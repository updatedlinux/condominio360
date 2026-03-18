const { sql, connectDB } = require('../config/database');
const ExchangeRateModel = require('../models/ExchangeRateModel');

/**
 * Balance Financiero del Condominio (tenant-admin)
 * Ingresos por cobros de recibos - PAID usa tasa congelada, PENDING usa tasa actual
 */
class TenantAdminBalanceController {

    /**
     * GET /api/tenant-admin/balance/financial-summary
     * Resumen financiero del condominio: cobrado, pendiente, por mes, gráficos
     */
    static async getFinancialSummary(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const pool = await connectDB();
            const latestRate = await ExchangeRateModel.getLatest();
            const rateVes = latestRate ? parseFloat(latestRate.usd_rate) : 0;

            const now = new Date();
            const currentMonth = now.getMonth() + 1;
            const currentYear = now.getFullYear();

            // Cobros del condominio: PAID = tasa congelada (current_exchange_rate), PENDING = tasa actual
            // PAID: paid_amount_ves (monto real pagado), USD = paid_amount_ves / current_exchange_rate
            // PENDING: assigned_amount_ves (actualizado diariamente), USD = assigned_amount_ves / rateActual
            const invoicesResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT i.id, i.status, i.assigned_amount_ves, i.paid_amount_ves, i.current_exchange_rate,
                           pr.billing_month, pr.billing_year, pr.invoice_type, pr.name as preliminary_name
                    FROM BillingInvoices i
                    INNER JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                    WHERE i.tenant_id = @tenant_id
                `);

            let totalCollectedVes = 0;
            let totalCollectedUsd = 0;
            let totalPendingVes = 0;
            let totalPendingUsd = 0;

            const byMonth = {};
            for (const row of invoicesResult.recordset) {
                const key = `${row.billing_year}-${String(row.billing_month).padStart(2, '0')}`;
                if (!byMonth[key]) {
                    byMonth[key] = {
                        month: row.billing_month,
                        year: row.billing_year,
                        collected_ves: 0,
                        collected_usd: 0,
                        pending_ves: 0,
                        pending_usd: 0
                    };
                }

                const rate = parseFloat(row.current_exchange_rate) || rateVes || 1;
                if (row.status === 'PAID') {
                    const ves = parseFloat(row.paid_amount_ves) || 0;
                    const usd = rate > 0 ? ves / rate : 0;
                    totalCollectedVes += ves;
                    totalCollectedUsd += usd;
                    byMonth[key].collected_ves += ves;
                    byMonth[key].collected_usd += usd;
                } else {
                    const ves = parseFloat(row.assigned_amount_ves) || 0;
                    const currRate = rateVes || rate;
                    const usd = currRate > 0 ? ves / currRate : 0;
                    totalPendingVes += ves;
                    totalPendingUsd += usd;
                    byMonth[key].pending_ves += ves;
                    byMonth[key].pending_usd += usd;
                }
            }

            // Tasas BCV últimos 30 días para gráfico
            const ratesResult = await ExchangeRateModel.getRecentForChart(30);

            // Comparativa últimos 6 meses (incluye el mes actual)
            const monthLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
            const comparative = [];
            for (let i = 0; i < 6; i++) {
                let m = currentMonth - i;
                let y = currentYear;
                while (m <= 0) {
                    m += 12;
                    y--;
                }
                const key = `${y}-${String(m).padStart(2, '0')}`;
                const data = byMonth[key] || {
                    collected_ves: 0,
                    collected_usd: 0,
                    pending_ves: 0,
                    pending_usd: 0
                };
                comparative.unshift({
                    month: m,
                    year: y,
                    key,
                    label: `${monthLabels[m - 1]} ${y}`,
                    collected_ves: data.collected_ves || 0,
                    collected_usd: data.collected_usd || 0,
                    pending_ves: data.pending_ves || 0,
                    pending_usd: data.pending_usd || 0
                });
            }
            comparative.reverse();

            res.json({
                success: true,
                data: {
                    latest_rate_ves: rateVes,
                    latest_rate_date: latestRate?.rate_date,
                    totals: {
                        collected_ves: totalCollectedVes,
                        collected_usd: totalCollectedUsd,
                        pending_ves: totalPendingVes,
                        pending_usd: totalPendingUsd
                    },
                    exchange_rates: ratesResult.map(r => ({
                        date: r.rate_date,
                        usd: parseFloat(r.usd_rate) || 0
                    })),
                    comparative,
                    by_month: Object.values(byMonth).sort((a, b) => {
                        const ka = `${a.year}-${String(a.month).padStart(2, '0')}`;
                        const kb = `${b.year}-${String(b.month).padStart(2, '0')}`;
                        return kb.localeCompare(ka);
                    }).slice(0, 12)
                }
            });
        } catch (error) {
            console.error('Tenant admin balance summary error:', error);
            res.status(500).json({ error: 'Error al obtener balance financiero' });
        }
    }
}

module.exports = TenantAdminBalanceController;
