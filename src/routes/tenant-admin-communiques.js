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

const upload = multer({ 
    storage,
    fileFilter,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// Todas las rutas requieren autenticación de Tenant Admin
router.use(authenticate, requireTenantAdmin);

// Rutas específicas (deben ir antes de las rutas con :id)
router.get('/stats/overview', CommuniqueController.getTenantStats);

// Rutas generales
router.get('/', CommuniqueController.getCommuniques);
router.post('/', upload.single('file'), CommuniqueController.createCommunique);
router.get('/:id', CommuniqueController.getCommuniqueById);
router.get('/:id/stats', CommuniqueController.getStats);
router.get('/:id/content', CommuniqueController.getContent);
router.delete('/:id', CommuniqueController.deleteCommunique);

module.exports = router;
