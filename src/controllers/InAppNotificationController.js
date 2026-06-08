const InAppNotificationModel = require('../models/InAppNotificationModel');
const TenantAdminModel = require('../models/TenantAdminModel');
const TenantModel = require('../models/TenantModel');
const AuditService = require('../services/AuditService');
const InAppWhatsAppQueueService = require('../services/InAppWhatsAppQueueService');
const { relativeAttachmentPath } = require('../middleware/uploadInAppNotificationAttachment');
const fs = require('fs');
const path = require('path');

const WA_UNAVAILABLE_MSG =
    'El servicio de WhatsApp no está contratado o configurado para este condominio. Contacte a administración Condominio360.';

/** null/''/undefined → sin filtro; evita String(null) === "null" en JSON del frontend. */
function normalizeTargetBuilding(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const s = String(value).trim();
    if (!s || s.toLowerCase() === 'null') return null;
    return s;
}

function parseRequestFields(req) {
    const b = req.body || {};
    return {
        message: b.message,
        status: b.status,
        scheduledAt: b.scheduledAt,
        sendWhatsapp: InAppNotificationModel.coerceBool(b.sendWhatsapp),
        sendNow: InAppNotificationModel.coerceBool(b.sendNow),
        targetBuilding: normalizeTargetBuilding(b.targetBuilding),
        removeAttachment: InAppNotificationModel.coerceBool(b.removeAttachment) === true
    };
}

function attachmentFromUpload(req) {
    if (!req.file) return null;
    const tenantId = req.user.tenantId;
    return {
        attachmentPath: relativeAttachmentPath(tenantId, req.file.filename),
        attachmentMime: req.file.mimetype,
        attachmentOriginalName: req.file.originalname || req.file.filename
    };
}

function enrichNotificationRow(row) {
    if (!row) return row;
    const out = { ...row };
    if (out.attachment_path) {
        out.attachment_url = `/uploads/${out.attachment_path}`;
        out.has_attachment = true;
    } else {
        out.has_attachment = false;
    }
    return out;
}

class InAppNotificationController {
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

