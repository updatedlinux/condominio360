const EmailService = require('./EmailService');
const SupportBrandedEmailTemplate = require('./SupportBrandedEmailTemplate');
const TenantAdminModel = require('../models/TenantAdminModel');
const TenantJuntaEmailContactModel = require('../models/TenantJuntaEmailContactModel');
const TenantModel = require('../models/TenantModel');
const { buildInlineLogoAttachmentsForHtml } = require('../utils/emailBrandAssets');
const { prepareEmbeddedImagesForMailgun, sanitizeRichHtml } = require('../utils/emailEmbeddedImages');

class SupportJuntaEmailService {
    static buildPreviewHtml(bodyHtml, tenantName) {
        const safe = sanitizeRichHtml(bodyHtml);
        const embedded = prepareEmbeddedImagesForMailgun(safe);
        return SupportBrandedEmailTemplate.wrap(embedded.html, { tenantName });
    }

    static async buildSendPayload(bodyHtml, tenantName) {
        const safe = sanitizeRichHtml(bodyHtml);
        const embedded = prepareEmbeddedImagesForMailgun(safe);
        const html = SupportBrandedEmailTemplate.wrap(embedded.html, { tenantName });
        const logoInline = await buildInlineLogoAttachmentsForHtml(html);
        const inline = [...logoInline, ...embedded.inline];
        return { html, inline };
    }

    static normalizeExtraEmails(emails) {
        if (!Array.isArray(emails)) return [];
        const seen = new Set();
        const out = [];
        for (const raw of emails) {
            const email = TenantJuntaEmailContactModel.normalizeEmail(
                typeof raw === 'string' ? raw : raw?.email
            );
            if (!email || seen.has(email)) continue;
            if (!TenantJuntaEmailContactModel.isValidEmail(email)) continue;
            seen.add(email);
            out.push({
                email,
                display_name: typeof raw === 'object' && raw?.display_name
                    ? String(raw.display_name).trim() || null
                    : null
            });
        }
        return out;
    }

    /**
     * @param {{ tenantId: string, adminIds?: string[]|null, contactIds?: string[]|null, extraEmails?: Array<string|{email:string,display_name?:string}>|null }}
     */
    static async resolveRecipients(opts) {
        const recipients = [];
        const seen = new Set();

        const push = (entry) => {
            const email = TenantJuntaEmailContactModel.normalizeEmail(entry.email);
            if (!email || seen.has(email)) return;
            if (!TenantJuntaEmailContactModel.isValidEmail(email)) return;
            seen.add(email);
            recipients.push(entry);
        };

        let admins = (await TenantAdminModel.getByTenant(opts.tenantId))
            .filter((a) => a.is_active !== false && a.is_active !== 0 && a.email);

        if (Array.isArray(opts.adminIds)) {
            const wanted = new Set(opts.adminIds.map(String));
            admins = admins.filter((a) => wanted.has(String(a.id)));
        }

        for (const admin of admins) {
            push({
                email: admin.email,
                name: [admin.first_name, admin.last_name].filter(Boolean).join(' '),
                recipient_type: 'tenant_admin',
                recipient_id: admin.id
            });
        }

        if (Array.isArray(opts.contactIds) && opts.contactIds.length) {
            const contacts = await TenantJuntaEmailContactModel.findByIds(opts.tenantId, opts.contactIds);
            for (const c of contacts) {
                push({
                    email: c.email,
                    name: c.display_name || c.email,
                    recipient_type: 'frequent_contact',
                    recipient_id: c.id
                });
            }
        }

        const extras = SupportJuntaEmailService.normalizeExtraEmails(opts.extraEmails || []);
        for (const ex of extras) {
            push({
                email: ex.email,
                name: ex.display_name || ex.email,
                recipient_type: 'extra',
                recipient_id: null
            });
        }

        return recipients;
    }

    /**
     * @param {{ tenantId: string, subject: string, htmlBody: string, adminIds?: string[]|null, contactIds?: string[]|null, extraEmails?: Array<string|{email:string,display_name?:string}>|null, saveExtraAsFrequent?: boolean, createdBy?: string|null }}
     */
    static async sendToRecipients(opts) {
        const tenant = await TenantModel.findById(opts.tenantId);
        if (!tenant) {
            const err = new Error('Condominio no encontrado');
            err.code = 'NOT_FOUND';
            throw err;
        }

        const subject = String(opts.subject || '').trim();
        if (!subject) {
            const err = new Error('El asunto es obligatorio');
            err.code = 'VALIDATION';
            throw err;
        }

        const bodyRaw = String(opts.htmlBody || '').trim();
        if (!bodyRaw || bodyRaw === '<p><br></p>') {
            const err = new Error('El cuerpo del correo no puede estar vacío');
            err.code = 'VALIDATION';
            throw err;
        }

        const recipients = await SupportJuntaEmailService.resolveRecipients({
            tenantId: opts.tenantId,
            adminIds: opts.adminIds,
            contactIds: opts.contactIds,
            extraEmails: opts.extraEmails
        });

        if (!recipients.length) {
            const err = new Error('Selecciona al menos un destinatario con correo válido');
            err.code = 'NO_RECIPIENTS';
            throw err;
        }

        if (opts.saveExtraAsFrequent) {
            const extras = SupportJuntaEmailService.normalizeExtraEmails(opts.extraEmails || []);
            for (const ex of extras) {
                try {
                    await TenantJuntaEmailContactModel.upsert(
                        opts.tenantId,
                        { email: ex.email, display_name: ex.display_name },
                        opts.createdBy || null
                    );
                } catch (e) {
                    console.warn('[SupportJuntaEmailService] upsert contact', ex.email, e.message);
                }
            }
        }

        const { html, inline } = await SupportJuntaEmailService.buildSendPayload(bodyRaw, tenant.name);

        const results = [];
        for (const rec of recipients) {
            try {
                const r = await EmailService.sendTransactionalWithInline(
                    rec.email,
                    subject,
                    html,
                    null,
                    inline,
                    {
                        tenantId: opts.tenantId,
                        messageType: 'superadmin_junta_support',
                        createdBy: opts.createdBy || null,
                        metadata: {
                            tenant_id: opts.tenantId,
                            recipient_type: rec.recipient_type,
                            recipient_id: rec.recipient_id
                        }
                    }
                );
                results.push({
                    ...rec,
                    ok: true,
                    messageId: r.messageId
                });
            } catch (e) {
                results.push({
                    ...rec,
                    ok: false,
                    error: e.message || String(e)
                });
            }
        }

        const sent = results.filter((r) => r.ok).length;
        const failed = results.length - sent;
        return { tenant, results, sent, failed, total: results.length };
    }
}

module.exports = SupportJuntaEmailService;
