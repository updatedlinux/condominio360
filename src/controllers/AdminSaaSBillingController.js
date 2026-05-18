const path = require('path');
const SaaSBillingModel = require('../models/SaaSBillingModel');
const SaaSBillingRateService = require('../services/SaaSBillingRateService');
const SystemSettingsModel = require('../models/SystemSettingsModel');
const AdminController = require('./AdminController');
const EmailService = require('../services/EmailService');
const { sql, connectDB } = require('../config/database');

/**
 * Controlador de facturación SaaS (Condominio360 → Condominios)
 */
class AdminSaaSBillingController {

    /**
     * GET /api/admin/saas-billing/rate
     * Obtener tasa BCV aplicable actual
     */
    static async getRate(req, res) {
        try {
            const rateInfo = await SaaSBillingRateService.getApplicableRate();
            res.json({
                success: true,
                data: {
                    usd_to_ves: rateInfo.rate,
                    rate_date: rateInfo.rateDate,
                    applied_rule: rateInfo.appliedRule
                }
            });
        } catch (error) {
            console.error('Get SaaS rate error:', error);
            res.status(500).json({ error: 'Error al obtener tasa' });
        }
    }

    /**
     * GET /api/admin/saas-billing/invoices
     * Listar facturas SaaS (con payment_report_pending)
     */
    static async listInvoices(req, res) {
        try {
            const { tenantId, periodMonth, periodYear } = req.query;
            let invoices = await SaaSBillingModel.getAllInvoices({
                tenantId: tenantId || null,
                periodMonth: periodMonth ? parseInt(periodMonth) : null,
                periodYear: periodYear ? parseInt(periodYear) : null,
                limit: 200
            });
            for (const inv of invoices) {
                if (inv.status === 'PENDING') {
                    const report = await SaaSBillingModel.getLatestPaymentReport(inv.id);
                    inv.payment_report_pending = report?.status === 'PENDING_CONFIRMATION';
                    inv.payment_report = report?.status === 'PENDING_CONFIRMATION' ? report : null;
                }
            }
            res.json({ success: true, data: invoices });
        } catch (error) {
            console.error('List SaaS invoices error:', error);
            res.status(500).json({ error: 'Error al listar facturas' });
        }
    }

    /**
     * GET /api/admin/saas-billing/invoices/:id
     * Detalle de factura (con payment_report si existe)
     */
    static async getInvoice(req, res) {
        try {
            const invoice = await SaaSBillingModel.getInvoiceWithItems(req.params.id);
            if (!invoice) {
                return res.status(404).json({ error: 'Factura no encontrada' });
            }
            if (invoice.status === 'PENDING' || invoice.status === 'PAID') {
                invoice.payment_report = await SaaSBillingModel.getLatestPaymentReport(invoice.id);
            }
            res.json({ success: true, data: invoice });
        } catch (error) {
            console.error('Get SaaS invoice error:', error);
            res.status(500).json({ error: 'Error al obtener factura' });
        }
    }

