const axios = require('axios');
const ExchangeRateModel = require('../models/ExchangeRateModel');

/**
 * Tasas BCV oficiales vía ve.dolarapi.com (sin API key).
 * La variación % se calcula respecto al último registro en BD con fecha anterior a la tasa actual.
 */
const API_USD = 'https://ve.dolarapi.com/v1/dolares/oficial';
const API_EUR = 'https://ve.dolarapi.com/v1/euros/oficial';

class BCVService {
    /**
     * Reservado por compatibilidad; ya no hay caché de clave API.
     */
    invalidateApiKeyCache() {}

    /**
     * @param {string} isoOrDate - ISO 8601 o similar
     * @returns {string|null} YYYY-MM-DD
     */
    _extractEffectiveDateFromDolarApi(isoOrDate) {
        if (!isoOrDate || typeof isoOrDate !== 'string') return null;
        const m = isoOrDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        const d = new Date(isoOrDate);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return null;
    }

    /**
     * @param {number} prev
     * @param {number} next
     * @returns {number}
     */
    _percentChange(prev, next) {
        const p = Number(prev);
        const n = Number(next);
        if (!p || isNaN(p) || isNaN(n)) return 0;
        return ((n - p) / p) * 100;
    }

    /**
     * Consulta ve.dolarapi.com (USD + EUR) y arma el objeto para guardar.
     * @returns {Promise<Object|null>}
     */
    async fetchFromAPI() {
        try {
            console.log('🔄 Consultando API BCV (ve.dolarapi.com)...');

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
                console.error('❌ Respuesta inválida de la API BCV');
                return null;
            }

            const u = usdRes.data;
            const e = eurRes.data;

            const usd = parseFloat(u.promedio);
            const eur = parseFloat(e.promedio);
            if (isNaN(usd) || isNaN(eur)) {
                console.error('❌ Valores de tasa inválidos (promedio)');
                return null;
            }

            const date =
                this._extractEffectiveDateFromDolarApi(u.fechaActualizacion) ||
                this._extractEffectiveDateFromDolarApi(e.fechaActualizacion);
            if (!date) {
                console.error('❌ La API no devolvió fecha efectiva (fechaActualizacion).');
                return null;
            }

            const prev = await ExchangeRateModel.getLatestBeforeDate(date);
            const changeUsd = prev ? this._percentChange(prev.usd_rate, usd) : 0;
            const changeEur = prev ? this._percentChange(prev.eur_rate, eur) : 0;

            const rateData = {
                date,
                usd,
                eur,
                changePercentageUsd: Math.round(changeUsd * 100) / 100,
                changePercentageEur: Math.round(changeEur * 100) / 100,
                rawData: { usd: u, eur: e }
            };

            return rateData;
        } catch (error) {
            console.error('❌ Error al consultar API BCV:', error.message);
            if (error.code === 'ECONNABORTED') {
                console.error('⏰ Timeout al consultar la API BCV');
            } else if (error.response) {
                console.error('📡 Error HTTP:', error.response.status, error.response.statusText);
            }
            return null;
        }
    }

    /**
     * Obtiene y guarda la tasa actual desde la API
     * @returns {Promise<Object|null>}
     */
    async fetchAndSave() {
        const rateData = await this.fetchFromAPI();
        if (!rateData) return null;

        const success = await ExchangeRateModel.upsert(rateData);
        if (success) {
            console.log('✅ Tasa BCV guardada exitosamente:', rateData);
            return rateData;
        }
        console.error('❌ Error al guardar tasa BCV');
        return null;
    }

    /**
     * @returns {Promise<Object|null>}
     */
    async getLatestRate() {
        let rate = await ExchangeRateModel.getLatest();
        if (rate) {
            return {
                date: rate.rate_date,
                usd: rate.usd_rate,
                eur: rate.eur_rate,
                changePercentageUsd: rate.change_percentage_usd,
                changePercentageEur: rate.change_percentage_eur,
                source: 'database'
            };
        }
        console.log('⚠️ No hay tasas en DB, consultando API...');
        return await this.fetchAndSave();
    }

    /**
     * @param {number} page
     * @param {number} limit
     * @returns {Promise<Object>}
     */
    async getPaginatedRates(page = 1, limit = 4) {
        return await ExchangeRateModel.getPaginated(page, limit);
    }

    /**
     * @returns {Promise<boolean>}
     */
    async needsUpdate() {
        try {
            const response = await axios.get(API_USD, {
                timeout: 10000,
                headers: { Accept: 'application/json', 'User-Agent': 'Condominio360/1.0' }
            });
            if (response.status !== 200 || !response.data) return true;
            const apiDate = this._extractEffectiveDateFromDolarApi(response.data.fechaActualizacion);
            if (!apiDate) {
                console.log('⚠️ API no devolvió fecha efectiva, forzando actualización');
                return true;
            }
            const exists = await ExchangeRateModel.existsForDate(apiDate);
            if (exists) {
                console.log(`✅ Ya existe tasa para la fecha de la API (${apiDate})`);
            } else {
                console.log(`📅 API tiene tasa para ${apiDate} (no en DB), se requiere actualización`);
            }
            return !exists;
        } catch (error) {
            console.error('❌ Error al verificar necesidad de actualización:', error.message);
            return true;
        }
    }

    /**
     * @returns {Promise<Object|null>}
     */
    async updateIfNeeded() {
        const needsUpdate = await this.needsUpdate();
        if (needsUpdate) {
            console.log('📅 Nueva tasa disponible en API, actualizando...');
            return await this.fetchAndSave();
        }
        const latest = await this.getLatestRate();
        if (latest) {
            console.log(`✅ Ya existe tasa para ${latest.date} (USD: ${latest.usd})`);
        }
        return latest;
    }
}

module.exports = new BCVService();
