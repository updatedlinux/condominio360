const crypto = require('crypto');
const WhatsAppWebhookModel = require('../models/WhatsAppWebhookModel');
const OpenWAWhatsAppService = require('../services/OpenWAWhatsAppService');

function verifyWebhookSignature(payload, signature, secret) {
    if (!secret || !signature) return !secret;
    try {
        const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
        const sigBuf = Buffer.from(String(signature));
        const expBuf = Buffer.from(expected);
        if (sigBuf.length !== expBuf.length) return false;
        return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
        return false;
    }
}

function mapAckName(ackName, ack) {
    const name = String(ackName || '').toLowerCase();
    if (name === 'read') return 'READ';
    if (name === 'delivered') return 'DELIVERED';
    if (name === 'sent') return 'SENT_ACK';
    if (name === 'pending') return 'PENDING_ACK';
    if (name === 'error') return 'ERROR';
    const n = Number(ack);
    if (n === 4) return 'READ';
    if (n === 3) return 'DELIVERED';
    if (n === 2) return 'SENT_ACK';
    return 'ACK';
}

class OpenWAWebhookController {
    /**
     * POST /api/webhooks/openwa
     * Eventos: message.sent, message.ack, session.connected, session.disconnected, session.qr, message.received
     */
    static async handle(req, res) {
        const secret = (process.env.OPENWA_WEBHOOK_SECRET || '').trim();
        const signature = req.headers['x-openwa-signature'] || req.headers['x-webhook-signature'];

        if (secret && !verifyWebhookSignature(req.body, signature, secret)) {
            console.warn('[OpenWA webhook] Firma inválida');
            return res.status(401).json({ success: false, error: 'Invalid signature' });
        }

        const body = req.body || {};
        const eventType = body.event || body.type || 'unknown';
        const sessionId = body.sessionId || body.data?.sessionId || null;

        try {
            const tenantId = await WhatsAppWebhookModel.findTenantIdBySessionId(sessionId);
            let openwaMessageId = null;
            let queueId = null;
            let deliveryStatus = null;

            if (eventType === 'message.sent') {
                openwaMessageId = body.data?.messageId || body.data?.id || null;
                deliveryStatus = 'SENT_CONFIRMED';
                queueId = await WhatsAppWebhookModel.findQueueIdByMessageId(openwaMessageId);
                if (openwaMessageId) {
                    await WhatsAppWebhookModel.updateQueueDeliveryByMessageId(
                        openwaMessageId,
                        deliveryStatus,
                        new Date()
                    );
                }
            } else if (eventType === 'message.ack') {
                openwaMessageId = body.data?.messageId || body.data?.id || null;
                deliveryStatus = mapAckName(body.data?.ackName, body.data?.ack);
                queueId = await WhatsAppWebhookModel.findQueueIdByMessageId(openwaMessageId);
                if (openwaMessageId) {
                    await WhatsAppWebhookModel.updateQueueDeliveryByMessageId(
                        openwaMessageId,
                        deliveryStatus,
                        new Date()
                    );
                }
            } else if (eventType === 'message.received') {
                openwaMessageId = body.data?.id || null;
            }

            await WhatsAppWebhookModel.insertEvent({
                tenantId,
                sessionId,
                eventType,
                openwaMessageId,
                queueId,
                payload: body
            });

            if (eventType.startsWith('session.')) {
                console.log(`[OpenWA webhook] ${eventType} session=${sessionId || '-'} tenant=${tenantId || '-'}`);
            }

            return res.status(200).json({ success: true });
        } catch (e) {
            console.error('[OpenWA webhook]', e);
            return res.status(500).json({ success: false, error: 'Webhook processing error' });
        }
    }

    /** GET /api/admin/openwa-webhook-info — URL sugerida para configurar en OpenWA */
    static async getWebhookInfo(req, res) {
        if (!req.user?.isSuperAdmin) {
            return res.status(403).json({ success: false, error: 'Solo Super Admin' });
        }
        res.json({
            success: true,
            data: {
                webhookUrl: OpenWAWhatsAppService.getWebhookUrl(),
                suggestedEvents: [
                    'message.sent',
                    'message.ack',
                    'session.connected',
                    'session.disconnected',
                    'session.qr'
                ],
                signatureHeader: 'X-OpenWA-Signature',
                signatureConfigured: !!(process.env.OPENWA_WEBHOOK_SECRET || '').trim(),
                openwaConfigured: !!OpenWAWhatsAppService.getPlatformConfig()
            }
        });
    }
}

module.exports = OpenWAWebhookController;
