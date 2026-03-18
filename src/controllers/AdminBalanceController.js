const { sql, connectDB } = require('../config/database');
const ExchangeRateModel = require('../models/ExchangeRateModel');

/**
 * AdminBalanceController
 * Balance financiero: tasas BCV y cobros por condominio
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
     * Balance financiero por condominio: cobrado, SaaS, comparativa, proyección
     */
    static async getFinancialSummary(req, res) {
        try {
            const pool = await connectDB();
            const latestRate = await ExchangeRateModel.getLatest();
            const rateVes = latestRate ? parseFloat(latestRate.usd_rate) : 0;

            const now = new Date();
            const currentMonth = now.getMonth() + 1;
            const currentYear = now.getFullYear();

            // Cobrado por condominio (BillingInvoices PAID/PENDING) y conteo de propiedades
            const condoCollectedResult = await pool.request()
                .query(`
                    SELECT t.id as tenant_id, t.name as tenant_name,
                        ISNULL(SUM(CASE WHEN i.status = 'PAID' THEN i.paid_amount_ves ELSE 0 END), 0) as total_collected_ves,
                        ISNULL(SUM(CASE WHEN i.status = 'PENDING' THEN i.assigned_amount_ves ELSE 0 END), 0) as total_pending_ves
                    FROM Tenants t
                    LEFT JOIN Properties p ON t.id = p.tenant_id
                    LEFT JOIN BillingInvoices i ON p.id = i.property_id
                    WHERE t.active = 1
                    GROUP BY t.id, t.name
                `);

            // SaaS: generadas (PAID) y por generar (PENDING)
            const saasResult = await pool.request()
                .query(`
                    SELECT si.tenant_id, t.name as tenant_name,
                        si.period_month, si.period_year,
                        si.total_usd, si.total_ves, si.status,
                        si.property_count
                    FROM SaaSInvoices si
                    INNER JOIN Tenants t ON si.tenant_id = t.id
                    ORDER BY si.period_year DESC, si.period_month DESC
                `);

            // Por mes: SaaS pagado y pendiente
            const saasByMonth = {};
            const tenantIds = new Set();
            for (const row of saasResult.recordset) {
                const key = `${row.period_year}-${String(row.period_month).padStart(2, '0')}`;
                if (!saasByMonth[key]) saasByMonth[key] = { paid_usd: 0, paid_ves: 0, pending_usd: 0, pending_ves: 0 };
                tenantIds.add(row.tenant_id);
                if (row.status === 'PAID') {
                    saasByMonth[key].paid_usd += parseFloat(row.total_usd) || 0;
                    saasByMonth[key].paid_ves += parseFloat(row.total_ves) || 0;
                } else {
                    saasByMonth[key].pending_usd += parseFloat(row.total_usd) || 0;
                    saasByMonth[key].pending_ves += parseFloat(row.total_ves) || 0;
                }
            }

            // Cobro condominio por mes (BillingInvoices)
            const condoByMonthResult = await pool.request()
                .query(`
                    SELECT pr.billing_month, pr.billing_year,
                        SUM(CASE WHEN i.status = 'PAID' THEN i.paid_amount_ves ELSE 0 END) as collected_ves,
                        SUM(CASE WHEN i.status = 'PENDING' THEN i.assigned_amount_ves ELSE 0 END) as pending_ves
                    FROM BillingPreliminaries pr
                    INNER JOIN BillingInvoices i ON pr.id = i.preliminary_id
                    GROUP BY pr.billing_month, pr.billing_year
                    ORDER BY pr.billing_year DESC, pr.billing_month DESC
                `);

            const condoByMonth = {};
            for (const row of condoByMonthResult.recordset) {
                const key = `${row.billing_year}-${String(row.billing_month).padStart(2, '0')}`;
                condoByMonth[key] = {
                    collected_ves: parseFloat(row.collected_ves) || 0,
                    pending_ves: parseFloat(row.pending_ves) || 0
                };
            }

            // Proyección: meses futuros (propiedades * 0.50 USD * tasa)
            const propertiesByTenant = await pool.request()
                .query(`
                    SELECT tenant_id, COUNT(*) as cnt FROM Properties GROUP BY tenant_id
                `);
            const propCount = {};
            for (const r of propertiesByTenant.recordset) {
                propCount[r.tenant_id] = r.cnt || 0;
            }

            const UNIT_PRICE_USD = 0.50;
            const projectionMonths = 6;
            const projection = [];
            for (let i = 1; i <= projectionMonths; i++) {
                let m = currentMonth + i;
                let y = currentYear;
                if (m > 12) { m -= 12; y++; }
                const totalProps = Object.values(propCount).reduce((a, b) => a + b, 0);
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

            // Meses anteriores para comparativa (últimos 6)
            const monthLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
            const comparative = [];
            for (let i = 0; i < 6; i++) {
                let m = currentMonth - 1 - i;
                let y = currentYear;
                while (m <= 0) { m += 12; y--; }
                const key = `${y}-${String(m).padStart(2, '0')}`;
                const saas = saasByMonth[key] || {};
                const condo = condoByMonth[key] || {};
                comparative.unshift({
                    month: m,
                    year: y,
                    key,
                    label: `${monthLabels[m - 1]} ${y}`,
                    saas_paid_usd: saas.paid_usd || 0,
                    saas_paid_ves: saas.paid_ves || 0,
                    saas_pending_usd: saas.pending_usd || 0,
                    saas_pending_ves: saas.pending_ves || 0,
                    condo_collected_ves: condo.collected_ves || 0,
                    condo_pending_ves: condo.pending_ves || 0
                });
            }

            // Balance por tenant
            const tenantsList = condoCollectedResult.recordset.map(t => {
                const saasPending = saasResult.recordset
                    .filter(s => String(s.tenant_id) === String(t.tenant_id) && s.status === 'PENDING')
                    .reduce((sum, s) => sum + (parseFloat(s.total_usd) || 0), 0);
                const saasPaid = saasResult.recordset
                    .filter(s => String(s.tenant_id) === String(t.tenant_id) && s.status === 'PAID')
                    .reduce((sum, s) => sum + (parseFloat(s.total_ves) || 0), 0);
                const props = propCount[t.tenant_id] || 0;
                return {
                    tenant_id: t.tenant_id,
                    tenant_name: t.tenant_name,
                    properties: props,
                    condo_collected_ves: parseFloat(t.total_collected_ves) || 0,
                    condo_pending_ves: parseFloat(t.total_pending_ves) || 0,
                    saas_paid_ves: saasPaid,
                    saas_pending_usd: saasPending,
                    saas_pending_ves: rateVes ? saasPending * rateVes : 0
                };
            });

            res.json({
                success: true,
                data: {
                    latest_rate_ves: rateVes,
                    latest_rate_date: latestRate?.rate_date,
                    by_tenant: tenantsList,
                    comparative,
                    projection,
                    totals: {
                        condo_collected: tenantsList.reduce((s, t) => s + t.condo_collected_ves, 0),
                        condo_pending: tenantsList.reduce((s, t) => s + t.condo_pending_ves, 0),
                        saas_pending_usd: tenantsList.reduce((s, t) => s + t.saas_pending_usd, 0),
                        saas_pending_ves: tenantsList.reduce((s, t) => s + t.saas_pending_ves, 0)
                    }
                }
            });
        } catch (error) {
            console.error('Get financial summary error:', error);
            res.status(500).json({ error: 'Error al obtener balance financiero' });
        }
    }
}

module.exports = AdminBalanceController;
