const BillingModel = require('../models/BillingModel');
const ExchangeRateModel = require('../models/ExchangeRateModel');
const BillingRateFreezeService = require('../services/BillingRateFreezeService');
const { itemToVes, allocateVesByWeight } = require('../utils/currencyConversion');
const { formatRateDateDisplay } = require('../utils/bcvFiscalCalendar');
const { sql, connectDB } = require('../config/database');
const { VENEZUELAN_BANKS } = require('../constants/venezuelanBanks');

/**
 * Owner Billing Controller
 * Vista de recibos para propietarios
 */
class OwnerBillingController {

    /** Formatea fecha efectiva de tasa (día civil almacenado, sin desfase por timezone) */
    static _formatRateDate(val) {
        return formatRateDateDisplay(val);
    }

    /**
     * GET /api/owner/billing/config
     * Obtener configuración de facturación del tenant (solo modo)
     */
    static async getConfig(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const pool = await connectDB();
            
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT billing_mode, billing_type, payment_info
                    FROM Tenants
                    WHERE id = @tenant_id
                `);
            
            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Tenant no encontrado' });
            }

            const config = result.recordset[0];
            
            res.json({
                success: true,
                data: {
                    billing_mode: config.billing_mode || 'FULL',
                    billing_type: config.billing_type || 'ALICUOTA',
                    // Solo mostrar datos de pago si es modo FULL
                    payment_info: config.billing_mode === 'FULL' && config.payment_info 
                        ? JSON.parse(config.payment_info) 
                        : null
                }
            });
        } catch (error) {
            console.error('Get billing config error:', error);
            res.status(500).json({ error: 'Error al obtener configuración' });
        }
    }

    /**
     * GET /api/owner/billing/invoices
     * Obtener recibos del propietario
     */
    static async getInvoices(req, res) {
        try {
            const userId = req.user.userId;
            const tenantId = req.user.tenantId;
            const propertyId = req.propertyId || req.query.propertyId;

            // Verificar modo de facturación
            const pool = await connectDB();
            const tenantResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT billing_mode FROM Tenants WHERE id = @tenant_id');
            
            const billingMode = tenantResult.recordset[0]?.billing_mode || 'FULL';

            // Si es modo SUPPORT, no hay recibos disponibles
            if (billingMode === 'SUPPORT') {
                return res.json({
                    success: true,
                    data: [],
                    message: 'Consulta con tu empresa administradora la facturación de tu condominio',
                    billing_mode: 'SUPPORT'
                });
            }

            // Obtener propiedades del usuario
            let propertyFilter = '';
            if (propertyId) {
                propertyFilter = 'AND i.property_id = @property_id';
            } else {
                // Obtener todas las propiedades del usuario
                propertyFilter = `AND i.property_id IN (
                    SELECT property_id FROM PropertyOwners WHERE user_id = @user_id
                )`;
            }

            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('user_id', sql.UniqueIdentifier, userId)
                .input('property_id', sql.UniqueIdentifier, propertyId || null)
                .query(`
                    SELECT i.*, p.name as property_name, p.building,
                        pr.billing_month, pr.billing_year, pr.name as preliminary_name,
                        pr.exchange_rate_usd,
                        CASE WHEN i.invoice_kind = N'LEGACY_DEBT' THEN N'Deuda histórica' ELSE pr.name END AS period_label,
                        CASE WHEN EXISTS (
                            SELECT 1 FROM BillingPaymentReports r
                            WHERE r.invoice_id = i.id AND r.status = N'PENDING_CONFIRMATION'
                        ) THEN 1 ELSE 0 END AS payment_report_pending
                    FROM BillingInvoices i
                    INNER JOIN Properties p ON i.property_id = p.id
                    LEFT JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                    WHERE i.tenant_id = @tenant_id
                    ${propertyFilter}
                    AND i.status IN (N'PENDING', N'PAID')
                    AND (
                        (i.invoice_kind = N'LEGACY_DEBT' AND i.sent_to_owners = 1)
                        OR (pr.status = N'FINALIZED' AND pr.sent_to_owners = 1)
                    )
                    ORDER BY
                        CASE WHEN i.invoice_kind = N'LEGACY_DEBT' THEN 0 ELSE 1 END,
                        pr.billing_year DESC, pr.billing_month DESC, i.created_at DESC
                `);

            res.json({
                success: true,
                data: result.recordset,
                billing_mode: 'FULL'
            });
        } catch (error) {
            console.error('Get owner invoices error:', error);
            res.status(500).json({ error: 'Error al obtener recibos' });
        }
    }

    /**
     * GET /api/owner/billing/invoices/:id
     * Obtener detalle de un recibo
     */
    static async getInvoiceById(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.userId;
            const tenantId = req.user.tenantId;

            const invoice = await BillingModel.getInvoiceWithItems(id, tenantId);
            
            if (!invoice) {
                return res.status(404).json({ error: 'Recibo no encontrado' });
            }

            // Verificar que el recibo pertenezca al usuario
            const pool = await connectDB();
            const ownerCheck = await pool.request()
                .input('property_id', sql.UniqueIdentifier, invoice.property_id)
                .input('user_id', sql.UniqueIdentifier, userId)
                .query('SELECT 1 FROM PropertyOwners WHERE property_id = @property_id AND user_id = @user_id');

            if (ownerCheck.recordset.length === 0) {
                return res.status(403).json({ error: 'No tienes acceso a este recibo' });
            }

            // Verificar que el recibo haya sido enviado
            if (!invoice.sent_to_owners) {
                return res.status(403).json({ error: 'Este recibo aún no está disponible' });
            }

            const latestRate = await ExchangeRateModel.getLatest();
            const HistoricalDebtService = require('../services/HistoricalDebtService');
            const preliminary = HistoricalDebtService.isLegacyInvoice(invoice)
                ? HistoricalDebtService.getFreezeContextFromInvoice(invoice)
                : {
                    exchange_rate_usd: invoice.exchange_rate_preliminary,
                    exchange_rate_date: invoice.preliminary_exchange_rate_date,
                    rate_freeze_mode: invoice.rate_freeze_mode,
                    rate_freeze_window_days: invoice.rate_freeze_window_days,
                    rate_unpaid_migrate_after_month: invoice.rate_unpaid_migrate_after_month,
                    created_at: invoice.preliminary_created_at
                };
            const rateCurrent = parseFloat(invoice.current_exchange_rate)
                || parseFloat(invoice.exchange_rate_at_creation)
                || BillingRateFreezeService.getFrozenRate(preliminary);
            const totalUsd = parseFloat(invoice.total_amount_usd)
                || (parseFloat(invoice.assigned_amount_ves) / (rateCurrent || 1));

            const paymentReport = await BillingModel.getLatestPaymentReport(id);
            if (paymentReport && paymentReport.status === 'PENDING_CONFIRMATION') {
                invoice.has_pending_payment_report = true;
            }

            const rateInfo = BillingRateFreezeService.buildRateInfo({
                preliminary,
                totalUsd,
                latestRate,
                pendingInvoicesCount: invoice.status === 'PENDING' ? 1 : 0,
                allInvoicesPaid: invoice.status === 'PAID'
            });
            if (rateInfo) {
                rateInfo.rate_current = rateCurrent;
                rateInfo.contravalue_current_ves = parseFloat(invoice.assigned_amount_ves);
            }
            invoice.rate_info = rateInfo;

            // Recalcular montos de items con tasa actual para que coincidan con el total del recibo
            if (invoice.items && rateCurrent) {
                const itemsRecalc = invoice.items.map(it => {
                    const base = parseFloat(it.base_amount) || 0;
                    const convVes = itemToVes(base, it.currency, rateCurrent);
                    return { ...it, _convVes: convVes };
                });
                const convList = itemsRecalc.map((it) => it._convVes);
                const totalVes = parseFloat(invoice.assigned_amount_ves) || 0;
                const allocated = allocateVesByWeight(totalVes, convList);
                invoice.items = itemsRecalc.map((it, idx) => {
                    const { _convVes, ...rest } = it;
                    return {
                        ...rest,
                        assigned_amount_ves: allocated[idx],
                        converted_amount_ves: _convVes
                    };
                });
                if (invoice.items.length === 1) invoice.items[0].assigned_amount_ves = totalVes;
            }

            res.json({
                success: true,
                data: invoice
            });
        } catch (error) {
            console.error('Get invoice detail error:', error);
            res.status(500).json({ error: 'Error al obtener detalle del recibo' });
        }
    }

    /**
     * GET /api/owner/billing/stats
     * Estadísticas de recibos del propietario
     */
    static async getStats(req, res) {
        try {
            const userId = req.user.userId;
            const tenantId = req.user.tenantId;

            // Verificar modo de facturación
            const pool = await connectDB();
            const tenantResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT billing_mode FROM Tenants WHERE id = @tenant_id');
            
            const billingMode = tenantResult.recordset[0]?.billing_mode || 'FULL';

            if (billingMode === 'SUPPORT') {
                return res.json({
                    success: true,
                    data: {
                        billing_mode: 'SUPPORT',
                        total_invoices: 0,
                        pending_count: 0,
                        paid_count: 0,
                        total_pending: 0,
                        total_paid: 0
                    }
                });
            }

            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('user_id', sql.UniqueIdentifier, userId)
                .query(`
                    SELECT 
                        COUNT(*) as total_invoices,
                        SUM(CASE WHEN i.status = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
                        SUM(CASE WHEN i.status = 'PAID' THEN 1 ELSE 0 END) as paid_count,
                        SUM(CASE WHEN i.status = 'PENDING' THEN i.assigned_amount_ves ELSE 0 END) as total_pending,
                        SUM(CASE WHEN i.status = 'PAID' THEN i.paid_amount_ves ELSE 0 END) as total_paid
                    FROM BillingInvoices i
                    INNER JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                    WHERE i.tenant_id = @tenant_id
                    AND i.property_id IN (
                        SELECT property_id FROM PropertyOwners WHERE user_id = @user_id
                    )
                    AND pr.status = 'FINALIZED'
                    AND pr.sent_to_owners = 1
                `);

            const stats = result.recordset[0];

            res.json({
                success: true,
                data: {
                    billing_mode: 'FULL',
                    total_invoices: stats.total_invoices || 0,
                    pending_count: stats.pending_count || 0,
                    paid_count: stats.paid_count || 0,
                    total_pending: stats.total_pending || 0,
                    total_paid: stats.total_paid || 0
                }
            });
        } catch (error) {
            console.error('Get owner billing stats error:', error);
            res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
    }

    /**
     * GET /api/owner/billing/banks
     * Lista de bancos de Venezuela para el formulario de reporte de pago
     */
    static async getBanks(req, res) {
        try {
            res.json({
                success: true,
                data: VENEZUELAN_BANKS
            });
        } catch (error) {
            console.error('Get banks error:', error);
            res.status(500).json({ error: 'Error al obtener lista de bancos' });
        }
    }

    /**
     * POST /api/owner/billing/invoices/:id/report-payment
     * Reportar pago por propietario (con comprobante opcional)
     */
    static async reportPayment(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.userId;
            const tenantId = req.user.tenantId;

            const invoice = await BillingModel.getInvoiceWithItems(id, tenantId);
            if (!invoice) {
                return res.status(404).json({ error: 'Recibo no encontrado' });
            }

            // Verificar que el recibo pertenezca al usuario
            const pool = await connectDB();
            const ownerCheck = await pool.request()
                .input('property_id', sql.UniqueIdentifier, invoice.property_id)
                .input('user_id', sql.UniqueIdentifier, userId)
                .query('SELECT 1 FROM PropertyOwners WHERE property_id = @property_id AND user_id = @user_id');

            if (ownerCheck.recordset.length === 0) {
                return res.status(403).json({ error: 'No tienes acceso a este recibo' });
            }

            if (invoice.status === 'PAID') {
                return res.status(400).json({ error: 'Este recibo ya está pagado' });
            }

            // Verificar que no exista un reporte pendiente
            const existingReport = await BillingModel.getLatestPaymentReport(id);
            if (existingReport && existingReport.status === 'PENDING_CONFIRMATION') {
                return res.status(400).json({ error: 'Ya existe un reporte de pago pendiente de confirmación' });
            }

            const {
                banco_emisor,
                fecha_transferencia,
                ref_transferencia,
                comentario
            } = req.body;

            const isLegacy = String(invoice.invoice_kind || '').toUpperCase() === 'LEGACY_DEBT';
            const maxVes = parseFloat(invoice.assigned_amount_ves) || 0;
            let montoAbonado = req.body.monto_abonado_ves != null
                ? parseFloat(req.body.monto_abonado_ves)
                : maxVes;
            if (!Number.isFinite(montoAbonado) || montoAbonado <= 0) {
                return res.status(400).json({ error: 'Monto abonado inválido' });
            }
            if (montoAbonado > maxVes + 0.000001) {
                return res.status(400).json({ error: 'El monto no puede superar el saldo pendiente del recibo' });
            }
            if (!isLegacy && Math.abs(montoAbonado - maxVes) > 0.000001) {
                return res.status(400).json({ error: 'En recibos ordinarios debe abonarse el monto total del recibo' });
            }

            if (!banco_emisor || !fecha_transferencia || !ref_transferencia) {
                return res.status(400).json({ error: 'Banco emisor, fecha de transferencia y referencia son requeridos' });
            }

            const rate = parseFloat(invoice.current_exchange_rate) || parseFloat(invoice.exchange_rate_at_creation) || 0;
            const { vesToUsd } = require('../utils/currencyConversion');
            const montoAbonadoUsd = isLegacy && rate > 0 ? vesToUsd(montoAbonado, rate) : null;

            const attachmentPath = req.file ? `payment-receipts/${req.file.filename}` : null;

            const report = await BillingModel.createPaymentReport({
                invoice_id: id,
                submitted_by: userId,
                banco_emisor: String(banco_emisor).trim(),
                fecha_transferencia: String(fecha_transferencia).trim(),
                ref_transferencia: String(ref_transferencia).trim(),
                monto_abonado_ves: montoAbonado,
                monto_abonado_usd: montoAbonadoUsd,
                comentario: comentario ? String(comentario).trim() : null,
                attachment_path: attachmentPath
            });

            res.json({
                success: true,
                data: report,
                message: 'Reporte de pago enviado. La junta verificará y confirmará la recepción.'
            });
        } catch (error) {
            console.error('Report payment error:', error);
            res.status(500).json({ error: 'Error al reportar pago' });
        }
    }
}

module.exports = OwnerBillingController;
