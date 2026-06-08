const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/**
 * Cliente OpenWA — send-{text|image|document} (DTO real: campos planos chatId/url/base64/mimetype).
 * La doc 06 muestra image:{url} pero el API espera { chatId, url, caption } o { chatId, base64, mimetype }.
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
const DEFAULT_MAX_URL_BYTES = 1500000;
const DEFAULT_MAX_BASE64_BYTES = 350000;

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

function parseMaxUrlBytes() {
    const n = parseInt(process.env.OPENWA_MEDIA_MAX_URL_BYTES || String(DEFAULT_MAX_URL_BYTES), 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_URL_BYTES;
}

function parseMaxBase64Bytes() {
    const n = parseInt(process.env.OPENWA_MEDIA_BASE64_MAX_BYTES || String(DEFAULT_MAX_BASE64_BYTES), 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BASE64_BYTES;
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

function isRetryableMediaError(status, detail) {
    if (status === 413) return true;
    if (status !== 400) return false;
    const d = String(detail || '').toLowerCase();
    return (
        d.includes('download') ||
        d.includes('media') ||
        d.includes('validation') ||
        d.includes('bad request')
    );
}

async function ensureWhatsappOptimizedImage(relativePath) {
    const abs = localUploadPath(relativePath);
    const cacheRel = relativePath.replace(/\.[^./\\]+$/, '') + '-openwa.jpg';
    const cacheAbs = localUploadPath(cacheRel);

    const srcStat = fs.statSync(abs);
    if (fs.existsSync(cacheAbs)) {
        const cacheStat = fs.statSync(cacheAbs);
        if (cacheStat.mtimeMs >= srcStat.mtimeMs && cacheStat.size <= parseMaxUrlBytes()) {
            return cacheRel;
        }
    }

    const dir = path.dirname(cacheAbs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await sharp(abs)
        .rotate()
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(cacheAbs);

    return cacheRel;
}

async function resolveImageRelativePath(relativePath, explicitMime) {
    const abs = localUploadPath(relativePath);
    if (!fs.existsSync(abs)) {
        throw new Error(`Adjunto no encontrado en disco: ${abs}`);
    }
    const size = fs.statSync(abs).size;
    const mime = guessMime(relativePath, explicitMime);
    const needsOptimize =
        size > parseMaxUrlBytes() || mime === 'image/png' || path.extname(relativePath).toLowerCase() === '.png';
    if (!needsOptimize) return relativePath;
    const optimized = await ensureWhatsappOptimizedImage(relativePath);
    console.log('[OpenWA] Imagen optimizada para WhatsApp', {
        original: relativePath,
        originalSize: size,
        optimized,
        optimizedSize: fs.statSync(localUploadPath(optimized)).size
    });
    return optimized;
}

function readFileAsBase64(relativePath) {
    const abs = localUploadPath(relativePath);
    return fs.readFileSync(abs).toString('base64');
}

function buildImageSendAttempts(servePath, mime) {
    const abs = localUploadPath(servePath);
    const size = fs.statSync(abs).size;
    const url = buildPublicUploadUrl(servePath);
    const filename = path.basename(servePath);
    const attempts = [];

    if (size <= parseMaxBase64Bytes()) {
        attempts.push({
            mode: 'base64',
            buildBody: (chatId, caption) => {
                const body = {
                    chatId,
                    base64: readFileAsBase64(servePath),
                    mimetype: mime,
                    filename
                };
                if (caption) body.caption = caption;
                return body;
            }
        });
    }

    attempts.push({
        mode: 'url',
        buildBody: (chatId, caption) => {
            const body = { chatId, url };
            if (caption) body.caption = caption;
            return body;
        }
    });

    return { attempts, url, servePath, size };
}

function buildDocumentSendAttempts(relativePath, mime, filename) {
    const abs = localUploadPath(relativePath);
    const size = fs.statSync(abs).size;
    const url = buildPublicUploadUrl(relativePath);
    const attempts = [];

    if (size <= parseMaxBase64Bytes()) {
        attempts.push({
            mode: 'base64',
            buildBody: (chatId, caption) => {
                const body = {
                    chatId,
                    base64: readFileAsBase64(relativePath),
                    mimetype: mime,
                    filename
                };
                if (caption) body.caption = caption;
                return body;
            }
        });
    }

    attempts.push({
        mode: 'url',
        buildBody: (chatId, caption) => {
            const body = { chatId, url, filename };
            if (caption) body.caption = caption;
            return body;
        }
    });

    return { attempts, url, size };
}

async function postOpenWA(platform, apiPath, body) {
    const url = joinUrl(platform.baseUrl, apiPath);
    const res = await axios.post(url, body, {
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-API-Key': platform.apiKey,
            'X-Request-ID': `c360_${Date.now()}`
        },
        timeout: 120000,
        validateStatus: () => true,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });
    return { url, res, data: res.data || {} };
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
        let attempts;
        let mediaUrl = null;

        if (media === 'IMAGE' && attachmentPath) {
            apiPath = `/sessions/${encodeURIComponent(sessionId)}/messages/send-image`;
            const servePath = await resolveImageRelativePath(attachmentPath, attachmentMime);
            const mime = guessMime(servePath, 'image/jpeg');
            const built = buildImageSendAttempts(servePath, mime);
            attempts = built.attempts;
            mediaUrl = built.url;
            console.log('[OpenWA] send-image', {
                servePath,
                fileSize: built.size,
                modes: attempts.map((a) => a.mode),
                url: built.url,
                ...(logMeta || {})
            });
        } else if (media === 'DOCUMENT' && attachmentPath) {
            apiPath = `/sessions/${encodeURIComponent(sessionId)}/messages/send-document`;
            const abs = localUploadPath(attachmentPath);
            if (!fs.existsSync(abs)) throw new Error(`Adjunto no encontrado: ${abs}`);
            const mime = guessMime(attachmentPath, attachmentMime);
            const filename = attachmentOriginalName || path.basename(attachmentPath) || 'documento.pdf';
            const built = buildDocumentSendAttempts(attachmentPath, mime, filename);
            attempts = built.attempts;
            mediaUrl = built.url;
            console.log('[OpenWA] send-document', {
                filename,
                fileSize: built.size,
                modes: attempts.map((a) => a.mode),
                url: built.url,
                ...(logMeta || {})
            });
        } else {
            apiPath = `/sessions/${encodeURIComponent(sessionId)}/messages/send-text`;
            attempts = [{
                mode: 'text',
                buildBody: () => ({ chatId, text: text || ' ' })
            }];
            console.log('[OpenWA] send-text', {
                chatId: maskChatId(chatId),
                ...(logMeta || {})
            });
        }

        let lastError = null;

        for (let i = 0; i < attempts.length; i++) {
            const attempt = attempts[i];
            const body = attempt.buildBody(chatId, caption);

            try {
                const { url, res, data } = await postOpenWA(platform, apiPath, body);

                if (res.status >= 400 || data.success === false) {
                    const detail = extractApiError(data, res.status, res.statusText);
                    const canRetry = i < attempts.length - 1 && isRetryableMediaError(res.status, detail);

                    console.warn('[OpenWA] Fallo envío', {
                        mode: attempt.mode,
                        url,
                        status: res.status,
                        detail: detail.slice(0, 800),
                        response: JSON.stringify(data).slice(0, 500),
                        requestBodyPreview: attempt.mode === 'base64'
                            ? `{ chatId, base64: "<${body.base64?.length || 0} chars>", mimetype: "${body.mimetype}", caption? }`
                            : JSON.stringify(body).slice(0, 400),
                        chatId: maskChatId(chatId),
                        media,
                        mediaUrl,
                        attachmentPath: attachmentPath || null,
                        ...(logMeta || {})
                    });

                    if (canRetry) {
                        console.warn('[OpenWA] Reintento con modo alternativo', {
                            from: attempt.mode,
                            to: attempts[i + 1].mode,
                            ...(logMeta || {})
                        });
                        lastError = new Error(`HTTP ${res.status} ${url}: ${detail}`.slice(0, 4000));
                        continue;
                    }

                    throw new Error(`HTTP ${res.status} ${url}: ${detail}`.slice(0, 4000));
                }

                const payload = data.data || data;
                const messageId = payload.messageId || payload.id || null;
                console.log('[OpenWA] Envío OK', {
                    mode: attempt.mode,
                    ...(logMeta || {}),
                    messageId,
                    chatId: maskChatId(chatId),
                    media,
                    mediaUrl
                });
                return { messageId, raw: data };
            } catch (e) {
                if (e.response?.data) {
                    const detail = extractApiError(e.response.data, e.response.status, e.message);
                    lastError = new Error(detail.slice(0, 4000));
                    if (i < attempts.length - 1) continue;
                    throw lastError;
                }
                if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
                    throw new Error(`No se pudo conectar con OpenWA (${e.code}). Revise OPENWA_BASE_URL y red.`);
                }
                lastError = e;
                if (i < attempts.length - 1) continue;
                throw e;
            }
        }

        throw lastError || new Error('OpenWA: envío fallido sin detalle');
    }
}

OpenWAWhatsAppService.buildPublicUploadUrl = buildPublicUploadUrl;
OpenWAWhatsAppService.localUploadPath = localUploadPath;

module.exports = OpenWAWhatsAppService;
