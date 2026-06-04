const { sql, connectDB } = require('../config/database');
const ExchangeRateModel = require('../models/ExchangeRateModel');
const SaaSBalanceFxService = require('../services/SaaSBalanceFxService');
const { DEFAULT_SAAS_UNIT_PRICE_USD } = require('../constants/billingReminders');

/**
 * AdminBalanceController
 * Balance financiero C360: tasas BCV, cobros SaaS, spread cambiario
 */
class AdminBalanceController {

    /**
     * GET /api/admin/balance/exchange-rates
     * Tasas BCV para gráficas (últimos 30 días)
     */
    static async getExchangeRates(req, res) {
        try {
            const days = Math.min(parseInt(req.query.days) || 30, 90);
            const rates = await ExchangeRateModel.getRecentForChart(days);
            const latest = await ExchangeRateModel.getLatest();

            res.json({
                success: true,
                data: {
                    rates: rates.map(r => ({
                        date: r.rate_date,
                        usd: parseFloat(r.usd_rate) || 0,
                        eur: parseFloat(r.eur_rate) || 0
                    })),
                    latest: latest ? {
                        usd: parseFloat(latest.usd_rate) || 0,
                        eur: parseFloat(latest.eur_rate) || 0,
                        date: latest.rate_date
                    } : null
                }
            });
        } catch (error) {
            console.error('Get exchange rates error:', error);
            res.status(500).json({ error: 'Error al obtener tasas' });
        }
    }

