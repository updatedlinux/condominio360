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

const QUILL_ALIGN_CLASSES = {
    'ql-align-center': 'center',
    'ql-align-right': 'right',
    'ql-align-justify': 'justify',
    'ql-align-left': 'left'
};

/**
 * Quill guarda alineación con clases (.ql-align-*) que los clientes de correo ignoran.
 * Convierte esas clases a text-align inline antes del envío.
 */
function prepareQuillHtmlForEmail(html) {
    const tagRe = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
    return String(html || '').replace(tagRe, (full, tag, attrs) => {
        const classMatch = attrs.match(/\bclass=(["'])([^"']*)\1/i);
        if (!classMatch) return full;

        const quote = classMatch[1];
        const classes = classMatch[2].split(/\s+/).filter(Boolean);
        let textAlign = null;
        const keptClasses = [];

        for (const cls of classes) {
            if (QUILL_ALIGN_CLASSES[cls]) {
                textAlign = QUILL_ALIGN_CLASSES[cls];
            } else if (!cls.startsWith('ql-')) {
                keptClasses.push(cls);
            }
        }

        if (!textAlign) return full;

        let newAttrs = attrs.replace(/\bclass=(["'])[^"']*\1/i, '');
        if (keptClasses.length) {
            newAttrs += ` class=${quote}${keptClasses.join(' ')}${quote}`;
        }

        const styleMatch = newAttrs.match(/\bstyle=(["'])([^"']*)\1/i);
        let style = styleMatch ? styleMatch[2].trim() : '';
        style = style.replace(/text-align\s*:\s*[^;]+;?/gi, '').trim();
        const alignRule = `text-align:${textAlign};`;
        style = style ? `${alignRule}${style.endsWith(';') ? '' : ';'}${style}` : alignRule;

        if (styleMatch) {
            newAttrs = newAttrs.replace(/\bstyle=(["'])[^"']*\1/i, `style=${quote}${style}${quote}`);
        } else {
            newAttrs += ` style=${quote}${style}${quote}`;
        }

        newAttrs = newAttrs.replace(/\s{2,}/g, ' ').trim();
        return `<${tag}${newAttrs ? ` ${newAttrs}` : ''}>`;
    });
}

function prepareRichHtmlForEmail(html) {
    return prepareQuillHtmlForEmail(sanitizeRichHtml(html));
}

module.exports = {
    prepareEmbeddedImagesForMailgun,
    sanitizeRichHtml,
    prepareQuillHtmlForEmail,
    prepareRichHtmlForEmail
};
