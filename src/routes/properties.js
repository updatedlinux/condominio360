const express = require('express');
const router = express.Router();
const PropertyController = require('../controllers/PropertyController');
const { authenticate, requireOwner } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(authenticate);

// Rutas para propietarios (owners)
router.get('/my-properties', requireOwner, PropertyController.getMyProperties);
router.get('/:id', requireOwner, PropertyController.show);

module.exports = router;
