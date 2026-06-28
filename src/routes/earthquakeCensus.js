const express = require('express');
const multer = require('multer');
const router = express.Router();
const EarthquakeCensusController = require('../controllers/EarthquakeCensusController');
const uploadEarthquakeCensusPhotos = require('../middleware/uploadEarthquakeCensusPhotos');

const UPLOAD_TIMEOUT_MS = parseInt(process.env.EARTHQUAKE_CENSUS_UPLOAD_TIMEOUT_MS || '300000', 10);

function extendUploadTimeout(req, res, next) {
    const ms = Number.isFinite(UPLOAD_TIMEOUT_MS) && UPLOAD_TIMEOUT_MS > 0 ? UPLOAD_TIMEOUT_MS : 300000;
    req.setTimeout(ms);
    res.setTimeout(ms);
    next();
}

function formatUploadError(err) {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return `Cada foto puede pesar hasta ${uploadEarthquakeCensusPhotos.maxFileSizeMb} MB como máximo`;
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return `Máximo ${uploadEarthquakeCensusPhotos.maxFiles} fotos por envío`;
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return 'Campo de fotos inválido. Actualice la página e intente de nuevo';
        }
        return 'Error al recibir las fotos. Intente con menos imágenes o mejor conexión';
    }
    return err.message || 'Error al subir fotos';
}

router.get('/damage-types', EarthquakeCensusController.listDamageTypes);
router.get('/tenants', EarthquakeCensusController.listTenants);
router.get('/tenants/:tenantId/buildings', EarthquakeCensusController.listBuildings);
router.get('/tenants/:tenantId/properties', EarthquakeCensusController.listProperties);
router.get('/tenants/:tenantId/submission', EarthquakeCensusController.getExistingManualSubmission);
router.get('/tenants/:tenantId/properties/:propertyId/submission', EarthquakeCensusController.getExistingSubmission);

router.post(
    '/submit',
    extendUploadTimeout,
    (req, res, next) => {
        uploadEarthquakeCensusPhotos.array('photos', uploadEarthquakeCensusPhotos.maxFiles)(req, res, (err) => {
            if (err) {
                return res.status(400).json({ success: false, error: formatUploadError(err) });
            }
            next();
        });
    },
    EarthquakeCensusController.submit
);

module.exports = router;