    static async list(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { status, page, limit } = req.query;
            const result = await InAppNotificationModel.findByTenant(tenantId, {
                status,
                page: parseInt(page) || 1,
                limit: parseInt(limit) || 20
            });
            result.notifications = (result.notifications || []).map(enrichNotificationRow);
            res.json({ success: true, ...result });
        } catch (error) {
            console.error('List in-app notifications error:', error);
            res.status(500).json({ success: false, error: 'Error al listar mensajes' });
        }
    }

    static async getById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const notification = await InAppNotificationModel.findById(id, tenantId);
            if (!notification) {
                return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
            }
            res.json({ success: true, data: enrichNotificationRow(notification) });
        } catch (error) {
            console.error('Get in-app notification error:', error);
            res.status(500).json({ success: false, error: 'Error al obtener mensaje' });
        }
    }

    static async create(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const createdBy = await InAppNotificationController.resolveTenantAdminAuthorId(req);
            const fields = parseRequestFields(req);
            const upload = attachmentFromUpload(req);

            let finalStatus = fields.status || 'DRAFT';
            let scheduledAtVal = fields.scheduledAt;

            if (fields.sendNow) {
                finalStatus = 'SENT';
                scheduledAtVal = null;
            } else if (fields.status === 'SCHEDULED' && fields.scheduledAt) {
                finalStatus = 'SCHEDULED';
            }

            const sendWhatsapp = fields.sendWhatsapp === true;
            await InAppNotificationController.assertWhatsAppAllowed(tenantId, sendWhatsapp);

            const notification = await InAppNotificationModel.create({
                tenantId,
                createdBy,
                message: fields.message || '',
                status: finalStatus,
                scheduledAt: scheduledAtVal,
                sendWhatsapp,
                targetBuilding: fields.targetBuilding,
                attachmentPath: upload?.attachmentPath || null,
                attachmentMime: upload?.attachmentMime || null,
                attachmentOriginalName: upload?.attachmentOriginalName || null
            });

            let whatsappEnqueue = null;
            if (fields.sendNow) {
                await InAppNotificationModel.markAsSent(notification.id);
                notification.status = 'SENT';
                notification.sent_at = new Date();
                whatsappEnqueue = await InAppWhatsAppQueueService.enqueueWhatsAppForSentNotification(notification.id)
                    .catch((e) => {
                        console.error('[WhatsApp enqueue create sendNow]', e);
                        return { enqueued: 0, error: e.message };
                    });
            }

            await AuditService.log({
                tenantId,
                actorId: createdBy,
                action: fields.sendNow ? 'IN_APP_NOTIFICATION_SENT' : 'IN_APP_NOTIFICATION_CREATED',
                entityType: 'IN_APP_NOTIFICATION',
                entityId: notification.id,
                metadata: { status: finalStatus, sendNow: !!fields.sendNow, targetBuilding: fields.targetBuilding }
            });

            res.status(201).json({
                success: true,
                message: fields.sendNow ? 'Mensaje enviado' : finalStatus === 'SCHEDULED' ? 'Mensaje programado' : 'Borrador guardado',
                data: enrichNotificationRow(notification),
                whatsappEnqueue
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

    static async update(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const fields = parseRequestFields(req);
            const upload = attachmentFromUpload(req);

            const existing = await InAppNotificationModel.findById(id, tenantId);
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
            }
            if (existing.status === 'SENT') {
                return res.status(400).json({ success: false, error: 'No se puede editar un mensaje ya enviado' });
            }

            if (fields.sendWhatsapp !== undefined) {
                await InAppNotificationController.assertWhatsAppAllowed(tenantId, !!fields.sendWhatsapp);
            }

            const updateData = {
                message: fields.message,
                status: fields.status,
                scheduledAt: fields.scheduledAt,
                sendWhatsapp: fields.sendWhatsapp,
                targetBuilding: fields.targetBuilding
            };

            if (fields.removeAttachment && existing.attachment_path) {
                updateData.clearAttachment = true;
                try {
                    fs.unlinkSync(path.join(process.cwd(), 'uploads', existing.attachment_path));
                } catch (_) { /* ignore */ }
            }
            if (upload) {
                if (existing.attachment_path) {
                    try {
                        fs.unlinkSync(path.join(process.cwd(), 'uploads', existing.attachment_path));
                    } catch (_) { /* ignore */ }
                }
                updateData.attachmentPath = upload.attachmentPath;
                updateData.attachmentMime = upload.attachmentMime;
                updateData.attachmentOriginalName = upload.attachmentOriginalName;
            }

            const updated = await InAppNotificationModel.update(id, updateData);

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

            res.json({ success: true, data: enrichNotificationRow(updated) });
        } catch (error) {
            console.error('Update in-app notification error:', error);
            const code = error.statusCode || 400;
            res.status(code).json({
                success: false,
                error: error.message || 'Error al actualizar mensaje'
            });
        }
    }

    static async sendNow(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const fields = parseRequestFields(req);

            const existing = await InAppNotificationModel.findById(id, tenantId);
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
            }
            if (existing.status === 'SENT') {
                return res.status(400).json({ success: false, error: 'El mensaje ya fue enviado' });
            }

            if (fields.sendWhatsapp !== undefined) {
                await InAppNotificationController.assertWhatsAppAllowed(tenantId, !!fields.sendWhatsapp);
                await InAppNotificationModel.update(id, { sendWhatsapp: !!fields.sendWhatsapp });
            }

            const refreshed = await InAppNotificationModel.findById(id, tenantId);
            if (refreshed.send_whatsapp) {
                await InAppNotificationController.assertWhatsAppAllowed(tenantId, true);
            }

            const updated = await InAppNotificationModel.markAsSent(id);

            const whatsappEnqueue = await InAppWhatsAppQueueService.enqueueWhatsAppForSentNotification(id)
                .catch((e) => {
                    console.error('[WhatsApp enqueue send]', e);
                    return { enqueued: 0, error: e.message };
                });

            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'IN_APP_NOTIFICATION_SENT',
                entityType: 'IN_APP_NOTIFICATION',
                entityId: id
            });

            res.json({ success: true, message: 'Mensaje enviado', data: enrichNotificationRow(updated), whatsappEnqueue });
        } catch (error) {
            console.error('Send in-app notification error:', error);
            const code = error.statusCode || 500;
            res.status(code).json({
                success: false,
                error: error.message || 'Error al enviar mensaje'
            });
        }
    }

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

    static async getForOwner(req, res) {
        try {
            let tenantId = req.user.tenantId;
            let buildingName = null;

            if (!tenantId && req.query.propertyId) {
                const { connectDB, sql } = require('../config/database');
                const pool = await connectDB();
                const r = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, req.query.propertyId)
                    .query(`
                        SELECT p.tenant_id, p.building, b.name AS building_name
                        FROM Properties p
                        LEFT JOIN Buildings b ON p.building_id = b.id
                        WHERE p.id = @propertyId
                    `);
                if (r.recordset[0]) {
                    tenantId = r.recordset[0].tenant_id;
                    buildingName = r.recordset[0].building_name || r.recordset[0].building || null;
                }
            } else if (req.query.propertyId) {
                const { connectDB, sql } = require('../config/database');
                const pool = await connectDB();
                const r = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, req.query.propertyId)
                    .query(`
                        SELECT p.building, b.name AS building_name
                        FROM Properties p
                        LEFT JOIN Buildings b ON p.building_id = b.id
                        WHERE p.id = @propertyId
                    `);
                if (r.recordset[0]) {
                    buildingName = r.recordset[0].building_name || r.recordset[0].building || null;
                }
            }

            if (!tenantId) {
                return res.json({ success: true, data: [] });
            }

            const notifications = await InAppNotificationModel.getLatestForTenant(tenantId, 4, buildingName);
            const data = notifications.map((n) => {
                const row = enrichNotificationRow(n);
                return {
                    id: row.id,
                    message: row.message,
                    sent_at: row.sent_at,
                    author_name: row.author_name,
                    target_building: row.target_building,
                    has_attachment: row.has_attachment,
                    attachment_url: row.has_attachment ? row.attachment_url : null,
                    attachment_label: row.attachment_original_name
                        || (row.attachment_mime?.startsWith('image/') ? 'Ver imagen' : 'Ver documento')
                };
            });
            res.json({ success: true, data });
        } catch (error) {
            console.error('Get owner notifications error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar notificaciones' });
        }
    }
}

module.exports = InAppNotificationController;
