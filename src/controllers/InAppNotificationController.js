const InAppNotificationModel = require('../models/InAppNotificationModel');
const TenantAdminModel = require('../models/TenantAdminModel');
const TenantModel = require('../models/TenantModel');
const AuditService = require('../services/AuditService');
const InAppWhatsAppQueueService = require('../services/InAppWhatsAppQueueService');

const WA_UNAVAILABLE_MSG =
    'El servicio de WhatsApp no está contratado o configurado para este condominio. Contacte a administración Condominio360.';

/**
 * Controller para Notificaciones In-App (mensajes cortos)
 * Tenant Admin: CRUD, enviar ahora, programar
 * Owner: listar últimas
 */
class InAppNotificationController {
    /**
     * InAppNotifications.created_by referencia TenantAdmins.id.
     * JWT TENANT_ADMIN: userId es TenantAdmins.id.
     * Superadmin con tenant (impersonación / panel): userId es Users.id → usar un admin de junta del tenant.
     */
    static async resolveTenantAdminAuthorId(req) {
        const tenantId = req.user.tenantId;
        if (!tenantId) {
            const err = new Error('Tenant no definido en la sesión');
            err.statusCode = 400;
            throw err;
        }
        if (req.user.type === 'TENANT_ADMIN') {
            return req.user.userId;
        }
        if (req.user.isSuperAdmin) {
            const id = await TenantAdminModel.findFirstActiveIdForTenant(tenantId);
            if (!id) {
                const err = new Error(
                    'No hay administrador de junta activo en este condominio; no se puede registrar el autor del mensaje.'
                );
                err.statusCode = 400;
                throw err;
            }
            return id;
        }
        const err = new Error('No autorizado');
        err.statusCode = 403;
        throw err;
    }

    static async assertWhatsAppAllowed(tenantId, sendWhatsapp) {
        if (!sendWhatsapp) return;
        const cfg = await TenantModel.getWhatsAppDeliveryConfig(tenantId);
        if (!cfg) {
            const err = new Error(WA_UNAVAILABLE_MSG);
            err.statusCode = 400;
            throw err;
        }
    }