    /**
     * GET /api/admin/balance/financial-summary
     * Facturación C360: VES cobrado, USD equivalente al pago, spread FX
     */
    static async getFinancialSummary(req, res) {
        try {
            const pool = await connectDB();
            const latestRate = await ExchangeRateModel.getLatest();
            const rateVes = latestRate ? parseFloat(latestRate.usd_rate) : 0;
            const ratesMap = await SaaSBalanceFxService.buildRatesMap();

            const now = new Date();
            const currentMonth = now.getMonth() + 1;
            const currentYear = now.getFullYear();

            const saasResult = await pool.request().query(`
                SELECT si.*, t.name AS tenant_name,
                    pr.fecha_transferencia,
                    pr.confirmed_at AS payment_confirmed_at
                FROM SaaSInvoices si
                INNER JOIN Tenants t ON si.tenant_id = t.id
                OUTER APPLY (
                    SELECT TOP 1 fecha_transferencia, confirmed_at
                    FROM SaaSPaymentReports
                    WHERE invoice_id = si.id AND status = N'CONFIRMED'
                    ORDER BY confirmed_at DESC
                ) pr
                WHERE t.active = 1
                ORDER BY si.period_year DESC, si.period_month DESC, t.name
            `);

            const propertiesByTenant = await pool.request().query(`
                SELECT tenant_id, COUNT(*) AS cnt FROM Properties GROUP BY tenant_id
            `);
            const propCount = {};
            for (const r of propertiesByTenant.recordset) {
                propCount[r.tenant_id] = r.cnt || 0;
            }

            const saasByMonth = {};
            const paidInvoices = [];
            const pendingInvoices = [];
            const tenantAgg = {};

            function ensureTenant(tenantId, tenantName) {
                if (!tenantAgg[tenantId]) {
                    tenantAgg[tenantId] = {
                        tenant_id: tenantId,
                        tenant_name: tenantName,
                        properties: propCount[tenantId] || 0,
                        invoiced_usd: 0,
                        paid_ves: 0,
                        paid_usd_equivalent: 0,
                        spread_usd: 0,
                        spread_in_freeze_window_usd: 0,
                        pending_usd: 0,
                        pending_ves: 0,
                        paid_invoice_count: 0,
                        pending_invoice_count: 0
                    };
                }
                return tenantAgg[tenantId];
            }

            for (const row of saasResult.recordset) {
                const key = `${row.period_year}-${String(row.period_month).padStart(2, '0')}`;
                if (!saasByMonth[key]) {
                    saasByMonth[key] = {
                        paid_usd: 0, paid_ves: 0, paid_usd_equivalent: 0, spread_usd: 0,
                        pending_usd: 0, pending_ves: 0
                    };
                }

                const agg = ensureTenant(row.tenant_id, row.tenant_name);

                if (row.status === 'PAID') {
                    const fx = SaaSBalanceFxService.analyzePaidInvoice(row, ratesMap);
                    paidInvoices.push(fx);

                    agg.invoiced_usd += fx.invoiced_usd;
                    agg.paid_ves += fx.paid_ves;
                    agg.paid_invoice_count += 1;
                    if (fx.paid_usd_equivalent != null) {
                        agg.paid_usd_equivalent += fx.paid_usd_equivalent;
                    }
                    if (fx.spread_usd != null) {
                        agg.spread_usd += fx.spread_usd;
                        if (fx.freeze_spread_window) {
                            agg.spread_in_freeze_window_usd += fx.spread_usd;
                        }
                    }

                    saasByMonth[key].paid_usd += fx.invoiced_usd;
                    saasByMonth[key].paid_ves += fx.paid_ves;
                    if (fx.paid_usd_equivalent != null) {
                        saasByMonth[key].paid_usd_equivalent += fx.paid_usd_equivalent;
                    }
                    if (fx.spread_usd != null) {
                        saasByMonth[key].spread_usd += fx.spread_usd;
                    }
                } else if (row.status === 'PENDING') {
                    const pending = SaaSBalanceFxService.analyzePendingInvoice(row, ratesMap, rateVes);
                    pendingInvoices.push(pending);

                    agg.pending_usd += pending.pending_usd;
                    agg.pending_ves += pending.pending_ves;
                    agg.pending_invoice_count += 1;

                    saasByMonth[key].pending_usd += pending.pending_usd;
                    saasByMonth[key].pending_ves += pending.pending_ves;
                }
            }

            // Incluir tenants activos sin facturas
            const activeTenants = await pool.request().query(`
                SELECT id, name FROM Tenants WHERE active = 1 ORDER BY name
            `);
            for (const t of activeTenants.recordset) {
                ensureTenant(t.id, t.name);
            }

            const tenantsList = Object.values(tenantAgg).sort((a, b) =>
                (a.tenant_name || '').localeCompare(b.tenant_name || '', 'es')
            );

            const monthLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
            const comparative = [];
            for (let i = 0; i < 6; i++) {
                let m = currentMonth - 1 - i;
                let y = currentYear;
                while (m <= 0) { m += 12; y--; }
                const key = `${y}-${String(m).padStart(2, '0')}`;
                const saas = saasByMonth[key] || {};
                comparative.unshift({
                    month: m,
                    year: y,
                    key,
                    label: `${monthLabels[m - 1]} ${y}`,
                    saas_paid_usd: saas.paid_usd || 0,
                    saas_paid_ves: saas.paid_ves || 0,
                    saas_paid_usd_equivalent: saas.paid_usd_equivalent || 0,
                    saas_spread_usd: saas.spread_usd || 0,
                    saas_pending_usd: saas.pending_usd || 0,
                    saas_pending_ves: saas.pending_ves || 0
                });
            }

            const UNIT_PRICE_USD = DEFAULT_SAAS_UNIT_PRICE_USD;
            const totalProps = Object.values(propCount).reduce((a, b) => a + b, 0);
            const projection = [];
            for (let i = 1; i <= 6; i++) {
                let m = currentMonth + i;
                let y = currentYear;
                if (m > 12) { m -= 12; y++; }
                const totalUsd = totalProps * UNIT_PRICE_USD;
                projection.push({
                    month: m,
                    year: y,
                    key: `${y}-${String(m).padStart(2, '0')}`,
                    properties: totalProps,
                    total_usd: totalUsd,
                    total_ves: rateVes ? totalUsd * rateVes : 0
                });
            }

            const totals = tenantsList.reduce((acc, t) => {
                acc.invoiced_usd += t.invoiced_usd;
                acc.paid_ves += t.paid_ves;
                acc.paid_usd_equivalent += t.paid_usd_equivalent;
                acc.spread_usd += t.spread_usd;
                acc.spread_in_freeze_window_usd += t.spread_in_freeze_window_usd;
                acc.pending_usd += t.pending_usd;
                acc.pending_ves += t.pending_ves;
                return acc;
            }, {
                invoiced_usd: 0,
                paid_ves: 0,
                paid_usd_equivalent: 0,
                spread_usd: 0,
                spread_in_freeze_window_usd: 0,
                pending_usd: 0,
                pending_ves: 0
            });

            paidInvoices.sort((a, b) => {
                const da = a.payment_date || a.invoice_rate_date || '';
                const db = b.payment_date || b.invoice_rate_date || '';
                return db.localeCompare(da);
            });

            res.json({
                success: true,
                data: {
                    latest_rate_ves: rateVes,
                    latest_rate_date: latestRate?.rate_date,
                    freeze_policy: {
                        window_days: 5,
                        description: 'Días 1-5: factura con tasa del 1ro del mes. Spread = USD facturado − (VES cobrados ÷ tasa BCV del día de pago).'
                    },
                    by_tenant: tenantsList,
                    paid_invoices: paidInvoices.slice(0, 50),
                    pending_invoices: pendingInvoices,
                    comparative,
                    projection,
                    totals
                }
            });
        } catch (error) {
            console.error('Get financial summary error:', error);
            res.status(500).json({ error: 'Error al obtener balance financiero' });
        }
    }
}

module.exports = AdminBalanceController;
