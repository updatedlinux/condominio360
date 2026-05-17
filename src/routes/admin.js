const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/AdminController');
const AdminDataUpdateController = require('../controllers/AdminDataUpdateController');
const AdminSaaSBillingController = require('../controllers/AdminSaaSBillingController');
const AdminBankController = require('../controllers/AdminBankController');
const { conditionalSaaSFiscalUpload } = require('../middleware/uploadSaaSFiscalInvoice');
const AdminBalanceController = require('../controllers/AdminBalanceController');
const BuildingController = require('../controllers/BuildingController');
const PropertyController = require('../controllers/PropertyController');
const EmailAdminController = require('../controllers/EmailAdminController');
const WhatsAppAdminController = require('../controllers/WhatsAppAdminController');

// Middleware to ensure user is SuperAdmin
const { authenticate } = require('../middleware/auth');

const verifySuperAdmin = (req, res, next) => {
    if (!req.user || !req.user.isSuperAdmin) {
        return res.status(403).json({ error: 'Access denied. Super Admin only.' });
    }
    next();
};

// Apply auth middleware to all admin routes
router.use(authenticate);
router.use(verifySuperAdmin);

// ==================== STATS & DASHBOARD ====================
router.get('/stats', AdminController.getStats);
router.get('/activity', AdminController.getActivity);
router.get('/audit-logs', AdminController.getAuditLogs);

// Tasas BCV (referencia en dashboard; fuente ve.dolarapi.com vía job)
router.get('/bcv-settings', AdminController.getBcvSettings);

// ==================== SUPERADMINS ====================
router.get('/superadmins', AdminController.getSuperAdmins);
router.post('/superadmins', AdminController.createSuperAdmin);
router.delete('/superadmins/:id', AdminController.deleteSuperAdmin);

// ==================== BÚSQUEDA PROPIETARIOS (SuperAdmin) ====================
router.get('/owners/search', AdminController.searchOwners);

// ==================== ACTUALIZACIÓN DE DATOS (Solicitudes de propietarios) ====================
router.get('/data-update-requests', AdminDataUpdateController.list);
router.get('/data-update-requests/export', AdminDataUpdateController.exportExcel);
router.get('/data-update-requests/:id', AdminDataUpdateController.getById);
router.post('/data-update-requests/:id/approve', AdminDataUpdateController.approve);
router.post('/data-update-requests/:id/reject', AdminDataUpdateController.reject);

// ==================== TENANTS (CONDOMINIOS) ====================
router.get('/tenants', AdminController.getAllTenants);
router.get('/tenants/:id', AdminController.getTenantById);
router.post('/tenants', AdminController.createTenant);
router.put('/tenants/:id', AdminController.updateTenant);
router.get('/tenants/:id/whatsapp-messaging', AdminController.getTenantWhatsAppMessaging);
router.put('/tenants/:id/whatsapp-messaging', AdminController.updateTenantWhatsAppMessaging);
router.delete('/tenants/:id', AdminController.deleteTenant);
router.post('/tenants/:id/toggle-status', AdminController.toggleTenantStatus);
router.post('/tenants/:id/billing-mode', AdminController.updateBillingMode);
router.post('/tenants/:id/admins', AdminController.createTenantAdmin);

// ==================== ONBOARDING WIZARD ====================
router.post('/onboarding', AdminController.onboardTenant);

// ==================== BUILDINGS (EDIFICIOS) ====================
router.get('/tenants/:id/buildings', AdminController.getBuildings);
router.post('/tenants/:id/buildings', AdminController.createBuilding);
router.put('/buildings/:id', AdminController.updateBuilding);
router.delete('/buildings/:id', AdminController.deleteBuilding);

