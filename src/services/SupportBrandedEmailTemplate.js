const {
    getEmailLogoSrc,
    getEmailLogoFilename
} = require('../utils/emailBrandAssets');

const COLORS = {
    slate900: '#0F172A',
    orange500: '#F97316',
    slate500: '#64748B',
    slate200: '#E2E8F0'
};

const FOOTER_HTML = `
<div style="padding:28px 32px 32px;border-top:1px solid ${COLORS.slate200};font-family:'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.65;color:${COLORS.slate500};">
    <p style="margin:0 0 4px;color:#334155;">Atte -</p>
    <p style="margin:0 0 4px;color:#334155;font-weight:600;">Support Team</p>
    <p style="margin:0 0 8px;color:#334155;">Condominio360 // Arsys Intela</p>
    <p style="margin:0;">
        <a href="https://www.condominio-360.com" style="color:#F97316;text-decoration:none;">www.condominio-360.com</a>
        //
        <a href="https://www.arsysintela.com" style="color:#F97316;text-decoration:none;">www.arsysintela.com</a>
    </p>
</div>`;

class SupportBrandedEmailTemplate {
    /**
     * Envuelve contenido HTML del WYSIWYG con header estilo reporte rebotes + footer fijo.
     * @param {string} bodyHtml
     * @param {{ tenantName?: string, title?: string }} [opts]
     */
    static wrap(bodyHtml, opts = {}) {
        const condoLogo = getEmailLogoSrc('condominio360Bounce');
        const intelaLogo = getEmailLogoSrc('arsysIntela');
        const tenantLine = opts.tenantName
            ? `<p style="margin:0 0 20px;font-family:'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;color:${COLORS.slate500};">Condominio: <strong style="color:#334155;">${escapeHtml(opts.tenantName)}</strong></p>`
            : '';

        return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(opts.title || 'Condominio360')}</title>
<style>
.email-body img { max-width: 100% !important; height: auto !important; display: block; }
</style>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,0.08);">
<tr>
<td style="background:${COLORS.slate900};padding:18px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="left" valign="middle" style="vertical-align:middle;">
<img src="${condoLogo}" alt="Condominio360" width="190" style="display:block;max-width:190px;height:auto;border:0;" />
</td>
<td align="right" valign="middle" style="vertical-align:middle;">
<img src="${intelaLogo}" alt="Arsys Intela" width="220" style="display:block;max-width:220px;height:auto;border:0;margin-left:auto;" />
</td>
</tr>
</table>
</td>
</tr>
<tr><td style="height:4px;line-height:4px;font-size:4px;background:${COLORS.orange500};">&nbsp;</td></tr>
<tr>
<td style="padding:32px 32px 8px;font-family:'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.7;color:#334155;">
${tenantLine}
<div class="email-body">${bodyHtml || ''}</div>
</td>
</tr>
<tr><td>${FOOTER_HTML}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
    }

    /** Nombres cid usados en el header (para adjuntos inline). */
    static headerInlineFilenames() {
        return [
            getEmailLogoFilename('condominio360Bounce'),
            getEmailLogoFilename('arsysIntela')
        ];
    }
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = SupportBrandedEmailTemplate;
