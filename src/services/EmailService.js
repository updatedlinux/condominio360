const nodemailer = require('nodemailer');

/**
 * Servicio de Email para envío de notificaciones e invitaciones
 */
class EmailService {
    constructor() {
        this.transporter = null;
        this.isConfigured = false;
        this.init();
    }

    /**
     * Inicializar transporter con configuración de SMTP
     */
    init() {
        // Verificar si hay configuración SMTP
        if (!process.env.SMTP_HOST) {
            console.log('⚠️  SMTP no configurado. Emails se mostrarán en consola (modo desarrollo).');
            return;
        }

        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            tls: {
                rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false'
            }
        });

        this.isConfigured = true;
    }

    /**
     * Verificar conexión SMTP
     */
    async verify() {
        if (!this.isConfigured) {
            return false;
        }
        
        try {
            await this.transporter.verify();
            return true;
        } catch (error) {
            console.error('Error verificando SMTP:', error);
            return false;
        }
    }

    /**
     * Enviar email genérico
     */
    async send(to, subject, html, text = null) {
        const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@condominio360.com';
        
        const mailOptions = {
            from: `"Condominio360" <${from}>`,
            to,
            subject,
            html,
            text: text || this._htmlToText(html)
        };

        // Modo desarrollo: mostrar en consola
        if (!this.isConfigured) {
            console.log('\n📧 =============== EMAIL (MODO DESARROLLO) ===============');
            console.log('Para:', to);
            console.log('Asunto:', subject);
            console.log('Contenido HTML:', html.substring(0, 500) + (html.length > 500 ? '...' : ''));
            console.log('=====================================================\n');
            return { messageId: 'dev-mode', preview: true };
        }

        try {
            const result = await this.transporter.sendMail(mailOptions);
            console.log(`✅ Email enviado a ${to}: ${result.messageId}`);
            return result;
        } catch (error) {
            console.error(`❌ Error enviando email a ${to}:`, error);
            throw error;
        }
    }

    /**
     * Enviar invitación a propietario nuevo (con link para confirmar registro y asignar contraseña)
     * @param {string} propertyLabel - Ej: "Edificio A, Apt 101" o "Casa 5"
     */
    async sendOwnerInvitation(email, firstName, tenantName, invitationLink, propertyLabel = null) {
        const subject = `Invitación a Condominio360 - ${tenantName}`;
        const propertyBlock = propertyLabel
            ? `<p>Te han asignado el inmueble: <strong>${propertyLabel}</strong></p>`
            : '';
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invitación a Condominio360</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .property-box { background: #fff7ed; border-left: 4px solid #f97316; padding: 12px 16px; margin: 16px 0; border-radius: 4px; }
        .button { display: inline-block; background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: white; padding: 14px 32px; 
                  text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: 600; }
        .footer { margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏢 Condominio360</h1>
            <p>Gestión Inteligente de Condominios</p>
        </div>
        <div class="content">
            <h2>Hola ${firstName},</h2>
            <p>Has sido registrado como propietario en <strong>${tenantName}</strong>.</p>
            ${propertyBlock}
            <p>Para completar tu registro y definir tu contraseña de acceso, haz clic en el siguiente botón:</p>
            <center>
                <a href="${invitationLink}" class="button">Completar Registro</a>
            </center>
            <p>O copia y pega este enlace en tu navegador:</p>
            <p style="word-break: break-all; background: #e5e7eb; padding: 10px; border-radius: 4px;">
                ${invitationLink}
            </p>
            <p><strong>Nota:</strong> Este enlace expirará en 7 días por seguridad.</p>
            <p>Si no esperabas esta invitación, puedes ignorar este correo.</p>
        </div>
        <div class="footer">
            <p>© 2026 Condominio360. Todos los derechos reservados.</p>
        </div>
    </div>
</body>
</html>`;

        return await this.send(email, subject, html);
    }

    /**
     * Notificar a propietario existente que fue agregado a otro condominio (sin link de confirmación)
     * @param {string} propertyLabel - Ej: "Edificio A, Apt 101"
     */
    async sendOwnerAddedToCondominio(email, firstName, tenantName, propertyLabel = null, loginUrl = '/login') {
        const subject = `Has sido agregado a ${tenantName} - Condominio360`;
        const propertyBlock = propertyLabel
            ? `<p>Inmueble asignado: <strong>${propertyLabel}</strong></p>`
            : '';
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agregado a Condominio360</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); color: white; padding: 14px 32px; 
                  text-decoration: none; border-radius: 8px; margin: 20px 0; font-weight: 600; }
        .footer { margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏢 Condominio360</h1>
            <p>Gestión Inteligente de Condominios</p>
        </div>
        <div class="content">
            <h2>Hola ${firstName},</h2>
            <p>Te informamos que has sido agregado como propietario a <strong>${tenantName}</strong>.</p>
            ${propertyBlock}
            <p>Ya perteneces a Condominio360. Puedes acceder con tu correo y contraseña actuales.</p>
            <center>
                <a href="${loginUrl}" class="button">Ir a Iniciar Sesión</a>
            </center>
            <p>Si tienes dudas, contacta a la administración de tu condominio.</p>
        </div>
        <div class="footer">
            <p>© 2026 Condominio360. Todos los derechos reservados.</p>
        </div>
    </div>
</body>
</html>`;

        return await this.send(email, subject, html);
    }

    /**
     * Enviar bienvenida y credenciales a Admin de Junta (onboarding SuperAdmin)
     * @param {string} email
     * @param {Object} opts - { displayName, tenantName, email, password, loginUrl }
     */
    async sendWelcomeAdmin(email, opts = {}) {
        const { displayName, tenantName, password, loginUrl } = opts;
        return this.sendAdminCredentials(
            email,
            displayName || opts.display_name || 'Admin',
            tenantName || opts.tenantName || 'Condominio',
            loginUrl || `${process.env.APP_URL || 'http://localhost:3000'}/login`,
            password || opts.password
        );
    }

    /**
     * Enviar credenciales a Admin de Junta
     */
    async sendAdminCredentials(email, firstName, tenantName, loginLink, tempPassword) {
        const subject = `Credenciales de Acceso - Panel de Junta ${tenantName}`;
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Credenciales de Acceso</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #059669; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .credentials { background: #ecfdf5; border: 2px solid #059669; padding: 20px; 
                       border-radius: 8px; margin: 20px 0; }
        .button { display: inline-block; background: #059669; color: white; padding: 12px 30px; 
                  text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏢 Condominio360</h1>
            <p>Panel de Administración de Junta</p>
        </div>
        <div class="content">
            <h2>Hola ${firstName},</h2>
            <p>Se ha creado tu cuenta de administrador para <strong>${tenantName}</strong>.</p>
            
            <div class="credentials">
                <h3>🔐 Tus Credenciales</h3>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Contraseña temporal:</strong> ${tempPassword}</p>
            </div>

            <div class="warning">
                <strong>⚠️ Importante:</strong> Por seguridad, debes cambiar tu contraseña 
                en tu primer inicio de sesión.
            </div>

            <center>
                <a href="${loginLink}" class="button">Acceder al Panel</a>
            </center>

            <p>O copia este enlace:</p>
            <p style="word-break: break-all; background: #e5e7eb; padding: 10px; border-radius: 4px;">
                ${loginLink}
            </p>
        </div>
    </div>
</body>
</html>`;

        return await this.send(email, subject, html);
    }

    /**
     * Enviar email de recuperación de contraseña
     */
    async sendPasswordReset(email, firstName, resetLink) {
        const subject = 'Recuperación de Contraseña - Condominio360';
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Recuperación de Contraseña</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc2626; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #dc2626; color: white; padding: 12px 30px; 
                  text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .warning { background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Recuperación de Contraseña</h1>
        </div>
        <div class="content">
            <h2>Hola ${firstName},</h2>
            <p>Recibimos una solicitud para restablecer tu contraseña en Condominio360.</p>
            
            <center>
                <a href="${resetLink}" class="button">Restablecer Contraseña</a>
            </center>

            <div class="warning">
                <strong>⚠️ Este enlace expira en 1 hora.</strong><br>
                Si no solicitaste este cambio, puedes ignorar este correo.
            </div>

            <p>O copia este enlace:</p>
            <p style="word-break: break-all; background: #e5e7eb; padding: 10px; border-radius: 4px;">
                ${resetLink}
            </p>
        </div>
    </div>
</body>
</html>`;

        return await this.send(email, subject, html);
    }

    /**
     * Enviar notificación de cambio de contraseña
     */
    async sendPasswordChanged(email, firstName) {
        const subject = 'Contraseña Actualizada - Condominio360';
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Contraseña Actualizada</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2563eb; color: white; padding: 30px; text-align: center; }
        .content { background: #f9fafb; padding: 30px; }
        .success { background: #d1fae5; border: 2px solid #059669; padding: 20px; 
                   border-radius: 8px; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ Contraseña Actualizada</h1>
        </div>
        <div class="content">
            <h2>Hola ${firstName},</h2>
            <div class="success">
                <p>Tu contraseña ha sido actualizada exitosamente.</p>
                <p>Si no realizaste este cambio, contacta inmediatamente al administrador.</p>
            </div>
        </div>
    </div>
</body>
</html>`;

        return await this.send(email, subject, html);
    }

    /**
     * Formatear fecha de reserva para emails (evita Invalid Date con ISO)
     */
    _formatReservationDate(val) {
        if (!val) return '--';
        const s = typeof val === 'string' ? val.split('T')[0] : (val instanceof Date ? val.toISOString().split('T')[0] : String(val).split('T')[0]);
        if (!s) return '--';
        try {
            return new Date(s + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        } catch (e) {
            return s;
        }
    }

    /**
     * Formatear hora (HH:mm) desde TIME de SQL o ISO
     */
    _formatReservationTime(t) {
        if (!t) return '';
        const s = String(t);
        const m = s.match(/T(\d{2}):(\d{2})/) || s.match(/(\d{1,2}):(\d{0,2})/);
        return m ? (m[1] || '08').padStart(2, '0') + ':' + (m[2] || '00').padStart(2, '0') : s;
    }

    /**
     * Template base para emails - logo Condominio360, colores optimizados para legibilidad
     */
    _generateEmailTemplate(content, options = {}) {
        const { title, subtitle, color = '#ea580c' } = options;
        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        const logoUrl = `${baseUrl}/assets/images/isotipo-naranja.svg`;

        return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: 'Segoe UI', 'Roboto', Arial, sans-serif;
            line-height: 1.7;
            color: #1a1a1a;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .email-container {
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.06);
            overflow: hidden;
        }
        .header {
            background: #ea580c;
            padding: 28px 24px;
            text-align: center;
        }
        .header-logo {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            margin-bottom: 8px;
        }
        .header-logo img {
            height: 48px;
            width: auto;
            display: block;
        }
        .header-logo span {
            color: #fff;
            font-size: 22px;
            font-weight: 700;
            letter-spacing: -0.5px;
        }
        .header p {
            margin: 0;
            color: #fff;
            font-size: 15px;
            font-weight: 400;
        }
        .content {
            padding: 32px 28px;
        }
        .content h2 {
            color: #1a1a1a;
            font-size: 18px;
            margin-bottom: 16px;
            font-weight: 600;
        }
        .content p {
            margin-bottom: 16px;
            color: #374151;
            font-size: 15px;
        }
        .details-box {
            background-color: #fef7ed;
            border-left: 4px solid ${color};
            padding: 18px 20px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }
        .details-box h3 {
            margin: 0 0 12px;
            color: #1a1a1a;
            font-size: 16px;
            font-weight: 600;
        }
        .details-box p {
            margin: 8px 0;
            font-size: 15px;
            color: #374151;
        }
        .status-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .status-open { background: #fef3c7; color: #92400e; }
        .status-in_progress { background: #dbeafe; color: #1e40af; }
        .status-resolved { background: #d1fae5; color: #065f46; }
        .status-closed { background: #f3f4f6; color: #4b5563; }
        .cta-button {
            display: inline-block;
            background: #ea580c;
            color: #fff !important;
            padding: 14px 32px;
            text-decoration: none;
            border-radius: 8px;
            margin: 20px 0;
            font-weight: 600;
            font-size: 15px;
        }
        .admin-response {
            background: #f0fdf4;
            border: 1px solid #86efac;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .admin-response h4 {
            margin: 0 0 10px;
            color: #166534;
            font-size: 14px;
            font-weight: 600;
        }
        .admin-response p {
            margin: 0;
            color: #1a1a1a;
            font-style: italic;
        }
        .footer {
            background-color: #1e293b;
            color: #e2e8f0;
            padding: 24px;
            text-align: center;
            font-size: 14px;
        }
        .footer strong {
            display: block;
            margin-bottom: 6px;
            color: #fff;
            font-weight: 600;
        }
        .footer p {
            margin: 0;
            color: #cbd5e1;
            line-height: 1.5;
        }
        .date-info {
            color: #64748b;
            font-size: 13px;
            margin-top: 20px;
            text-align: center;
        }
        .divider {
            border-top: 1px solid #e5e7eb;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <div class="header-logo">
                <img src="${logoUrl}" alt="Condominio360" />
                <span>Condominio360</span>
            </div>
            ${subtitle ? `<p>${subtitle}</p>` : ''}
        </div>
        
        <div class="content">
            ${content}
        </div>
        
        <div class="footer">
            <strong>Junta de Condominio</strong>
            <p>Este es un mensaje automático del sistema.<br>Por favor, no responda a este correo.</p>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Notificar al propietario que su solicitud fue creada
     */
    async sendRequestCreatedNotification(request, requestType, ownerEmail, ownerName) {
        const statusLabels = {
            'OPEN': 'Abierta',
            'IN_PROGRESS': 'En Proceso',
            'RESOLVED': 'Resuelta',
            'CLOSED': 'Cerrada'
        };
        
        const statusClass = request.status.toLowerCase();
        
        const content = `
            <h2>Hola ${ownerName},</h2>
            <p>Tu solicitud ha sido registrada exitosamente en nuestro sistema.</p>
            
            <div class="details-box">
                <h3>${requestType.name}</h3>
                <p><strong>Estado:</strong> <span class="status-badge status-${statusClass}">${statusLabels[request.status]}</span></p>
                <p><strong>Fecha:</strong> ${new Date(request.created_at).toLocaleDateString('es-ES', { 
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
                })}</p>
            </div>
            
            <p>La Junta de Condominio revisará tu solicitud y te notificará cuando haya actualizaciones.</p>
            
            <div style="text-align: center;">
                <a href="${process.env.APP_URL || 'http://localhost:3000'}/owner/requests/${request.id}" class="cta-button">
                    Ver Solicitud
                </a>
            </div>
        `;
        
        const html = this._generateEmailTemplate(content, {
            title: 'Solicitud Registrada',
            subtitle: 'Confirmación de solicitud'
        });
        
        const subject = `Solicitud Registrada: ${requestType.name}`;
        await this.send(ownerEmail, subject, html);
    }

    /**
     * Notificar nueva solicitud a la junta (admins)
     */
    async notifyNewRequest(request, requestType, tenantName, ownerName) {
        // Obtener emails de admins del tenant
        const { connectDB, sql } = require('../config/database');
        const pool = await connectDB();
        
        const result = await pool.request()
            .input('tenantId', sql.UniqueIdentifier, request.tenant_id)
            .query(`SELECT email, first_name FROM TenantAdmins WHERE tenant_id = @tenantId AND is_active = 1`);
        
        const adminEmails = result.recordset.map(r => r.email);
        
        if (adminEmails.length === 0) {
            console.log('⚠️ No hay admins configurados para notificar');
            return;
        }

        const priorityLabels = { 'LOW': 'Baja', 'MEDIUM': 'Media', 'HIGH': 'Alta', 'URGENT': 'Urgente' };
        
        const content = `
            <h2>Nueva solicitud recibida</h2>
            <p>Se ha recibido una nueva solicitud en el sistema:</p>
            
            <div class="details-box">
                <h3>${requestType.name}</h3>
                <p><strong>Propietario:</strong> ${ownerName}</p>
                <p><strong>Prioridad:</strong> ${priorityLabels[request.priority] || request.priority}</p>
                <p><strong>Fecha:</strong> ${new Date(request.created_at).toLocaleDateString('es-ES', { 
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                })}</p>
            </div>
            
            <p><strong>Descripción:</strong></p>
            <p style="background: #f8f9fa; padding: 15px; border-radius: 8px;">${request.description || 'Sin descripción'}</p>
            
            <div style="text-align: center;">
                <a href="${process.env.APP_URL || 'http://localhost:3000'}/tenant-admin/requests" class="cta-button">
                    Gestionar Solicitud
                </a>
            </div>
        `;
        
        const html = this._generateEmailTemplate(content, {
            title: 'Nueva Solicitud',
            subtitle: 'Requiere atención'
        });
        
        const subject = `🔔 Nueva Solicitud: ${requestType.name} - ${tenantName}`;
        
        for (const email of adminEmails) {
            await this.send(email.trim(), subject, html);
        }
    }

    /**
     * Notificar cambio de estado de solicitud al propietario
     */
    async sendRequestStatusUpdate(request, requestType, ownerEmail, ownerName, adminComment = null) {
        const statusLabels = {
            'OPEN': 'Abierta',
            'IN_PROGRESS': 'En Proceso',
            'RESOLVED': 'Resuelta',
            'CLOSED': 'Cerrada',
            'APPROVED': 'Aprobada',
            'REJECTED': 'Rechazada'
        };
        
        const statusMessages = {
            'OPEN': 'Tu solicitud ha sido registrada y está pendiente de revisión.',
            'IN_PROGRESS': 'La Junta de Condominio está atendiendo tu solicitud.',
            'RESOLVED': 'Tu solicitud ha sido resuelta. Si tienes alguna duda, por favor contacta a la administración.',
            'CLOSED': 'Tu solicitud ha sido cerrada.',
            'APPROVED': 'Tu solicitud ha sido aprobada. A continuación encontrarás los detalles.',
            'REJECTED': 'Lamentamos informarte que tu solicitud no puede ser procesada. A continuación encontrarás el motivo.'
        };
        
        const statusClass = request.status.toLowerCase();
        const statusColor = {
            'OPEN': '#f59e0b',
            'IN_PROGRESS': '#3b82f6',
            'RESOLVED': '#10b981',
            'CLOSED': '#6b7280',
            'APPROVED': '#10b981',
            'REJECTED': '#dc2626'
        }[request.status] || '#8B5028';
        
        let adminResponseHtml = '';
        if (adminComment) {
            adminResponseHtml = `
                <div class="admin-response">
                    <h4>Respuesta de la Junta de Condominio</h4>
                    <p>"${adminComment}"</p>
                </div>
            `;
        }
        
        const content = `
            <h2>Hola ${ownerName},</h2>
            <p>Tu solicitud ha sido actualizada:</p>
            
            <div class="details-box" style="border-left-color: ${statusColor}">
                <h3>${requestType.name}</h3>
                <p><strong>Nuevo Estado:</strong> <span class="status-badge status-${statusClass}">${statusLabels[request.status]}</span></p>
                <p><strong>Fecha de actualización:</strong> ${new Date().toLocaleDateString('es-ES', { 
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                })}</p>
            </div>
            
            <p>${statusMessages[request.status]}</p>
            
            ${adminResponseHtml}
            
            <div class="divider"></div>
            
            <div style="text-align: center;">
                <a href="${process.env.APP_URL || 'http://localhost:3000'}/owner/requests/${request.id}" class="cta-button">
                    Ver Detalles
                </a>
            </div>
        `;
        
        const html = this._generateEmailTemplate(content, {
            title: 'Actualización de Solicitud',
            subtitle: `Estado: ${statusLabels[request.status]}`,
            color: statusColor
        });
        
        const subject = `📝 Actualización: ${requestType.name} - ${statusLabels[request.status]}`;
        await this.send(ownerEmail, subject, html);
    }

    /**
     * Notificar a admins de junta que se generó una factura Condominio360
     */
    async sendSaaSInvoiceNotification(tenantName, periodMonth, periodYear, totalUsd, totalVes, adminEmails) {
        if (!adminEmails || adminEmails.length === 0) {
            console.log('⚠️ No hay admins para notificar factura Condominio360');
            return;
        }
        const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        const periodLabel = `${months[periodMonth - 1]} ${periodYear}`;
        const content = `
            <h2>Nueva factura Condominio360</h2>
            <p>Se ha generado una factura para <strong>${tenantName}</strong>.</p>
            <div class="details-box">
                <p><strong>Período:</strong> ${periodLabel}</p>
                <p><strong>Total USD:</strong> $${parseFloat(totalUsd).toFixed(2)}</p>
                <p><strong>Total VES:</strong> Bs. ${parseFloat(totalVes).toLocaleString('es-VE')}</p>
            </div>
            <div style="text-align: center;">
                <a href="${process.env.APP_URL || 'http://localhost:3000'}/tenant-admin/saas-invoices" class="cta-button">Ver facturas</a>
            </div>
        `;
        const html = this._generateEmailTemplate(content, {
            title: 'Factura Condominio360',
            subtitle: `Período ${periodLabel}`,
            color: '#f97316'
        });
        const subject = `📄 Factura Condominio360: ${tenantName} - ${periodLabel}`;
        for (const email of adminEmails) {
            if (email && email.trim()) {
                await this.send(email.trim(), subject, html);
            }
        }
    }

    /**
     * Enviar notificación de pago confirmado al propietario
     */
    async sendPaymentConfirmed(email, firstName, invoiceNumber, periodLabel, amountVes) {
        const subject = `✅ Pago confirmado - Recibo ${invoiceNumber}`;
        const content = `
            <h2>Hola ${firstName},</h2>
            <p>Tu reporte de pago ha sido confirmado por la junta de condominio.</p>
            <div class="details-box">
                <h3>Detalle del recibo</h3>
                <p><strong>Número:</strong> ${invoiceNumber}</p>
                <p><strong>Período:</strong> ${periodLabel}</p>
                <p><strong>Monto:</strong> Bs. ${parseFloat(amountVes).toLocaleString('es-VE')}</p>
            </div>
            <p>El recibo queda marcado como pagado en tu expediente.</p>
        `;
        const html = this._generateEmailTemplate(content, {
            title: 'Pago Confirmado',
            subtitle: 'Condominio360',
            color: '#16a34a'
        });
        return await this.send(email, subject, html);
    }

    /**
     * Enviar notificación de pago rechazado al propietario
     */
    async sendPaymentRejected(email, firstName, invoiceNumber, periodLabel, rejectionReason) {
        const subject = `⚠️ Pago rechazado - Recibo ${invoiceNumber}`;
        const reason = rejectionReason ? `Motivo: ${rejectionReason}` : 'Sin motivo especificado';
        const content = `
            <h2>Hola ${firstName},</h2>
            <p>Tu reporte de pago ha sido rechazado por la junta de condominio.</p>
            <div class="details-box">
                <h3>Detalle del recibo</h3>
                <p><strong>Número:</strong> ${invoiceNumber}</p>
                <p><strong>Período:</strong> ${periodLabel}</p>
                <p><strong>${reason}</strong></p>
            </div>
            <p>Por favor, verifica los datos de tu transferencia y vuelve a reportar el pago, o contacta a la administración del condominio.</p>
        `;
        const html = this._generateEmailTemplate(content, {
            title: 'Pago Rechazado',
            subtitle: 'Condominio360',
            color: '#dc2626'
        });
        return await this.send(email, subject, html);
    }

    /**
     * Notificar al propietario que su reserva de área común fue recibida
     */
    async sendReservationReceivedNotification(reservation, ownerEmail, ownerName, areaName, requiresApproval) {
        const dateStr = this._formatReservationDate(reservation.reservation_date);
        const timeStr = `${this._formatReservationTime(reservation.start_time)} - ${this._formatReservationTime(reservation.end_time)}`;
        const pendingMsg = requiresApproval
            ? '<p><strong>Esta área requiere aprobación de la junta de condominio.</strong> Tu reserva quedará sujeta a revisión y te notificaremos por correo cuando sea aprobada o rechazada.</p>'
            : '<p>Tu reserva está confirmada.</p>';

        const content = `
            <h2>Hola ${ownerName},</h2>
            <p>Tu solicitud de reserva de área común ha sido registrada exitosamente.</p>
            
            <div class="details-box">
                <h3>${areaName}</h3>
                <p><strong>Fecha:</strong> ${dateStr}</p>
                <p><strong>Horario:</strong> ${timeStr}</p>
                ${reservation.notes ? `<p><strong>Notas:</strong> ${reservation.notes}</p>` : ''}
            </div>
            
            ${pendingMsg}
            
            <div style="text-align: center;">
                <a href="${process.env.APP_URL || 'http://localhost:3000'}/owner/common-areas" class="cta-button">
                    Ver Mis Reservas
                </a>
            </div>
        `;

        const html = this._generateEmailTemplate(content, {
            title: 'Reserva de Área Común Registrada',
            subtitle: requiresApproval ? 'Pendiente de aprobación' : 'Confirmada',
            color: requiresApproval ? '#f59e0b' : '#8B5028'
        });
        const subject = requiresApproval
            ? `⏳ Reserva registrada: ${areaName} (pendiente de aprobación)`
            : `✅ Reserva confirmada: ${areaName}`;
        await this.send(ownerEmail, subject, html);
    }

    /**
     * Notificar al propietario que su reserva fue aprobada por la junta
     */
    async sendReservationApprovedNotification(reservation, ownerEmail, ownerName, areaName) {
        const dateStr = this._formatReservationDate(reservation.reservation_date);
        const timeStr = `${this._formatReservationTime(reservation.start_time)} - ${this._formatReservationTime(reservation.end_time)}`;

        const content = `
            <h2>Hola ${ownerName},</h2>
            <p>¡Buenas noticias! La junta de condominio ha aprobado tu reserva de área común.</p>
            
            <div class="details-box" style="border-left-color: #10b981">
                <h3>${areaName}</h3>
                <p><strong>Fecha:</strong> ${dateStr}</p>
                <p><strong>Horario:</strong> ${timeStr}</p>
            </div>
            
            <p>Tu reserva queda confirmada. Te esperamos.</p>
            
            <div style="text-align: center;">
                <a href="${process.env.APP_URL || 'http://localhost:3000'}/owner/common-areas" class="cta-button">
                    Ver Mis Reservas
                </a>
            </div>
        `;

        const html = this._generateEmailTemplate(content, {
            title: 'Reserva Aprobada',
            subtitle: areaName,
            color: '#10b981'
        });
        const subject = `✅ Reserva aprobada: ${areaName}`;
        await this.send(ownerEmail, subject, html);
    }

    /**
     * Notificar al propietario que su reserva fue rechazada
     */
    async sendReservationRejectedNotification(reservation, ownerEmail, ownerName, areaName, rejectionReason) {
        const dateStr = this._formatReservationDate(reservation.reservation_date);
        const timeStr = `${this._formatReservationTime(reservation.start_time)} - ${this._formatReservationTime(reservation.end_time)}`;
        const reasonHtml = rejectionReason
            ? `<div class="admin-response"><p><strong>Motivo:</strong> "${rejectionReason}"</p></div>`
            : '';

        const content = `
            <h2>Hola ${ownerName},</h2>
            <p>Lamentamos informarte que la junta de condominio no ha podido aprobar tu reserva de área común.</p>
            
            <div class="details-box" style="border-left-color: #dc2626">
                <h3>${areaName}</h3>
                <p><strong>Fecha:</strong> ${dateStr}</p>
                <p><strong>Horario:</strong> ${timeStr}</p>
            </div>
            
            ${reasonHtml}
            
            <p>Si tienes dudas, por favor contacta a la administración del condominio.</p>
            
            <div style="text-align: center;">
                <a href="${process.env.APP_URL || 'http://localhost:3000'}/owner/common-areas" class="cta-button">
                    Reservar otro horario
                </a>
            </div>
        `;

        const html = this._generateEmailTemplate(content, {
            title: 'Reserva No Aprobada',
            subtitle: areaName,
            color: '#dc2626'
        });
        const subject = `❌ Reserva no aprobada: ${areaName}`;
        await this.send(ownerEmail, subject, html);
    }

    /**
     * Convertir HTML a texto plano básico
     */
    _htmlToText(html) {
        return html
            .replace(/<style[^>]*>.*?<\/style>/gs, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}

// Singleton
module.exports = new EmailService();