// ==================== PROPERTIES (INMUEBLES) ====================
router.get('/tenants/:id/properties/export', AdminController.exportPropertiesExcel);
router.get('/tenants/:id/properties', AdminController.getProperties);
router.post('/tenants/:id/properties', AdminController.createProperty);
router.put('/properties/:id', AdminController.updateProperty);
router.delete('/properties/:id', AdminController.deleteProperty);

// ==================== OWNERS (PROPIETARIOS) ====================
router.get('/tenants/:id/owners/export', AdminController.exportOwnersExcel);
router.get('/tenants/:id/owners', AdminController.getOwners);
router.post('/tenants/:id/owners/bulk', AdminController.createOwnersBulk);
router.post('/tenants/:id/owners/bulk/send-welcome-emails', AdminController.sendBulkWelcomeEmails);
router.post('/tenants/:id/owners', AdminController.createOwner);
router.delete('/tenants/:id/owners/:ownerId', AdminController.deleteOwner);
router.put('/owners/:id', AdminController.updateOwner);
router.post('/owners/:id/password', AdminController.setOwnerPassword);
router.post('/owners/:id/send-password-reset', AdminController.sendOwnerPasswordResetEmail);

// ==================== FACTURACIÓN SAAS (Condominio360 → Condominios) ====================
router.get('/saas-billing/rate', AdminSaaSBillingController.getRate);
router.get('/saas-billing/payment-config', AdminSaaSBillingController.getPaymentConfig);
router.put('/saas-billing/payment-config', AdminSaaSBillingController.savePaymentConfig);
router.get('/saas-billing/invoices', AdminSaaSBillingController.listInvoices);
router.get('/saas-billing/invoices/:id', AdminSaaSBillingController.getInvoice);
router.post('/saas-billing/invoices', conditionalSaaSFiscalUpload, AdminSaaSBillingController.createInvoice);
router.patch('/saas-billing/invoices/:id', AdminSaaSBillingController.updateInvoice);
router.post('/saas-billing/invoices/:id/recalculate', AdminSaaSBillingController.recalculateInvoice);
router.post('/saas-billing/invoices/:id/confirm-payment', AdminSaaSBillingController.confirmPayment);
router.post('/saas-billing/invoices/:id/reject-payment', AdminSaaSBillingController.rejectPayment);
router.post('/saas-billing/invoices/:id/adjust-paid-rate', AdminSaaSBillingController.adjustPaidRate);
router.patch('/saas-billing/invoices/:id/paid-details', AdminSaaSBillingController.updatePaidDetails);
router.get('/saas-billing/invoices/:id/payment-pdf', AdminSaaSBillingController.downloadPaidInvoicePdf);
router.delete('/saas-billing/invoices/:id', AdminSaaSBillingController.deleteInvoice);
router.get('/saas-billing/tenants-available', AdminSaaSBillingController.getTenantsForBilling);

// ==================== CONCILIACIÓN BANCARIA (catálogo de bancos) ====================
router.get('/reconciliation/banks', AdminBankController.list);
router.patch('/reconciliation/banks/:id/active', AdminBankController.toggleActive);
router.patch('/reconciliation/banks/:id/notes', AdminBankController.updateNotes);

// ==================== BALANCE FINANCIERO ====================
router.get('/balance/exchange-rates', AdminBalanceController.getExchangeRates);
router.get('/balance/financial-summary', AdminBalanceController.getFinancialSummary);

// ==================== CORREO (Mailgun / jobs) ====================
router.get('/outgoing-queues-summary', EmailAdminController.getOutgoingQueuesSummary);
router.get('/whatsapp-deliveries', WhatsAppAdminController.listDeliveries);
router.get('/email-metrics', EmailAdminController.getMetrics);
router.get('/email-jobs', EmailAdminController.listJobs);
router.get('/email-jobs/:id', EmailAdminController.getJob);
router.get('/email-recipients/:recipientId/logs', EmailAdminController.getRecipientLogs);
router.post('/email-recipients/:recipientId/retry', EmailAdminController.retryRecipient);

module.exports = router;
