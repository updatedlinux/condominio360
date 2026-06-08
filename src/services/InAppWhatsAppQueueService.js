const { sql, connectDB } = require('../config/database');
const TenantModel = require('../models/TenantModel');
const WhatsAppQueueModel = require('../models/WhatsAppQueueModel');
const WhatsAppPhoneBlacklistModel = require('../models/WhatsAppPhoneBlacklistModel');
const UserModel = require('../models/UserModel');
const OpenWAWhatsAppService = require('./OpenWAWhatsAppService');
const EmailService = require('./EmailService');
const { normalizePhoneForWhatsApp } = require('../utils/whatsappPhone');

function buildWhatsAppOutboundBody(tenantName, userMessage) {
    const name = (tenantName || '').replace(/\s+/g, ' ').trim() || 'Condominio';
    const header = `📢 Mensaje enviado por la Junta de Condominio - ${name}:\n\n`;
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

function effectiveTargetBuilding(value) {
    if (value == null) return null;
    const s = String(value).trim();
    if (!s || s.toLowerCase() === 'null') return null;
    return s;
}

function isOpenWAServerError(errText) {
    return /^HTTP 500\b/i.test(errText || '');
}

function maskChatId(chatId) {
    const s = String(chatId || '').replace(/@c\.us$/, '');
    if (s.length <= 4) return '****@c.us';
    return `***${s.slice(-4)}@c.us`;
}

async function resolveOwnerPrimaryEmail(userId) {
    const user = await UserModel.findById(userId);
    if (!user) return { email: null, firstName: 'Propietario' };
    if (user.email && String(user.email).trim()) {
        return { email: String(user.email).trim(), firstName: user.first_name || 'Propietario' };
    }
    const emails = await UserModel.getEmails(userId);
    const pick = emails.find((e) => e.is_primary) || emails[0];
    return {
        email: pick?.email ? String(pick.email).trim() : null,
        firstName: user.first_name || 'Propietario'
    };
}

/**
 * Cola global: máximo 30 envíos exitosos a OpenWA cada 2 minutos (plataforma).
 * Un job = un propietario. Teléfonos VE (+58), ES (+34) y US (+1).
 */
class InAppWhatsAppQueueService {
    static async loadOwnerRecipientsWithPhones(tenantId, targetBuilding = null) {
        const pool = await connectDB();
        const req = pool.request().input('tenant_id', sql.UniqueIdentifier, tenantId);
        const building = effectiveTargetBuilding(targetBuilding);
        let buildingClause = '';
        if (building) {
            buildingClause = ' AND (p.building = @target_building OR b.name = @target_building)';
            req.input('target_building', sql.NVarChar, building);
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
            effectiveTargetBuilding(n.target_building)
        );
        const blockedChatIds = await WhatsAppPhoneBlacklistModel.getBlockedChatIds(n.tenant_id);
        let enqueued = 0;
        let skippedPhones = 0;
        let skippedBlacklisted = 0;
        for (const row of owners) {
            const norm = normalizePhoneForWhatsApp(row.phone);
            if (!norm) {
                skippedPhones += 1;
                continue;
            }

            if (blockedChatIds.has(norm.chatId)) {
                skippedBlacklisted += 1;
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
        if (skippedBlacklisted > 0) {
            console.log('[WhatsApp] Destinatarios omitidos (lista negra)', {
                notificationId: inAppNotificationId,
                tenantId: n.tenant_id,
                skippedBlacklisted
            });
        }
        return { enqueued, skippedPhones, skippedBlacklisted, targetBuilding: n.target_building || null };
    }

    static async notifyOwnerWhatsAppBlacklisted(tenantId, userId, chatId, tenantName) {
        const { email, firstName } = await resolveOwnerPrimaryEmail(userId);
        if (!email) {
            console.warn('[WhatsApp] Lista negra: propietario sin correo', {
                tenantId,
                userId,
                chatId: maskChatId(chatId)
            });
            return false;
        }

        const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
        await EmailService.sendWhatsAppPhoneBlacklistNotice(
            email,
            firstName,
            tenantName,
            `${base}/owner/profile`,
            { tenantId, chatId, userId }
        );
        await WhatsAppPhoneBlacklistModel.markOwnerNotified(tenantId, chatId);
        console.log('[WhatsApp] Correo lista negra enviado al propietario', {
            tenantId,
            chatId: maskChatId(chatId)
        });
        return true;
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

            const chatId = job.chat_id || job.phone_national;
            if (await WhatsAppPhoneBlacklistModel.isBlocked(job.tenant_id, chatId)) {
                await WhatsAppQueueModel.markSkipped(
                    job.id,
                    'Número en lista negra WhatsApp (fallos 500 recurrentes). Revise el teléfono del propietario.'
                );
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
                try {
                    await WhatsAppPhoneBlacklistModel.recordSuccess(job.tenant_id, chatId);
                } catch (blErr) {
                    console.warn('[WhatsApp] recordSuccess falló (envío ya OK)', blErr.message);
                }
            } catch (e) {
                const errText = e.message || 'Error de envío';
                if (isOpenWAServerError(errText)) {
                    const bl = await WhatsAppPhoneBlacklistModel.recordServerFailure(
                        job.tenant_id,
                        chatId,
                        job.user_id,
                        errText
                    );
                    if (bl.newlyBlocked && !bl.ownerNotified) {
                        console.warn('[WhatsApp] Número añadido a lista negra', {
                            tenantId: job.tenant_id,
                            chatId: maskChatId(chatId),
                            failures: bl.failureCount,
                            threshold: bl.threshold
                        });
                        InAppWhatsAppQueueService.notifyOwnerWhatsAppBlacklisted(
                            job.tenant_id,
                            job.user_id,
                            chatId,
                            tenantRow?.name
                        ).catch((mailErr) => {
                            console.warn('[WhatsApp] No se pudo enviar correo de lista negra', mailErr.message);
                        });
                    }
                }
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
