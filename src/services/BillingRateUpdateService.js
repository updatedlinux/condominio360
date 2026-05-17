const BillingModel = require('../models/BillingModel');
const ExchangeRateModel = require('../models/ExchangeRateModel');
const BillingRateFreezeService = require('./BillingRateFreezeService');
const { usdToVes } = require('../utils/currencyConversion');
const BCVService = require('./BCVService');

/**
 * Servicio de actualización de tasas BCV para facturas pendientes
 * Se ejecuta diariamente para actualizar los montos VES según la tasa del día
 */
class BillingRateUpdateService {
    constructor() {
        this.isRunning = false;
        this.job = null;
    }

    /**
     * Iniciar el servicio de actualización
     */
    start() {
        console.log('🚀 Iniciando servicio de actualización de tasas de facturación...');
        
        // Ejecutar inmediatamente al iniciar
        this.updatePendingInvoices();
        
        // Programar ejecución diaria a las 6:00 PM (hora Venezuela) - alineado con publicación BCV
        const now = new Date();
        const venezuelaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
        const targetHour = 18; // 6 PM
        const targetMinute = 0;
        
        let nextRun = new Date(venezuelaTime);
        nextRun.setHours(targetHour, targetMinute, 0, 0);
        
        if (venezuelaTime.getHours() >= targetHour && venezuelaTime.getMinutes() >= targetMinute) {
            // Ya pasó la hora de hoy, programar para mañana
            nextRun.setDate(nextRun.getDate() + 1);
        }
        
        const msUntilNextRun = nextRun - venezuelaTime;
        
        console.log(`📅 Próxima actualización de tasas: ${nextRun.toLocaleString('es-VE', { timeZone: 'America/Caracas' })}`);
        
        // Timeout para la primera ejecución
        setTimeout(() => {
            this.updatePendingInvoices();
            // Luego ejecutar cada 24 horas
            this.job = setInterval(() => {
                this.updatePendingInvoices();
            }, 24 * 60 * 60 * 1000); // 24 horas
        }, msUntilNextRun);
    }

    /**
     * Detener el servicio
     */
    stop() {
        if (this.job) {
            clearInterval(this.job);
            this.job = null;
        }
        console.log('🛑 Servicio de actualización de tasas detenido');
    }

    /**
     * Actualizar recibos pendientes con la tasa BCV más reciente
     */
    async updatePendingInvoices() {
        if (this.isRunning) {
            console.log('⏳ Actualización de tasas ya en progreso...');
            return;
        }

        this.isRunning = true;
        console.log('🔄 Iniciando actualización de tasas para recibos pendientes...');

        try {
            // Tasa fiscal vía histórico (día hábil siguiente; viernes → lun/mar/mié si hay feriados).
            await BCVService.updateIfNeeded().catch(() => {});

            // Obtener tasa BCV más reciente (preliminares usan siempre la más reciente)
            const latestRate = await ExchangeRateModel.getLatest();
            
            if (!latestRate || !latestRate.usd_rate) {
                console.log('⚠️ No hay tasa BCV disponible. Saltando actualización.');
                this.isRunning = false;
                return;
            }

            const newRate = latestRate.usd_rate;
            console.log(`💱 Tasa BCV actual: ${newRate} VES/USD`);

            // Obtener recibos pendientes que necesitan actualización
            const pendingInvoices = await BillingModel.getPendingInvoicesForRateUpdate();
            
            if (pendingInvoices.length === 0) {
                console.log('✅ No hay recibos pendientes para actualizar');
                this.isRunning = false;
                return;
            }

            console.log(`📋 ${pendingInvoices.length} recibos pendientes encontrados`);

            let updatedCount = 0;
            let skippedCount = 0;

            for (const invoice of pendingInvoices) {
                try {
                    const preliminary = {
                        rate_freeze_mode: invoice.rate_freeze_mode,
                        rate_freeze_window_days: invoice.rate_freeze_window_days,
                        rate_unpaid_migrate_after_month: invoice.rate_unpaid_migrate_after_month,
                        created_at: invoice.preliminary_created_at,
                        exchange_rate_usd: invoice.preliminary_exchange_rate
                    };
                    if (!BillingRateFreezeService.shouldApplyDailyRateUpdate(preliminary)) {
                        skippedCount++;
                        continue;
                    }

                    // Solo actualizar si la tasa cambió
                    if (Math.abs(invoice.current_exchange_rate - newRate) < 0.01) {
                        skippedCount++;
                        continue;
                    }

                    // Calcular nuevo monto VES basado en el monto USD original
                    // El monto USD no cambia, solo se recalcula el VES
                    const newAmountVes = usdToVes(invoice.assigned_amount_usd, newRate);

                    // Actualizar recibo
                    await BillingModel.updateInvoiceRate(invoice.id, newRate, newAmountVes);
                    
                    updatedCount++;
                    
                    if (updatedCount % 100 === 0) {
                        console.log(`  📝 ${updatedCount} recibos actualizados...`);
                    }
                } catch (error) {
                    console.error(`❌ Error actualizando recibo ${invoice.id}:`, error.message);
                }
            }

            console.log(`✅ Actualización completada: ${updatedCount} actualizados, ${skippedCount} sin cambios`);

        } catch (error) {
            console.error('❌ Error en actualización de tasas:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Ejecutar actualización manual (para testing o forzar actualización)
     */
    async forceUpdate() {
        console.log('🔄 Forzando actualización manual de tasas...');
        await this.updatePendingInvoices();
    }
}

module.exports = new BillingRateUpdateService();
