const express = require('express');
const router = express.Router();

// Tenant Admin Views - These don't use layouts
router.get('/', (req, res) => {
    res.render('tenant-admin/dashboard', {
        title: 'Panel de Administración',
        layout: false,
        tenant: { name: 'Condominio' }
    });
});

router.get('/consultations', (req, res) => {
    res.render('tenant-admin/consultations', {
        title: 'Consultas',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/communications', (req, res) => {
    res.render('tenant-admin/communications', {
        title: 'Mensajes',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/communiques', (req, res) => {
    res.render('tenant-admin/communiques', {
        title: 'Comunicados',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/common-areas', (req, res) => {
    res.render('tenant-admin/common-areas', {
        title: 'Áreas Comunes',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/buildings', (req, res) => {
    res.render('tenant-admin/buildings', {
        title: 'Edificios',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/buildings/:id/properties', (req, res) => {
    res.render('tenant-admin/building-properties', {
        title: 'Inmuebles del Edificio',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' },
        buildingId: req.params.id
    });
});

router.get('/properties', (req, res) => {
    res.render('tenant-admin/properties', {
        title: 'Inmuebles',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/properties/:id', (req, res) => {
    res.render('tenant-admin/property-detail', {
        title: 'Detalle del Inmueble',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' },
        propertyId: req.params.id
    });
});

router.get('/owners', (req, res) => {
    res.render('tenant-admin/owners', {
        title: 'Propietarios',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/requests', (req, res) => {
    res.render('tenant-admin/requests', {
        title: 'Solicitudes',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/request-types', (req, res) => {
    res.render('tenant-admin/request-types', {
        title: 'Tipos de Solicitud',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/security-users', (req, res) => {
    res.render('tenant-admin/security-users', {
        title: 'Usuarios de Vigilancia',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/nfc-cards', (req, res) => {
    res.render('tenant-admin/nfc-cards', {
        title: 'Tarjetas NFC',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' },
        activePage: 'nfc-cards'
    });
});

router.get('/billing', (req, res) => {
    res.render('tenant-admin/billing', {
        title: 'Facturación',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/saas-invoices', (req, res) => {
    res.render('tenant-admin/saas-invoices', {
        title: 'Facturación Condominio360',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/balance-financiero', (req, res) => {
    res.render('tenant-admin/balance-financiero', {
        title: 'Balance Financiero',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

router.get('/email', (req, res) => {
    res.render('tenant-admin/email', {
        title: 'Correo saliente',
        layout: false,
        tenant: req.tenant || { name: 'Condominio' }
    });
});

module.exports = router;
