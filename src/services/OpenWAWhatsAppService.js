const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Cliente OpenWA — POST /api/sessions/:sessionId/messages/send-{text|image|document}
 * Config plataforma: OPENWA_BASE_URL, OPENWA_API_KEY
 *
 * Multimedia: lee el archivo local y envía base64 (OpenWA no depende de descargar APP_URL).
 * OPENWA_MEDIA_BASE_URL opcional si prefiere URL en lugar de base64.
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

/**
 * @returns {{ image?: object, document?: object, mode: 'base64'|'url' } | null}
 */
function buildMediaPayload(relativePath, explicitMime, kind) {
    if (!relativePath) return null;

    const mime = guessMime(relativePath, explicitMime);
    const abs = localUploadPath(relativePath);

    if (fs.existsSync(abs)) {
        const buf = fs.readFileSync(abs);
        const b64 = buf.toString('base64');
        const dataUri = `data:${mime};base64,${b64}`;
        if (kind === 'document') {
            return { document: { base64: dataUri }, mode: 'base64' };
        }
        return { image: { base64: dataUri }, mode: 'base64' };
    }

    const url = buildPublicUploadUrl(relativePath);
    console.warn('[OpenWA] Adjunto no encontrado en disco, usando URL', { path: abs, url });
    if (kind === 'document') {
        return { document: { url }, mode: 'url' };
    }
    return { image: { url }, mode: 'url' };
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

        if (media === 'IMAGE' && attachmentPath) {
            apiPath = `/sessions/${encodeURIComponent(sessionId)}/messages/send-image`;
            const mediaPayload = buildMediaPayload(attachmentPath, attachmentMime, 'image');
            if (!mediaPayload) throw new Error('Adjunto de imagen no disponible');
            body = { chatId, image: mediaPayload.image, caption };
        } else if (media === 'DOCUMENT' && attachmentPath) {
            apiPath = `/sessions/${encodeURIComponent(sessionId)}/messages/send-document`;
            const mediaPayload = buildMediaPayload(attachmentPath, attachmentMime, 'document');
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

        const url = joinUrl(platform.baseUrl, apiPath);
        try {
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
            const data = res.data || {};
            if (res.status >= 400 || data.success === false) {
                const detail = extractApiError(data, res.status, res.statusText);
                const msg = `HTTP ${res.status} ${url}: ${detail}`.slice(0, 4000);
                console.warn('[OpenWA] Fallo envío', {
                    url,
                    status: res.status,
                    detail: detail.slice(0, 800),
                    chatId: maskChatId(chatId),
                    media,
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
                media
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
