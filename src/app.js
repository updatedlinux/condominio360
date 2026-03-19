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

// Trust proxy (Nginx, load balancers) - req.protocol y req.get('host') correctos
app.set('trust proxy', 1);

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
app.use(morgan('dev'));
app.use(express.json());
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

// Configurar layouts para el resto de rutas
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Rutas de Vistas con layouts
app.use('/', require('./routes/index'));

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// Importar Scheduler y Queue Service
const SchedulerService = require('./services/SchedulerService');
const CommuniqueQueueService = require('./services/CommuniqueQueueService');
const ConsultationNotificationService = require('./services/ConsultationNotificationService');
const BillingRateUpdateService = require('./services/BillingRateUpdateService');

// Iniciar Servidor
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    if (process.env.RECAPTCHA_SECRET_KEY && !(process.env.RECAPTCHA_SITE_KEY || '').trim()) {
        console.warn('⚠️  RECAPTCHA_SECRET_KEY está configurado pero RECAPTCHA_SITE_KEY no. El login requerirá token que el frontend no puede obtener.');
    }
    
    // Iniciar tareas programadas
    SchedulerService.start();
    
    // Iniciar cola de comunicados
    CommuniqueQueueService.start();
    
    // Iniciar servicio de notificaciones de consultas
    ConsultationNotificationService.start();
    
    // Iniciar servicio de actualización de tasas de facturación
    BillingRateUpdateService.start();
});

module.exports = app;
