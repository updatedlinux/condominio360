const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/**
 * Cliente OpenWA — POST /api/sessions/:sessionId/messages/send-{text|image|document}
 * Config plataforma: OPENWA_BASE_URL, OPENWA_API_KEY
 *
 * Flujo típico (servidores separados): Condominio360 → POST a OpenWA con imagen comprimida en base64.
 * OPENWA_MEDIA_BASE_URL solo si OpenWA puede descargar archivos desde Condominio360 (dirección inversa).
 */

const MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf'
};

const CAPTION_MAX = 1024;

function joinUrl(baseUrl, pathPart) {
    const b = (baseUrl || '').trim().replace(/\/+$/, '');
    const p = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
    return `${b}${p}`;
}

function maskChatId(chatId) {
    const s = String(chatId || '').replace(/@c\.us$/, '');
    if (s.length <= 4) return '****@c.us';
    return `***${s.slice(-4)}@c.us`;
}

function buildPublicUploadUrl(relativePath) {
    const base = (
        process.env.OPENWA_MEDIA_BASE_URL ||
        process.env.APP_URL ||
        'http://localhost:3000'
    ).replace(/\/+$/, '');
    const rel = String(relativePath || '').replace(/^\/+/, '');
    return `${base}/uploads/${rel}`;
}