    /**
     * POST /api/admin/saas-billing/invoices
     * Generar factura(s) mensual(es)
     */
    static async createInvoice(req, res) {
        try {
            const isMultipart = req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data');
            let body = req.body;
            if (isMultipart) {
                body = { ...req.body };
                if (typeof body.extra_items === 'string') {
                    try {
                        body.extra_items = JSON.parse(body.extra_items || '[]');
                    } catch (e) {
                        return res.status(400).json({ error: 'extra_items inválido' });
                    }
                }
                if (body.period_month != null && body.period_month !== '') {
                    body.period_month = parseInt(body.period_month, 10);
                }
                if (body.period_year != null && body.period_year !== '') {
                    body.period_year = parseInt(body.period_year, 10);
                }
            }

            const { tenant_id, tenant_ids, period_month, period_year, extra_items = [], payment_method, billing_document_type } = body;

            let fiscalAttachmentPath = null;
            let fiscalAttachmentMime = null;
            if (req.file && req.file.path) {
                fiscalAttachmentPath = `/uploads/saas-fiscal-invoices/${path.basename(req.file.path)}`;
                fiscalAttachmentMime = req.file.mimetype || null;
            }

            const docType = billing_document_type === 'FISCAL' ? 'FISCAL' : 'VOUCHER';
            if (docType === 'FISCAL' && !fiscalAttachmentPath) {
                return res.status(400).json({ error: 'La factura fiscal requiere adjuntar PDF o imagen de la factura' });
            }

            const pool = await connectDB();
            const now = new Date();
            const month = period_month ?? now.getMonth() + 1;
            const year = period_year ?? now.getFullYear();

            const tenantsToBill = [];
            if (tenant_id) {
                const t = await pool.request()
                    .input('id', sql.UniqueIdentifier, tenant_id)
                    .query('SELECT id, name FROM Tenants WHERE id = @id AND active = 1');
                if (t.recordset[0]) tenantsToBill.push(t.recordset[0]);
            } else if (tenant_ids && Array.isArray(tenant_ids) && tenant_ids.length > 0) {
                for (const tid of tenant_ids) {
                    const t = await pool.request()
                        .input('id', sql.UniqueIdentifier, tid)
                        .query('SELECT id, name FROM Tenants WHERE id = @id AND active = 1');
                    if (t.recordset[0]) tenantsToBill.push(t.recordset[0]);
                }
            } else {
                const all = await pool.request().query('SELECT id, name FROM Tenants WHERE active = 1');
                tenantsToBill.push(...all.recordset);
            }

            const created = [];
            const skipped = [];

            for (const tenant of tenantsToBill) {
                const exists = await SaaSBillingModel.existsForPeriod(tenant.id, month, year);
                if (exists) {
                    skipped.push({ tenant_id: tenant.id, tenant_name: tenant.name, reason: 'Ya existe factura para este periodo' });
                    continue;
                }
                const invoice = await SaaSBillingModel.createInvoice(
                    tenant.id, month, year, extra_items, payment_method, req.user?.userId,
                    {
                        billingDocumentType: docType,
                        fiscalAttachmentPath,
                        fiscalAttachmentMime
                    }
                );
                created.push(invoice);
                await AdminController.logAudit(req, 'CREATE', 'SAAS_INVOICE', invoice.id,
                    `Generó factura Condominio360: ${tenant.name} - ${month}/${year}`, null);
                // Notificar por email a admins de la junta
                const adminsResult = await pool.request()
                    .input('tenantId', sql.UniqueIdentifier, tenant.id)
                    .query('SELECT email FROM TenantAdmins WHERE tenant_id = @tenantId AND is_active = 1');
                const adminEmails = (adminsResult.recordset || []).map(r => r.email).filter(Boolean);
                try {
                    await EmailService.sendSaaSInvoiceNotification(
                        tenant.name, month, year, invoice.total_usd, invoice.total_ves, adminEmails
                    );
                } catch (emailErr) {
                    console.error('Error enviando notificación de factura:', emailErr);
                }
            }

            res.status(201).json({
                success: true,
                created: created.length,
                skipped: skipped.length,
                invoices: created,
                skipped_details: skipped
            });
        } catch (error) {
            console.error('Create SaaS invoice error:', error);
            res.status(500).json({ error: error.message || 'Error al generar factura' });
        }
    }

    /**
     * POST /api/admin/saas-billing/invoices/:id/recalculate
     * Recalcular total VES con tasa BCV actual
     */
    static async recalculateInvoice(req, res) {
        try {
            const invoice = await SaaSBillingModel.recalculateVes(req.params.id);
            if (!invoice) {
                return res.status(400).json({
                    error: 'No se puede recalcular: factura no pendiente o existe un reporte de pago en verificación'
                });
            }
            await AdminController.logAudit(req, 'UPDATE', 'SAAS_INVOICE', invoice.id,
                `Recalculó factura Condominio360 (tasa BCV)`, null);
            res.json({ success: true, data: invoice });
        } catch (error) {
            console.error('Recalculate SaaS invoice error:', error);
            res.status(500).json({ error: 'Error al recalcular' });
        }
    }

