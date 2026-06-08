/**
 * Convierte imágenes data-URL del WYSIWYG en adjuntos inline cid: para Mailgun.
 */
function prepareEmbeddedImagesForMailgun(html) {
    const inline = [];
    let idx = 0;
    const out = String(html || '').replace(
        /src=(["'])data:image\/([a-zA-Z0-9+.-]+);base64,([^"']+)\1/gi,
        (match, quote, mimeRaw, b64) => {
            const mime = mimeRaw.toLowerCase();
            const ext = mime === 'jpeg' ? 'jpg' : mime === 'svg+xml' ? 'svg' : mime.replace(/[^a-z0-9]/g, '') || 'png';
            const filename = `wysiwyg-${idx}.${ext}`;
            idx += 1;
            try {
                inline.push({
                    filename,
                    data: Buffer.from(b64, 'base64'),
                    contentType: `image/${mime}`
                });
                return `src=${quote}cid:${filename}${quote}`;
            } catch {
                return match;
            }
        }
    );
    return { html: out, inline };
}

function sanitizeRichHtml(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

module.exports = {
    prepareEmbeddedImagesForMailgun,
    sanitizeRichHtml
};
