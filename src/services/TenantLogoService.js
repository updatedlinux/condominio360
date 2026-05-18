const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const TENANT_LOGO = require('../constants/tenantLogo');

/**
 * Normaliza el logo subido a una resolución máxima estándar (mantiene proporción).
 */
class TenantLogoService {
    static async normalizeUploadedFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const isPng = ext === '.png';
        const tmpPath = `${filePath}.tmp`;

        let pipeline = sharp(filePath)
            .rotate()
            .resize(TENANT_LOGO.storageMaxWidth, TENANT_LOGO.storageMaxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            });

        if (isPng) {
            pipeline = pipeline.png({ compressionLevel: 9 });
        } else {
            pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
        }

        await pipeline.toFile(tmpPath);
        await fs.promises.rename(tmpPath, filePath);
    }
}

module.exports = TenantLogoService;
