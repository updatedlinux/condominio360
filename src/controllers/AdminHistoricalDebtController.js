const HistoricalDebtService = require('../services/HistoricalDebtService');
const PropertyHistoricalDebtModel = require('../models/PropertyHistoricalDebtModel');
const { sql, connectDB } = require('../config/database');

class AdminHistoricalDebtController {
    static async list(req, res) {
        try {
            const { id: tenantId } = req.params;
            const rows = await PropertyHistoricalDebtModel.listByTenant(tenantId);
            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('List historical debts error:', error);
            res.status(500).json({ error: 'Error al listar deudas históricas' });
        }
    }

    static async create(req, res) {
        try {
            const { id: tenantId } = req.params;
            const {
                property_id,
                amount,
                currency,
                description,
                rate_freeze_mode,
                rate_freeze_window_days,
                rate_unpaid_migrate_after_month
            } = req.body;

            if (!property_id || amount == null) {
                return res.status(400).json({ error: 'property_id y amount son requeridos' });
            }

            const { rate, rateDate } = await HistoricalDebtService.getExchangeContext();
            const result = await HistoricalDebtService.createOne(
                tenantId,
                {
                    property_id,
                    amount: parseFloat(amount),
                    currency: (currency || 'USD').toUpperCase(),
                    description,
                    rate_freeze_mode,
                    rate_freeze_window_days,
                    rate_unpaid_migrate_after_month
                },
                req.user.userId
            );

            res.status(201).json({
                success: true,
                data: result,
                message: 'Deuda histórica registrada'
            });
        } catch (error) {
            console.error('Create historical debt error:', error);
            res.status(400).json({ error: error.message || 'Error al crear deuda histórica' });
        }
    }

    static async bulkCreate(req, res) {
        const pool = await connectDB();
        const transaction = pool.transaction();
        let transactionStarted = false;

        try {
            const { id: tenantId } = req.params;
            const { rows } = req.body;

            if (!Array.isArray(rows) || rows.length === 0) {
                return res.status(400).json({ error: 'Se requiere un array de registros' });
            }

            const created = await HistoricalDebtService.bulkCreate(tenantId, rows, req.user.userId);

            res.status(201).json({
                success: true,
                message: `Se cargaron ${created.length} deuda(s) histórica(s)`,
                successCount: created.length,
                total: rows.length,
                data: created
            });
        } catch (error) {
            if (transactionStarted) {
                try { await transaction.rollback(); } catch (e) { /* ignore */ }
            }
            console.error('Bulk historical debt error:', error);
            res.status(400).json({
                success: false,
                error: error.message || 'Error en la carga masiva. No se guardó ningún registro.',
                errorDetails: [error.message]
            });
        }
    }

    static async update(req, res) {
        try {
            const { id: tenantId, debtId } = req.params;
            const pool = await connectDB();
            const transaction = pool.transaction();
            await transaction.begin();

            const debt = await PropertyHistoricalDebtModel.updateDebt(
                transaction,
                debtId,
                tenantId,
                {
                    description: req.body.description,
                    rate_freeze_mode: req.body.rate_freeze_mode,
                    rate_freeze_window_days: req.body.rate_freeze_window_days,
                    rate_unpaid_migrate_after_month: req.body.rate_unpaid_migrate_after_month
                }
            );
            if (!debt) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Deuda no encontrada o no editable' });
            }

            const freezeMode = HistoricalDebtService.normalizeFreezeMode(req.body.rate_freeze_mode || debt.rate_freeze_mode);
            await transaction.request()
                .input('invoice_id', sql.UniqueIdentifier, debt.invoice_id)
                .input('legacy_rate_freeze_mode', sql.NVarChar, freezeMode)
                .input('legacy_rate_freeze_window_days', sql.Int, req.body.rate_freeze_window_days ?? debt.rate_freeze_window_days)
                .input('legacy_rate_unpaid_migrate_after_month', sql.Bit, req.body.rate_unpaid_migrate_after_month ? 1 : 0)
                .query(`
                    UPDATE BillingInvoices
                    SET legacy_rate_freeze_mode = @legacy_rate_freeze_mode,
                        legacy_rate_freeze_window_days = @legacy_rate_freeze_window_days,
                        legacy_rate_unpaid_migrate_after_month = @legacy_rate_unpaid_migrate_after_month,
                        updated_at = SYSDATETIME()
                    WHERE id = @invoice_id AND invoice_kind = N'LEGACY_DEBT'
                `);

            await transaction.commit();
            res.json({ success: true, data: debt, message: 'Deuda actualizada' });
        } catch (error) {
            console.error('Update historical debt error:', error);
            res.status(400).json({ error: error.message || 'Error al actualizar' });
        }
    }

    static async cancel(req, res) {
        try {
            const { debtId, id: tenantId } = req.params;
            const { reason } = req.body;
            const pool = await connectDB();
            const transaction = pool.transaction();
            await transaction.begin();

            const debt = await PropertyHistoricalDebtModel.cancel(
                transaction, debtId, tenantId, req.user.userId, reason
            );
            if (!debt) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Deuda no encontrada' });
            }

            await transaction.request()
                .input('invoice_id', sql.UniqueIdentifier, debt.invoice_id)
                .query(`
                    UPDATE BillingInvoices
                    SET status = N'CANCELLED', updated_at = SYSDATETIME()
                    WHERE id = @invoice_id
                `);

            await transaction.commit();
            res.json({ success: true, message: 'Deuda histórica anulada' });
        } catch (error) {
            console.error('Cancel historical debt error:', error);
            res.status(400).json({ error: error.message || 'Error al anular' });
        }
    }

    static async downloadTemplate(req, res) {
        try {
            const { id: tenantId } = req.params;
            const pool = await connectDB();
            const tenantRes = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT building_type FROM Tenants WHERE id = @tenant_id');
            const buildingType = tenantRes.recordset[0]?.building_type || 'SINGLE';

            const propsResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT p.name, p.slug, b.name AS building_name
                    FROM Properties p
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    WHERE p.tenant_id = @tenant_id
                    ORDER BY COALESCE(b.name, N''), p.name
                `);

            const lines = [
                'inmueble_slug,monto,moneda,descripcion,congelamiento_tasa,dias_ventana,migrar_mes_impago',
                '# congelamiento_tasa: NONE | PERMANENT | WINDOW',
                '# migrar_mes_impago: 0 o 1 (solo PERMANENT)',
                ''
            ];

            for (const p of propsResult.recordset) {
                const pSlug = p.slug || HistoricalDebtService.toSlug(p.name);
                const buildingSlug = p.building_name ? HistoricalDebtService.toSlug(p.building_name) : null;
                const fullSlug = buildingType === 'MULTIPLE' && buildingSlug
                    ? `${buildingSlug}-${pSlug}` : pSlug;
                lines.push(`${fullSlug},,USD,Deuda histórica pre-sistema,NONE,,0`);
            }

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=plantilla_deuda_historica.csv');
            res.send('\uFEFF' + lines.join('\n'));
        } catch (error) {
            console.error('Template historical debt error:', error);
            res.status(500).json({ error: 'Error al generar plantilla' });
        }
    }
}

module.exports = AdminHistoricalDebtController;
