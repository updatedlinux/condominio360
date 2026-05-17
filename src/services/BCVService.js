const axios = require('axios');
const ExchangeRateModel = require('../models/ExchangeRateModel');
const {
    getHistoricoFetchTargets,
    getMinimumRequiredRateDate,
    toHistoricoPath,
    normalizeRateDate,
    isRateDateAdequate,
    getCaracasParts
} = require('../utils/bcvFiscalCalendar');

/**
 * Tasas BCV oficiales vía ve.dolarapi.com (sin API key).
 * La tasa fiscal se obtiene del endpoint histórico para el día hábil bancario siguiente
 * (no del endpoint /dolares/oficial, que puede ir desfasado).
 */
const API_USD = 'https://ve.dolarapi.com/v1/dolares/oficial';
const API_EUR = 'https://ve.dolarapi.com/v1/euros/oficial';
const API_HIST_USD = 'https://ve.dolarapi.com/v1/historicos/dolares/oficial';
const API_HIST_EUR = 'https://ve.dolarapi.com/v1/historicos/euros/oficial';

class BCVService {
    constructor() {
        this._lastApiCheckAtUtc = null;
        this._lastApiOkAtUtc = null;
        this._lastApiError = null;
        this._lastApiStatus = null;
        this._lastFetchMode = null; // 'historico' | 'oficial' | null
        this._lastFetchTargets = null;
    }

    invalidateApiKeyCache() {}

    _extractEffectiveDateFromDolarApi(isoOrDate) {
        if (!isoOrDate || typeof isoOrDate !== 'string') return null;
        const m = isoOrDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        const d = new Date(isoOrDate);
        if (!isNaN(d.getTime())) {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Caracas',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).formatToParts(d);
            const y = parts.find((p) => p.type === 'year')?.value;
            const mo = parts.find((p) => p.type === 'month')?.value;
            const da = parts.find((p) => p.type === 'day')?.value;
            if (y && mo && da) return `${y}-${mo}-${da}`;
            return d.toISOString().slice(0, 10);
        }
        return null;
    }

    _percentChange(prev, next) {
        const p = Number(prev);
        const n = Number(next);
        if (!p || isNaN(p) || isNaN(n)) return 0;
        return ((n - p) / p) * 100;
    }

    /**
     * @param {Object} data
     * @returns {boolean}
     */
    _isHistoricoRateValid(data) {
        if (!data || typeof data !== 'object') return false;
        const promedio = parseFloat(data.promedio);
        return !isNaN(promedio) && promedio > 0;
    }

    /**
     * Consulta tasa histórica para una fecha (YYYY-MM-DD).
     * @param {string} dateYmd
     * @returns {Promise<{ usd: Object, eur: Object, date: string }|null>}
     */
    async fetchHistoricoForDate(dateYmd) {
        const path = toHistoricoPath(dateYmd);
        const headers = { Accept: 'application/json', 'User-Agent': 'Condominio360/1.0' };

        try {
            const [usdRes, eurRes] = await Promise.all([
                axios.get(`${API_HIST_USD}/${path}`, { timeout: 30000, headers, validateStatus: (s) => s === 200 || s === 404 }),
                axios.get(`${API_HIST_EUR}/${path}`, { timeout: 30000, headers, validateStatus: (s) => s === 200 || s === 404 })
            ]);

            if (usdRes.status !== 200 || eurRes.status !== 200) {
                return null;
            }
            if (!this._isHistoricoRateValid(usdRes.data) || !this._isHistoricoRateValid(eurRes.data)) {
                return null;
            }

            const date =
                this._extractEffectiveDateFromDolarApi(usdRes.data.fecha) ||
                this._extractEffectiveDateFromDolarApi(eurRes.data.fecha) ||
                dateYmd;

            return {
                date,
                usd: usdRes.data,
                eur: eurRes.data,
                usdRate: parseFloat(usdRes.data.promedio),
                eurRate: parseFloat(eurRes.data.promedio)
            };
        } catch (error) {
            if (error.response?.status === 404) return null;
            throw error;
        }
    }

