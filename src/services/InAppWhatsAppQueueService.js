const { sql, connectDB } = require('../config/database');
const TenantModel = require('../models/TenantModel');
const WhatsAppQueueModel = require('../models/WhatsAppQueueModel');
const OpenWAWhatsAppService = require('./OpenWAWhatsAppService');
const { normalizePhoneForWhatsApp } = require('../utils/whatsappPhone');

function buildWhatsAppOutboundBody(tenantName, userMessage) {
    const name = (tenantName || '').replace(/\s+/g, ' ').trim() || 'Condominio';
    const header = `⚠️ Mensaje enviado por la Junta de Condominio - ${name}:\n\n`;
    const body = (userMessage || '').trim();
    const footer = '\n\n_⚙️ Este es un mensaje automático del sistema. Por favor, no responda a este bot_';
    return `${header}${body}${footer}`;
}

function resolveMessageType(mime) {
    if (!mime) return 'TEXT';
    if (mime.startsWith('image/')) return 'IMAGE';
    if (mime === 'application/pdf') return 'DOCUMENT';
    return 'TEXT';
}

/**
 * Cola global: máximo 30 envíos exitosos a OpenWA cada 2 minutos (plataforma).
 * Un job = un propietario. Teléfonos VE (+58), ES (+34) y US (+1).
 */
class InAppWhatsAppQueueService {
    static async loadOwnerRecipientsWithPhones(tenantId, targetBuilding = null) {
        const pool = await connectDB();
        const req = pool.request().input('tenant_id', sql.UniqueIdentifier, tenantId);
        let buildingClause = '';
        if (targetBuilding) {
            buildingClause = ' AND (p.building = @target_building OR b.name = @target_building)';
            req.input('target_building', sql.NVarChar, targetBuilding);
        }
        const r = await req.query(`
            SELECT DISTINCT u.id AS user_id, u.phone
            FROM Users u
            INNER JOIN PropertyOwners po ON po.user_id = u.id
            INNER JOIN Properties p ON p.id = po.property_id
            LEFT JOIN Buildings b ON p.building_id = b.id
            WHERE p.tenant_id = @tenant_id
              AND u.phone IS NOT NULL
              AND LEN(LTRIM(RTRIM(u.phone))) > 0
              ${buildingClause}
        `);
        return r.recordset || [];
    }

    static async enqueueWhatsAppForSentNotification(inAppNotificationId) {
        const pool = await connectDB();
        const nRow = await pool.request()
            .input('id', sql.UniqueIdentifier, inAppNotificationId)
            .query(`
                SELECT n.* FROM InAppNotifications n WHERE n.id = @id AND n.status = 'SENT'
            `);
        const n = nRow.recordset[0];
        if (!n || !n.send_whatsapp) {
            return { enqueued: 0, skipped: 'no_flag' };
        }

        if (await WhatsAppQueueModel.hasRowsForNotification(inAppNotificationId)) {
            return { enqueued: 0, skipped: 'already_queued' };
        }

        const cfg = await TenantModel.getWhatsAppDeliveryConfig(n.tenant_id);
        if (!cfg) {
            console.warn(`[WhatsApp] OpenWA no configurado para tenant ${n.tenant_id}, notificación ${inAppNotificationId}`);
            return { enqueued: 0, skipped: 'not_configured' };
        }

        const message = (n.message || '').trim();
        const hasAttachment = !!(n.attachment_path && n.attachment_mime);
        if (!message && !hasAttachment) {
            return { enqueued: 0, skipped: 'empty_message' };
        }

        const messageType = hasAttachment ? resolveMessageType(n.attachment_mime) : 'TEXT';
        const owners = await InAppWhatsAppQueueService.loadOwnerRecipientsWithPhones(
            n.tenant_id,
            n.target_building || null
        );
        let enqueued = 0;
        let skippedPhones = 0;
        for (const row of owners) {
            const norm = normalizePhoneForWhatsApp(row.phone);
            if (!norm) {
                skippedPhones += 1;
                continue;
            }

            if (await WhatsAppQueueModel.rowExistsForNotificationAndUser(n.id, row.user_id)) {
                continue;
            }

            await WhatsAppQueueModel.enqueueRow({
                tenantId: n.tenant_id,
                inAppNotificationId: n.id,
                userId: row.user_id,
                chatId: norm.chatId,
                phoneNational: norm.nationalNumber,
                messageBody: message.slice(0, 500),
                messageType,
                attachmentPath: n.attachment_path || null
            });
            enqueued += 1;
        }
        return { enqueued, skippedPhones, targetBuilding: n.target_building || null };
    }

    static async processQueueTick() {
        await WhatsAppQueueModel.purgeOldGlobalLogs();

        for (;;) {
            const used = await WhatsAppQueueModel.countGlobalSendsInWindow();
            if (used >= WhatsAppQueueModel.MAX_SENDS_PER_WINDOW) {
                break;
            }

            const job = await WhatsAppQueueModel.getNextPending();
            if (!job) break;

            const cfg = await TenantModel.getWhatsAppDeliveryConfig(job.tenant_id);
            if (!cfg) {
                await WhatsAppQueueModel.markFailed(job.id, 'OpenWA no configurado para este condominio (sesión o plataforma)');
                continue;
            }

            const tenantRow = await TenantModel.findById(job.tenant_id);
            const outboundMessage = buildWhatsAppOutboundBody(tenantRow?.name, job.message_body);
            const mediaType = (job.message_type || 'TEXT').toUpperCase();

            try {
                const result = await OpenWAWhatsAppService.sendMessage({
                    sessionId: cfg.sessionId,
                    chatId: job.chat_id || job.phone_national,
                    text: outboundMessage,
                    mediaType,
                    attachmentPath: job.attachment_path,
                    attachmentMime: job.attachment_mime,
                    attachmentOriginalName: job.attachment_original_name,
                    logMeta: {
                        jobId: job.id,
                        notificationId: job.in_app_notification_id,
                        tenantId: job.tenant_id
                    }
                });
                await WhatsAppQueueModel.markSent(job.id, result.messageId);
                await WhatsAppQueueModel.logGlobalSend();
            } catch (e) {
                const errText = e.message || 'Error de envío';
                console.warn(`[WhatsApp queue] Job ${job.id} FAILED:`, errText);
                await WhatsAppQueueModel.markFailed(job.id, errText);
            }
        }
    }

    static start(intervalMs = 20000) {
        if (InAppWhatsAppQueueService._timer) return;
        InAppWhatsAppQueueService._timer = setInterval(() => {
            InAppWhatsAppQueueService.processQueueTick().catch((err) => {
                console.error('[WhatsApp queue]', err);
            });
        }, intervalMs);
        InAppWhatsAppQueueService.processQueueTick().catch((err) => {
            console.error('[WhatsApp queue]', err);
        });
    }
}

module.exports = InAppWhatsAppQueueService;
