const { sql, connectDB } = require('../config/database');
const TenantModel = require('../models/TenantModel');
const WhatsAppQueueModel = require('../models/WhatsAppQueueModel');
const WhatsAppExternalApiService = require('./WhatsAppExternalApiService');
const { normalizeVenezuelaMobileForWhatsApp } = require('../utils/venezuelaPhone');

function buildWhatsAppOutboundBody(tenantName, userMessage) {
    const name = (tenantName || '').replace(/\s+/g, ' ').trim() || 'Condominio';
    const header = `⚠️ Mensaje enviado por la Junta de Condominio - ${name}:\n\n`;
    const body = (userMessage || '').trim();
    // WhatsApp: _texto_ = cursiva
    const footer = '\n\n_⚙️ Este es un mensaje automático del sistema. Por favor, no responda a este bot_';
    return `${header}${body}${footer}`;
}

/**
 * Cola global: máximo 30 envíos exitosos a API externa cada 2 minutos (plataforma).
 * Un job = un propietario; el API externo no encola.
 * Solo móviles Venezuela (prefijos 424/412/416/426/414/422); otros números se omiten sin error.
 */
class InAppWhatsAppQueueService {
    static async loadOwnerRecipientsWithPhones(tenantId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT DISTINCT u.id AS user_id, u.phone
                FROM Users u
                INNER JOIN PropertyOwners po ON po.user_id = u.id
                INNER JOIN Properties p ON p.id = po.property_id
                WHERE p.tenant_id = @tenant_id
                  AND u.phone IS NOT NULL
                  AND LEN(LTRIM(RTRIM(u.phone))) > 0
            `);
        return r.recordset || [];
    }

    /**
     * Tras marcar mensaje in-app como SENT con send_whatsapp = 1.
     */
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
            console.warn(`[WhatsApp] Sin API configurada para tenant ${n.tenant_id}, notificación ${inAppNotificationId}`);
            return { enqueued: 0, skipped: 'not_configured' };
        }

        const message = (n.message || '').trim();
        if (!message) {
            return { enqueued: 0, skipped: 'empty_message' };
        }

        const owners = await InAppWhatsAppQueueService.loadOwnerRecipientsWithPhones(n.tenant_id);
        let enqueued = 0;
        for (const row of owners) {
            const norm = normalizeVenezuelaMobileForWhatsApp(row.phone);
            if (!norm) continue;

            if (await WhatsAppQueueModel.rowExistsForNotificationAndUser(n.id, row.user_id)) {
                continue;
            }

            await WhatsAppQueueModel.enqueueRow({
                tenantId: n.tenant_id,
                inAppNotificationId: n.id,
                userId: row.user_id,
                phoneNational: norm.phoneNumber,
                messageBody: message.slice(0, 500)
            });
            enqueued += 1;
        }
        return { enqueued };
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
                await WhatsAppQueueModel.markFailed(job.id, 'API WhatsApp no configurada para este condominio');
                continue;
            }

            const tenantRow = await TenantModel.findById(job.tenant_id);
            const outboundMessage = buildWhatsAppOutboundBody(tenantRow?.name, job.message_body);

            try {
                await WhatsAppExternalApiService.sendWhatsApp({
                    baseUrl: cfg.baseUrl,
                    secretKey: cfg.secretKey,
                    countryCode: '+58',
                    phoneNumber: job.phone_national,
                    message: outboundMessage,
                    logMeta: {
                        jobId: job.id,
                        notificationId: job.in_app_notification_id,
                        tenantId: job.tenant_id
                    }
                });
                await WhatsAppQueueModel.markSent(job.id);
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
