const axios = require('axios');
const ExchangeRateModel = require('../models/ExchangeRateModel');

/**
 * Servicio para consultar y gestionar las tasas de cambio BCV
 */
class BCVService {
    constructor() {
        this.apiUrl = 'https://api.dolarvzla.com/public/bcv/exchange-rate';
        this.apiKey = process.env.BCV_API_KEY || '1a5f1abbecf35cd232a178b213fca110c105edec7e089cfdbd93f93f9609b1c9';
    }

    /**
     * Consulta la API externa para obtener las tasas de cambio actuales
     * @returns {Promise<Object|null>}
     */
    async fetchFromAPI() {
        try {
            console.log('🔄 Consultando API BCV para tasas de cambio...');
            
            const response = await axios.get(this.apiUrl, {
                timeout: 30000,
                headers: {
                    'x-dolarvzla-key': this.apiKey,
                    'Accept': 'application/json',
                    'User-Agent': 'Condominio360/1.0'
                }
            });

            if (response.status === 200 && response.data) {
                console.log('✅ Datos obtenidos de la API BCV:', response.data);
                return this.parseResponse(response.data);
            } else {
                console.error('❌ Respuesta inválida de la API BCV');
                return null;
            }
        } catch (error) {
            console.error('❌ Error al consultar API BCV:', error.message);
            
            if (error.code === 'ECONNABORTED') {
                console.error('⏰ Timeout al consultar la API BCV');
            } else if (error.response) {
                console.error('📡 Error HTTP:', error.response.status, error.response.statusText);
                console.error('📄 Respuesta:', error.response.data);
            }
            
            return null;
        }
    }

    /**
     * Extrae la fecha efectiva de la tasa desde la API (fecha a la que corresponde, no la de extracción).
     * La API BCV registra la fecha que la tasa representa.
     * @returns {string|null} YYYY-MM-DD
     */
    _extractEffectiveDate(data) {
        const candidates = [
            data.current?.fecha,
            data.current?.effective_date,
            data.current?.date_value,
            data.current?.date,
            data.fecha,
            data.date,
            data.rate_date
        ].filter(Boolean);
        for (const raw of candidates) {
            if (typeof raw !== 'string') continue;
            const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (m) return `${m[1]}-${m[2]}-${m[3]}`;
            const d = new Date(raw);
            if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        }
        return null;
    }

    /**
     * Parsea la respuesta de la API
     * @param {Object} data - Datos de la respuesta
     * @returns {Object|null}
     */
    parseResponse(data) {
        try {
            if (!data.current || !data.current.usd || !data.current.eur) {
                console.error('❌ Estructura de datos inválida en la respuesta');
                return null;
            }

            const usd = parseFloat(data.current.usd);
            const eur = parseFloat(data.current.eur);
            
            if (isNaN(usd) || isNaN(eur)) {
                console.error('❌ Valores de tasa de cambio inválidos');
                return null;
            }

            // Parse change percentages if available
            const changeUsd = data.changePercentage?.usd ? parseFloat(data.changePercentage.usd) : 0;
            const changeEur = data.changePercentage?.eur ? parseFloat(data.changePercentage.eur) : 0;

            // Usar SOLO la fecha efectiva de la API (fecha a la que corresponde la tasa, no la de extracción)
            const date = this._extractEffectiveDate(data);
            if (!date) {
                console.error('❌ La API no devolvió fecha efectiva. No se guardará para evitar datos incorrectos.');
                return null;
            }

            return {
                date: date,
                usd: usd,
                eur: eur,
                changePercentageUsd: changeUsd,
                changePercentageEur: changeEur,
                rawData: data
            };
        } catch (error) {
            console.error('❌ Error al parsear respuesta:', error.message);
            return null;
        }
    }

    /**
     * Obtiene y guarda la tasa actual desde la API
     * @returns {Promise<Object|null>}
     */
    async fetchAndSave() {
        const rateData = await this.fetchFromAPI();
        
        if (!rateData) {
            return null;
        }

        const success = await ExchangeRateModel.upsert(rateData);
        
        if (success) {
            console.log('✅ Tasa BCV guardada exitosamente:', rateData);
            return rateData;
        } else {
            console.error('❌ Error al guardar tasa BCV');
            return null;
        }
    }

    /**
     * Obtiene la tasa más reciente (de la DB o la API si no hay)
     * @returns {Promise<Object|null>}
     */
    async getLatestRate() {
        // Primero intentar obtener de la base de datos
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

        // Si no hay en DB, intentar obtener de la API
        console.log('⚠️ No hay tasas en DB, consultando API...');
        return await this.fetchAndSave();
    }

    /**
     * Obtiene tasas paginadas para mostrar en el dashboard
     * @param {number} page
     * @param {number} limit
     * @returns {Promise<Object>}
     */
    async getPaginatedRates(page = 1, limit = 4) {
        return await ExchangeRateModel.getPaginated(page, limit);
    }

    /**
     * Verifica si necesitamos actualizar la tasa
     * Consulta la API y verifica si ya tenemos la tasa más reciente
     * @returns {Promise<boolean>}
     */
    async needsUpdate() {
        try {
            // Consultar la API para obtener la fecha de la tasa más reciente
            const response = await axios.get(this.apiUrl, {
                timeout: 10000,
                headers: {
                    'x-dolarvzla-key': this.apiKey,
                    'Accept': 'application/json',
                    'User-Agent': 'Condominio360/1.0'
                }
            });

            if (response.status === 200 && response.data && response.data.current) {
                const apiDate = this._extractEffectiveDate(response.data);
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
            }
            
            // Si no podemos obtener la fecha de la API, asumimos que necesitamos actualizar
            return true;
        } catch (error) {
            console.error('❌ Error al verificar necesidad de actualización:', error.message);
            // En caso de error, intentar actualizar de todos modos
            return true;
        }
    }

    /**
     * Actualiza la tasa si es necesario
     * @returns {Promise<Object|null>}
     */
    async updateIfNeeded() {
        const needsUpdate = await this.needsUpdate();
        
        if (needsUpdate) {
            console.log('📅 Nueva tasa disponible en API, actualizando...');
            return await this.fetchAndSave();
        } else {
            const latest = await this.getLatestRate();
            if (latest) {
                console.log(`✅ Ya existe tasa para ${latest.date} (USD: ${latest.usd})`);
            }
            return latest;
        }
    }
}

module.exports = new BCVService();
