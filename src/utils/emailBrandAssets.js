const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ASSETS_DIR = path.join(__dirname, '..', 'public', 'assets', 'images');

const BRAND_ASSETS = {
    condominio360: {
        svg: path.join(ASSETS_DIR, 'isotipo-naranja.svg'),
        png: path.join(ASSETS_DIR, 'png', 'isotipo-naranja.png'),
        publicPngPath: '/assets/images/png/isotipo-naranja.png',
        width: 128
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

function getEmailLogoUrl(baseUrl, brand = 'condominio360') {
    const asset = BRAND_ASSETS[brand] || BRAND_ASSETS.condominio360;
    if (fs.existsSync(asset.png)) {
        return `${baseUrl}${asset.publicPngPath}`;
    }
    return `${baseUrl}${asset.publicPngPath}`;
}

module.exports = {
    ensureEmailBrandAssets,
    ensureEmailBrandAssetsOnce,
    getEmailLogoUrl,
    BRAND_ASSETS
};
