const SaaSBillingModel = require('../models/SaaSBillingModel');
const SaaSBillingRateService = require('../services/SaaSBillingRateService');
const SystemSettingsModel = require('../models/SystemSettingsModel');
const { VENEZUELAN_BANKS } = require('../constants/venezuelanBanks');
const { sql, connectDB } = require('../config/database');

/**
 * Controlador para que el Tenant Admin vea sus facturas de Condominio360
 */
class TenantAdminSaaSBillingController {

    /**
     * GET /api/tenant-admin/saas-invoices
     * Listar facturas de Condominio360 para este condominio
     */
    static async list(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const invoices = await SaaSBillingModel.getByTenant(tenantId, { limit: 50 });
            res.json({ success: true, data: invoices });
        } catch (error) {
            console.error('List SaaS invoices (tenant) error:', error);
            res.status(500).json({ error: 'Error al listar facturas' });
        }
    }

    /**
     * GET /api/tenant-admin/saas-invoices/summary
     * Resumen para el sidebar (pendientes, monto total)
     */
    static async summary(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const [pendingCount, totalPending] = await Promise.all([
                SaaSBillingModel.getPendingCountByTenant(tenantId),
                SaaSBillingModel.getTotalPendingByTenant(tenantId)
            ]);
            res.json({
                success: true,
                data: {
                    pending_count: pendingCount,
                    total_pending_ves: totalPending
                }
            });
        } catch (error) {
            console.error('SaaS invoices summary error:', error);
            res.status(500).json({ error: 'Error al obtener resumen' });
        }
    }

    /**
     * GET /api/tenant-admin/saas-invoices/:id
     * Detalle de factura (con tasa actual para mostrar VES)
     */
    static async getById(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const invoice = await SaaSBillingModel.getInvoiceWithItems(req.params.id);
            if (!invoice || String(invoice.tenant_id) !== String(tenantId)) {
                return res.status(404).json({ error: 'Factura no encontrada' });
            }
            const rateInfo = await SaaSBillingRateService.getApplicableRate();
            const paymentReport = invoice.status === 'PENDING' ? await SaaSBillingModel.getLatestPaymentReport(invoice.id) : null;
            const has_pending_payment_report = !!(paymentReport && paymentReport.status === 'PENDING_CONFIRMATION');
            res.json({
                success: true,
                data: {
                    ...invoice,
                    current_rate: rateInfo.rate,
                    current_rate_date: rateInfo.rateDate,
                    applied_rule: rateInfo.appliedRule,
                    payment_report: paymentReport,
                    has_pending_payment_report
                }
            });
        } catch (error) {
            console.error('Get SaaS invoice (tenant) error:', error);
            res.status(500).json({ error: 'Error al obtener factura' });
        }
    }

    /**
     * GET /api/tenant-admin/saas-invoices/banks
     * Lista de bancos de Venezuela
     */
    static async getBanks(req, res) {
        try {
            res.json({ success: true, data: VENEZUELAN_BANKS });
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener bancos' });
        }
    }

    /**
     * GET /api/tenant-admin/saas-invoices/payment-config
     * Método de pago configurado por Condominio360 (para reportar pago)
     */
    static async getPaymentConfig(req, res) {
        try {
            const config = await SystemSettingsModel.get('saas_payment_info');
            res.json({ success: true, data: config || null });
        } catch (error) {
            console.error('Get SaaS payment config (tenant) error:', error);
            res.status(500).json({ error: 'Error al obtener configuración' });
        }
    }

    /**
     * POST /api/tenant-admin/saas-invoices/:id/report-payment
     * Reportar pago de factura SaaS (junta reporta a superadmin)
     */
    static async reportPayment(req, res) {
        try {
            const tenantId = req.user.tenantId;
            let submittedById = req.user.userId;
            if (req.user.isSuperAdmin || req.user.type === 'SUPERADMIN') {
                const pool = await connectDB();
                const taRes = await pool.request()
                    .input('tenant_id', sql.UniqueIdentifier, tenantId)
                    .query('SELECT TOP 1 id FROM TenantAdmins WHERE tenant_id = @tenant_id AND is_active = 1');
                if (taRes.recordset.length > 0) {
                    submittedById = taRes.recordset[0].id;
                } else {
                    return res.status(400).json({ error: 'El condominio no tiene administradores de junta registrados. Cree uno desde el panel Super Admin.' });
                }
            }
            const { id } = req.params;
            const invoice = await SaaSBillingModel.getInvoiceWithItems(id);
            if (!invoice || String(invoice.tenant_id) !== String(tenantId)) {
                return res.status(404).json({ error: 'Factura no encontrada' });
            }
            if (invoice.status === 'PAID') {
                return res.status(400).json({ error: 'Esta factura ya está pagada' });
            }
            const existing = await SaaSBillingModel.getLatestPaymentReport(id);
            if (existing?.status === 'PENDING_CONFIRMATION') {
                return res.status(400).json({ error: 'Ya existe un reporte pendiente de confirmación' });
            }
            const { banco_emisor, fecha_transferencia, ref_transferencia, comentario } = req.body;
            if (!banco_emisor || !fecha_transferencia || !ref_transferencia) {
                return res.status(400).json({ error: 'Banco emisor, fecha y referencia son requeridos' });
            }
            const montoVes = parseFloat(invoice.total_ves) || 0;
            const attachmentPath = req.file ? `payment-receipts/${req.file.filename}` : null;
            const report = await SaaSBillingModel.createPaymentReport({
                invoice_id: id,
                submitted_by: submittedById,
                banco_emisor: String(banco_emisor).trim(),
                fecha_transferencia: String(fecha_transferencia).trim(),
                ref_transferencia: String(ref_transferencia).trim(),
                monto_abonado_ves: montoVes,
                comentario: comentario ? String(comentario).trim() : null,
                attachment_path: attachmentPath
            });
            res.json({ success: true, data: report, message: 'Reporte enviado. Condominio360 verificará y confirmará el pago.' });
        } catch (error) {
            console.error('Report SaaS payment error:', error);
            res.status(500).json({ error: 'Error al reportar pago' });
        }
    }
}

module.exports = TenantAdminSaaSBillingController;
