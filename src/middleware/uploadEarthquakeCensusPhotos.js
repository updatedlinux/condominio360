const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(process.cwd(), 'uploads', 'earthquake-census');
const maxFileSizeMb = parseInt(process.env.EARTHQUAKE_CENSUS_PHOTO_MAX_MB || '8', 10);
const maxFiles = parseInt(process.env.EARTHQUAKE_CENSUS_PHOTO_MAX_COUNT || '10', 10);

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const IMAGE_MIMES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
]);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

function isAllowedImage(file) {
    const mime = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (IMAGE_MIMES.has(mime) || mime.startsWith('image/')) {
        return !ext || IMAGE_EXTS.has(ext);
    }
    if (ext && IMAGE_EXTS.has(ext)) {
        return true;
    }
    if (mime === 'application/octet-stream' && ext && IMAGE_EXTS.has(ext)) {
        return true;
    }
    return false;
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        let ext = path.extname(file.originalname || '').toLowerCase();
        if (!ext || !IMAGE_EXTS.has(ext)) {
            const mime = String(file.mimetype || '').toLowerCase();
            if (mime.includes('png')) ext = '.png';
            else if (mime.includes('webp')) ext = '.webp';
            else if (mime.includes('heic') || mime.includes('heif')) ext = '.heic';
            else ext = '.jpg';
        }
        cb(null, uniqueSuffix + ext);
    }
});

const fileFilter = (_req, file, cb) => {
    if (isAllowedImage(file)) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten imágenes (JPG, PNG, WebP, HEIC). Si el problema persiste, intente tomar la foto de nuevo.'), false);
    }
};

const uploadEarthquakeCensusPhotos = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: Math.max(1, maxFileSizeMb) * 1024 * 1024,
        files: Math.max(1, maxFiles)
    }
});

uploadEarthquakeCensusPhotos.maxFileSizeMb = maxFileSizeMb;
uploadEarthquakeCensusPhotos.maxFiles = maxFiles;

module.exports = uploadEarthquakeCensusPhotos;
