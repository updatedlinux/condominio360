const express = require('express');
const router = express.Router();
const TenantAdminBillingController = require('../controllers/TenantAdminBillingController');
const { conditionalPreliminaryUpload } = require('../middleware/uploadBillingPreliminaryItems');
const { authenticate, requireTenantAdmin } = require('../middleware/auth');

// Todas las rutas requieren autenticación de TenantAdmin
router.use(authenticate);
router.use(requireTenantAdmin);

// Configuración
router.get('/config', TenantAdminBillingController.getConfig);
router.put('/config', TenantAdminBillingController.updateConfig);

// Proveedores
router.get('/vendors', TenantAdminBillingController.listVendors);
router.post('/vendors', TenantAdminBillingController.createVendor);
router.put('/vendors/:id', TenantAdminBillingController.updateVendor);
router.delete('/vendors/:id', TenantAdminBillingController.deleteVendor);

// Contratos
router.get('/contracts', TenantAdminBillingController.listContracts);
router.post('/contracts', TenantAdminBillingController.createContract);
router.put('/contracts/:id', TenantAdminBillingController.updateContract);
router.delete('/contracts/:id', TenantAdminBillingController.deleteContract);

// Preliminares
router.get('/preliminaries', TenantAdminBillingController.listPreliminaries);
router.get('/preliminaries/:id', TenantAdminBillingController.getPreliminary);
router.post('/preliminaries', conditionalPreliminaryUpload, TenantAdminBillingController.createPreliminary);
router.post('/preliminaries/:id/generate', TenantAdminBillingController.generateInvoices);
router.post('/preliminaries/:id/send', TenantAdminBillingController.sendInvoices);

// Recibos
router.get('/invoices', TenantAdminBillingController.listInvoices);
router.get('/invoices/:id', TenantAdminBillingController.getInvoice);
router.post('/invoices/:id/payment', TenantAdminBillingController.registerPayment);

// Plantillas
router.get('/templates', TenantAdminBillingController.listTemplates);
router.post('/templates', TenantAdminBillingController.createTemplate);

// Estadísticas
router.get('/stats', TenantAdminBillingController.getStats);

// Exportación
router.get('/export/:preliminary_id', TenantAdminBillingController.exportPreliminary);

module.exports = router;
