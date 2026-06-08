const FormData = require('form-data');
const Mailgun = require('mailgun.js');

/**
 * Cliente Mailgun API (sin SMTP).
 * Todo el tráfico usa un solo dominio verificado en Mailgun (MAILGUN_DEFAULT_DOMAIN, por defecto el dominio base).
 * Remitente: MAILGUN_FROM_LOCAL @ MAILGUN_FROM_DOMAIN (por defecto noreply@condominio-360.com).
 */
class MailgunMailProvider {
    constructor() {
        this.baseDomain = (process.env.MAILGUN_BASE_DOMAIN || 'condominio-360.com').replace(/^\.+|\.+$/g, '');
        this.sendingDomain = (process.env.MAILGUN_DEFAULT_DOMAIN || this.baseDomain).trim();
        /** @deprecated usar sendingDomain; se mantiene para scripts (send-test-email) */
        this.defaultDomain = this.sendingDomain;
        this.fromDomain = (process.env.MAILGUN_FROM_DOMAIN || this.baseDomain).trim();
        this.apiKey = (process.env.MAILGUN_API_KEY || '').trim();
        this.region = (process.env.MAILGUN_REGION || 'us').toLowerCase();
        this.replyTo = (process.env.MAILGUN_REPLY_TO || '').trim() || null;
        this.fromLocalPart = (process.env.MAILGUN_FROM_LOCAL || 'noreply').trim();

        this._client = null;
        if (this.apiKey) {
            const mailgun = new Mailgun(FormData);
            const opts = { username: 'api', key: this.apiKey };
            if (this.region === 'eu') {
                opts.url = 'https://api.eu.mailgun.net';
            }
            this._client = mailgun.client(opts);
        }
    }

    isConfigured() {
        return !!this._client && !!this.apiKey;
    }

    /** Dominio pasado a Mailgun `messages.create` (debe estar verificado en la cuenta). */
    getSendingDomain() {
        return this.sendingDomain;
    }

    buildFromHeader() {
        return `"Condominio360" <${this.fromLocalPart}@${this.fromDomain}>`;
    }

    /**
     * @returns {Promise<{ id: string, message: string }>}
     */
    async send({ domain, to, subject, html, text, fromOverride = null, inline = null }) {
        if (!this.isConfigured()) {
            throw new Error('Mailgun API no configurada (MAILGUN_API_KEY)');
        }
        const apiDomain = domain || this.sendingDomain;
        const from = fromOverride || this.buildFromHeader();
        const data = {
            from,
            to: Array.isArray(to) ? to : [to],
            subject,
            html,
            ...(text ? { text } : {})
        };
        if (inline && inline.length) {
            data.inline = inline;
        }
        if (this.replyTo) {
            data['h:Reply-To'] = this.replyTo;
        }
        const result = await this._client.messages.create(apiDomain, data);
        const id = result?.id || result?.message || '';
        return { id: typeof id === 'string' ? id.replace(/[<>]/g, '') : String(id), raw: result };
    }
}

module.exports = new MailgunMailProvider();
