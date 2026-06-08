require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Importar configuración de BD
const { connectDB } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Detrás de Nginx Proxy Manager / reverse proxy: Express debe confiar en X-Forwarded-* para req.ip.
 * TRUST_PROXY=true → confiar en toda la cadena (típico: un solo proxy delante).
 * TRUST_PROXY=N → confiar en N saltos (número entero).
 * Sin variable: 1 (un proxy).
 */
function configureTrustProxy() {
    const raw = (process.env.TRUST_PROXY || '').trim().toLowerCase();
    if (raw === 'true' || raw === 'yes' || raw === 'on') {
        app.set('trust proxy', true);
        return;
    }
    const n = parseInt(raw, 10);
    if (raw !== '' && Number.isFinite(n) && n >= 0) {
        app.set('trust proxy', n);
        return;
    }
    app.set('trust proxy', 1);
}
configureTrustProxy();

function normalizeClientIp(ip) {
    if (!ip || ip === '::1') return ip || '-';
    if (typeof ip === 'string' && ip.startsWith('::ffff:')) return ip.slice(7);
    return ip;
}

morgan.token('remote-addr', (req) => {
    const ip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress;
    return normalizeClientIp(ip);
});

// Base URL global para vistas (assets, correos, enlaces)
const BASE_URL = process.env.APP_URL || `http://localhost:${PORT}`;
app.locals.baseUrl = BASE_URL;

// Conectar a BD al inicio
connectDB();

const expressLayouts = require('express-ejs-layouts');

// Configuración de Vistas (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares Globales
app.use(helmet({
    contentSecurityPolicy: false // Desactivar para desarrollo y uso de scripts inline si es necesario
}));
app.use(cors());
// "dev" no incluye IP; mismo estilo + cliente (detrás de Nginx Proxy Manager / trust proxy)
const morganFormat =
    process.env.MORGAN_FORMAT ||
    ':remote-addr :method :url :status :response-time ms - :res[content-length]';
app.use(morgan(morganFormat));
app.use(express.json({
    verify: (req, res, buf) => {
        if (req.originalUrl && req.originalUrl.startsWith('/api/webhooks/')) {
            req.rawBody = buf.toString('utf8');
        }
    }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Middlewares de Aplicación
const tenantMiddleware = require('./middleware/tenant');

// Rutas API
const authRoutes = require('./routes/auth');
const ownerRoutes = require('./routes/owner');
const propertyRoutes = require('./routes/properties');
const tenantRoutes = require('./routes/tenants');
const requestRoutes = require('./routes/requests');
const visitorRoutes = require('./routes/visitors');
const securityRoutes = require('./routes/security');
const nfcAdminRoutes = require('./routes/nfc');
const ownerCommuniqueRoutes = require('./routes/owner-communiques');
const tenantAdminCommuniqueRoutes = require('./routes/tenant-admin-communiques');

// Tenant Middleware
app.use(tenantMiddleware);

// Rutas de Vistas (DEBEN ir antes que las API para evitar conflictos)
// Comunicados Views
app.use('/', require('./routes/communiqueViews'));

// Rutas de Vistas - Tenant Admin (sin layouts)
app.use('/tenant-admin', require('./routes/tenantAdminViews'));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/owner', ownerRoutes); // Owner Panel Routes
app.use('/api/owner/communiques', ownerCommuniqueRoutes); // Owner Communiques
app.use('/api/admin', require('./routes/admin')); // Admin Routes
app.use('/api/tenant-admin', require('./routes/tenantAdmin')); // Tenant Admin Routes
app.use('/api/tenant-admin/communiques', tenantAdminCommuniqueRoutes); // Tenant Admin Communiques
app.use('/api/properties', propertyRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/consultations', require('./routes/consultations'));
app.use('/api/security', securityRoutes);
app.use('/api/tenant-admin/nfc', nfcAdminRoutes);
app.use('/api/webhooks', require('./routes/webhooks'));

// Demo request desde landing (público)
const DemoController = require('./controllers/DemoController');
app.post('/api/demo-request', DemoController.requestDemo);

// Configurar layouts para el resto de rutas
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Rutas de Vistas con layouts
app.use('/', require('./routes/index'));

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// Rutas no definidas: respuesta controlada (sin mensaje técnico "Cannot GET") — 404 para HTML, JSON mínimo para API
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, error: 'Recurso no encontrado' });
    }
    if (req.method === 'HEAD') {
        return res.status(404).end();
    }
    if (req.method === 'GET') {
        return res.status(404).render('error-not-found', {
            title: 'Página no encontrada',
            layout: false
        });
    }
    return res.status(404).send('Not found');
});

// Importar Scheduler y Queue Service
const SchedulerService = require('./services/SchedulerService');
const CommuniqueQueueService = require('./services/CommuniqueQueueService');
const BulkOwnerWelcomeSchedulerService = require('./services/BulkOwnerWelcomeSchedulerService');
const ConsultationNotificationService = require('./services/ConsultationNotificationService');
const BillingRateUpdateService = require('./services/BillingRateUpdateService');
const EmailWorkerService = require('./services/EmailWorkerService');
const BillingReminderWorkerService = require('./services/BillingReminderWorkerService');
const InAppWhatsAppQueueService = require('./services/InAppWhatsAppQueueService');

// Iniciar Servidor
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    if (process.env.RECAPTCHA_SECRET_KEY && !(process.env.RECAPTCHA_SITE_KEY || '').trim()) {
        console.warn('⚠️  RECAPTCHA_SECRET_KEY está configurado pero RECAPTCHA_SITE_KEY no. El login requerirá token que el frontend no puede obtener.');
    }
    
    const { ensureEmailBrandAssets } = require('./utils/emailBrandAssets');
    ensureEmailBrandAssets().catch((err) => {
        console.warn('[emailBrandAssets] No se pudieron preparar logos PNG para correos:', err.message || err);
    });

    // Iniciar tareas programadas
    SchedulerService.start();
    
    // Iniciar cola de comunicados
    CommuniqueQueueService.start();

    // Envíos de bienvenida masiva programados por hora
    BulkOwnerWelcomeSchedulerService.start();
    
    // Iniciar servicio de notificaciones de consultas
    ConsultationNotificationService.start();
    
    // Iniciar servicio de actualización de tasas de facturación
    BillingRateUpdateService.start();

    // Cola bulk Mailgun + purga de logs de correo (retención EMAIL_LOG_RETENTION_DAYS)
    EmailWorkerService.start();

    BillingReminderWorkerService.start();

    // Cola WhatsApp (OpenWA): límite global 30 envíos / 2 min
    InAppWhatsAppQueueService.start();
});

module.exports = app;
