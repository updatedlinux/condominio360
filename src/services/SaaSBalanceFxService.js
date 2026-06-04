const ExchangeRateModel = require('../models/ExchangeRateModel');

const FREEZE_WINDOW_DAYS = 5;

/**
 * Cálculos FX para balance financiero SaaS (Condominio360).
 * Spread = USD facturado − (VES cobrados / tasa BCV del día de pago).
 * Positivo = pérdida cambiaria; negativo = ganancia.
 */
class SaaSBalanceFxService {
    static toYmd(value) {
        if (!value) return null;
        if (typeof value === 'string') {
            const s = value.trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        }
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
    }

    static parseTransferDate(raw) {
        if (!raw) return null;
        const s = String(raw).trim();
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    static resolvePaymentDate(invoice, paymentReport) {
        const fromTransfer = SaaSBalanceFxService.parseTransferDate(paymentReport?.fecha_transferencia);
        if (fromTransfer) return SaaSBalanceFxService.toYmd(fromTransfer);
        if (invoice?.paid_at) return SaaSBalanceFxService.toYmd(invoice.paid_at);
        if (paymentReport?.confirmed_at) return SaaSBalanceFxService.toYmd(paymentReport.confirmed_at);
        return null;
    }

    static isInFreezeWindow(dateYmd) {
        if (!dateYmd) return false;
        const day = parseInt(dateYmd.slice(8, 10), 10);
        return day >= 1 && day <= FREEZE_WINDOW_DAYS;
    }

    static daysBetween(fromYmd, toYmd) {
        if (!fromYmd || !toYmd) return null;
        const a = new Date(fromYmd + 'T12:00:00');
        const b = new Date(toYmd + 'T12:00:00');
        return Math.round((b - a) / (24 * 60 * 60 * 1000));
    }

    static async buildRatesMap() {
        const { connectDB } = require('../config/database');
        const pool = await connectDB();
        const result = await pool.request().query(`
            SELECT CONVERT(varchar(10), rate_date, 23) AS rate_date_ymd, usd_rate
            FROM ExchangeRates
            ORDER BY rate_date ASC
        `);
        const map = {};
        for (const row of result.recordset || []) {
            if (row.rate_date_ymd) {
                map[row.rate_date_ymd] = parseFloat(row.usd_rate) || 0;
            }
        }
        return map;
    }

    static lookupRate(dateYmd, ratesMap) {
        if (!dateYmd) return null;
        if (ratesMap[dateYmd] != null && ratesMap[dateYmd] > 0) {
            return { rate: ratesMap[dateYmd], rate_date: dateYmd, source: 'exact' };
        }
        const dates = Object.keys(ratesMap).filter((d) => d <= dateYmd).sort();
        if (dates.length === 0) return null;
        const fallbackDate = dates[dates.length - 1];
        return {
            rate: ratesMap[fallbackDate],
            rate_date: fallbackDate,
            source: 'prior'
        };
    }

    /**
     * @param {Object} invoice - fila SaaSInvoices + tenant_name, fecha_transferencia opcional
     * @param {Object} ratesMap - mapa YYYY-MM-DD → usd_rate
     */
    static analyzePaidInvoice(invoice, ratesMap) {
        const invoicedUsd = parseFloat(invoice.total_usd) || 0;
        const paidVes = parseFloat(invoice.paid_amount_ves ?? invoice.total_ves) || 0;
        const invoicedVes = parseFloat(invoice.total_ves) || 0;
        const invoiceRate = parseFloat(invoice.bcv_rate) || 0;
        const invoiceRateDate = SaaSBalanceFxService.toYmd(invoice.bcv_rate_date);
        const paymentDate = SaaSBalanceFxService.resolvePaymentDate(invoice, invoice);
        const paymentRateInfo = SaaSBalanceFxService.lookupRate(paymentDate, ratesMap);
        const paymentRate = paymentRateInfo?.rate || 0;

        let paidUsdEquiv = null;
        let spreadUsd = null;
        let spreadVes = null;
        if (paymentRate > 0) {
            paidUsdEquiv = paidVes / paymentRate;
            spreadUsd = invoicedUsd - paidUsdEquiv;
            spreadVes = spreadUsd * paymentRate;
        }

        const invoiceInFreeze = SaaSBalanceFxService.isInFreezeWindow(invoiceRateDate);
        const paymentInFreeze = SaaSBalanceFxService.isInFreezeWindow(paymentDate);
        const daysToPay = SaaSBalanceFxService.daysBetween(invoiceRateDate, paymentDate);

        return {
            invoice_id: invoice.id,
            tenant_id: invoice.tenant_id,
            tenant_name: invoice.tenant_name,
            period_month: invoice.period_month,
            period_year: invoice.period_year,
            status: invoice.status,
            invoiced_usd: invoicedUsd,
            invoiced_ves: invoicedVes,
            paid_ves: paidVes,
            invoice_rate: invoiceRate,
            invoice_rate_date: invoiceRateDate,
            payment_date: paymentDate,
            payment_rate: paymentRate || null,
            payment_rate_date: paymentRateInfo?.rate_date || null,
            payment_rate_source: paymentRateInfo?.source || null,
            paid_usd_equivalent: paidUsdEquiv,
            spread_usd: spreadUsd,
            spread_ves: spreadVes,
            rate_delta: paymentRate && invoiceRate ? paymentRate - invoiceRate : null,
            days_to_payment: daysToPay,
            invoice_in_freeze_window: invoiceInFreeze,
            payment_in_freeze_window: paymentInFreeze,
            freeze_spread_window: invoiceInFreeze && paymentInFreeze && daysToPay != null && daysToPay >= 0 && daysToPay <= FREEZE_WINDOW_DAYS
        };
    }

    static analyzePendingInvoice(invoice, ratesMap, latestRate) {
        const pendingUsd = parseFloat(invoice.total_usd) || 0;
        const pendingVes = parseFloat(invoice.total_ves) || 0;
        const invoiceRate = parseFloat(invoice.bcv_rate) || 0;
        const invoiceRateDate = SaaSBalanceFxService.toYmd(invoice.bcv_rate_date);
        const currentRate = latestRate || 0;
        const currentUsdEquiv = currentRate > 0 ? pendingVes / currentRate : null;
        const exposureUsd = currentUsdEquiv != null ? pendingUsd - currentUsdEquiv : null;

        return {
            invoice_id: invoice.id,
            tenant_id: invoice.tenant_id,
            tenant_name: invoice.tenant_name,
            period_month: invoice.period_month,
            period_year: invoice.period_year,
            pending_usd: pendingUsd,
            pending_ves: pendingVes,
            invoice_rate: invoiceRate,
            invoice_rate_date: invoiceRateDate,
            current_rate: currentRate || null,
            current_usd_equivalent: currentUsdEquiv,
            exposure_usd: exposureUsd
        };
    }
}

module.exports = SaaSBalanceFxService;