function localUploadPath(relativePath) {
    const rel = String(relativePath || '').replace(/^\/+/, '').replace(/^uploads\//, '');
    return path.join(process.cwd(), 'uploads', rel);
}

function guessMime(relativePath, explicitMime) {
    if (explicitMime) return explicitMime;
    const ext = path.extname(relativePath || '').toLowerCase();
    return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function truncateCaption(text) {
    const t = (text || '').trim();
    if (!t) return undefined;
    return t.length > CAPTION_MAX ? t.slice(0, CAPTION_MAX) : t;
}

function extractApiError(data, resStatus, resStatusText) {
    if (!data || typeof data !== 'object') {
        return resStatusText || `HTTP ${resStatus}`;
    }
    const err = data.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
        const code = err.code ? `[${err.code}] ` : '';
        return `${code}${err.message || JSON.stringify(err)}`;
    }
    if (data.message) return String(data.message);
    return JSON.stringify(data).slice(0, 500);
}

function parseMaxBase64Bytes() {
    const raw = (process.env.OPENWA_MEDIA_BASE64_MAX_BYTES || '350000').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 350000;
}

function hasMediaBaseUrl() {
    return !!(process.env.OPENWA_MEDIA_BASE_URL || '').trim();
}

/** URL solo si el admin configuró una base alcanzable desde el servidor OpenWA. */
function preferUrlForMedia() {
    if ((process.env.OPENWA_MEDIA_URL_FIRST || '').trim().toLowerCase() === 'true') return true;
    return hasMediaBaseUrl();
}

function isImageAttachment(relativePath, explicitMime) {
    const mime = guessMime(relativePath, explicitMime);
    return mime.startsWith('image/');
}

async function buildCompressedImageBase64(relativePath, opts = {}) {
    const abs = localUploadPath(relativePath);
    const maxBytes = opts.maxBytes || parseMaxBase64Bytes();
    const originalSize = fs.statSync(abs).size;
    let quality = opts.startQuality || 82;
    let maxDim = opts.startMaxDim || 1280;
    let buf = null;

    for (let attempt = 0; attempt < 10; attempt++) {
        buf = await sharp(abs)
            .rotate()
            .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality, mozjpeg: true })
            .toBuffer();
        if (buf.length <= maxBytes) break;
        quality = Math.max(30, quality - 12);
        maxDim = Math.max(400, Math.floor(maxDim * 0.75));
    }

    if (!buf || buf.length > maxBytes) {
        throw new Error(
            `Imagen demasiado grande para WhatsApp (${originalSize} bytes). ` +
            'Use una imagen más pequeña o configure OPENWA_MEDIA_BASE_URL si OpenWA puede descargar desde Condominio360.'
        );
    }

    const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`;
    console.log('[OpenWA] Imagen comprimida (base64)', {
        originalSize,
        compressedSize: buf.length,
        quality,
        maxDim
    });
    return { image: { base64: dataUri }, mode: 'base64' };
}

function buildUrlMediaPayload(relativePath, kind) {
    const url = buildPublicUploadUrl(relativePath);
    if (kind === 'document') return { document: { url }, mode: 'url', downloadUrl: url };
    return { image: { url }, mode: 'url', downloadUrl: url };
}

function buildBase64MediaPayload(relativePath, explicitMime, kind) {
    const mime = guessMime(relativePath, explicitMime);
    const abs = localUploadPath(relativePath);
    const buf = fs.readFileSync(abs);
    const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
    if (kind === 'document') return { document: { base64: dataUri }, mode: 'base64' };
    return { image: { base64: dataUri }, mode: 'base64' };
}

/**
 * @param {'url'|'base64'|undefined} forceMode
 */
async function buildMediaPayload(relativePath, explicitMime, kind, forceMode) {
    if (!relativePath) return null;

    const abs = localUploadPath(relativePath);
    if (!fs.existsSync(abs)) {
        if (!hasMediaBaseUrl()) {
            throw new Error(`Adjunto no encontrado: ${abs}`);
        }
        const payload = buildUrlMediaPayload(relativePath, kind);
        console.warn('[OpenWA] Adjunto no encontrado en disco, usando URL', { path: abs, url: payload.downloadUrl });
        return payload;
    }

    const size = fs.statSync(abs).size;
    const useUrl = forceMode === 'url' || (forceMode !== 'base64' && preferUrlForMedia());

    if (useUrl) {
        const payload = buildUrlMediaPayload(relativePath, kind);
        console.log('[OpenWA] Multimedia vía URL (OpenWA descarga)', { size, url: payload.downloadUrl, kind });
        return payload;
    }

    if (kind === 'image' && isImageAttachment(relativePath, explicitMime)) {
        return buildCompressedImageBase64(relativePath, forceMode === 'base64-tiny'
            ? { maxBytes: Math.floor(parseMaxBase64Bytes() * 0.5), startQuality: 60, startMaxDim: 800 }
            : undefined);
    }

    const raw = buildBase64MediaPayload(relativePath, explicitMime, kind);
    const absCheck = localUploadPath(relativePath);
    const rawSize = fs.statSync(absCheck).size;
    if (rawSize > parseMaxBase64Bytes()) {
        throw new Error(
            `Adjunto demasiado grande para envío directo (${rawSize} bytes). ` +
            'Configure OPENWA_MEDIA_BASE_URL solo si OpenWA puede descargar desde Condominio360.'
        );
    }
    return raw;
}

async function postOpenWA(platform, apiPath, body) {
    const url = joinUrl(platform.baseUrl, apiPath);
    const res = await axios.post(url, body, {
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-API-Key': platform.apiKey
        },
        timeout: 90000,
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });
    return { url, res, data: res.data || {} };
}

function isPayloadTooLarge(status, detail) {
    if (status === 413) return true;
    const d = String(detail || '').toLowerCase();
    return d.includes('entity too large') || d.includes('payload too large');
}

class OpenWAWhatsAppService {
    static getPlatformConfig() {
        const baseUrl = (process.env.OPENWA_BASE_URL || '').trim().replace(/\/+$/, '');
        const apiKey = (process.env.OPENWA_API_KEY || '').trim();
        if (!baseUrl || !apiKey) return null;
        return { baseUrl, apiKey };
    }

    static getWebhookUrl() {
        const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
        return `${base}/api/webhooks/openwa`;
    }

    /**
     * @param {{ sessionId: string, chatId: string, text: string, mediaType?: 'TEXT'|'IMAGE'|'DOCUMENT', attachmentPath?: string|null, attachmentMime?: string|null, attachmentOriginalName?: string|null, logMeta?: Record<string, unknown> }} opts
     */
    static async sendMessage(opts) {
        const platform = OpenWAWhatsAppService.getPlatformConfig();
        if (!platform) throw new Error('OpenWA no configurado (OPENWA_BASE_URL / OPENWA_API_KEY)');

        const {
            sessionId,
            chatId,
            text,
            mediaType = 'TEXT',
            attachmentPath,
            attachmentMime,
            attachmentOriginalName,
            logMeta
        } = opts;
        if (!sessionId || !chatId) throw new Error('Sesión o chatId incompletos');

        const media = (mediaType || 'TEXT').toUpperCase();
        const caption = truncateCaption(text);
        let apiPath;
        let body;
        let mediaPayload = null;

        if (media === 'IMAGE' && attachmentPath) {
            apiPath = `/sessions/${encodeURIComponent(sessionId)}/messages/send-image`;
            mediaPayload = await buildMediaPayload(attachmentPath, attachmentMime, 'image');
            if (!mediaPayload) throw new Error('Adjunto de imagen no disponible');
            body = { chatId, image: mediaPayload.image, caption };
        } else if (media === 'DOCUMENT' && attachmentPath) {
            apiPath = `/sessions/${encodeURIComponent(sessionId)}/messages/send-document`;
            mediaPayload = await buildMediaPayload(attachmentPath, attachmentMime, 'document');
            if (!mediaPayload) throw new Error('Adjunto de documento no disponible');
            const filename = attachmentOriginalName || path.basename(attachmentPath) || 'documento.pdf';
            body = {
                chatId,
                document: mediaPayload.document,
                filename,
                caption
            };
        } else {
            apiPath = `/sessions/${encodeURIComponent(sessionId)}/messages/send-text`;
            body = { chatId, text: text || ' ' };
        }

        try {
            let { url, res, data } = await postOpenWA(platform, apiPath, body);

            if (
                res.status >= 400
                && mediaPayload
                && isPayloadTooLarge(res.status, extractApiError(data, res.status, res.statusText))
            ) {
                let retried = false;
                if (hasMediaBaseUrl() && mediaPayload.mode !== 'url') {
                    console.warn('[OpenWA] Base64 rechazado (413), reintento con URL', {
                        attachmentPath,
                        ...(logMeta || {})
                    });
                    mediaPayload = await buildMediaPayload(
                        attachmentPath,
                        attachmentMime,
                        media === 'DOCUMENT' ? 'document' : 'image',
                        'url'
                    );
                    retried = true;
                } else if (media === 'IMAGE' && mediaPayload.mode === 'base64') {
                    console.warn('[OpenWA] Base64 rechazado (413), reintento con más compresión', {
                        attachmentPath,
                        ...(logMeta || {})
                    });
                    mediaPayload = await buildMediaPayload(attachmentPath, attachmentMime, 'image', 'base64-tiny');
                    retried = true;
                }
                if (retried && mediaPayload) {
                    if (media === 'IMAGE') {
                        body = { chatId, image: mediaPayload.image, caption };
                    } else if (media === 'DOCUMENT') {
                        body = {
                            chatId,
                            document: mediaPayload.document,
                            filename: attachmentOriginalName || path.basename(attachmentPath) || 'documento.pdf',
                            caption
                        };
                    }
                    ({ url, res, data } = await postOpenWA(platform, apiPath, body));
                }
            }

            if (res.status >= 400 || data.success === false) {
                const detail = extractApiError(data, res.status, res.statusText);
                const msg = `HTTP ${res.status} ${url}: ${detail}`.slice(0, 4000);
                console.warn('[OpenWA] Fallo envío', {
                    url,
                    status: res.status,
                    detail: detail.slice(0, 800),
                    chatId: maskChatId(chatId),
                    media,
                    mediaMode: mediaPayload?.mode || null,
                    mediaUrl: mediaPayload?.downloadUrl || null,
                    attachmentPath: attachmentPath || null,
                    ...(logMeta || {})
                });
                throw new Error(msg);
            }
            const payload = data.data || data;
            const messageId = payload.messageId || payload.id || null;
            console.log('[OpenWA] Envío OK', {
                ...(logMeta || {}),
                messageId,
                chatId: maskChatId(chatId),
                media,
                mediaMode: mediaPayload?.mode || null
            });
            return { messageId, raw: data };
        } catch (e) {
            if (e.response?.data) {
                const detail = extractApiError(e.response.data, e.response.status, e.message);
                throw new Error(detail.slice(0, 4000));
            }
            if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
                throw new Error(`No se pudo conectar con OpenWA (${e.code}). Revise OPENWA_BASE_URL y red.`);
            }
            throw e;
        }
    }
}

OpenWAWhatsAppService.buildPublicUploadUrl = buildPublicUploadUrl;
OpenWAWhatsAppService.localUploadPath = localUploadPath;

module.exports = OpenWAWhatsAppService;
