const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ASSETS_DIR = path.join(__dirname, '..', 'public', 'assets', 'images');
const CONDO_BOUNCE_SVG = fs.existsSync(path.join(ASSETS_DIR, 'CONDOMINIO360-blacklogo.svg'))
    ? path.join(ASSETS_DIR, 'CONDOMINIO360-blacklogo.svg')
    : path.join(ASSETS_DIR, 'logo.svg');

const BRAND_ASSETS = {
    condominio360: {
        svg: path.join(ASSETS_DIR, 'isotipo-naranja.svg'),
        png: path.join(ASSETS_DIR, 'png', 'isotipo-naranja.png'),
        publicPngPath: '/assets/images/png/isotipo-naranja.png',
        width: 128
    },
    condominio360Bounce: {
        svg: CONDO_BOUNCE_SVG,
        png: path.join(ASSETS_DIR, 'png', 'condominio360-bounce-header.png'),
        publicPngPath: '/assets/images/png/condominio360-bounce-header.png',
        width: 380
    },
    arsysIntela: {
        svg: path.join(ASSETS_DIR, 'main-intelawhite.svg'),
        png: path.join(ASSETS_DIR, 'png', 'main-intelawhite.png'),
        publicPngPath: '/assets/images/png/main-intelawhite.png',
        width: 320
    }
};

let ensurePromise = null;

async function svgToPngIfNeeded(asset) {
    if (!fs.existsSync(asset.svg)) {
        console.warn(`[emailBrandAssets] SVG no encontrado: ${asset.svg}`);
        return fs.existsSync(asset.png);
    }

    const svgMtime = fs.statSync(asset.svg).mtimeMs;
    const pngExists = fs.existsSync(asset.png);
    const pngMtime = pngExists ? fs.statSync(asset.png).mtimeMs : 0;

    if (pngExists && pngMtime >= svgMtime) {
        return true;
    }

    await fs.promises.mkdir(path.dirname(asset.png), { recursive: true });
    await sharp(asset.svg)
        .resize(asset.width, asset.width, {
            fit: 'inside',
            withoutEnlargement: false,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png({ compressionLevel: 9 })
        .toFile(asset.png);

    return true;
}

/**
 * Genera/actualiza PNG desde SVG para logos usados en correos (compatibilidad clientes de email).
 */
async function ensureEmailBrandAssets() {
    await svgToPngIfNeeded(BRAND_ASSETS.condominio360);
    await svgToPngIfNeeded(BRAND_ASSETS.arsysIntela);
}

function ensureEmailBrandAssetsOnce() {
    if (!ensurePromise) {
        ensurePromise = ensureEmailBrandAssets().catch((err) => {
            ensurePromise = null;
            console.error('[emailBrandAssets] Error generando PNG para correos:', err.message || err);
            throw err;
        });
    }
    return ensurePromise;
}

function resolveEmailPublicBaseUrl() {
    const raw = (
        process.env.EMAIL_PUBLIC_BASE_URL
        || process.env.APP_URL
        || 'https://condominio-360.com'
    ).trim().replace(/\/+$/, '');

    if (!raw) return 'https://condominio-360.com';
    if (process.env.NODE_ENV === 'production' && raw.startsWith('http://')) {
        return `https://${raw.slice(7)}`;
    }
    return raw;
}

function getEmailLogoFilename(brand = 'condominio360') {
    const asset = BRAND_ASSETS[brand] || BRAND_ASSETS.condominio360;
    return path.basename(asset.png);
}

function getEmailLogoUrl(baseUrl, brand = 'condominio360') {
    const asset = BRAND_ASSETS[brand] || BRAND_ASSETS.condominio360;
    const root = (baseUrl || resolveEmailPublicBaseUrl()).replace(/\/+$/, '');
    return `${root}${asset.publicPngPath}`;
}

/**
 * Src para <img>: por defecto CID embebido (no depende de APP_URL ni de assets públicos).
 * EMAIL_LOGO_MODE=url fuerza URL pública (EMAIL_PUBLIC_BASE_URL / APP_URL).
 */
function getEmailLogoSrc(brand = 'condominio360') {
    const mode = (process.env.EMAIL_LOGO_MODE || 'inline').toLowerCase();
    if (mode === 'url' || mode === 'external') {
        return getEmailLogoUrl(resolveEmailPublicBaseUrl(), brand);
    }
    return `cid:${getEmailLogoFilename(brand)}`;
}

/** Reemplaza URLs públicas antiguas del logo por cid: (correos ya encolados). */
function replaceExternalLogoUrlsWithCid(html) {
    let out = String(html || '');
    for (const asset of Object.values(BRAND_ASSETS)) {
        const filename = path.basename(asset.png);
        const escapedPath = asset.publicPngPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(
            new RegExp(`https?:\\/\\/[^"'\\s>]+${escapedPath}`, 'gi'),
            `cid:${filename}`
        );
    }
    return out;
}

/**
 * Adjuntos inline Mailgun referenciados como cid:filename en el HTML.
 */
async function buildInlineLogoAttachmentsForHtml(html) {
    if (!html || !String(html).includes('cid:')) {
        return [];
    }

    await ensureEmailBrandAssets();

    const attachments = [];
    for (const asset of Object.values(BRAND_ASSETS)) {
        const filename = path.basename(asset.png);
        const cidRef = `cid:${filename}`;
        if (!String(html).includes(cidRef)) continue;

        if (!fs.existsSync(asset.png)) {
            await svgToPngIfNeeded(asset);
        }
        if (!fs.existsSync(asset.png)) {
            console.warn(`[emailBrandAssets] PNG no disponible para inline: ${asset.png}`);
            continue;
        }

        attachments.push({
            filename,
            data: await fs.promises.readFile(asset.png),
            contentType: 'image/png'
        });
    }

    return attachments;
}

module.exports = {
    ensureEmailBrandAssets,
    ensureEmailBrandAssetsOnce,
    resolveEmailPublicBaseUrl,
    getEmailLogoUrl,
    getEmailLogoSrc,
    getEmailLogoFilename,
    replaceExternalLogoUrlsWithCid,
    buildInlineLogoAttachmentsForHtml,
    BRAND_ASSETS
};
