const crypto = require('crypto');
const EmailJobModel = require('../models/EmailJobModel');

function verifySignature(timestamp, token, signature, signingKey) {
    if (!signingKey || !timestamp || !token || !signature) return false;
    const encoded = crypto.createHmac('sha256', signingKey).update(String(timestamp) + String(token)).digest('hex');
    return encoded === signature;
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
 * POST webhook Mailgun (application/x-www-form-urlencoded).
 * Verificación con MAILGUN_WEBHOOK_SIGNING_KEY (panel del dominio en Mailgun).
 */
class MailgunWebhookController {
    static async handle(req, res) {
        try {
            const signingKey = (process.env.MAILGUN_WEBHOOK_SIGNING_KEY || '').trim();
            const { signature, timestamp, token } = req.body || {};

            if (signingKey) {
                if (!verifySignature(timestamp, token, signature, signingKey)) {
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
