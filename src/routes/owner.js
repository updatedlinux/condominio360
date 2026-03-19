const express = require('express');
const router = express.Router();
const OwnerController = require('../controllers/OwnerController');
const OwnerBillingController = require('../controllers/OwnerBillingController');
const OwnerCommuniqueController = require('../controllers/OwnerCommuniqueController');
const OwnerCommonAreaController = require('../controllers/OwnerCommonAreaController');
const DeliveryController = require('../controllers/DeliveryController');
const { authenticate, requireOwner, requirePropertyAccess } = require('../middleware/auth');
const uploadPaymentReceipt = require('../middleware/uploadPaymentReceipt');

/**
 * Rutas del Panel de Propietario
 * Base: /api/owner
 * Todas requieren autenticación como propietario
 */

// Middleware personalizado para billing (permite OWNER o TENANT_ADMIN)
const requireOwnerOrTenantAdmin = (req, res, next) => {
    if (!req.user || (req.user.type !== 'OWNER' && req.user.type !== 'TENANT_ADMIN')) {
        return res.status(403).json({ error: 'Acceso denegado. Se requiere ser propietario o administrador.' });
    }
    next();
};

// Aplicar middleware a todas las rutas
router.use(authenticate, requireOwner);

// ==================== DASHBOARD ====================
router.get('/dashboard', OwnerController.getDashboard);
router.get('/activity', OwnerController.getActivity);

// ==================== PERFIL ====================
router.get('/profile', require('../controllers/OwnerProfileController').getProfile);
router.post('/profile/update-request', require('../controllers/OwnerProfileController').submitUpdateRequest);
router.get('/in-app-notifications', require('../controllers/InAppNotificationController').getForOwner);

// ==================== DELIVERIES ====================
router.get('/deliveries', DeliveryController.getByUser);
router.post('/deliveries', DeliveryController.create);

// ==================== SOLICITUDES ====================
router.get('/requests/types', OwnerController.getRequestTypes);
router.get('/requests/move-config', OwnerController.getMoveConfig);
router.get('/requests', OwnerController.getRequests);
router.post('/requests', OwnerController.createRequest);
router.get('/requests/:id', OwnerController.getRequestById);

// ==================== COMUNICADOS ====================
router.get('/communiques', OwnerCommuniqueController.getCommuniques);
router.get('/communiques/:id', OwnerCommuniqueController.getCommuniqueById);

// ==================== CONSULTAS ====================
router.get('/consultations', OwnerController.getConsultations);
router.get('/consultations/:id', OwnerController.getConsultationById);
router.post('/consultations/:id/vote', OwnerController.vote);

// ==================== ÁREAS COMUNES / RESERVAS ====================
router.get('/common-areas', OwnerCommonAreaController.getAreas);
router.get('/common-areas/reservations', OwnerCommonAreaController.getMyReservations);
router.post('/common-areas/reservations', OwnerCommonAreaController.createReservation);
router.post('/common-areas/reservations/:id/cancel', OwnerCommonAreaController.cancelReservation);
router.get('/common-areas/:id/slots', OwnerCommonAreaController.getAvailableSlots);
router.get('/common-areas/:id', OwnerCommonAreaController.getAreaDetail);

// ==================== VISITAS ====================
router.get('/visitors', OwnerController.getVisitors);
router.post('/visitors', OwnerController.createVisitor);
router.get('/visits/upcoming', OwnerController.getUpcomingVisits);
router.get('/visits/history', OwnerController.getVisitsHistory);

// ==================== ACCESOS VEHICULARES (NFC) ====================
router.get('/vehicle-access', OwnerController.getVehicleAccess);

// ==================== FACTURACIÓN ====================
// Rutas de billing permiten OWNER o TENANT_ADMIN
router.get('/billing/config', authenticate, requireOwnerOrTenantAdmin, OwnerBillingController.getConfig);
router.get('/billing/invoices', authenticate, requireOwnerOrTenantAdmin, OwnerBillingController.getInvoices);
router.get('/billing/invoices/:id', authenticate, requireOwnerOrTenantAdmin, OwnerBillingController.getInvoiceById);
router.post('/billing/invoices/:id/report-payment', authenticate, requireOwnerOrTenantAdmin, (req, res, next) => {
    uploadPaymentReceipt.single('receipt')(req, res, (err) => {
        if (err) {
            if (err.message && err.message.includes('Solo se permiten')) {
                return res.status(400).json({ error: err.message });
            }
            return res.status(500).json({ error: 'Error al subir archivo' });
        }
        next();
    });
}, OwnerBillingController.reportPayment);
router.get('/billing/banks', authenticate, requireOwnerOrTenantAdmin, OwnerBillingController.getBanks);
router.get('/billing/stats', authenticate, requireOwnerOrTenantAdmin, OwnerBillingController.getStats);

// ==================== TASAS BCV ====================
router.get('/exchange-rates', OwnerController.getExchangeRates);
router.post('/exchange-rates/update', OwnerController.forceUpdateExchangeRate);

module.exports = router;
