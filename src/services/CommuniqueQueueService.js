const { CronJob } = require('cron');
const CommuniqueModel = require('../models/CommuniqueModel');
const EmailService = require('./EmailService');

/**
 * Cola de envío de comunicados (admin de junta / tenant).
 * El cron intenta un lote cada N minutos, pero cada correo se envía con EmailService.send(),
 * que respeta el mismo límite global SMTP_MAX_EMAILS_PER_HOUR que el resto del SaaS (todos los condominios).
 */
class CommuniqueQueueService {
    constructor() {
        this.batchSize = 30; // Destinatarios por lote de BD
        this.intervalMinutes = 2; // Cada 2 minutos se intenta avanzar la cola si hay pendientes
        this.isProcessing = false;
        this.task = null;
    }

    /**
     * Iniciar el procesador de cola
     */
    start() {
        console.log('🚀 Iniciando Communique Queue Service...');
        console.log(`📧 Configuración: Lotes de ${this.batchSize} correos cada ${this.intervalMinutes} minutos`);

        // Ejecutar cada 2 minutos
        this.task = new CronJob(
            `*/${this.intervalMinutes} * * * *`, // Cada 2 minutos
            async () => {
                await this.processQueue();
            },
            null, // onComplete
            true, // start immediately
            'America/Caracas' // timezone Venezuela GMT-4
        );

        // Procesar inmediatamente al iniciar
        this.processQueue();

        console.log('✅ Communique Queue Service iniciado');
    }

    /**
     * Detener el procesador
     */
    stop() {
        if (this.task) {
            this.task.stop();
            this.task = null;
            console.log('⏹️ Communique Queue Service detenido');
        }
    }

