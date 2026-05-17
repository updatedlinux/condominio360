const ConsultationModel = require('../models/ConsultationModel');
const { connectDB, sql } = require('../config/database');
const EmailService = require('./EmailService');

/**
 * Servicio para notificaciones de consultas/votaciones
 * Envía notificaciones por lotes al crear y al activar consultas
 */
class ConsultationNotificationService {
    
    constructor() {
        this.batchSize = 30; // Same as communiques
        this.isProcessing = false;
        this.checkInterval = null;
    }

    /**
     * Iniciar el servicio de notificaciones
     */
    start() {
        console.log('📬 Servicio de notificaciones de consultas iniciado');
        
        // Check every 5 minutes for consultations to notify
        this.checkInterval = setInterval(() => {
            this.checkAndNotifyActivations();
        }, 5 * 60 * 1000);
        
        // Initial check
        this.checkAndNotifyActivations();
    }

    /**
     * Detener el servicio
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    /**
     * Enviar notificación de nueva consulta creada
     * @param {Object} consultation - Datos de la consulta
     * @param {Array} recipients - Lista de destinatarios
     */
    async sendCreationNotification(consultation, recipients) {
        if (!recipients || recipients.length === 0) {
            console.log('⚠️ No hay destinatarios para notificar');
            return;
        }

        console.log(`📧 Enviando notificación de creación a ${recipients.length} propietarios`);

        const startDate = new Date(consultation.start_date).toLocaleDateString('es-VE', {
            timeZone: 'America/Caracas',
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });

        const targetInfo = consultation.target_building 
            ? `para el edificio/calle ${consultation.target_building}` 
            : 'para todo el conjunto residencial';

        const subject = `Nueva Consulta: ${consultation.title}`;
        
        // Send in batches
        for (let i = 0; i < recipients.length; i += this.batchSize) {
            const batch = recipients.slice(i, i + this.batchSize);
            
            await Promise.all(batch.map(recipient => 
                this.sendEmail(recipient.email, subject, this.getCreationEmailTemplate({
                    title: consultation.title,
                    description: consultation.description,
                    startDate,
                    targetInfo,
                    recipientName: `${recipient.first_name} ${recipient.last_name}`,
                    consultationId: consultation.id
                }), consultation.tenant_id)
            ));

            // Small delay between batches
            if (i + this.batchSize < recipients.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        console.log('✅ Notificaciones de creación enviadas');
    }

    /**
     * Verificar y enviar notificaciones de activación
     */
    async checkAndNotifyActivations() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const pool = await connectDB();
            
            // Find consultations that start today and haven't been notified
            const result = await pool.request()
                .query(`
                    SELECT c.*, t.name as tenant_name
                    FROM Consultations c
                    INNER JOIN Tenants t ON c.tenant_id = t.id
                    WHERE c.status = 'OPEN'
                    AND c.activation_notified = 0
                    AND c.start_date <= GETUTCDATE()
                    AND c.end_date >= GETUTCDATE()
                `);

            for (const consultation of result.recordset) {
                console.log(`📢 Activando consulta: ${consultation.title}`);
                
                // Get recipients
                const recipients = await this.getRecipients(consultation.tenant_id, consultation.target_building);
                
                // Send activation notifications
                await this.sendActivationNotification(consultation, recipients);
                
                // Mark as notified
                await ConsultationModel.markAsNotified(consultation.id);
            }
        } catch (error) {
            console.error('Error checking activations:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Enviar notificación de activación
     */
    async sendActivationNotification(consultation, recipients) {
        if (!recipients || recipients.length === 0) return;

        console.log(`📧 Enviando notificación de activación a ${recipients.length} propietarios`);

        const endDate = new Date(consultation.end_date).toLocaleDateString('es-VE', {
            timeZone: 'America/Caracas',
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });

        const subject = `🔔 Consulta Activa: ${consultation.title}`;

        for (let i = 0; i < recipients.length; i += this.batchSize) {
            const batch = recipients.slice(i, i + this.batchSize);
            
            await Promise.all(batch.map(recipient => 
                this.sendEmail(recipient.email, subject, this.getActivationEmailTemplate({
                    title: consultation.title,
                    description: consultation.description,
                    endDate,
                    recipientName: `${recipient.first_name} ${recipient.last_name}`,
                    consultationId: consultation.id
                }), consultation.tenant_id)
            ));

            if (i + this.batchSize < recipients.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        console.log('✅ Notificaciones de activación enviadas');
    }

    /**
     * Obtener destinatarios elegibles
     * - targetBuilding null: todos los propietarios del tenant
     * - targetBuilding "Lourdes": solo propietarios con inmuebles en ese edificio (building o building_id->Buildings.name)
     */
    async getRecipients(tenantId, targetBuilding = null) {
        try {
            const pool = await connectDB();
            
            let query = `
                SELECT DISTINCT u.id, u.email, u.first_name, u.last_name
                FROM Users u
                INNER JOIN PropertyOwners po ON u.id = po.user_id
                INNER JOIN Properties p ON po.property_id = p.id
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.tenant_id = @tenantId
                AND u.email IS NOT NULL
                AND u.email != ''
            `;

            if (targetBuilding) {
                query += ` AND (p.building = @targetBuilding OR b.name = @targetBuilding)`;
            }

            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('targetBuilding', sql.NVarChar, targetBuilding)
                .query(query);

            return result.recordset;
        } catch (error) {
            console.error('Error getting recipients:', error);
            return [];
        }
    }

    /**
     * Enviar email
     */
    async sendEmail(to, subject, html, tenantId = null) {
        try {
            await EmailService.send(to, subject, html, null, {
                tenantId,
                messageType: 'consultation_notification'
            });
        } catch (error) {
            // El error ya se registra en EmailOrchestrator (evitar duplicar la misma traza en PM2).
        }
    }

    /**
     * Template para email de creación
     */
    getCreationEmailTemplate(data) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Nueva Consulta</title>
                <style>
                    body { font-family: 'Roboto', Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #8B5028 0%, #6B3F1F 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
                    .header h1 { color: white; margin: 0; font-size: 24px; }
                    .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; }
                    .info-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #8B5028; }
                    .button { display: inline-block; background: linear-gradient(135deg, #8B5028 0%, #6B3F1F 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; margin-top: 20px; }
                    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🏛️ Condominio360</h1>
                    </div>
                    <div class="content">
                        <h2>Hola ${data.recipientName},</h2>
                        
                        <p>Se ha creado una nueva consulta <strong>${data.targetInfo}</strong>:</p>
                        
                        <div class="info-box">
                            <h3 style="margin-top: 0; color: #8B5028;">${data.title}</h3>
                            <p>${data.description || 'Sin descripción'}</p>
                            <p style="margin-bottom: 0;">
                                <strong>📅 Fecha de inicio:</strong> ${data.startDate}<br>
                                <small>La consulta se activará automáticamente a la medianoche (00:00) de esa fecha, hora Venezuela.</small>
                            </p>
                        </div>
                        
                        <p>Te enviaremos un recordatorio cuando la consulta esté abierta para votación.</p>
                        
                        <a href="${process.env.APP_URL || 'https://condominio360.com'}/owner/consultations" class="button">Ver Consulta</a>
                        
                        <p style="margin-top: 30px; font-size: 12px; color: #666;">
                            Este es un mensaje automático de Condominio360. Por favor no respondas a este correo.
                        </p>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} Condominio360 - Todos los derechos reservados</p>
                    </div>
                </div>
            </body>
            </html>
        `;
    }

    /**
     * Template para email de activación
     */
    getActivationEmailTemplate(data) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Consulta Activa</title>
                <style>
                    body { font-family: 'Roboto', Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #8B5028 0%, #6B3F1F 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
                    .header h1 { color: white; margin: 0; font-size: 24px; }
                    .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; }
                    .alert { background: #e8f5e9; border: 1px solid #4caf50; padding: 15px; border-radius: 8px; margin: 20px 0; color: #2e7d32; }
                    .info-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #8B5028; }
                    .button { display: inline-block; background: linear-gradient(135deg, #4caf50 0%, #388e3c 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; margin-top: 20px; }
                    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🏛️ Condominio360</h1>
                    </div>
                    <div class="content">
                        <h2>Hola ${data.recipientName},</h2>
                        
                        <div class="alert">
                            <strong>🔔 ¡La consulta ya está abierta para votación!</strong>
                        </div>
                        
                        <div class="info-box">
                            <h3 style="margin-top: 0; color: #8B5028;">${data.title}</h3>
                            <p>${data.description || 'Sin descripción'}</p>
                            <p style="margin-bottom: 0;">
                                <strong>⏰ Fecha de cierre:</strong> ${data.endDate}
                            </p>
                        </div>
                        
                        <p><strong>Recuerda:</strong></p>
                        <ul>
                            <li>Cada inmueble tiene derecho a un voto</li>
                            <li>Si eres propietario de varios inmuebles, deberás votar por cada uno</li>
                            <li>Una vez emitido el voto, no se puede modificar</li>
                        </ul>
                        
                        <a href="${process.env.APP_URL || 'https://condominio360.com'}/owner/consultations" class="button">Votar Ahora</a>
                        
                        <p style="margin-top: 30px; font-size: 12px; color: #666;">
                            Este es un mensaje automático de Condominio360. Por favor no respondas a este correo.
                        </p>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} Condominio360 - Todos los derechos reservados</p>
                    </div>
                </div>
            </body>
            </html>
        `;
    }
}

module.exports = new ConsultationNotificationService();
