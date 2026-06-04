const ExchangeRateModel = require('../models/ExchangeRateModel');

const FREEZE_WINDOW_DAYS = 5;
const TZ_CARACAS = 'America/Caracas';

/**
 * Cálculos FX para balance financiero SaaS (Condominio360).
 * Spread = USD facturado − (VES cobrados / tasa BCV del día de pago).
 * Positivo = pérdida cambiaria; negativo = ganancia.
 */
class SaaSBalanceFxService {
    static toYmd(value) {
        return SaaSBalanceFxService.toYmdLocal(value);
    }

    /** Fecha calendario en Venezuela (evita desfase UTC en paid_at). */
    static toYmdLocal(value) {
        if (!value) return null;
        if (typeof value === 'string') {
            const s = value.trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        }
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        try {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: TZ_CARACAS,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).formatToParts(d);
            const y = parts.find((p) => p.type === 'year')?.value;
            const m = parts.find((p) => p.type === 'month')?.value;
            const day = parts.find((p) => p.type === 'day')?.value;
            if (y && m && day) return `${y}-${m}-${day}`;
        } catch (_) { /* fallback abajo */ }
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    /** DD/MM/YYYY (Venezuela) — también D/M/YYYY */
    static parseTransferDate(raw) {
        if (!raw) return null;
        const s = String(raw).trim();
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        return null;
    }

    static compareYmd(a, b) {
        if (!a || !b) return 0;
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }

    /**
     * Fecha efectiva del cobro para spread FX.
     * Prioridad: paid_at (confirmación) > confirmed_at > fecha_transferencia (si es plausible).
     */
    static resolvePaymentDate(invoice, paymentReport) {
        const fromPaidAt = invoice?.paid_at ? SaaSBalanceFxService.toYmdLocal(invoice.paid_at) : null;
        const fromConfirmed = paymentReport?.confirmed_at
            ? SaaSBalanceFxService.toYmdLocal(paymentReport.confirmed_at)
            : null;

        const transferParsed = SaaSBalanceFxService.parseTransferDate(paymentReport?.fecha_transferencia);
        const transferYmd = transferParsed ? SaaSBalanceFxService.toYmdLocal(transferParsed) : null;

        const invoiceAnchor = SaaSBalanceFxService.toYmdLocal(invoice?.created_at)
            || SaaSBalanceFxService.toYmdLocal(invoice?.bcv_rate_date);

        if (fromPaidAt) return fromPaidAt;
        if (fromConfirmed) return fromConfirmed;

        if (transferYmd) {
            if (!invoiceAnchor || SaaSBalanceFxService.compareYmd(transferYmd, invoiceAnchor) >= 0) {
                return transferYmd;
            }
        }

        return transferYmd || null;
    }

    static resolveTransferDate(paymentReport) {
        const transferParsed = SaaSBalanceFxService.parseTransferDate(paymentReport?.fecha_transferencia);
        return transferParsed ? SaaSBalanceFxService.toYmdLocal(transferParsed) : null;
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
        const invoiceRateDate = SaaSBalanceFxService.toYmdLocal(invoice.bcv_rate_date);

        const paymentReport = {
            fecha_transferencia: invoice.fecha_transferencia,
            confirmed_at: invoice.payment_confirmed_at || invoice.confirmed_at
        };
        const transferDate = SaaSBalanceFxService.resolveTransferDate(paymentReport);
        const paymentDate = SaaSBalanceFxService.resolvePaymentDate(invoice, paymentReport);
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
        const transferBeforeInvoice = transferDate && invoiceRateDate
            && SaaSBalanceFxService.compareYmd(transferDate, invoiceRateDate) < 0;

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
            transfer_date: transferDate,
            transfer_date_raw: invoice.fecha_transferencia || null,
            payment_date: paymentDate,
            payment_date_source: invoice.paid_at
                ? 'paid_at'
                : (paymentReport.confirmed_at ? 'confirmed_at' : 'transfer'),
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
            freeze_spread_window: invoiceInFreeze && paymentInFreeze && daysToPay != null && daysToPay >= 0 && daysToPay <= FREEZE_WINDOW_DAYS,
            transfer_date_warning: transferBeforeInvoice || false
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
