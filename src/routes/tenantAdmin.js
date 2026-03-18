const express = require('express');
const router = express.Router();
const TenantAdminController = require('../controllers/TenantAdminController');
const TenantAdminRequestController = require('../controllers/TenantAdminRequestController');
const TenantAdminConsultationController = require('../controllers/TenantAdminConsultationController');
const TenantAdminCommunicationController = require('../controllers/TenantAdminCommunicationController');
const TenantAdminCommonAreaController = require('../controllers/TenantAdminCommonAreaController');
const TenantAdminOwnerController = require('../controllers/TenantAdminOwnerController');
const BuildingController = require('../controllers/BuildingController');
const PropertyController = require('../controllers/PropertyController');
const TenantAdminBillingController = require('../controllers/TenantAdminBillingController');
const { authenticate } = require('../middleware/auth');
const uploadPaymentReceipt = require('../middleware/uploadPaymentReceipt');
const TenantAdminBalanceController = require('../controllers/TenantAdminBalanceController');

// Middleware to ensure user is Tenant Admin
const verifyTenantAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(403).json({ error: 'No autenticado' });
    }
    
    if (req.user.type === 'TENANT_ADMIN') {
        // TenantAdmins tienen acceso completo
        return next();
    }
    
    if (req.user.isSuperAdmin) {
        // Superadmin también tiene acceso
        return next();
    }
    
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de administrador de junta.' });
};

// Apply generic auth middleware first
router.use(authenticate);
router.use(verifyTenantAdmin);

// Dashboard stats
router.get('/stats', TenantAdminController.getStats);
router.get('/activity', TenantAdminController.getActivity);

// ==================== NOTIFICACIONES IN-APP (MENSAJES CORTOS) ====================
const InAppNotificationController = require('../controllers/InAppNotificationController');
router.get('/in-app-notifications', InAppNotificationController.list);
router.get('/in-app-notifications/max-length', (req, res) => res.json({ maxLength: 250 }));
router.get('/in-app-notifications/:id', InAppNotificationController.getById);
router.post('/in-app-notifications', InAppNotificationController.create);
router.put('/in-app-notifications/:id', InAppNotificationController.update);
router.post('/in-app-notifications/:id/send', InAppNotificationController.sendNow);
router.delete('/in-app-notifications/:id', InAppNotificationController.delete);

// ==================== COMUNICADOS / CARTAS ====================
router.get('/communications', TenantAdminCommunicationController.getCommunications);
router.get('/communications/stats', TenantAdminCommunicationController.getStats);
router.get('/communications/:id', TenantAdminCommunicationController.getCommunicationDetail);
router.post('/communications', TenantAdminCommunicationController.createCommunication);
router.put('/communications/:id', TenantAdminCommunicationController.updateCommunication);
router.delete('/communications/:id', TenantAdminCommunicationController.deleteCommunication);
router.post('/communications/:id/publish', TenantAdminCommunicationController.publishCommunication);
router.post('/communications/:id/archive', TenantAdminCommunicationController.archiveCommunication);

// ==================== CONSULTAS / VOTACIONES ====================
router.get('/consultations', TenantAdminConsultationController.index);
router.get('/consultations/:id', TenantAdminConsultationController.show);
router.post('/consultations', TenantAdminConsultationController.create);
router.put('/consultations/:id', TenantAdminConsultationController.update);
router.delete('/consultations/:id', TenantAdminConsultationController.delete);
router.post('/consultations/:id/close', TenantAdminConsultationController.close);
router.get('/consultations/:id/results', TenantAdminConsultationController.getResults);
router.get('/consultations/:id/eligible-properties', TenantAdminConsultationController.getEligibleProperties);

// ==================== TIPOS DE SOLICITUD ====================
router.get('/request-types', TenantAdminRequestController.getRequestTypes);
router.get('/request-types/:id', TenantAdminRequestController.getRequestTypeById);
router.post('/request-types', TenantAdminRequestController.createRequestType);
router.put('/request-types/:id', TenantAdminRequestController.updateRequestType);
router.delete('/request-types/:id', TenantAdminRequestController.deleteRequestType);

// ==================== CONFIGURACIÓN DE MUDANZAS ====================
router.get('/move-config', TenantAdminRequestController.getMoveConfig);
router.put('/move-config', TenantAdminRequestController.updateMoveConfig);
router.get('/move-config/available-dates', TenantAdminRequestController.getAvailableMoveDates);

// ==================== GESTIÓN DE SOLICITUDES ====================
router.get('/requests/stats', TenantAdminRequestController.getStats);
router.get('/requests', TenantAdminRequestController.getAllRequests);
router.get('/requests/:id', TenantAdminRequestController.getRequestById);
router.put('/requests/:id/status', TenantAdminRequestController.updateRequestStatus);

