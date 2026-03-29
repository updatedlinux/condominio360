const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const baseDir = path.join(process.cwd(), 'uploads', 'billing-preliminary-items');

function ensureTenantDir(tenantId) {
    const dir = path.join(baseDir, tenantId || 'unknown');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const tenantId = req.user?.tenantId || 'unknown';
        cb(null, ensureTenantDir(tenantId));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'].includes(ext) ? ext : '.bin';
        cb(null, `${crypto.randomUUID()}${safeExt}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];

    if (allowedMimes.includes(file.mimetype) && allowedExts.some((e) => ext === e)) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten imágenes (JPG, PNG, GIF, WebP) y archivos PDF'), false);
    }
};

/** Acepta cualquier campo attachment_N; máx. 64 ítems por solicitud */
const uploadBillingPreliminaryItems = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024, files: 64 }
});

/** Solo ejecuta multer si el cliente envía multipart/form-data (JSON sigue igual). */
function conditionalPreliminaryUpload(req, res, next) {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
        return uploadBillingPreliminaryItems.any()(req, res, (err) => {
            if (err) {
                return res.status(400).json({ success: false, error: err.message || 'Error al subir archivos' });
            }
            next();
        });
    }
    next();
}

module.exports = uploadBillingPreliminaryItems;
module.exports.conditionalPreliminaryUpload = conditionalPreliminaryUpload;