    /**
     * PATCH /api/admin/saas-billing/invoices/:id
     * Actualizar estado o método de pago
     */
    static async updateInvoice(req, res) {
        try {
            const { status, payment_method } = req.body;
            const pool = await connectDB();

            let updates = [];
            const reqId = pool.request().input('id', sql.UniqueIdentifier, req.params.id);

            if (status) {
                updates.push('status = @status');
                reqId.input('status', sql.NVarChar, status);
            }
            if (payment_method !== undefined) {
                updates.push('payment_method = @payment_method');
                reqId.input('payment_method', sql.NVarChar, payment_method);
            }

            if (updates.length === 0) {
                return res.status(400).json({ error: 'Nada que actualizar' });
            }

            await reqId.query(`
                UPDATE SaaSInvoices SET ${updates.join(', ')}, updated_at = SYSDATETIME() WHERE id = @id
            `);

            const invoice = await SaaSBillingModel.getInvoiceWithItems(req.params.id);
            await AdminController.logAudit(req, 'UPDATE', 'SAAS_INVOICE', req.params.id,
                `Actualizó factura Condominio360 (${status ? 'estado: ' + status : ''} ${payment_method !== undefined ? 'método de pago' : ''})`, null);

            res.json({ success: true, data: invoice });
        } catch (error) {
            console.error('Update SaaS invoice error:', error);
            res.status(500).json({ error: 'Error al actualizar' });
        }
    }

    /**
     * DELETE /api/admin/saas-billing/invoices/:id
     * Eliminar factura solo si está PENDING
     */
    static async deleteInvoice(req, res) {
        try {
            const pool = await connectDB();
            const r = await pool.request()
                .input('id', sql.UniqueIdentifier, req.params.id)
                .query('SELECT id, status, tenant_id FROM SaaSInvoices WHERE id = @id');
            const inv = r.recordset[0];
            if (!inv) {
                return res.status(404).json({ error: 'Factura no encontrada' });
            }
            if (inv.status !== 'PENDING') {
                return res.status(400).json({ error: 'Solo se pueden eliminar facturas pendientes' });
            }
            await pool.request()
                .input('id', sql.UniqueIdentifier, req.params.id)
                .query('DELETE FROM SaaSInvoiceItems WHERE invoice_id = @id');
            await pool.request()
                .input('id', sql.UniqueIdentifier, req.params.id)
                .query('DELETE FROM SaaSInvoices WHERE id = @id');
            await AdminController.logAudit(req, 'DELETE', 'SAAS_INVOICE', req.params.id, 'Eliminó factura Condominio360 (pendiente)', null);
            res.json({ success: true, deleted: true });
        } catch (error) {
            console.error('Delete SaaS invoice error:', error);
            res.status(500).json({ error: 'Error al eliminar factura' });
        }
    }

    /**
     * GET /api/admin/saas-billing/payment-config
     * Obtener método de pago configurado para Cobros Condominio360
     */
    static async getPaymentConfig(req, res) {
        try {
            const config = await SystemSettingsModel.get('saas_payment_info');
            res.json({ success: true, data: config || { bank_account: '', mobile_payment: '' } });
        } catch (error) {
            console.error('Get SaaS payment config error:', error);
            res.status(500).json({ error: 'Error al obtener configuración' });
        }
    }

    /**
     * PUT /api/admin/saas-billing/payment-config
     * Guardar método de pago para Cobros Condominio360
     */
    static async savePaymentConfig(req, res) {
        try {
            const { bank_account, mobile_payment } = req.body;
            await SystemSettingsModel.set('saas_payment_info', { bank_account: bank_account || '', mobile_payment: mobile_payment || '' });
            await AdminController.logAudit(req, 'UPDATE', 'SYSTEM', null, 'Actualizó método de pago Condominio360', null);
            res.json({ success: true, data: { bank_account: bank_account || '', mobile_payment: mobile_payment || '' } });
        } catch (error) {
            console.error('Save SaaS payment config error:', error);
            res.status(500).json({ error: 'Error al guardar configuración' });
        }
    }

    /**
     * POST /api/admin/saas-billing/invoices/:id/confirm-payment
     * Confirmar reporte de pago enviado por la junta
     */
    static async confirmPayment(req, res) {
        try {
            const adminId = req.user.userId;
            const { id } = req.params;
            const report = await SaaSBillingModel.getLatestPaymentReport(id);
            if (!report || report.status !== 'PENDING_CONFIRMATION') {
                return res.status(404).json({ error: 'No hay reporte pendiente para esta factura' });
            }
            const invoice = await SaaSBillingModel.confirmPaymentReport(report.id, id, adminId);
            if (!invoice) return res.status(400).json({ error: 'Error al confirmar' });
            await AdminController.logAudit(req, 'UPDATE', 'SAAS_INVOICE', id, 'Confirmó pago reportado por junta', null);
            res.json({ success: true, data: invoice, message: 'Pago confirmado. Ingrés registrado en Balance Financiero.' });
        } catch (error) {
            console.error('Confirm SaaS payment error:', error);
            res.status(500).json({ error: 'Error al confirmar pago' });
        }
    }

