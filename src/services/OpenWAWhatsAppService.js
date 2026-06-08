const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/**
 * Cliente OpenWA — send-{text|image|document} (DTO plano: chatId + url|base64 + mimetype).
 * Multimedia: URL pública por defecto; base64 solo si OPENWA_MEDIA_USE_BASE64=true.
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
const DEFAULT_MAX_BASE64_BYTES = 75000;

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

function useBase64Fallback() {
    const v = (process.env.OPENWA_MEDIA_USE_BASE64 || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
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
    return d.includes('download') || d.includes('media') || d.includes('validation');
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
    console.log('[OpenWA] Imagen optimizada', {
        original: relativePath,
        originalSize: size,
        optimized,
        optimizedSize: fs.statSync(localUploadPath(optimized)).size
    });
    return optimized;
}

function readFileAsBase64(relativePath) {
    return fs.readFileSync(localUploadPath(relativePath)).toString('base64');
}

function buildMediaSendAttempts(relativePath, mime, filename) {
    const size = fs.statSync(localUploadPath(relativePath)).size;
    const publicUrl = buildPublicUploadUrl(relativePath);
    const attempts = [];

    attempts.push({
        mode: 'url',
        buildBody: (chatId, caption) => {
            const body = { chatId, url: publicUrl };
            if (filename) body.filename = filename;
            if (caption) body.caption = caption;
            return body;
        }
    });

    if (useBase64Fallback() && size <= parseMaxBase64Bytes()) {
        attempts.push({
            mode: 'base64',
            buildBody: (chatId, caption) => {
                const body = {
                    chatId,
                    base64: readFileAsBase64(relativePath),
                    mimetype: mime,
                    filename: filename || path.basename(relativePath)
                };
                if (caption) body.caption = caption;
                return body;
            }
        });
    }

    return { attempts, url: publicUrl, size };
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
            const built = buildMediaSendAttempts(servePath, mime, path.basename(servePath));
            attempts = built.attempts;
            mediaUrl = built.url;
        } else if (media === 'DOCUMENT' && attachmentPath) {
            apiPath = `/sessions/${encodeURIComponent(sessionId)}/messages/send-document`;
            const abs = localUploadPath(attachmentPath);
            if (!fs.existsSync(abs)) throw new Error(`Adjunto no encontrado: ${abs}`);
            const mime = guessMime(attachmentPath, attachmentMime);
            const filename = attachmentOriginalName || path.basename(attachmentPath) || 'documento.pdf';
            const built = buildMediaSendAttempts(attachmentPath, mime, filename);
            attempts = built.attempts;
            mediaUrl = built.url;
        } else {
            apiPath = `/sessions/${encodeURIComponent(sessionId)}/messages/send-text`;
            attempts = [{
                mode: 'text',
                buildBody: () => ({ chatId, text: text || ' ' })
            }];
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
                    lastError = new Error(`HTTP ${res.status} ${url}: ${detail}`.slice(0, 4000));

                    if (canRetry) {
                        console.log('[OpenWA] Reintento multimedia', {
                            from: attempt.mode,
                            to: attempts[i + 1].mode,
                            status: res.status,
                            chatId: maskChatId(chatId),
                            ...(logMeta || {})
                        });
                        continue;
                    }

                    console.warn('[OpenWA] Fallo envío', {
                        mode: attempt.mode,
                        status: res.status,
                        detail: detail.slice(0, 300),
                        chatId: maskChatId(chatId),
                        media,
                        ...(logMeta || {})
                    });
                    throw lastError;
                }

                const payload = data.data || data;
                const messageId = payload.messageId || payload.id || null;
                console.log('[OpenWA] Envío OK', {
                    mode: attempt.mode,
                    messageId,
                    chatId: maskChatId(chatId),
                    media,
                    ...(logMeta || {})
                });
                return { messageId, raw: data };
            } catch (e) {
                if (e === lastError || (lastError && e.message === lastError.message)) {
                    throw e;
                }
                if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
                    throw new Error(`No se pudo conectar con OpenWA (${e.code}). Revise OPENWA_BASE_URL y red.`);
                }
                throw e;
            }
        }

        throw lastError || new Error('OpenWA: envío fallido sin detalle');
    }
}

OpenWAWhatsAppService.buildPublicUploadUrl = buildPublicUploadUrl;
OpenWAWhatsAppService.localUploadPath = localUploadPath;

module.exports = OpenWAWhatsAppService;
