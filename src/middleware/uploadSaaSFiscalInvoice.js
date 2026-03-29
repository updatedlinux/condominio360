const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const baseDir = path.join(process.cwd(), 'uploads', 'saas-fiscal-invoices');
if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, baseDir);
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

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }
});

/** multipart/form-data: parse fields first; tenant_id must be in body for destination */
function conditionalSaaSFiscalUpload(req, res, next) {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
        return upload.single('fiscal_attachment')(req, res, (err) => {
            if (err) {
                return res.status(400).json({ success: false, error: err.message || 'Error al subir archivo' });
            }
            next();
        });
    }
    next();
}

module.exports = upload;
module.exports.conditionalSaaSFiscalUpload = conditionalSaaSFiscalUpload;
