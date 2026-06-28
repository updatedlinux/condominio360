const express = require('express');
const router = express.Router();
const EarthquakeCensusController = require('../controllers/EarthquakeCensusController');
const uploadEarthquakeCensusPhotos = require('../middleware/uploadEarthquakeCensusPhotos');

router.get('/damage-types', EarthquakeCensusController.listDamageTypes);
router.get('/tenants', EarthquakeCensusController.listTenants);
router.get('/tenants/:tenantId/buildings', EarthquakeCensusController.listBuildings);
router.get('/tenants/:tenantId/properties', EarthquakeCensusController.listProperties);
router.get('/tenants/:tenantId/properties/:propertyId/submission', EarthquakeCensusController.getExistingSubmission);

router.post(
    '/submit',
    (req, res, next) => {
        uploadEarthquakeCensusPhotos.array('photos', 10)(req, res, (err) => {
            if (err) {
                return res.status(400).json({ success: false, error: err.message || 'Error al subir fotos' });
            }
            next();
        });
    },
    EarthquakeCensusController.submit
);

module.exports = router;
