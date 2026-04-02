const MailgunMailProvider = require('./email/MailgunMailProvider');
const EmailOrchestrator = require('./email/EmailOrchestrator');

/**
 * Formatea fecha para correos: la DB guarda hora Venezuela pero el driver la interpreta como UTC.
 * Añadimos -04:00 para que se muestre correctamente.
 */
function formatDateVenezuela(dateVal, options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) {
    if (!dateVal) return '-';
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    const iso = d.toISOString();
    const isoVenezuela = iso.slice(0, 19) + '-04:00';
    return new Date(isoVenezuela).toLocaleDateString('es-ES', { timeZone: 'America/Caracas', ...options });
}

/**
 * Servicio de Email: delega en EmailOrchestrator (Mailgun API). Sin SMTP.
 */
class EmailService {
    constructor() {
        if (!MailgunMailProvider.isConfigured()) {
            console.log('⚠️  MAILGUN_API_KEY no configurada. Emails se mostrarán en consola (modo desarrollo).');
        }
    }

    get isConfigured() {
        return MailgunMailProvider.isConfigured();
    }

    /**
     * Verificar que Mailgun API esté configurada
     */
    async verify() {
        return MailgunMailProvider.isConfigured();
    }

    /**
     * @param {object} meta - tenantId, messageType, pipeline (transactional|bulk), createdBy, idempotencyKey, metadata
     */
    async send(to, subject, html, text = null, meta = {}) {
        const plain = text || this._htmlToText(html);
        return EmailOrchestrator.dispatchMail({
            to,
            subject,
            html,
            text: plain,
            tenantId: meta.tenantId ?? null,
            messageType: meta.messageType || 'generic',
            pipeline: meta.pipeline || 'transactional',
            createdBy: meta.createdBy || null,
            idempotencyKey: meta.idempotencyKey || null,
            sourceBatchId: meta.sourceBatchId || null,
            metadata: meta.metadata || null
        });
    }

