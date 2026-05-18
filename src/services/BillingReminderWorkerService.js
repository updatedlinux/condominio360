const { CronJob } = require('cron');
const BillingReminderService = require('./BillingReminderService');

/**
 * Recordatorios automáticos de recibos vencidos (hitos) y deuda histórica (semanal).
 */
class BillingReminderWorkerService {
    constructor() {
        this.overdueJob = null;
        this.legacyJob = null;
        this.overdueRunning = false;
        this.legacyRunning = false;
    }

    static isEnabled() {
        const v = String(process.env.BILLING_REMINDER_WORKER_ENABLED || 'true').toLowerCase();
        return v !== '0' && v !== 'false' && v !== 'no';
    }

    start() {
        if (!BillingReminderWorkerService.isEnabled()) {
            console.log('⏭️  BillingReminderWorkerService deshabilitado (BILLING_REMINDER_WORKER_ENABLED)');
            return;
        }

        console.log('🚀 BillingReminderWorkerService: recibos vencidos diario 9:00, deuda histórica lunes 10:00 (America/Caracas)');

        this.overdueJob = new CronJob(
            '0 9 * * *',
            () => this._runOverdue(),
            null,
            true,
            'America/Caracas'
        );

        this.legacyJob = new CronJob(
            '0 10 * * 1',
            () => this._runLegacy(),
            null,
            true,
            'America/Caracas'
        );

        setTimeout(() => this._runOverdue().catch((e) => console.error('[BillingReminder] overdue inicial:', e)), 120000);
    }

    stop() {
        if (this.overdueJob) {
            this.overdueJob.stop();
            this.overdueJob = null;
        }
        if (this.legacyJob) {
            this.legacyJob.stop();
            this.legacyJob = null;
        }
    }

    async _runOverdue() {
        if (this.overdueRunning) return;
        this.overdueRunning = true;
        try {
            const r = await BillingReminderService.processOverdueReminders();
            if (r.sent > 0) {
                console.log(`[BillingReminder] Recibos vencidos: ${r.sent} correo(s), ${r.skipped} omitido(s)`);
            }
        } catch (e) {
            console.error('[BillingReminder] overdue:', e);
        } finally {
            this.overdueRunning = false;
        }
    }

    async _runLegacy() {
        if (this.legacyRunning) return;
        this.legacyRunning = true;
        try {
            const r = await BillingReminderService.processLegacyWeeklyReminders();
            if (r.sent > 0) {
                console.log(`[BillingReminder] Deuda histórica (${r.weekKey}): ${r.sent} correo(s)`);
            }
        } catch (e) {
            console.error('[BillingReminder] legacy:', e);
        } finally {
            this.legacyRunning = false;
        }
    }
}

module.exports = new BillingReminderWorkerService();
