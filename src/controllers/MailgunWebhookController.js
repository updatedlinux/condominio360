const crypto = require('crypto');
const EmailJobModel = require('../models/EmailJobModel');

/**
 * Mailgun envía la firma en el cuerpo de dos formas:
 * - JSON: { signature: { timestamp, token, signature }, "event-data": { ... } }
 * - Form legacy: timestamp, token, signature en el nivel raíz (application/x-www-form-urlencoded)
 */
function extractWebhookSignatureFields(body) {
    if (!body || typeof body !== 'object') return null;
    const nested = body.signature;
    if (nested && typeof nested === 'object' && nested.timestamp != null && nested.token != null) {
        return {
            timestamp: String(nested.timestamp),
            token: String(nested.token),
            signatureHex: String(nested.signature || '').trim().toLowerCase()
        };
    }
    if (body.timestamp != null && body.token != null && body.signature != null && typeof body.signature === 'string') {
        return {
            timestamp: String(body.timestamp),
            token: String(body.token),
            signatureHex: String(body.signature).trim().toLowerCase()
        };
    }
    return null;
}

function verifySignatureHex(timestamp, token, signatureHex, signingKey) {
    if (!signingKey || !timestamp || !token || !signatureHex) return false;
    const encoded = crypto.createHmac('sha256', signingKey).update(String(timestamp).concat(String(token))).digest('hex').toLowerCase();
    const sig = signatureHex.toLowerCase().replace(/\s/g, '');
    try {
        const a = Buffer.from(encoded, 'hex');
        const b = Buffer.from(sig, 'hex');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return encoded === sig;
    }
}

function parseEventData(body) {
    const raw = body['event-data'] ?? body.eventData ?? body.event_data;
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function extractMessageId(eventData) {
    const h = eventData?.message?.headers || eventData?.['message']?.headers;
    const mid = h?.['message-id'] || h?.['Message-Id'] || eventData?.['message-id'];
    if (!mid) return null;
    return String(mid).replace(/[<>]/g, '').trim();
}

/**
 * POST webhook Mailgun (JSON o application/x-www-form-urlencoded).
 * Verificación con MAILGUN_WEBHOOK_SIGNING_KEY (Sending → dominio → Webhooks en Mailgun).
 */
class MailgunWebhookController {
    static async handle(req, res) {
        try {
            const signingKey = (process.env.MAILGUN_WEBHOOK_SIGNING_KEY || '').trim();
            const sigFields = extractWebhookSignatureFields(req.body || {});

            if (signingKey) {
                if (!sigFields) {
                    return res.status(401).send('Invalid signature');
                }
                if (!verifySignatureHex(sigFields.timestamp, sigFields.token, sigFields.signatureHex, signingKey)) {
                    return res.status(401).send('Invalid signature');
                }
            } else if (process.env.NODE_ENV === 'production') {
                console.warn('[MailgunWebhook] MAILGUN_WEBHOOK_SIGNING_KEY no configurada; rechazando en producción');
                return res.status(503).send('Webhook signing not configured');
            }

            const eventData = parseEventData(req.body);
            if (!eventData) {
                return res.status(400).send('Missing event-data');
            }

            const eventType = (eventData.event || 'unknown').toLowerCase().replace(/[^a-z0-9_]/g, '_');
            const messageId = extractMessageId(eventData);

            if (!messageId) {
                return res.status(200).send('OK');
            }

            const recipient = await EmailJobModel.findRecipientByProviderMessageId(messageId);
            if (recipient) {
                await EmailJobModel.insertLog({
                    recipient_id: recipient.id,
                    job_id: recipient.job_id,
                    tenant_id: recipient.tenant_id,
                    event_type: `webhook_${eventType}`,
                    provider_response: eventData
                });
            }

            return res.status(200).send('OK');
        } catch (err) {
            console.error('[MailgunWebhook]', err);
            return res.status(500).send('Error');
        }
    }
}

module.exports = MailgunWebhookController;
