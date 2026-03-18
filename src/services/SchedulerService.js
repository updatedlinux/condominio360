const { CronJob } = require('cron');
const BCVService = require('./BCVService');
const { connectDB } = require('../config/database');

/**
 * Servicio para manejar tareas programadas (cron jobs)
 * Usa la librería 'cron' que es más confiable con timezones
 */
class SchedulerService {
    constructor() {
        this.jobs = {};
        this.isRunning = false;
        this.timezone = 'America/Caracas'; // GMT-4 Venezuela
    }

    /**
     * Inicia todas las tareas programadas
     */
    start() {
        console.log('🚀 Iniciando Scheduler Service...');
        
        // Verificar zona horaria actual
        const venezuelaTime = new Date().toLocaleString('es-VE', { 
            timeZone: this.timezone,
            hour12: false 
        });
        console.log('🕐 Hora actual Venezuela (GMT-4):', venezuelaTime);

        // Tarea: Actualizar tasa BCV diariamente a las 6:00 PM (hora Venezuela)
        // El BCV publica las tasas del día siguiente a las ~5:30 PM
        // Cron: 0 18 * * * = minuto 0, hora 18, todos los días
        this.jobs.bcvUpdate = new CronJob(
            '0 18 * * *', // 6:00 PM
            async () => {
                const execTime = new Date().toLocaleString('es-VE', { 
                    timeZone: this.timezone,
                    hour12: false 
                });
                console.log(`⏰ [${execTime} GMT-4] Ejecutando tarea programada: Actualización BCV`);
                await this.updateBCVRate();
            },
            null, // onComplete
            true, // start immediately
            this.timezone // timezone
        );

        // Tarea: Verificar y actualizar si no hay tasa (el BCV publica la del día siguiente en la tarde/noche)
        // Se ejecuta cada hora entre 6 AM y 11 PM (Venezuela) para capturar tasas publicadas tarde
        this.jobs.bcvCheck = new CronJob(
            '0 6-23 * * *', // Cada hora entre 6 AM y 11 PM
            async () => {
                const execTime = new Date().toLocaleString('es-VE', { 
                    timeZone: this.timezone,
                    hour12: false 
                });
                console.log(`🔍 [${execTime} GMT-4] Verificando si se necesita actualizar tasa BCV...`);
                await BCVService.updateIfNeeded();
            },
            null,
            true,
            this.timezone
        );

        // Verificación BCV al iniciar (captura tasa si ya fue publicada)
        (async () => {
            await new Promise(r => setTimeout(r, 3000));
            console.log('🔍 Verificación BCV al inicio...');
            await BCVService.updateIfNeeded();
        })();

        // Tarea: Enviar notificaciones in-app programadas
        this.jobs.sendScheduledNotifications = new CronJob(
            '*/2 * * * *', // Cada 2 minutos
            async () => {
                try {
                    const InAppNotificationModel = require('../models/InAppNotificationModel');
                    const due = await InAppNotificationModel.getScheduledDue();
                    for (const n of due) {
                        await InAppNotificationModel.markAsSent(n.id);
                        console.log(`📤 Notificación in-app enviada: ${n.id}`);
                    }
                } catch (e) {
                    console.error('Error enviando notificaciones programadas:', e);
                }
            },
            null,
            true,
            this.timezone
        );

        // Tarea: Cerrar consultas automáticamente cuando vence la fecha
        // Se ejecuta cada 5 minutos para verificar consultas vencidas
        this.jobs.closeConsultations = new CronJob(
            '*/5 * * * *', // Cada 5 minutos
            async () => {
                const execTime = new Date().toLocaleString('es-VE', { 
                    timeZone: this.timezone,
                    hour12: false 
                });
                console.log(`🔒 [${execTime} GMT-4] Verificando consultas para cerrar automáticamente...`);
                await this.closeExpiredConsultations();
            },
            null,
            true,
            this.timezone
        );

        this.isRunning = true;
        console.log('✅ Scheduler Service iniciado');
        console.log('📅 Tareas programadas (Zona horaria: America/Caracas | GMT-4):');
        console.log('   - Actualización BCV: Todos los días a las 18:00 (6:00 PM Venezuela)');
        console.log('   - Verificación BCV: Cada hora entre 06:00 y 23:00 (6 AM - 11 PM Venezuela)');
        console.log('   - Cierre de consultas: Cada 5 minutos');
        
        // Mostrar próxima ejecución
        console.log('   📌 Próxima ejecución BCV:', this.jobs.bcvUpdate.nextDate().toLocaleString('es-VE', { timeZone: this.timezone }));
    }

    /**
     * Detiene todas las tareas programadas
     */
    stop() {
        console.log('🛑 Deteniendo Scheduler Service...');
        
        Object.values(this.jobs).forEach(job => {
            if (job) job.stop();
        });
        
        this.isRunning = false;
        console.log('✅ Scheduler Service detenido');
    }

    /**
     * Actualiza la tasa BCV manualmente
     */
    async updateBCVRate() {
        try {
            const venezuelaTime = new Date().toLocaleString('es-VE', { 
                timeZone: this.timezone,
                hour12: false 
            });
            console.log(`🌐 Consultando API BCV a las ${venezuelaTime} (GMT-4)...`);
            
            const result = await BCVService.fetchAndSave();
            if (result) {
                console.log(`✅ Tasa BCV actualizada: ${result.date} | USD: ${result.usd} | EUR: ${result.eur}`);
            } else {
                console.error('❌ No se pudo actualizar la tasa BCV');
            }
            return result;
        } catch (error) {
            console.error('❌ Error en actualización BCV:', error);
            return null;
        }
    }

    /**
     * Cierra automáticamente las consultas que han vencido
     * Usa GETUTCDATE() para comparar con las fechas almacenadas en UTC
     */
    async closeExpiredConsultations() {
        try {
            const pool = await connectDB();
            
            // Buscar consultas OPEN que ya pasaron su fecha de cierre
            // end_date se almacena como UTC 04:00 (00:00 Venezuela)
            // GETUTCDATE() retorna la hora actual en UTC
            const result = await pool.request().query(`
                UPDATE Consultations
                SET status = 'CLOSED', updated_at = SYSDATETIME()
                OUTPUT INSERTED.id, INSERTED.title, INSERTED.tenant_id
                WHERE status = 'OPEN'
                AND end_date < GETUTCDATE()
            `);
            
            if (result.recordset.length > 0) {
                console.log(`🔒 ${result.recordset.length} consulta(s) cerrada(s) automáticamente:`);
                result.recordset.forEach(c => {
                    console.log(`   - "${c.title}" (ID: ${c.id})`);
                });
            } else {
                console.log('🔍 No hay consultas vencidas para cerrar');
            }
            
            return result.recordset;
        } catch (error) {
            console.error('❌ Error al cerrar consultas expiradas:', error);
            return [];
        }
    }

    /**
     * Obtiene el estado del scheduler
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            jobs: Object.keys(this.jobs),
            timezone: this.timezone,
            nextRuns: {
                bcvUpdate: this.jobs.bcvUpdate?.nextDate()?.toISOString(),
                bcvCheck: this.jobs.bcvCheck?.nextDate()?.toISOString(),
                closeConsultations: this.jobs.closeConsultations?.nextDate()?.toISOString()
            }
        };
    }
}

module.exports = new SchedulerService();
