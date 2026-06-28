const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = './uploads/earthquake-census';

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname || '').toLowerCase();
        cb(null, uniqueSuffix + (ext || '.jpg'));
    }
});

const fileFilter = (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
    if (allowedMimes.includes(file.mimetype) && allowedExts.some((e) => ext === e)) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten imágenes (JPG, PNG, WebP, HEIC)'), false);
    }
};

const uploadEarthquakeCensusPhotos = multer({
    storage,
    fileFilter,
    limits: { fileSize: 8 * 1024 * 1024, files: 10 }
});

module.exports = uploadEarthquakeCensusPhotos;