    /**
     * Busca la tasa fiscal en el API histórico según calendario venezolano.
     * @param {Date} [referenceDate]
     * @returns {Promise<Object|null>}
     */
    async fetchFiscalFromHistorico(referenceDate = new Date()) {
        const targets = getHistoricoFetchTargets(referenceDate);
        this._lastFetchTargets = targets;

        if (targets.length === 0) {
            console.log('📅 Fin de semana (hora Vzla): no hay publicación BCV; se mantiene la última tasa.');
            this._lastFetchMode = null;
            return null;
        }

        console.log(`🔍 Objetivos histórico BCV: ${targets.join(' → ')}`);

        for (const target of targets) {
            try {
                const row = await this.fetchHistoricoForDate(target);
                if (!row) {
                    console.log(`   ○ ${target}: sin tasa (feriado o aún no publicada)`);
                    continue;
                }
                console.log(`   ✓ ${row.date}: USD ${row.usdRate} | EUR ${row.eurRate}`);

                const prev = await ExchangeRateModel.getLatestBeforeDate(row.date);
                const changeUsd = prev ? this._percentChange(prev.usd_rate, row.usdRate) : 0;
                const changeEur = prev ? this._percentChange(prev.eur_rate, row.eurRate) : 0;

                this._lastFetchMode = 'historico';
                return {
                    date: row.date,
                    usd: row.usdRate,
                    eur: row.eurRate,
                    changePercentageUsd: Math.round(changeUsd * 100) / 100,
                    changePercentageEur: Math.round(changeEur * 100) / 100,
                    rawData: { usd: row.usd, eur: row.eur, fetchTargets: targets, resolvedTarget: target }
                };
            } catch (err) {
                console.warn(`   ⚠ ${target}: ${err.message}`);
            }
        }

        console.warn('⚠️ Ningún objetivo histórico devolvió tasa; se reintentará más tarde.');
        return null;
    }

    /**
     * Fallback: endpoint oficial vigente (puede ir desfasado respecto al día fiscal).
     * @returns {Promise<Object|null>}
     */
    async fetchFromAPI() {
        try {
            this._lastApiCheckAtUtc = new Date().toISOString();
            this._lastApiStatus = null;
            this._lastApiError = null;
            console.log('🔄 Consultando API BCV oficial (fallback ve.dolarapi.com)...');

            const [usdRes, eurRes] = await Promise.all([
                axios.get(API_USD, {
                    timeout: 30000,
                    headers: { Accept: 'application/json', 'User-Agent': 'Condominio360/1.0' }
                }),
                axios.get(API_EUR, {
                    timeout: 30000,
                    headers: { Accept: 'application/json', 'User-Agent': 'Condominio360/1.0' }
                })
            ]);

            if (usdRes.status !== 200 || !usdRes.data || eurRes.status !== 200 || !eurRes.data) {
                this._lastApiStatus = 'error';
                this._lastApiError = 'Respuesta inválida de la API';
                return null;
            }

            const usd = parseFloat(usdRes.data.promedio);
            const eur = parseFloat(eurRes.data.promedio);
            if (isNaN(usd) || isNaN(eur)) return null;

            const date =
                this._extractEffectiveDateFromDolarApi(usdRes.data.fechaActualizacion) ||
                this._extractEffectiveDateFromDolarApi(eurRes.data.fechaActualizacion);
            if (!date) return null;

            const prev = await ExchangeRateModel.getLatestBeforeDate(date);
            const changeUsd = prev ? this._percentChange(prev.usd_rate, usd) : 0;
            const changeEur = prev ? this._percentChange(prev.eur_rate, eur) : 0;

            this._lastFetchMode = 'oficial';
            this._lastApiStatus = 'ok';
            this._lastApiOkAtUtc = new Date().toISOString();

            return {
                date,
                usd,
                eur,
                changePercentageUsd: Math.round(changeUsd * 100) / 100,
                changePercentageEur: Math.round(changeEur * 100) / 100,
                rawData: { usd: usdRes.data, eur: eurRes.data, fallback: true }
            };
        } catch (error) {
            console.error('❌ Error API BCV oficial:', error.message);
            this._lastApiCheckAtUtc = this._lastApiCheckAtUtc || new Date().toISOString();
            this._lastApiStatus = 'error';
            this._lastApiError = error?.message || 'Error desconocido';
            return null;
        }
    }

