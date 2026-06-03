const { CronJob } = require('cron');
const ConsultationModel = require('../models/ConsultationModel');
const NotificationQueueModel = require('../models/NotificationQueueModel');
const { connectDB, sql } = require('../config/database');
const EmailService = require('./EmailService');

/**
 * Notificaciones de consultas: encolado asíncrono + procesador en background.
 */
class ConsultationNotificationService {

    constructor() {
        this.batchSize = 30;
        this.queueBatchSize = 40;
        this.isProcessingActivations = false;
        this.isProcessingQueue = false;
        this.activationTask = null;
        this.queueTask = null;
    }

    start() {
        console.log('📬 Servicio de notificaciones de consultas iniciado');

        this.activationTask = new CronJob(
            '*/5 * * * *',
            () => this.checkAndNotifyActivations(),
            null,
            true,
            'America/Caracas'
        );

        this.queueTask = new CronJob(
            '*/2 * * * *',
            () => this.processNotificationQueue(),
            null,
            true,
            'America/Caracas'
        );

        this.checkAndNotifyActivations();
        this.processNotificationQueue();
    }

    stop() {
        if (this.activationTask) {
            this.activationTask.stop();
            this.activationTask = null;
        }
        if (this.queueTask) {
            this.queueTask.stop();
            this.queueTask = null;
        }
    }

    /**
     * Encolar aviso de nueva consulta (no bloquea la creación HTTP).
     */
    async queueCreationNotifications(consultation, recipients) {
        if (!recipients?.length) {
            console.log('⚠️ No hay destinatarios para encolar (creación)');
            return 0;
        }

        const tenantId = consultation.tenant_id;
        const items = recipients.map((recipient) => ({
            tenant_id: tenantId,
            user_id: recipient.id,
            type: 'consultation_creation',
            title: `Nueva Consulta: ${consultation.title}`,
            message: `Se ha programado una nueva consulta para tu condominio: ${consultation.title}`,
            data: {
                consultation_id: consultation.id,
                kind: 'creation'
            }
        }));

        const queued = await NotificationQueueModel.enqueueMany(items);
        console.log(`📥 Encoladas ${queued} notificaciones de creación (consulta ${consultation.id})`);
        return queued;
    }

    /**
     * Encolar aviso de consulta activa (votación abierta).
     */
    async queueActivationNotifications(consultation, recipients) {
        if (!recipients?.length) return 0;

        const tenantId = consultation.tenant_id;
        const items = recipients.map((recipient) => ({
            tenant_id: tenantId,
            user_id: recipient.id,
            type: 'consultation_activation',
            title: `🔔 Consulta Activa: ${consultation.title}`,
            message: `La consulta "${consultation.title}" ya está abierta para votación.`,
            data: {
                consultation_id: consultation.id,
                kind: 'activation'
            }
        }));

        const queued = await NotificationQueueModel.enqueueMany(items);
        console.log(`📥 Encoladas ${queued} notificaciones de activación (consulta ${consultation.id})`);
        return queued;
    }

