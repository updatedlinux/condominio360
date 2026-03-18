const express = require('express');
const router = express.Router();
const SecurityController = require('../controllers/SecurityController');
const DeliveryController = require('../controllers/DeliveryController');
const NFCSecurityController = require('../controllers/NFCSecurityController');
const { authenticate, requireSecurity } = require('../middleware/auth');

/**
 * Rutas del Panel de Seguridad
 * Base: /api/security
 * Todas requieren autenticación como vigilante/seguridad
 */

// Aplicar middleware a todas las rutas
router.use(authenticate, requireSecurity);

// ==================== DASHBOARD / POLLING ====================
router.get('/dashboard/status', SecurityController.getDashboardStatus);
router.get('/active-visits', SecurityController.getActiveVisits);

// ==================== BÚSQUEDA PROPIETARIOS (para visita/delivery manual) ====================
router.get('/owners/search', SecurityController.searchOwnersByDni);

// ==================== VISITAS ====================
router.get('/visits', SecurityController.getVisits);
router.get('/visits/search', SecurityController.searchVisits);
router.post('/visits/:id/entry', SecurityController.registerVisitEntry);
router.post('/visits/:id/exit', SecurityController.registerVisitExit);
router.post('/visits/manual', SecurityController.createManualVisit);
router.post('/frequent-visits/:id/entry', SecurityController.registerFrequentVisitEntry);

// ==================== DELIVERIES ====================
router.get('/deliveries', DeliveryController.getForSecurity);
router.get('/deliveries/search', DeliveryController.searchByOwner);
router.post('/deliveries/:id/arrive', DeliveryController.markArrived);
router.post('/deliveries/:id/deliver', DeliveryController.markDelivered);
router.post('/deliveries/manual', DeliveryController.createManual);

// ==================== MUDANZAS ====================
router.get('/moves', SecurityController.getApprovedMoves);
router.get('/moves/search', SecurityController.searchMoves);

// ==================== ACCESO VEHICULAR NFC ====================
router.post('/nfc/log', NFCSecurityController.logAccess);
router.get('/nfc/lookup/:card_uid', NFCSecurityController.lookupByUid);
router.get('/nfc/today-logs', NFCSecurityController.getTodayLogs);

module.exports = router;
