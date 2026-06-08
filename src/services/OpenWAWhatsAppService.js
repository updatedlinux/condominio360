const axios = require('axios');

/**
 * Cliente OpenWA — POST /api/sessions/:sessionId/messages/send-{text|image|document}
 * Config plataforma: OPENWA_BASE_URL, OPENWA_API_KEY
 */

function joinUrl(baseUrl, path) {
    const b = (baseUrl || '').trim().replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${b}${p}`;
}

function maskChatId(chatId) {
    const s = String(chatId || '').replace(/@c\.us$/, '');
    if (s.length <= 4) return '****@c.us';
    return `***${s.slice(-4)}@c.us`;
}

function buildPublicUploadUrl(relativePath) {
    const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const rel = String(relativePath || '').replace(/^\/+/, '');
    return `${base}/uploads/${rel}`;
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
     * @param {{ sessionId: string, chatId: string, text: string, mediaType?: 'TEXT'|'IMAGE'|'DOCUMENT', attachmentPath?: string|null, attachmentOriginalName?: string|null, logMeta?: Record<string, unknown> }} opts
     */
    static async sendMessage(opts) {
        const platform = OpenWAWhatsAppService.getPlatformConfig();
        if (!platform) throw new Error('OpenWA no configurado (OPENWA_BASE_URL / OPENWA_API_KEY)');

        const { sessionId, chatId, text, mediaType = 'TEXT', attachmentPath, attachmentOriginalName, logMeta } = opts;
        if (!sessionId || !chatId) throw new Error('Sesión o chatId incompletos');

        const media = (mediaType || 'TEXT').toUpperCase();
        let path;
        let body;

        if (media === 'IMAGE' && attachmentPath) {
            path = `/sessions/${encodeURIComponent(sessionId)}/messages/send-image`;
            body = {
                chatId,
                image: { url: buildPublicUploadUrl(attachmentPath) },
                caption: text || undefined
            };
        } else if (media === 'DOCUMENT' && attachmentPath) {
            path = `/sessions/${encodeURIComponent(sessionId)}/messages/send-document`;
            const filename = attachmentOriginalName || attachmentPath.split('/').pop() || 'documento.pdf';
            body = {
                chatId,
                document: { url: buildPublicUploadUrl(attachmentPath) },
                filename,
                caption: text || undefined
            };
        } else {
            path = `/sessions/${encodeURIComponent(sessionId)}/messages/send-text`;
            body = { chatId, text: text || ' ' };
        }

        const url = joinUrl(platform.baseUrl, path);
        try {
            const res = await axios.post(url, body, {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-API-Key': platform.apiKey
                },
                timeout: 45000,
                validateStatus: () => true
            });
            const data = res.data || {};
            if (res.status >= 400 || data.success === false) {
                const errObj = data.error;
                const detail = typeof errObj === 'object'
                    ? (errObj.message || errObj.code || JSON.stringify(errObj))
                    : (errObj || data.message || res.statusText || `HTTP ${res.status}`);
                const msg = `HTTP ${res.status} ${url}: ${detail}`.slice(0, 4000);
                console.warn('[OpenWA] Fallo envío', { url, status: res.status, detail: String(detail).slice(0, 500) });
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
                const d = e.response.data;
                const msg = d.error?.message || d.message || e.message;
                throw new Error(String(msg).slice(0, 4000));
            }
            if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
                throw new Error(`No se pudo conectar con OpenWA (${e.code}). Revise OPENWA_BASE_URL y red.`);
            }
            throw e;
        }
    }
}

OpenWAWhatsAppService.buildPublicUploadUrl = buildPublicUploadUrl;

module.exports = OpenWAWhatsAppService;
