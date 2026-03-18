const ExchangeRateModel = require('../models/ExchangeRateModel');

/**
 * Servicio de tasa BCV para facturación SaaS
 * Regla: Días 1-5 del mes → tasa del 1ro del mes
 *        Día 6+ → tasa diaria = la más reciente en la DB (por rate_date)
 * IMPORTANTE: Siempre usamos la fecha efectiva de la tasa (rate_date de la DB),
 * que proviene de la API externa, no la fecha de consulta.
 */
class SaaSBillingRateService {
    /**
     * Obtiene la tasa BCV a usar para una factura SaaS
     * Siempre usa la tasa más reciente (getLatest) y su rate_date (fecha efectiva de la API)
     * @param {Date} [referenceDate] - Fecha de referencia (default: hoy) - solo para appliedRule
     * @returns {Promise<Object>} { rate, rateDate, appliedRule }
     */
    static async getApplicableRate(referenceDate = new Date()) {
        const now = referenceDate;
        const dayOfMonth = now.getDate();
        const appliedRule = (dayOfMonth >= 1 && dayOfMonth <= 5) ? 'FIRST_OF_MONTH' : 'DAILY';

        let rate;
        let rateDateStr;

        if (appliedRule === 'FIRST_OF_MONTH') {
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const firstOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
            rate = await ExchangeRateModel.getByDate(firstOfMonth);
            if (rate) {
                rateDateStr = rate.rate_date ? new Date(rate.rate_date).toISOString().split('T')[0] : firstOfMonth;
            }
        }

        if (!rate) {
            // Siempre usar la tasa más reciente; su rate_date es la fecha efectiva (de la API)
            rate = await ExchangeRateModel.getLatest();
            rateDateStr = rate?.rate_date ? new Date(rate.rate_date).toISOString().split('T')[0] : null;
        }

        const usdRate = rate?.usd_rate || 0;

        return {
            rate: usdRate,
            rateDate: rateDateStr,
            appliedRule,
            raw: rate
        };
    }
}

module.exports = SaaSBillingRateService;