    /**
     * POST /api/admin/saas-billing/invoices/:id/reject-payment
     * Rechazar reporte de pago
     */
    static async rejectPayment(req, res) {
        try {
            const { id } = req.params;
            const { rejection_reason } = req.body;
            const report = await SaaSBillingModel.getLatestPaymentReport(id);
            if (!report || report.status !== 'PENDING_CONFIRMATION') {
                return res.status(404).json({ error: 'No hay reporte pendiente para esta factura' });
            }
            await SaaSBillingModel.rejectPaymentReport(report.id, id, rejection_reason);
            await AdminController.logAudit(req, 'UPDATE', 'SAAS_INVOICE', id, `Rechazó reporte de pago: ${rejection_reason || 'Sin motivo'}`, null);
            res.json({ success: true, message: 'Reporte rechazado. La junta podrá volver a reportar el pago.' });
        } catch (error) {
            console.error('Reject SaaS payment error:', error);
            res.status(500).json({ error: 'Error al rechazar reporte' });
        }
    }

    /**
     * POST /api/admin/saas-billing/invoices/:id/adjust-paid-rate
     * Ajustar la tasa BCV y monto en bolívares de una factura ya PAGADA
     * usando la tasa registrada en BD para una fecha específica.
     * Body: { rate_date: 'YYYY-MM-DD' }
     */
    static async adjustPaidRate(req, res) {
        try {
            const { id } = req.params;
            const rateDate = req.body && req.body.rate_date ? String(req.body.rate_date).trim() : '';
            if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) {
                return res.status(400).json({ error: 'Fecha inválida. Usa el formato YYYY-MM-DD' });
            }

            const result = await SaaSBillingModel.adjustPaidInvoiceRate(id, rateDate);
            if (result.reason === 'NOT_FOUND') {
                return res.status(404).json({ error: 'Factura no encontrada' });
            }
            if (result.reason === 'NOT_PAID') {
                return res.status(400).json({ error: 'Solo se puede ajustar la tasa de facturas en estado PAGADA' });
            }
            if (result.reason === 'NO_RATE_FOR_DATE') {
                return res.status(404).json({ error: `No hay tasa BCV registrada en BD para la fecha ${rateDate}` });
            }

            const { previous, applied } = result;
            const diffVes = (applied.total_ves - previous.total_ves);
            const diffStr = (diffVes >= 0 ? '+' : '') + diffVes.toFixed(2);
            await AdminController.logAudit(req, 'UPDATE', 'SAAS_INVOICE', id,
                `Ajustó tasa BCV de factura pagada a ${rateDate} (${applied.bcv_rate} Bs/USD). ` +
                `Bs. anterior: ${previous.total_ves}, nuevo: ${applied.total_ves} (Δ ${diffStr})`,
                null);

            res.json({
                success: true,
                data: result.invoice,
                previous,
                applied,
                message: `Tasa actualizada a Bs. ${applied.bcv_rate} (${rateDate}). Total ajustado a Bs. ${applied.total_ves.toLocaleString('es-VE')}.`
            });
        } catch (error) {
            console.error('Adjust paid rate error:', error);
            res.status(500).json({ error: 'Error al ajustar tasa de factura pagada' });
        }
    }

    /**
     * PATCH /api/admin/saas-billing/invoices/:id/paid-details
     * Permite al superadmin ajustar manualmente datos de una factura ya PAGADA:
     *  - total_usd (recalcula bolívares con la tasa actual de la factura)
     *  - payment_report: { banco_emisor, fecha_transferencia, ref_transferencia, monto_abonado_ves, comentario }
     */
    static async updatePaidDetails(req, res) {
        try {
            const { id } = req.params;
            const body = req.body || {};
            const payload = {};
            if (body.total_usd !== undefined && body.total_usd !== null && body.total_usd !== '') {
                const v = parseFloat(body.total_usd);
                if (!Number.isFinite(v) || v < 0) {
                    return res.status(400).json({ error: 'Monto USD inválido' });
                }
                payload.total_usd = v;
            }
            if (body.period_month !== undefined && body.period_month !== null && body.period_month !== '') {
                payload.period_month = body.period_month;
            }
            if (body.period_year !== undefined && body.period_year !== null && body.period_year !== '') {
                payload.period_year = body.period_year;
            }
            if (body.payment_report && typeof body.payment_report === 'object') {
                payload.payment_report = body.payment_report;
            }
            if (Object.keys(payload).length === 0) {
                return res.status(400).json({ error: 'Nada que actualizar' });
            }

            const result = await SaaSBillingModel.updatePaidInvoiceDetails(id, payload);
            if (result.reason === 'NOT_FOUND') {
                return res.status(404).json({ error: 'Factura no encontrada' });
            }
            if (result.reason === 'NOT_PAID') {
                return res.status(400).json({ error: 'Solo se pueden editar facturas en estado PAGADA' });
            }
            if (result.reason === 'INVALID_MONTH') {
                return res.status(400).json({ error: 'Mes inválido (debe ser entre 1 y 12)' });
            }
            if (result.reason === 'INVALID_YEAR') {
                return res.status(400).json({ error: 'Año inválido' });
            }
            if (result.reason === 'PERIOD_DUPLICATE') {
                return res.status(409).json({ error: 'Ya existe una factura para ese condominio en el período seleccionado. Elimina o cambia esa factura antes de mover esta.' });
            }

            const summary = (result.changes && result.changes.length > 0)
                ? result.changes.join('; ')
                : 'sin cambios';
            await AdminController.logAudit(req, 'UPDATE', 'SAAS_INVOICE', id,
                `Editó factura pagada (ajuste manual): ${summary}`, null);

            res.json({
                success: true,
                data: result.invoice,
                message: 'Recibo actualizado correctamente'
            });
        } catch (error) {
            console.error('Update paid details error:', error);
            res.status(500).json({ error: error.message || 'Error al actualizar recibo' });
        }
    }

    /**
     * GET /api/admin/saas-billing/invoices/:id/payment-pdf
     * Descargar comprobante PDF de pago confirmado (solo facturas PAID)
     */
    static async downloadPaidInvoicePdf(req, res) {
        try {
            const invoice = await SaaSBillingModel.getInvoiceWithItems(req.params.id);
            if (!invoice) {
                return res.status(404).json({ error: 'Factura no encontrada' });
            }
            if (invoice.status !== 'PAID') {
                return res.status(400).json({ error: 'El comprobante PDF solo está disponible para facturas pagadas' });
            }
            const SaaSInvoicePdfService = require('../services/SaaSInvoicePdfService');
            const paymentReport = await SaaSBillingModel.getLatestPaymentReport(invoice.id);
            SaaSInvoicePdfService.streamPaidInvoice(res, invoice, paymentReport);
        } catch (error) {
            console.error('Download paid invoice PDF (admin) error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error al generar el comprobante PDF' });
            } else {
                res.end();
            }
        }
    }

    /**
     * GET /api/admin/saas-billing/tenants-available
     * Listar tenants activos para generar facturas
     */
    static async getTenantsForBilling(req, res) {
        try {
            const pool = await connectDB();
            const now = new Date();
            const month = req.query.period_month ? parseInt(req.query.period_month) : (now.getMonth() + 1);
            const year = req.query.period_year ? parseInt(req.query.period_year) : now.getFullYear();
            const r = await pool.request()
                .input('m', sql.Int, month)
                .input('y', sql.Int, year)
                .query(`
                    SELECT t.id, t.name, t.slug,
                        COALESCE(t.saas_unit_price_usd, 0.50) AS saas_unit_price_usd,
                        (SELECT COUNT(*) FROM Properties WHERE tenant_id = t.id) as property_count,
                        (SELECT COUNT(*) FROM SaaSInvoices WHERE tenant_id = t.id AND period_month = @m AND period_year = @y) as has_invoice
                    FROM Tenants t
                    WHERE t.active = 1
                    ORDER BY t.name
                `);
            res.json({ success: true, data: r.recordset });
        } catch (error) {
            console.error('Get tenants for billing error:', error);
            res.status(500).json({ error: 'Error al obtener condominios' });
        }
    }
}

module.exports = AdminSaaSBillingController;