    /**
     * GET /api/tenant-admin/whatsapp-messaging-status
     */
    static async getWhatsAppMessagingStatus(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const available = !!(await TenantModel.getWhatsAppDeliveryConfig(tenantId));
            res.json({
                success: true,
                data: {
                    whatsappAvailable: available,
                    unavailableMessage:
                        'El servicio de WhatsApp no está contratado para este condominio. Contacte a administración Condominio360 para contratarlo (costo adicional).'
                }
            });
        } catch (error) {
            console.error('getWhatsAppMessagingStatus error:', error);
            res.status(500).json({ success: false, error: 'Error al verificar WhatsApp' });
        }
    }

    /**
     * GET /api/tenant-admin/in-app-notifications
     */
    static async list(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { status, page, limit } = req.query;
            const result = await InAppNotificationModel.findByTenant(tenantId, {
                status,
                page: parseInt(page) || 1,
                limit: parseInt(limit) || 20
            });
            res.json({ success: true, ...result });
        } catch (error) {
            console.error('List in-app notifications error:', error);
            res.status(500).json({ success: false, error: 'Error al listar mensajes' });
        }
    }

    /**
     * GET /api/tenant-admin/in-app-notifications/:id
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const notification = await InAppNotificationModel.findById(id, tenantId);
            if (!notification) {
                return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
            }
            res.json({ success: true, data: notification });
        } catch (error) {
            console.error('Get in-app notification error:', error);
            res.status(500).json({ success: false, error: 'Error al obtener mensaje' });
        }
    }

    /**
     * POST /api/tenant-admin/in-app-notifications
     * Crear: draft, scheduled o send now
     */
    static async create(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const createdBy = await InAppNotificationController.resolveTenantAdminAuthorId(req);
            const {
                message,
                status = 'DRAFT',
                scheduledAt = null,
                sendWhatsapp = false,
                sendNow = false
            } = req.body;

            let finalStatus = status;
            let scheduledAtVal = scheduledAt;

            if (sendNow) {
                finalStatus = 'SENT';
                scheduledAtVal = null;
            } else if (status === 'SCHEDULED' && scheduledAt) {
                finalStatus = 'SCHEDULED';
            }

            await InAppNotificationController.assertWhatsAppAllowed(tenantId, !!sendWhatsapp);

            const notification = await InAppNotificationModel.create({
                tenantId,
                createdBy,
                message,
                status: finalStatus,
                scheduledAt: scheduledAtVal,
                sendWhatsapp
            });

            if (sendNow) {
                await InAppNotificationModel.markAsSent(notification.id);
                notification.status = 'SENT';
                notification.sent_at = new Date();
                await InAppWhatsAppQueueService.enqueueWhatsAppForSentNotification(notification.id).catch((e) => {
                    console.error('[WhatsApp enqueue create sendNow]', e);
                });
            }

            await AuditService.log({
                tenantId,
                actorId: createdBy,
                action: sendNow ? 'IN_APP_NOTIFICATION_SENT' : 'IN_APP_NOTIFICATION_CREATED',
                entityType: 'IN_APP_NOTIFICATION',
                entityId: notification.id,
                metadata: { status: finalStatus, sendNow }
            });

            res.status(201).json({
                success: true,
                message: sendNow ? 'Mensaje enviado' : finalStatus === 'SCHEDULED' ? 'Mensaje programado' : 'Borrador guardado',
                data: notification
            });
        } catch (error) {
            console.error('Create in-app notification error:', error);
            const code = error.statusCode || 400;
            res.status(code).json({
                success: false,
                error: error.message || 'Error al crear mensaje'
            });
        }
    }

    /**
     * PUT /api/tenant-admin/in-app-notifications/:id
     * Solo DRAFT o SCHEDULED
     */
    static async update(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const { message, status, scheduledAt, sendWhatsapp } = req.body;

            const existing = await InAppNotificationModel.findById(id, tenantId);
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
            }
            if (existing.status === 'SENT') {
                return res.status(400).json({ success: false, error: 'No se puede editar un mensaje ya enviado' });
            }

            if (sendWhatsapp !== undefined) {
                await InAppNotificationController.assertWhatsAppAllowed(tenantId, !!sendWhatsapp);
            }

            const updated = await InAppNotificationModel.update(id, {
                message,
                status,
                scheduledAt,
                sendWhatsapp
            });

            if (!updated) {
                return res.status(400).json({ success: false, error: 'Error al actualizar' });
            }

            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'IN_APP_NOTIFICATION_UPDATED',
                entityType: 'IN_APP_NOTIFICATION',
                entityId: id
            });

            res.json({ success: true, data: updated });
        } catch (error) {
            console.error('Update in-app notification error:', error);
            const code = error.statusCode || 400;
            res.status(code).json({
                success: false,
                error: error.message || 'Error al actualizar mensaje'
            });
        }
    }

    /**
     * POST /api/tenant-admin/in-app-notifications/:id/send
     * Enviar ahora (DRAFT o SCHEDULED). Body opcional: { sendWhatsapp: boolean }
     */
    static async sendNow(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const { sendWhatsapp: bodySendWa } = req.body || {};

            const existing = await InAppNotificationModel.findById(id, tenantId);
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
            }
            if (existing.status === 'SENT') {
                return res.status(400).json({ success: false, error: 'El mensaje ya fue enviado' });
            }

            if (bodySendWa !== undefined) {
                await InAppNotificationController.assertWhatsAppAllowed(tenantId, !!bodySendWa);
                await InAppNotificationModel.update(id, { sendWhatsapp: !!bodySendWa });
            }

            const refreshed = await InAppNotificationModel.findById(id, tenantId);
            if (refreshed.send_whatsapp) {
                await InAppNotificationController.assertWhatsAppAllowed(tenantId, true);
            }

            const updated = await InAppNotificationModel.markAsSent(id);

            await InAppWhatsAppQueueService.enqueueWhatsAppForSentNotification(id).catch((e) => {
                console.error('[WhatsApp enqueue send]', e);
            });

            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'IN_APP_NOTIFICATION_SENT',
                entityType: 'IN_APP_NOTIFICATION',
                entityId: id
            });

            res.json({ success: true, message: 'Mensaje enviado', data: updated });
        } catch (error) {
            console.error('Send in-app notification error:', error);
            const code = error.statusCode || 500;
            res.status(code).json({
                success: false,
                error: error.message || 'Error al enviar mensaje'
            });
        }
    }

    /**
     * DELETE /api/tenant-admin/in-app-notifications/:id
     * Solo DRAFT o SCHEDULED
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const existing = await InAppNotificationModel.findById(id, tenantId);
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
            }
            if (existing.status === 'SENT') {
                return res.status(400).json({ success: false, error: 'No se puede eliminar un mensaje ya enviado' });
            }

            await InAppNotificationModel.delete(id, tenantId);

            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'IN_APP_NOTIFICATION_DELETED',
                entityType: 'IN_APP_NOTIFICATION',
                entityId: id
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Delete in-app notification error:', error);
            res.status(500).json({ success: false, error: 'Error al eliminar mensaje' });
        }
    }

    /**
     * GET /api/owner/in-app-notifications
     * Últimas 4 para el panel del propietario
     * Usa tenantId del token o lo obtiene de propertyId
     */
    static async getForOwner(req, res) {
        try {
            let tenantId = req.user.tenantId;
            if (!tenantId && req.query.propertyId) {
                const { connectDB, sql } = require('../config/database');
                const pool = await connectDB();
                const r = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, req.query.propertyId)
                    .query('SELECT tenant_id FROM Properties WHERE id = @propertyId');
                if (r.recordset[0]) {
                    tenantId = r.recordset[0].tenant_id;
                }
            }
            if (!tenantId) {
                return res.json({ success: true, data: [] });
            }
            const notifications = await InAppNotificationModel.getLatestForTenant(tenantId, 4);
            res.json({ success: true, data: notifications });
        } catch (error) {
            console.error('Get owner notifications error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar notificaciones' });
        }
    }
}

module.exports = InAppNotificationController;