// ==================== ÁREAS COMUNES ====================
router.get('/common-areas', TenantAdminCommonAreaController.getAreas);
router.get('/common-areas/stats', TenantAdminCommonAreaController.getStats);
router.get('/common-areas/reservations', TenantAdminCommonAreaController.getReservations);
router.get('/common-areas/reservations/today', TenantAdminCommonAreaController.getTodayReservations);
router.get('/common-areas/:id', TenantAdminCommonAreaController.getAreaDetail);
router.post('/common-areas', TenantAdminCommonAreaController.createArea);
router.put('/common-areas/:id', TenantAdminCommonAreaController.updateArea);
router.delete('/common-areas/:id', TenantAdminCommonAreaController.deleteArea);
router.post('/common-areas/reservations/:id/approve', TenantAdminCommonAreaController.approveReservation);
router.post('/common-areas/reservations/:id/reject', TenantAdminCommonAreaController.rejectReservation);

// ==================== EDIFICIOS (SOLO LECTURA) ====================
router.get('/buildings', BuildingController.listForTenantAdmin);
router.get('/buildings/:id/properties', BuildingController.getProperties);

// ==================== INMUEBLES/PROPIEDADES (SOLO LECTURA) ====================
router.get('/properties', PropertyController.listForTenantAdmin);
router.get('/properties/:id', PropertyController.getForTenantAdmin);
router.get('/properties/:id/owners', PropertyController.getPropertyOwners);
router.get('/properties/:id/audit', TenantAdminController.getPropertyAudit); // Auditoría completa
router.get('/properties/:id/billing-invoices', TenantAdminBillingController.getPropertyBillingInvoices);

// ==================== PROPIETARIOS (LECTURA Y EDICIÓN) ====================
router.get('/owners', TenantAdminOwnerController.list);
router.get('/owners/:id', TenantAdminOwnerController.getById);
router.put('/owners/:id', TenantAdminOwnerController.update);
router.get('/owners/:id/properties', TenantAdminOwnerController.getProperties);
router.put('/owners/:userId/properties/:propertyId', TenantAdminOwnerController.updatePropertyLink);
router.post('/owners/:id/password', TenantAdminOwnerController.setPassword); // Establecer contraseña

// ==================== USUARIOS DE SEGURIDAD ====================
const SecurityUserController = require('../controllers/SecurityUserController');
router.get('/security-users', SecurityUserController.list);
router.post('/security-users', SecurityUserController.create);
router.put('/security-users/:id', SecurityUserController.update);
router.post('/security-users/:id/password', SecurityUserController.setPassword);
router.delete('/security-users/:id', SecurityUserController.deactivate);

// ==================== FACTURACIÓN CONDOMINIO360 (SAAS) ====================
const TenantAdminSaaSBillingController = require('../controllers/TenantAdminSaaSBillingController');
router.get('/saas-invoices', TenantAdminSaaSBillingController.list);
router.get('/saas-invoices/summary', TenantAdminSaaSBillingController.summary);
router.get('/saas-invoices/payment-config', TenantAdminSaaSBillingController.getPaymentConfig);
router.get('/saas-invoices/banks', TenantAdminSaaSBillingController.getBanks);
router.get('/saas-invoices/:id', TenantAdminSaaSBillingController.getById);
router.post('/saas-invoices/:id/report-payment', (req, res, next) => {
    uploadPaymentReceipt.single('receipt')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Error al subir archivo' });
        next();
    });
}, TenantAdminSaaSBillingController.reportPayment);

// ==================== BALANCE FINANCIERO ====================
router.get('/balance/financial-summary', TenantAdminBalanceController.getFinancialSummary);

// ==================== FACTURACIÓN ====================
const ExchangeRateModel = require('../models/ExchangeRateModel');

// Configuración
router.get('/billing/config', TenantAdminBillingController.getConfig);
router.put('/billing/config', TenantAdminBillingController.updateConfig);

// Tasa de cambio BCV
router.get('/billing/exchange-rate', async (req, res) => {
    try {
        const latestRate = await ExchangeRateModel.getLatest();
        if (!latestRate) {
            return res.status(404).json({ success: false, error: 'No hay tasa disponible' });
        }
        res.json({
            success: true,
            data: {
                rate: latestRate.usd_rate,
                date: latestRate.rate_date
            }
        });
    } catch (error) {
        console.error('Error getting exchange rate:', error);
        res.status(500).json({ success: false, error: 'Error al obtener tasa' });
    }
});