    /**
     * Obtiene y persiste la tasa fiscal (histórico primero).
     * @param {Date} [referenceDate]
     * @returns {Promise<Object|null>}
     */
    async fetchAndSave(referenceDate = new Date()) {
        this._lastApiCheckAtUtc = new Date().toISOString();

        let rateData = await this.fetchFiscalFromHistorico(referenceDate);

        if (!rateData) {
            const parts = getCaracasParts(referenceDate);
            const targets = getHistoricoFetchTargets(referenceDate);
            const minRequired = getMinimumRequiredRateDate(referenceDate);
            const latest = await ExchangeRateModel.getLatest();

            if (targets.length === 0 && latest) {
                console.log(`✅ Fin de semana: usando última tasa (${normalizeRateDate(latest.rate_date)})`);
                return {
                    date: normalizeRateDate(latest.rate_date),
                    usd: parseFloat(latest.usd_rate),
                    eur: parseFloat(latest.eur_rate),
                    changePercentageUsd: latest.change_percentage_usd,
                    changePercentageEur: latest.change_percentage_eur,
                    source: 'database_weekend'
                };
            }

            if (latest && isRateDateAdequate(latest.rate_date, minRequired)) {
                console.log(`✅ Ya hay tasa adecuada en BD (${normalizeRateDate(latest.rate_date)} >= ${minRequired})`);
                return {
                    date: normalizeRateDate(latest.rate_date),
                    usd: parseFloat(latest.usd_rate),
                    eur: parseFloat(latest.eur_rate),
                    changePercentageUsd: latest.change_percentage_usd,
                    changePercentageEur: latest.change_percentage_eur,
                    source: 'database'
                };
            }

            console.log('⚠️ Histórico vacío; intentando fallback endpoint oficial...');
            rateData = await this.fetchFromAPI();
        } else {
            this._lastApiStatus = 'ok';
            this._lastApiOkAtUtc = new Date().toISOString();
        }

        if (!rateData) return null;

        const success = await ExchangeRateModel.upsert(rateData);
        if (success) {
            console.log(`✅ Tasa BCV guardada (fecha fiscal ${rateData.date}): USD ${rateData.usd}`);
            return rateData;
        }
        console.error('❌ Error al guardar tasa BCV');
        return null;
    }

    async getLatestRate() {
        const latest = await ExchangeRateModel.getLatest();
        if (latest) {
            return {
                date: normalizeRateDate(latest.rate_date),
                usd: latest.usd_rate,
                eur: latest.eur_rate,
                changePercentageUsd: latest.change_percentage_usd,
                changePercentageEur: latest.change_percentage_eur,
                source: 'database'
            };
        }
        console.log('⚠️ No hay tasas en DB, consultando API histórica fiscal...');
        return await this.fetchAndSave();
    }

    async getPaginatedRates(page = 1, limit = 4) {
        return await ExchangeRateModel.getPaginated(page, limit);
    }

    /**
     * ¿Falta la tasa fiscal requerida para operar hoy?
     */
    async needsUpdate(referenceDate = new Date()) {
        try {
            this._lastApiCheckAtUtc = new Date().toISOString();
            const minRequired = getMinimumRequiredRateDate(referenceDate);
            const latest = await ExchangeRateModel.getLatest();

            if (!latest) {
                console.log(`📅 Sin tasas en BD; se requiere al menos ${minRequired}`);
                return true;
            }

            const stored = normalizeRateDate(latest.rate_date);
            if (isRateDateAdequate(stored, minRequired)) {
                console.log(`✅ Tasa en BD (${stored}) cubre el día fiscal requerido (${minRequired})`);
                return false;
            }

            console.log(`📅 Tasa en BD (${stored}) no cubre ${minRequired}; se requiere actualización`);
            return true;
        } catch (error) {
            console.error('❌ Error al verificar necesidad de actualización:', error.message);
            this._lastApiStatus = 'error';
            this._lastApiError = error?.message || 'Error desconocido';
            return true;
        }
    }

    getApiStatusMeta() {
        return {
            lastApiCheckAtUtc: this._lastApiCheckAtUtc,
            lastApiOkAtUtc: this._lastApiOkAtUtc,
            lastApiStatus: this._lastApiStatus,
            lastApiError: this._lastApiError,
            lastFetchMode: this._lastFetchMode,
            lastFetchTargets: this._lastFetchTargets,
            minimumRequiredDate: getMinimumRequiredRateDate(),
            historicoTargets: getHistoricoFetchTargets()
        };
    }

    async updateIfNeeded(referenceDate = new Date()) {
        const needsUpdate = await this.needsUpdate(referenceDate);
        if (needsUpdate) {
            console.log('📅 Actualizando tasa fiscal BCV (histórico día hábil siguiente)...');
            const saved = await this.fetchAndSave(referenceDate);
            if (saved && !saved.source?.startsWith('database')) return saved;
            const latest = await this.getLatestRate();
            console.warn('⚠️ No se pudo actualizar desde API. Se mantiene la tasa en BD si existe.');
            return latest;
        }
        const latest = await this.getLatestRate();
        if (latest) {
            console.log(`✅ Tasa fiscal vigente: ${latest.date} (USD: ${latest.usd})`);
        }
        return latest;
    }
}

module.exports = new BCVService();
