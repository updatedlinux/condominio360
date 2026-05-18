const express = require('express');
const router = express.Router();
const SecurityController = require('../controllers/SecurityController');
const DeliveryController = require('../controllers/DeliveryController');
const NFCSecurityController = require('../controllers/NFCSecurityController');
const { authenticate, requireSecurity } = require('../middleware/auth');
const {
    requireVisitsAnnouncements,
    requireDeliveriesAnnouncements,
    requireVehicleAccess
} = require('../middleware/requireTenantFeature');

/**
 * Rutas del Panel de Seguridad
 * Base: /api/security
 * Todas requieren autenticación como vigilante/seguridad
 */

// Aplicar middleware a todas las rutas
router.use(authenticate, requireSecurity);

// ==================== FUNCIONALIDADES DEL CONDOMINIO ====================
router.get('/portal-features', async (req, res) => {
    try {
        const TenantModel = require('../models/TenantModel');
        const data = await TenantModel.getPortalFeatureFlags(req.user.tenantId);
        if (!data) {
            return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
        }
        res.json({ success: true, data });
    } catch (error) {
        console.error('security portal-features error:', error);
        res.status(500).json({ success: false, error: 'Error al cargar funcionalidades' });
    }
});

// ==================== DASHBOARD / POLLING ====================
router.get('/dashboard/status', SecurityController.getDashboardStatus);
router.get('/active-visits', requireVisitsAnnouncements, SecurityController.getActiveVisits);

// ==================== BÚSQUEDA PROPIETARIOS (para visita/delivery manual) ====================
router.get('/owners/search', SecurityController.searchOwnersByDni);

// ==================== VISITAS ====================
router.get('/visits', requireVisitsAnnouncements, SecurityController.getVisits);
router.get('/visits/search', requireVisitsAnnouncements, SecurityController.searchVisits);
router.post('/visits/:id/entry', requireVisitsAnnouncements, SecurityController.registerVisitEntry);
router.post('/visits/:id/exit', requireVisitsAnnouncements, SecurityController.registerVisitExit);
router.post('/visits/manual', requireVisitsAnnouncements, SecurityController.createManualVisit);
router.post('/frequent-visits/:id/entry', requireVisitsAnnouncements, SecurityController.registerFrequentVisitEntry);

// ==================== DELIVERIES ====================
router.get('/deliveries', requireDeliveriesAnnouncements, DeliveryController.getForSecurity);
router.get('/deliveries/search', requireDeliveriesAnnouncements, DeliveryController.searchByOwner);
router.post('/deliveries/:id/arrive', requireDeliveriesAnnouncements, DeliveryController.markArrived);
router.post('/deliveries/:id/deliver', requireDeliveriesAnnouncements, DeliveryController.markDelivered);
router.post('/deliveries/manual', requireDeliveriesAnnouncements, DeliveryController.createManual);

// ==================== MUDANZAS ====================
router.get('/moves', SecurityController.getApprovedMoves);
router.get('/moves/search', SecurityController.searchMoves);

// ==================== ACCESO VEHICULAR NFC ====================
router.post('/nfc/log', requireVehicleAccess, NFCSecurityController.logAccess);
router.get('/nfc/lookup/:card_uid', requireVehicleAccess, NFCSecurityController.lookupByUid);
router.get('/nfc/today-logs', requireVehicleAccess, NFCSecurityController.getTodayLogs);

module.exports = router;
