const express = require('express');
const router = express.Router();
const NFCAdminController = require('../controllers/NFCAdminController');
const { authenticate, requireTenantAdmin } = require('../middleware/auth');

/**
 * Rutas para Gestión de NFC (por parte de la Junta de Condominio)
 * Base: /api/tenant-admin/nfc
 * Accesible por: Tenant Admins
 */

router.use(authenticate, requireTenantAdmin);

// Tarjetas
router.get('/cards', NFCAdminController.getCards);
router.get('/cards/:id', NFCAdminController.getCardById);
router.post('/cards', NFCAdminController.createCard);
router.put('/cards/:id', NFCAdminController.updateCard);
router.delete('/cards/:id', NFCAdminController.deleteCard);

// Acciones especiales
router.post('/cards/:id/block', NFCAdminController.blockCard);
router.post('/cards/:id/unblock', NFCAdminController.unblockCard);

// Estadísticas y logs
router.get('/stats', NFCAdminController.getStats);
router.get('/access-logs', NFCAdminController.getAccessLogs);

module.exports = router;
