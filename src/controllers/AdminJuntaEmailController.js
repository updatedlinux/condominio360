const AdminController = require('./AdminController');
const SupportJuntaEmailService = require('../services/SupportJuntaEmailService');
const TenantAdminModel = require('../models/TenantAdminModel');
const TenantJuntaEmailContactModel = require('../models/TenantJuntaEmailContactModel');
const TenantModel = require('../models/TenantModel');
const uploadJuntaEmailImageMw = require('../middleware/uploadJuntaEmailImage');

function isUuid(s) {
    return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function parseUuidList(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter((id) => isUuid(id));
}

class AdminJuntaEmailController {
    /**
     * GET /api/admin/tenants/:id/junta-email/recipients
     */
    static async listRecipients(req, res) {
        try {
            const tenantId = req.params.id;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            const admins = (await TenantAdminModel.getByTenant(tenantId))
                .filter((a) => a.is_active !== false && a.is_active !== 0)
                .map((a) => ({
                    id: a.id,
                    email: a.email,
                    first_name: a.first_name,
                    last_name: a.last_name,
                    role: a.role,
                    is_active: !!a.is_active
                }));

            const frequent_contacts = (await TenantJuntaEmailContactModel.listByTenant(tenantId)).map((c) => ({
                id: c.id,
                email: c.email,
                display_name: c.display_name,
                notes: c.notes
            }));

            res.json({
                success: true,
                data: {
                    tenant: { id: tenant.id, name: tenant.name },
                    admins,
                    frequent_contacts
                }
            });
        } catch (e) {
            console.error('[AdminJuntaEmailController.listRecipients]', e);
            res.status(500).json({ success: false, error: 'Error al listar destinatarios' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/junta-email/contacts
     * Body: { email, display_name?, notes? }
     */
    static async createContact(req, res) {
        try {
            const tenantId = req.params.id;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            const contact = await TenantJuntaEmailContactModel.create(
                tenantId,
                {
                    email: req.body?.email,
                    display_name: req.body?.display_name,
                    notes: req.body?.notes
                },
                req.user?.id || null
            );

            res.status(201).json({ success: true, data: { contact } });
        } catch (e) {
            console.error('[AdminJuntaEmailController.createContact]', e);
            if (e.code === 'VALIDATION' || e.code === 'DUPLICATE') {
                return res.status(400).json({ success: false, error: e.message });
            }
            res.status(500).json({ success: false, error: 'Error al guardar contacto frecuente' });
        }
    }

    /**
     * DELETE /api/admin/tenants/:id/junta-email/contacts/:contactId
     */
    static async deleteContact(req, res) {
        try {
            const tenantId = req.params.id;
            const contactId = req.params.contactId;
            if (!isUuid(contactId)) {
                return res.status(400).json({ success: false, error: 'Contacto inválido' });
            }

            const deleted = await TenantJuntaEmailContactModel.delete(tenantId, contactId);
            if (!deleted) {
                return res.status(404).json({ success: false, error: 'Contacto no encontrado' });
            }

            res.json({ success: true, message: 'Contacto eliminado' });
        } catch (e) {
            console.error('[AdminJuntaEmailController.deleteContact]', e);
            res.status(500).json({ success: false, error: 'Error al eliminar contacto' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/junta-email/preview
     */
    static async preview(req, res) {
        try {
            const tenantId = req.params.id;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            const html = SupportJuntaEmailService.buildPreviewHtml(req.body?.html_body, tenant.name);
            res.json({ success: true, data: { html } });
        } catch (e) {
            console.error('[AdminJuntaEmailController.preview]', e);
            res.status(500).json({ success: false, error: 'Error al generar vista previa' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/junta-email/send
     * Body: { subject, html_body, admin_ids?, contact_ids?, extra_emails?, save_extra_as_frequent? }
     */
    static async send(req, res) {
        try {
            const tenantId = req.params.id;
            const subject = String(req.body?.subject || '').trim();
            const htmlBody = req.body?.html_body;
            const adminIds = parseUuidList(req.body?.admin_ids);
            const contactIds = parseUuidList(req.body?.contact_ids);
            const extraEmails = Array.isArray(req.body?.extra_emails) ? req.body.extra_emails : [];
            const saveExtraAsFrequent = !!req.body?.save_extra_as_frequent;

            const result = await SupportJuntaEmailService.sendToRecipients({
                tenantId,
                subject,
                htmlBody,
                adminIds,
                contactIds,
                extraEmails,
                saveExtraAsFrequent,
                createdBy: req.user?.id || null
            });

            await AdminController.logAudit(
                req,
                'CREATE',
                'JUNTA_SUPPORT_EMAIL',
                tenantId,
                `Correo support: "${subject}" (${result.sent}/${result.total} enviados)`,
                tenantId
            );

            res.json({
                success: true,
                message:
                    result.failed === 0
                        ? `Correo enviado a ${result.sent} destinatario(s)`
                        : `Enviado a ${result.sent}; falló ${result.failed}`,
                data: {
                    sent: result.sent,
                    failed: result.failed,
                    total: result.total,
                    results: result.results
                }
            });
        } catch (e) {
            console.error('[AdminJuntaEmailController.send]', e);
            if (e.code === 'NOT_FOUND') {
                return res.status(404).json({ success: false, error: e.message });
            }
            if (e.code === 'VALIDATION' || e.code === 'NO_RECIPIENTS') {
                return res.status(400).json({ success: false, error: e.message });
            }
            res.status(500).json({ success: false, error: 'Error al enviar correo' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/junta-email/upload-image
     */
    static async uploadImage(req, res) {
        try {
            const tenantId = req.params.id;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen' });
            }

            const url = uploadJuntaEmailImageMw.publicImageUrl(req, tenantId, req.file.filename);
            res.json({
                success: true,
                data: {
                    url,
                    filename: req.file.filename
                }
            });
        } catch (e) {
            console.error('[AdminJuntaEmailController.uploadImage]', e);
            res.status(500).json({ success: false, error: 'Error al subir imagen' });
        }
    }
}

module.exports = AdminJuntaEmailController;