    /**
     * Enviar invitación a propietario nuevo (con link para confirmar registro y asignar contraseña)
     * @param {string} propertyLabel - Ej: "Edificio A, Apt 101" o "Casa 5"
     */
    async sendOwnerInvitation(email, firstName, tenantName, invitationLink, propertyLabel = null, meta = {}) {
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
            <p><strong>Nota:</strong> Este enlace expira a las 24 horas por seguridad.</p>
            <p>Si no esperabas esta invitación, puedes ignorar este correo.</p>
        </div>
        <div class="footer">
            <p>© 2026 Condominio360. Todos los derechos reservados.</p>
        </div>
    </div>
</body>
</html>`;

        return await this.send(email, subject, html, null, { ...meta, messageType: 'owner_invitation' });
    }

    /**
     * Notificar a propietario existente que fue agregado a otro condominio (sin link de confirmación)
     * @param {string} propertyLabel - Ej: "Edificio A, Apt 101"
     */
    async sendOwnerAddedToCondominio(email, firstName, tenantName, propertyLabel = null, loginUrl = '/login', meta = {}) {
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

        return await this.send(email, subject, html, null, { ...meta, messageType: 'owner_added_condominio' });
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
            password || opts.password,
            { tenantId: opts.tenantId || null }
        );
    }

    /**
     * Enviar credenciales a Admin de Junta (bienvenida onboarding)
     */
    async sendAdminCredentials(email, firstName, tenantName, loginLink, tempPassword, meta = {}) {
        const subject = `Bienvenido a Condominio360 - Credenciales para ${tenantName}`;

        const content = `
            <h2>Hola ${firstName},</h2>
            <p>Te damos la bienvenida a <strong>Condominio360</strong>. Se ha creado tu cuenta como administrador de junta para <strong>${tenantName}</strong>.</p>
            
            <div class="details-box" style="border-left-color: #059669">
                <h3>🔐 Tus credenciales de acceso</h3>
                <p><strong>Correo:</strong> ${email}</p>
                <p><strong>Contraseña:</strong> <code style="background:#fff7ed; padding:4px 8px; border-radius:4px; font-size:15px;">${tempPassword}</code></p>
            </div>

            <div class="admin-response" style="background:#fffbeb; border-color:#fbbf24; margin:20px 0;">
                <h4 style="color:#92400e;">⚠️ Importante</h4>
                <p style="margin:0; color:#1a1a1a;">Por seguridad, te recomendamos cambiar tu contraseña en tu primer inicio de sesión.</p>
            </div>
            
            <p>Haz clic en el botón siguiente para acceder al panel de administración:</p>
            
            <div style="text-align: center; margin: 28px 0;">
                <a href="${loginLink}" class="cta-button">Acceder al Panel de Junta</a>
            </div>

            <p class="date-info">O copia y pega este enlace en tu navegador:<br>
            <span style="word-break: break-all; background:#f1f5f9; padding:12px; border-radius:6px; display:inline-block; margin-top:8px; font-size:13px;">${loginLink}</span></p>
        `;

        const html = this._generateEmailTemplate(content, {
            title: 'Bienvenida - Credenciales de Acceso',
            subtitle: `Panel de Junta - ${tenantName}`,
            color: '#ea580c'
        });

        return await this.send(email, subject, html, null, { ...meta, messageType: 'admin_credentials' });
    }

    /**
     * Enviar email de recuperación de contraseña
     */
    async sendPasswordReset(email, firstName, resetLink, meta = {}) {
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

        return await this.send(email, subject, html, null, { ...meta, messageType: 'password_reset' });
    }

    /**
     * Enviar notificación de cambio de contraseña
     */
    async sendPasswordChanged(email, firstName, meta = {}) {
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

        return await this.send(email, subject, html, null, { ...meta, messageType: 'password_changed' });
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
                <p><strong>Fecha:</strong> ${formatDateVenezuela(request.created_at)}</p>
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
        await this.send(ownerEmail, subject, html, null, {});
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
                <p><strong>Fecha:</strong> ${formatDateVenezuela(request.created_at)}</p>
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
            await this.send(email.trim(), subject, html, null, {});
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
                <p><strong>Fecha de actualización:</strong> ${formatDateVenezuela(request.updated_at || request.created_at)}</p>
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
        await this.send(ownerEmail, subject, html, null, {});
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
                await this.send(email.trim(), subject, html, null, {});
            }
        }
    }

    /**
     * Enviar notificación de pago confirmado al propietario
     */
    async sendPaymentConfirmed(email, firstName, invoiceNumber, periodLabel, amountVes, meta = {}) {
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
        return await this.send(email, subject, html, null, {
            ...meta,
            messageType: meta.messageType || 'payment_confirmed'
        });
    }

    /**
     * Enviar notificación de pago rechazado al propietario
     */
    async sendPaymentRejected(email, firstName, invoiceNumber, periodLabel, rejectionReason, meta = {}) {
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
        return await this.send(email, subject, html, null, {
            ...meta,
            messageType: meta.messageType || 'payment_rejected'
        });
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
        await this.send(ownerEmail, subject, html, null, {});
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
        await this.send(ownerEmail, subject, html, null, {});
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
        await this.send(ownerEmail, subject, html, null, {});
    }

    /**
     * Notificar al propietario que su solicitud de actualización de datos fue recibida
     * Se envía a la nueva dirección de correo indicada en la solicitud
     */
    async sendDataUpdateRequestToOwner(email, firstName) {
        const subject = 'Solicitud de actualización de datos recibida - Condominio360';
        const content = `
            <h2>Hola ${firstName},</h2>
            <p>Hemos recibido tu solicitud de actualización de datos personales. <strong>Tu solicitud está en proceso.</strong></p>
            
            <div class="details-box">
                <h3>¿Qué sigue?</h3>
                <p>Serás contactado por el equipo de Condominio360, la junta de condominio y la empresa administradora en caso de existir, para confirmar y conciliar tus datos.</p>
                <p><strong>Es probable que se te solicite:</strong></p>
                <ul style="margin: 12px 0; padding-left: 24px;">
                    <li>Título de propiedad</li>
                    <li>Contratos de arrendamiento (si aplica)</li>
                    <li>Poderes notariados (si aplica)</li>
                </ul>
                <p>Te sugerimos tener estos documentos a la mano para agilizar el proceso.</p>
            </div>
            
            <p>Una vez confirmada la titularidad o tenencia del inmueble, se actualizarán tus datos en el sistema y podrás ingresar usando tu cédula o correo electrónico.</p>
            <p>Te notificaremos por correo cuando tu solicitud sea procesada.</p>
            <p>Si no realizaste esta solicitud, por favor contacta a la administración de tu condominio.</p>
        `;
        const html = this._generateEmailTemplate(content, { title: 'Solicitud en Proceso', subtitle: 'Actualización de datos', color: '#f97316' });
        await this.send(email, subject, html, null, {});
    }

    /**
     * Notificar al Super Admin de nueva solicitud de actualización de datos
     */
    async sendDataUpdateRequestToSuperAdmin(email, firstName, lastName, ownerEmail, adminUrl) {
        const subject = `Nueva solicitud de actualización de datos - ${firstName} ${lastName}`;
        const content = `
            <h2>Nueva solicitud de actualización de datos</h2>
            <p>El propietario <strong>${firstName} ${lastName}</strong> (${ownerEmail}) ha enviado una solicitud para actualizar sus datos personales.</p>
            <div class="details-box">
                <p>La solicitud será revisada por el equipo de Condominio360, la junta de condominio y la empresa administradora en caso de existir.</p>
                <p>Revisa y procesa la solicitud en el panel de administración.</p>
            </div>
            <div style="text-align: center;">
                <a href="${adminUrl}" class="cta-button">Ir al panel</a>
            </div>
        `;
        const html = this._generateEmailTemplate(content, { title: 'Solicitud Pendiente', subtitle: 'Actualización de datos', color: '#f97316' });
        await this.send(email, subject, html, null, {});
    }

    /**
     * Notificar al propietario que su solicitud fue aprobada (versión simple, sin token)
     */
    async sendDataUpdateApproved(email, firstName, changesList = []) {
        const subject = 'Tus datos han sido actualizados - Condominio360';
        const changesHtml = changesList.length > 0
            ? `<ul style="margin: 16px 0; padding-left: 24px;">${changesList.map(c => `<li>${c}</li>`).join('')}</ul>`
            : '<p>Los datos de tu perfil han sido actualizados.</p>';
        const content = `
            <h2>Hola ${firstName},</h2>
            <p>Tu solicitud de actualización de datos ha sido <strong>aprobada</strong>.</p>
            ${changesHtml}
            <p>Estos cambios aplican a todos los condominios e inmuebles donde tienes propiedad en Condominio360.</p>
        `;
        const html = this._generateEmailTemplate(content, { title: 'Datos Actualizados', subtitle: 'Solicitud aprobada', color: '#16a34a' });
        await this.send(email, subject, html, null, {});
    }

    /**
     * Enviar invitación para definir contraseña tras aprobación de actualización de datos
     * Similar a sendOwnerInvitation: el propietario debe confirmar y establecer su contraseña
     */
    async sendDataUpdateApprovedWithPasswordSetup(email, firstName, tenantName, invitationLink, propertyLabel = null) {
        const subject = `Confirma tu cuenta y define tu contraseña - Condominio360`;
        const propertyBlock = propertyLabel
            ? `<div class="details-box"><p><strong>Inmueble:</strong> ${propertyLabel}</p></div>`
            : '';
        const content = `
            <h2>Hola ${firstName},</h2>
            <p>Tu solicitud de actualización de datos ha sido <strong>aprobada</strong>. Tus datos personales han sido actualizados en el sistema.</p>
            ${propertyBlock}
            <p>Para acceder al panel de Condominio360, debes confirmar tu cuenta y definir tu contraseña de acceso. Haz clic en el siguiente botón:</p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="${invitationLink}" class="cta-button">Confirmar y definir contraseña</a>
            </div>
            <p>O copia y pega este enlace en tu navegador:</p>
            <p style="word-break: break-all; background: #f3f4f6; padding: 12px; border-radius: 6px; font-size: 13px;">
                ${invitationLink}
            </p>
            <p><strong>Nota:</strong> Este enlace expira a las 24 horas por seguridad.</p>
            <p>Una vez completado, podrás ingresar con tu cédula o correo electrónico y la contraseña que definas.</p>
        `;
        const html = this._generateEmailTemplate(content, { title: 'Datos Aprobados', subtitle: 'Define tu contraseña', color: '#16a34a' });
        await this.send(email, subject, html, null, {});
    }

    /**
     * Notificar al propietario que su solicitud fue rechazada
     */
    async sendDataUpdateRejected(email, firstName) {
        const subject = 'Solicitud de actualización de datos - Condominio360';
        const content = `
            <h2>Hola ${firstName},</h2>
            <p>Lamentamos informarte que tu solicitud de actualización de datos personales ha sido <strong>rechazada</strong>.</p>
            <p>Tus datos permanecen sin cambios. Si necesitas actualizar tu información, por favor contacta directamente a la administración de tu condominio o a la Junta de Condominio.</p>
        `;
        const html = this._generateEmailTemplate(content, { title: 'Solicitud Rechazada', subtitle: 'Actualización de datos', color: '#dc2626' });
        await this.send(email, subject, html, null, {});
    }

    /**
     * Template HTML para emails Arsys Intela (azul, logo)
     */
    _arsysIntelaTemplate(content, options = {}) {
        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        const logoUrl = `${baseUrl}/assets/images/main-intelawhite.svg`;
        const { title, subtitle } = options;

        return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title || 'Arsys Intela'}</title>
    <style>
        body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.7; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
        .email-container { background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); overflow: hidden; }
        .header { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 28px 24px; text-align: center; }
        .header-logo img { height: 48px; width: auto; display: block; margin: 0 auto; }
        .header p { margin: 12px 0 0; color: rgba(255,255,255,0.95); font-size: 14px; }
        .content { padding: 32px 28px; }
        .content h2 { color: #1a1a1a; font-size: 18px; margin-bottom: 16px; font-weight: 600; }
        .content p { margin-bottom: 16px; color: #374151; font-size: 15px; }
        .details-box { background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 18px 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
        .details-box p { margin: 8px 0; }
        .footer { background-color: #1e3a5f; color: #e2e8f0; padding: 24px; text-align: center; font-size: 14px; }
        .footer strong { display: block; margin-bottom: 6px; color: #fff; font-weight: 600; }
        .footer p { margin: 0; color: #cbd5e1; line-height: 1.5; }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <div class="header-logo">
                <img src="${logoUrl}" alt="Arsys Intela" />
            </div>
            ${subtitle ? `<p>${subtitle}</p>` : '<p>Condominio360 - Gestión Inteligente de Condominios</p>'}
        </div>
        <div class="content">${content}</div>
        <div class="footer">
            <strong>Arsys Intela - Casa Matriz de Condominio360</strong>
            <p>www.arsysintela.com / www.condominio-360.com</p>
            <p>Gestión inteligente de condominios. Moderniza tu comunidad con tecnología de punta.</p>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Acuse de recibo al solicitante de demo - Arsys Intela branding
     */
    async sendDemoAcknowledgement(to) {
        const subject = 'Solicitud de Demo Recibida - Condominio360';
        const content = `
            <h2>¡Gracias por tu interés!</h2>
            <p>Hemos recibido tu solicitud de demostración de <strong>Condominio360</strong>.</p>
            <div class="details-box">
                <p><strong>Serás contactado en breve</strong> por el equipo de <strong>Arsys Intela</strong> (casa matriz de Condominio360) para otorgarte un demo personalizado y atender todas tus consultas.</p>
                <p>Te contactaremos en menos de 24 horas al correo que nos proporcionaste.</p>
            </div>
            <p>Mientras tanto, puedes explorar nuestras funciones en <a href="${process.env.APP_URL || 'http://localhost:3000'}">condominio-360.com</a>.</p>
        `;
        const html = this._arsysIntelaTemplate(content, {
            title: 'Solicitud Recibida',
            subtitle: 'Condominio360 - Arsys Intela'
        });
        return await this.send(to, subject, html, null, {});
    }

    /**
     * Notificación a superadmins - nueva solicitud de demo
     */
    async sendDemoRequestToSuperAdmins(to, requesterEmail) {
        const subject = `🔔 Nueva solicitud de Demo - ${requesterEmail}`;
        const content = `
            <h2>Nueva solicitud de demostración</h2>
            <p>Alguien ha solicitado una demo de Condominio360 desde el landing.</p>
            <div class="details-box">
                <p><strong>Correo del solicitante:</strong> <a href="mailto:${requesterEmail}">${requesterEmail}</a></p>
                <p>Por favor, contacta al solicitante en menos de 24 horas para otorgarle el demo y atender su interés.</p>
            </div>
        `;
        const html = this._arsysIntelaTemplate(content, {
            title: 'Solicitud de Demo',
            subtitle: 'Requiere atención'
        });
        return await this.send(to, subject, html, null, {});
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
