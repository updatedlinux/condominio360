const crypto = require('crypto');
const WhatsAppWebhookModel = require('../models/WhatsAppWebhookModel');
const OpenWAWhatsAppService = require('../services/OpenWAWhatsAppService');

function verifyWebhookSignature(rawBody, signature, secret) {
    if (!secret) return true;
    if (!signature) return false;
    try {
        const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody || '').digest('hex');
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

/** Evita guardar QR/imágenes base64 completos en WhatsAppWebhookEvents. */
function sanitizeWebhookPayload(body) {
    if (!body || typeof body !== 'object') return body;

    function trimValue(value) {
        if (typeof value !== 'string') return value;
        if (value.length <= 500) return value;
        if (value.startsWith('data:') || /^[A-Za-z0-9+/=\r\n]{200,}/.test(value.slice(0, 300))) {
            return `[omitted ${value.length} chars]`;
        }
        return `${value.slice(0, 500)}…[+${value.length - 500}]`;
    }

    function walk(node) {
        if (node == null || typeof node !== 'object') return trimValue(node);
        if (Array.isArray(node)) return node.map(walk);
        const out = {};
        for (const [key, val] of Object.entries(node)) {
            out[key] = walk(val);
        }
        return out;
    }

    return walk(body);
}

/** OpenWA HTTP puede enviar plano { event, sessionId, data } o envuelto { type:"event", payload:{...} }. */
function normalizeWebhookBody(raw) {
    if (!raw || typeof raw !== 'object') {
        return { body: {}, eventType: 'unknown', sessionId: null, envelope: raw };
    }
    if (raw.type === 'event' && raw.payload && typeof raw.payload === 'object') {
        const p = raw.payload;
        return {
            body: p,
            envelope: raw,
            eventType: p.event || p.type || 'unknown',
            sessionId: p.sessionId || p.data?.sessionId || null
        };
    }
    const eventType = raw.event || (raw.type && raw.type !== 'event' ? raw.type : null) || 'unknown';
    return {
        body: raw,
        envelope: raw,
        eventType,
        sessionId: raw.sessionId || raw.data?.sessionId || null
    };
}

function extractMessageId(data) {
    if (!data || typeof data !== 'object') return null;
    return data.messageId || data.id || null;
}

class OpenWAWebhookController {
    /**
     * GET /api/webhooks/openwa — comprobar que la URL es alcanzable (OpenWA usa POST).
     */
    static ping(req, res) {
        res.json({
            success: true,
            message: 'Webhook OpenWA activo. OpenWA debe enviar eventos con POST.',
            method: 'POST',
            signatureHeader: 'X-OpenWA-Signature',
            signatureRequired: !!(process.env.OPENWA_WEBHOOK_SECRET || '').trim(),
            note: 'El dashboard OpenWA estándar no pide secret. Si OPENWA_WEBHOOK_SECRET está en .env pero OpenWA no firma, quita esa variable y reinicia.'
        });
    }

    /**
     * POST /api/webhooks/openwa
     * Eventos: message.sent, message.ack, session.connected, session.disconnected, session.qr, message.received
     */
    static async handle(req, res) {
        const secret = (process.env.OPENWA_WEBHOOK_SECRET || '').trim();
        const signature = req.headers['x-openwa-signature'] || req.headers['x-webhook-signature'];
        const rawBody = req.rawBody || JSON.stringify(req.body || {});

        if (secret && !verifyWebhookSignature(rawBody, signature, secret)) {
            console.warn('[OpenWA webhook] Firma inválida', {
                hasSignature: !!signature,
                bodyLength: rawBody.length
            });
            return res.status(401).json({ success: false, error: 'Invalid signature' });
        }

        const normalized = normalizeWebhookBody(req.body || {});
        const body = normalized.body;
        const eventType = normalized.eventType;
        const sessionId = normalized.sessionId;

        try {
            const tenantId = await WhatsAppWebhookModel.findTenantIdBySessionId(sessionId);
            let openwaMessageId = null;
            let queueId = null;
            let deliveryStatus = null;
            const data = body.data || {};

            if (eventType === 'message.sent') {
                openwaMessageId = extractMessageId(data);
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
                openwaMessageId = extractMessageId(data);
                deliveryStatus = mapAckName(data.ackName, data.ack);
                queueId = await WhatsAppWebhookModel.findQueueIdByMessageId(openwaMessageId);
                if (openwaMessageId) {
                    await WhatsAppWebhookModel.updateQueueDeliveryByMessageId(
                        openwaMessageId,
                        deliveryStatus,
                        new Date()
                    );
                }
            } else if (eventType === 'message.received') {
                openwaMessageId = extractMessageId(data);
            }

            await WhatsAppWebhookModel.insertEvent({
                tenantId,
                sessionId,
                eventType,
                openwaMessageId,
                queueId,
                payload: sanitizeWebhookPayload(normalized.envelope)
            });

            console.log('[OpenWA webhook] evento guardado', {
                eventType,
                sessionId: sessionId || '-',
                tenantId: tenantId || '-',
                openwaMessageId: openwaMessageId || '-',
                queueId: queueId || '-'
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
                openwaDashboardHasWebhookSecret: false,
                note: 'OpenWA solo pide URL y eventos. Deja OPENWA_WEBHOOK_SECRET vacío salvo que tu instancia envíe firma HMAC.',
                openwaConfigured: !!OpenWAWhatsAppService.getPlatformConfig()
            }
        });
    }
}

module.exports = OpenWAWebhookController;