// Forzar actualización de tasa BCV (solo para admin)
router.post('/billing/exchange-rate/update', async (req, res) => {
    try {
        const BCVService = require('../services/BCVService');
        const result = await BCVService.fetchAndSave();
        
        if (result) {
            res.json({
                success: true,
                message: 'Tasa actualizada correctamente',
                data: {
                    rate: result.usd,
                    date: result.date   // Fecha efectiva de la API (a la que corresponde la tasa)
                }
            });
        } else {
            res.status(400).json({ success: false, error: 'No se pudo obtener tasa de la API BCV' });
        }
    } catch (error) {
        console.error('Error updating exchange rate:', error);
        res.status(500).json({ success: false, error: 'Error al actualizar tasa' });
    }
});

// EMERGENCIA: Forzar eliminación de preliminar FINALIZED (solo para testing/debug)
router.post('/billing/preliminaries/:id/force-delete', async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        const { sql, connectDB } = require('../config/database');
        const pool = await connectDB();
        
        // Primero verificar que existe
        const checkResult = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT name, status FROM BillingPreliminaries WHERE id = @id AND tenant_id = @tenant_id');
        
        if (checkResult.recordset.length === 0) {
            return res.status(404).json({ success: false, error: 'Preliminar no encontrado' });
        }
        
        const preliminaryName = checkResult.recordset[0].name;
        
        // Eliminar items del preliminar
        await pool.request()
            .input('preliminary_id', sql.UniqueIdentifier, id)
            .query('DELETE FROM BillingPreliminaryItems WHERE preliminary_id = @preliminary_id');
        
        // Eliminar items de recibos asociados
        await pool.request()
            .input('preliminary_id', sql.UniqueIdentifier, id)
            .query(`DELETE FROM BillingInvoiceItems 
                    WHERE invoice_id IN (SELECT id FROM BillingInvoices WHERE preliminary_id = @preliminary_id)`);
        
        // Eliminar recibos asociados
        await pool.request()
            .input('preliminary_id', sql.UniqueIdentifier, id)
            .query('DELETE FROM BillingInvoices WHERE preliminary_id = @preliminary_id');
        
        // Eliminar el preliminar
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('DELETE FROM BillingPreliminaries WHERE id = @id AND tenant_id = @tenant_id');
        
        res.json({ 
            success: true, 
            message: `Preliminar "${preliminaryName}" eliminado forzosamente` 
        });
    } catch (error) {
        console.error('Force delete error:', error);
        res.status(500).json({ success: false, error: 'Error al eliminar preliminar' });
    }
});

// Proveedores
router.get('/billing/vendors', TenantAdminBillingController.listVendors);
router.post('/billing/vendors', TenantAdminBillingController.createVendor);
router.put('/billing/vendors/:id', TenantAdminBillingController.updateVendor);
router.delete('/billing/vendors/:id', TenantAdminBillingController.deleteVendor);

// Contratos
router.get('/billing/contracts', TenantAdminBillingController.listContracts);
router.post('/billing/contracts', TenantAdminBillingController.createContract);
router.put('/billing/contracts/:id', TenantAdminBillingController.updateContract);
router.delete('/billing/contracts/:id', TenantAdminBillingController.deleteContract);

// Preliminares
router.get('/billing/preliminaries', TenantAdminBillingController.listPreliminaries);
router.get('/billing/preliminaries/:id', TenantAdminBillingController.getPreliminary);
router.post('/billing/preliminaries', TenantAdminBillingController.createPreliminary);
router.delete('/billing/preliminaries/:id', TenantAdminBillingController.deletePreliminary);
router.post('/billing/preliminaries/:id/generate', TenantAdminBillingController.generateInvoices);
router.post('/billing/preliminaries/:id/generate-property/:propertyId', TenantAdminBillingController.generateInvoiceForProperty);
router.post('/billing/preliminaries/:id/send', TenantAdminBillingController.sendInvoices);

// Recibos
router.get('/billing/invoices', TenantAdminBillingController.listInvoices);
router.get('/billing/invoices/:id', TenantAdminBillingController.getInvoice);
router.post('/billing/invoices/:id/payment', TenantAdminBillingController.registerPayment);
router.post('/billing/invoices/:id/confirm-payment', TenantAdminBillingController.confirmPayment);
router.post('/billing/invoices/:id/reject-payment', TenantAdminBillingController.rejectPayment);

// Plantillas
router.get('/billing/templates', TenantAdminBillingController.listTemplates);
router.post('/billing/templates', TenantAdminBillingController.createTemplate);

// Estadísticas
router.get('/billing/stats', TenantAdminBillingController.getStats);

// Exportación
router.get('/billing/export/:preliminary_id', TenantAdminBillingController.exportPreliminary);

module.exports = router;
