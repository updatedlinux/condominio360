const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const baseDir = path.join(process.cwd(), 'uploads', 'junta-email');

function ensureTenantDir(tenantId) {
    const dir = path.join(baseDir, tenantId || 'unknown');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ensureTenantDir(req.params.id));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.png';
        cb(null, `${crypto.randomUUID()}${safeExt}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    if (allowedMimes.includes(file.mimetype) && allowedExts.some((e) => ext === e)) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten imágenes JPG, PNG, GIF o WebP'), false);
    }
};

const uploadJuntaEmailImage = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

function publicImageUrl(req, tenantId, filename) {
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    return `${base}/uploads/junta-email/${tenantId}/${filename}`;
}

module.exports = uploadJuntaEmailImage;
module.exports.publicImageUrl = publicImageUrl;
