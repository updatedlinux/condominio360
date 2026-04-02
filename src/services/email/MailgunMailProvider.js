const FormData = require('form-data');
const Mailgun = require('mailgun.js');

/**
 * Cliente Mailgun API (sin SMTP). Un dominio verificado por tenant (subdominio bajo MAILGUN_BASE_DOMAIN).
 */
class MailgunMailProvider {
    constructor() {
        this.baseDomain = (process.env.MAILGUN_BASE_DOMAIN || 'condominio-360.com').replace(/^\.+|\.+$/g, '');
        this.defaultDomain = (process.env.MAILGUN_DEFAULT_DOMAIN || `mg.${this.baseDomain}`).trim();
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

    /**
     * Dominio Mailgun para envío: mailgun_domain del tenant, o {slug}.baseDomain, o default.
     */
    resolveSendingDomain(tenant) {
        if (tenant && tenant.mailgun_domain) {
            return String(tenant.mailgun_domain).trim().toLowerCase();
        }
        if (tenant && tenant.slug) {
            const slug = String(tenant.slug).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
            return `${slug}.${this.baseDomain}`;
        }
        return this.defaultDomain;
    }

    buildFromHeader(mailgunDomain) {
        const local = this.fromLocalPart;
        return `"Condominio360" <${local}@${mailgunDomain}>`;
    }

    /**
     * @returns {Promise<{ id: string, message: string }>}
     */
    async send({ domain, to, subject, html, text, fromOverride = null }) {
        if (!this.isConfigured()) {
            throw new Error('Mailgun API no configurada (MAILGUN_API_KEY)');
        }
        const from = fromOverride || this.buildFromHeader(domain);
        const data = {
            from,
            to: Array.isArray(to) ? to : [to],
            subject,
            html,
            ...(text ? { text } : {})
        };
        if (this.replyTo) {
            data['h:Reply-To'] = this.replyTo;
        }
        const result = await this._client.messages.create(domain, data);
        const id = result?.id || result?.message || '';
        return { id: typeof id === 'string' ? id.replace(/[<>]/g, '') : String(id), raw: result };
    }
}

module.exports = new MailgunMailProvider();