    /**
     * Procesar cola de correos de consultas.
     */
    async processNotificationQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        try {
            const pending = await NotificationQueueModel.getPendingByTypes(
                NotificationQueueModel.CONSULTATION_QUEUE_TYPES || ['consultation_creation', 'consultation_activation'],
                this.queueBatchSize
            );

            if (pending.length === 0) return;

            console.log(`📧 Procesando ${pending.length} notificaciones de consulta en cola...`);

            const consultationCache = new Map();

            for (const row of pending) {
                try {
                    let payload = {};
                    try {
                        payload = JSON.parse(row.data || '{}');
                    } catch (_) { /* noop */ }

                    const consultationId = payload.consultation_id;
                    if (!consultationId) {
                        await NotificationQueueModel.markAsFailed(row.id, 'Falta consultation_id en data');
                        continue;
                    }

                    if (!consultationCache.has(consultationId)) {
                        const pool = await connectDB();
                        const cRes = await pool.request()
                            .input('id', sql.UniqueIdentifier, consultationId)
                            .query('SELECT * FROM Consultations WHERE id = @id');
                        if (cRes.recordset.length === 0) {
                            await NotificationQueueModel.markAsFailed(row.id, 'Consulta no encontrada');
                            consultationCache.set(consultationId, null);
                            continue;
                        }
                        consultationCache.set(consultationId, cRes.recordset[0]);
                    }

                    const consultation = consultationCache.get(consultationId);
                    if (!consultation) continue;

                    const pool = await connectDB();
                    const userRes = await pool.request()
                        .input('user_id', sql.UniqueIdentifier, row.user_id)
                        .query('SELECT email, first_name, last_name FROM Users WHERE id = @user_id');

                    const user = userRes.recordset[0];
                    if (!user?.email) {
                        await NotificationQueueModel.markAsFailed(row.id, 'Usuario sin email');
                        continue;
                    }

                    const recipientName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Propietario';
                    const kind = payload.kind || (row.type === 'consultation_activation' ? 'activation' : 'creation');

                    let subject;
                    let html;
                    if (kind === 'activation') {
                        const endDate = new Date(consultation.end_date).toLocaleDateString('es-VE', {
                            timeZone: 'America/Caracas',
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric'
                        });
                        subject = `🔔 Consulta Activa: ${consultation.title}`;
                        html = this.getActivationEmailTemplate({
                            title: consultation.title,
                            description: consultation.description,
                            endDate,
                            recipientName,
                            consultationId: consultation.id
                        });
                    } else {
                        const startDate = new Date(consultation.start_date).toLocaleDateString('es-VE', {
                            timeZone: 'America/Caracas',
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric'
                        });
                        const targetInfo = consultation.target_building
                            ? `para el edificio/calle ${consultation.target_building}`
                            : 'para todo el conjunto residencial';
                        subject = `Nueva Consulta: ${consultation.title}`;
                        html = this.getCreationEmailTemplate({
                            title: consultation.title,
                            description: consultation.description,
                            startDate,
                            targetInfo,
                            recipientName,
                            consultationId: consultation.id
                        });
                    }

                    await this.sendEmail(user.email, subject, html, consultation.tenant_id);
                    await NotificationQueueModel.markAsSent(row.id);
                } catch (err) {
                    await NotificationQueueModel.markAsFailed(row.id, err.message || 'Error al enviar');
                }
            }
        } catch (error) {
            console.error('Error procesando cola de consultas:', error);
        } finally {
            this.isProcessingQueue = false;
        }
    }

    /**
     * @deprecated Usar queueCreationNotifications. Mantenido para scripts de conciliación directa.
     */
    async sendCreationNotification(consultation, recipients) {
        return this.queueCreationNotifications(consultation, recipients);
    }

    async checkAndNotifyActivations() {
        if (this.isProcessingActivations) return;
        this.isProcessingActivations = true;

        try {
            const pool = await connectDB();
            const result = await pool.request().query(`
                SELECT c.*, t.name AS tenant_name
                FROM Consultations c
                INNER JOIN Tenants t ON c.tenant_id = t.id
                WHERE c.status = 'OPEN'
                AND c.activation_notified = 0
                AND c.start_date <= GETUTCDATE()
                AND c.end_date >= GETUTCDATE()
            `);

            for (const consultation of result.recordset) {
                console.log(`📢 Encolando activación: ${consultation.title}`);
                const recipients = await this.getRecipients(consultation.tenant_id, consultation.target_building);
                await this.queueActivationNotifications(consultation, recipients);
                await ConsultationModel.markAsNotified(consultation.id);
            }
        } catch (error) {
            console.error('Error checking activations:', error);
        } finally {
            this.isProcessingActivations = false;
        }
    }

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

    async sendEmail(to, subject, html, tenantId = null) {
        await EmailService.send(to, subject, html, null, {
            tenantId,
            messageType: 'consultation_notification'
        });
    }

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
