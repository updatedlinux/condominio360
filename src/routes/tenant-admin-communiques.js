const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const CommuniqueController = require('../controllers/TenantAdminCommuniqueController');
const { authenticate, requireTenantAdmin } = require('../middleware/auth');

// Configurar multer para subida de archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads/communiques');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['.docx', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos DOCX o PDF'), false);
    }
};

const maxUploadMb = parseInt(process.env.COMMUNIQUE_MAX_UPLOAD_MB || '50', 10);
const uploadMaxBytes = (Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : 50) * 1024 * 1024;

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: uploadMaxBytes }
});

// Todas las rutas requieren autenticación de Tenant Admin
router.use(authenticate, requireTenantAdmin);

// Rutas específicas (deben ir antes de las rutas con :id)
router.get('/stats/overview', CommuniqueController.getTenantStats);

// Rutas generales
router.get('/', CommuniqueController.getCommuniques);
router.post('/', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err && err.code === 'LIMIT_FILE_SIZE') {
            const mb = Math.round(uploadMaxBytes / (1024 * 1024));
            return res.status(400).json({
                success: false,
                error: `El archivo supera el tamaño máximo permitido (${mb} MB).`
            });
        }
        if (err) return next(err);
        next();
    });
}, CommuniqueController.createCommunique);
router.get('/:id', CommuniqueController.getCommuniqueById);
router.get('/:id/stats', CommuniqueController.getStats);
router.get('/:id/content', CommuniqueController.getContent);
router.delete('/:id', CommuniqueController.deleteCommunique);

module.exports = router;