    /**
     * Procesar la cola de emails
     */
    async processQueue() {
        if (this.isProcessing) {
            console.log('⏳ Procesamiento en curso, esperando...');
            return;
        }

        try {
            this.isProcessing = true;
            console.log('📧 Verificando cola de comunicados...');

            // Obtener lotes pendientes
            const pendingBatches = await CommuniqueModel.getPendingBatches(1);

            if (pendingBatches.length === 0) {
                console.log('✅ No hay comunicados pendientes en la cola');
                return;
            }

            const batch = pendingBatches[0];
            console.log(`📧 Procesando lote ${batch.batch_number}/${batch.total_batches} del comunicado: ${batch.title}`);

            // Marcar como procesando
            await CommuniqueModel.updateBatchStatus(batch.id, 'processing');

            // Obtener destinatarios de este lote
            const recipients = await this.getRecipientsForBatch(batch.communique_id, batch.batch_number);

            if (recipients.length === 0) {
                console.log('⚠️ No hay destinatarios en este lote');
                await CommuniqueModel.updateBatchStatus(batch.id, 'completed');
                return;
            }

            console.log(`📧 Enviando a ${recipients.length} destinatarios...`);

            // Generar template HTML
            const htmlContent = this.generateEmailTemplate(batch);

            // Enviar emails
            let sentCount = 0;
            let errorCount = 0;

            // Secuencial: cada send() espera en el limitador global (100/h compartido con todo el sistema)
            for (const recipient of recipients) {
                try {
                    await EmailService.send(
                        recipient.email,
                        `📢 Comunicado: ${batch.title}`,
                        htmlContent
                    );

                    // Actualizar notificación como enviada
                    await CommuniqueModel.updateNotificationStatus(recipient.id, 'sent');
                    sentCount++;
                    console.log(`✅ Enviado a: ${recipient.email}`);

                } catch (error) {
                    console.error(`❌ Error enviando a ${recipient.email}:`, error.message);
                    await CommuniqueModel.updateNotificationStatus(recipient.id, 'error', error.message);
                    errorCount++;
                }
            }

            // Marcar lote como completado
            await CommuniqueModel.updateBatchStatus(batch.id, 'completed');

            console.log(`📊 Resumen del lote ${batch.batch_number}/${batch.total_batches}:`);
            console.log(`   ✅ Enviados: ${sentCount}`);
            console.log(`   ❌ Fallidos: ${errorCount}`);
            console.log(`   📧 Total: ${recipients.length}`);

            // Si es el último lote, marcar comunicado como publicado
            if (batch.batch_number === batch.total_batches) {
                await CommuniqueModel.markAsPublished(batch.communique_id);
                console.log(`🎉 Comunicado "${batch.title}" completamente enviado`);
            }

        } catch (error) {
            console.error('❌ Error procesando cola:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Obtener destinatarios para un lote específico
     */
    async getRecipientsForBatch(communiqueId, batchNumber) {
        try {
            const offset = (batchNumber - 1) * this.batchSize;
            
            // Obtener notificaciones pendientes con paginación
            const { connectDB, sql } = require('../config/database');
            const pool = await connectDB();
            
            const result = await pool.request()
                .input('communiqueId', sql.UniqueIdentifier, communiqueId)
                .input('offset', sql.Int, offset)
                .input('limit', sql.Int, this.batchSize)
                .query(`
                    SELECT n.id, n.email, n.user_id, u.first_name, u.last_name
                    FROM CommuniqueNotifications n
                    LEFT JOIN Users u ON n.user_id = u.id
                    WHERE n.communique_id = @communiqueId AND n.status = 'pending'
                    ORDER BY n.created_at ASC
                    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
                `);

            return result.recordset;
        } catch (error) {
            console.error('Error getting recipients:', error);
            return [];
        }
    }

    /**
     * Generar template HTML para el email
     */
    generateEmailTemplate(communique) {
        const currentDate = new Date().toLocaleDateString('es-VE', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'America/Caracas'
        });

        return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Comunicado de la Junta</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .email-container {
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #8B5028 0%, #6b3d1f 100%);
            padding: 30px 20px;
            text-align: center;
        }
        .header h1 {
            color: white;
            margin: 0;
            font-size: 24px;
        }
        .content {
            padding: 30px;
        }
        .title {
            color: #1a1a1a;
            font-size: 22px;
            margin-bottom: 15px;
        }
        .description {
            background-color: #f8f9fa;
            padding: 15px;
            border-left: 4px solid #8B5028;
            margin: 20px 0;
            font-style: italic;
        }
        .cta-button {
            display: inline-block;
            background-color: #8B5028;
            color: white;
            padding: 14px 30px;
            text-decoration: none;
            border-radius: 6px;
            margin: 20px 0;
            font-weight: 600;
            text-align: center;
        }
        .cta-button:hover {
            background-color: #6b3d1f;
        }
        .footer {
            background-color: #34495e;
            color: white;
            padding: 20px;
            text-align: center;
            font-size: 14px;
        }
        .date-info {
            color: #666;
            font-size: 13px;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1>📢 Comunicado de la Junta</h1>
        </div>
        
        <div class="content">
            <p>Estimado(a) propietario(a),</p>
            
            <p>La Junta de Condominio de <strong>${communique.tenant_name}</strong> ha publicado un nuevo comunicado:</p>
            
            <h2 class="title">${communique.title}</h2>
            
            ${communique.description ? `
            <div class="description">
                ${communique.description}
            </div>
            ` : ''}
            
            <div style="text-align: center;">
                <a href="${process.env.APP_URL || 'http://localhost:3000'}/owner/communiques/${communique.communique_id}" class="cta-button">
                    📄 Ver Comunicado Completo
                </a>
            </div>
            
            <p>Por favor, revise este comunicado en su totalidad para mantenerse informado sobre los asuntos importantes del condominio.</p>
            
            <div class="date-info">
                <strong>Fecha de publicación:</strong> ${currentDate}
            </div>
        </div>
        
        <div class="footer">
            <p><strong>${communique.tenant_name}</strong></p>
            <p style="font-size: 12px; margin-top: 10px; opacity: 0.8;">
                Este es un mensaje automático del sistema de comunicados.<br>
                Por favor, no responda a este correo.
            </p>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Agregar comunicado a la cola de envío
     */
    async queueCommunique(communiqueId, recipients) {
        try {
            console.log(`📧 Agregando comunicado ${communiqueId} a la cola...`);
            console.log(`   👥 ${recipients.length} destinatarios totales`);
            console.log(`   📦 Lotes de ${this.batchSize} = ${Math.ceil(recipients.length / this.batchSize)} lotes`);

            const totalBatches = await CommuniqueModel.addToEmailQueue(
                communiqueId, 
                recipients, 
                this.batchSize
            );

            console.log(`✅ Comunicado agregado a la cola en ${totalBatches} lotes`);
            return totalBatches;
        } catch (error) {
            console.error('Error queueing communique:', error);
            throw error;
        }
    }

    /**
     * Obtener estado de la cola
     */
    async getQueueStatus() {
        try {
            const { connectDB, sql } = require('../config/database');
            const pool = await connectDB();
            
            const result = await pool.request().query(`
                SELECT 
                    status,
                    COUNT(*) as count
                FROM CommuniqueEmailQueue
                GROUP BY status
            `);

            const status = {
                pending: 0,
                processing: 0,
                completed: 0,
                failed: 0
            };

            result.recordset.forEach(row => {
                status[row.status] = row.count;
            });

            return status;
        } catch (error) {
            console.error('Error getting queue status:', error);
            return null;
        }
    }
}

module.exports = new CommuniqueQueueService();
