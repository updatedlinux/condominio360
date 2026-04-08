const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.render('landing', {
        title: 'Gestión Inteligente de Condominios',
        layout: false, // Landing autocontenida con su propio diseño
        recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || ''
    });
});

/**
 * Política de privacidad (pública). URLs para proveedores de correo (p. ej. Mailgun) en mailgunUrlList.
 */
router.get('/privacy', (req, res) => {
    const raw = (process.env.APP_URL || 'https://condominio-360.com').trim().replace(/\/$/, '');
    const extra = (process.env.PUBLIC_PRIVACY_URLS || '')
        .split(',')
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean);
    const urlSet = new Set([raw, ...extra]);
    const mailgunUrlList = [...urlSet].join(', ');
    res.render('privacy-policy', {
        title: 'Política de privacidad',
        layout: false,
        appUrl: raw,
        mailgunUrlList,
        lastUpdated: '28 de marzo de 2026'
    });
});

router.get('/politica-privacidad', (req, res) => {
    res.redirect(301, '/privacy');
});

router.get('/login', (req, res) => {
    res.render('auth/login', {
        title: 'Iniciar Sesión',
        layout: 'layouts/main',
        loginPage: true,
        baseUrl: req.app.locals.baseUrl || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
        recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || ''
    });
});

router.get('/select-tenant', (req, res) => {
    res.render('auth/select-tenant', {
        title: 'Seleccionar Condominio',
        layout: 'layouts/main'
    });
});

router.get('/select-property', (req, res) => {
    res.render('auth/select-property', {
        title: 'Seleccionar Propiedad',
        layout: false
    });
});

router.get('/owner-nickname-flow', (req, res) => {
    res.render('auth/owner-nickname-flow', {
        title: 'Actualizar Datos',
        layout: false
    });
});

router.get('/auth/complete-registration', (req, res) => {
    res.render('auth/complete-registration', {
        title: 'Completar Registro',
        layout: false
    });
});

router.get('/auth/reset-password', (req, res) => {
    res.render('auth/reset-password', {
        title: 'Restablecer contraseña',
        layout: false
    });
});

// Panels
// Owner Panel Routes
router.get('/owner/dashboard', (req, res) => {
    res.render('owner/dashboard', {
        title: 'Panel de Propietario',
        layout: false
    });
});

router.get('/owner/requests', (req, res) => {
    res.render('owner/requests', {
        title: 'Mis Solicitudes',
        layout: false
    });
});

router.get('/owner/requests/new', (req, res) => {
    res.render('owner/request-form', {
        title: 'Nueva Solicitud',
        layout: false
    });
});

// Ruta para enlaces de correo "Ver Solicitud" - redirige al login (sin sesión en nueva pestaña)
router.get('/owner/requests/:id', (req, res) => {
    const { id } = req.params;
    res.redirect(`/login?redirect=${encodeURIComponent(`/owner/requests?id=${id}`)}`);
});

router.get('/owner/consultations', (req, res) => {
    res.render('owner/consultations', {
        title: 'Consultas',
        layout: false
    });
});

router.get('/owner/visitors', (req, res) => {
    res.render('owner/visitors', {
        title: 'Visitas',
        layout: false
    });
});

router.get('/owner/visitors/history', (req, res) => {
    res.render('owner/visitors-history', {
        title: 'Historial de Visitas',
        layout: false
    });
});

router.get('/owner/visitors/new', (req, res) => {
    res.render('owner/visitor-form', {
        title: 'Anunciar Visita',
        layout: false
    });
});

router.get('/owner/delivery/new', (req, res) => {
    res.render('owner/delivery-form', {
        title: 'Anunciar Delivery',
        layout: false
    });
});

router.get('/owner/invoices', (req, res) => {
    res.render('owner/billing', {
        title: 'Mis Recibos',
        layout: false
    });
});

router.get('/owner/communiques', (req, res) => {
    res.render('owner/communiques', {
        title: 'Comunicados',
        layout: false
    });
});

router.get('/owner/common-areas', (req, res) => {
    res.render('owner/common-areas', {
        title: 'Reservar Área Común',
        layout: false
    });
});

router.get('/owner/vehicle-access', (req, res) => {
    res.render('owner/vehicle-access', {
        title: 'Accesos Vehiculares',
        layout: false
    });
});

router.get('/owner/profile', (req, res) => {
    res.render('owner/profile', {
        title: 'Mi Perfil',
        layout: false
    });
});

// Legacy route (redirect)
router.get('/dashboard', (req, res) => {
    res.redirect('/owner/dashboard');
});

router.get('/admin', (req, res) => {
    res.render('admin/dashboard', {
        title: 'Super Admin',
        layout: false
    });
});

const AdminController = require('../controllers/AdminController');

router.get('/admin/impersonate-tenant/:id', AdminController.renderImpersonateTenant);
router.get('/admin/tenants/:id', AdminController.renderTenantDetail);

router.get('/admin/tenants/:id/properties', AdminController.renderTenantProperties);

router.get('/admin/tenants/:id/owners', AdminController.renderTenantOwners);

// Security Panel Routes
router.get('/security', (req, res) => {
    res.render('security/dashboard', {
        title: 'Panel de Seguridad',
        layout: false
    });
});

// Legacy security route (redirect)
router.get('/security/dashboard', (req, res) => {
    res.redirect('/security');
});

module.exports = router;
