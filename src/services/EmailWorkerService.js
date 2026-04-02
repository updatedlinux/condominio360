const { CronJob } = require('cron');
const EmailOrchestrator = require('./email/EmailOrchestrator');

/**
 * Worker de cola bulk (Mailgun API) y purga de email_logs según EMAIL_LOG_RETENTION_DAYS (por defecto 30).
 */
class EmailWorkerService {
    constructor() {
        this.bulkTask = null;
        this.purgeTask = null;
        this.isBulkRunning = false;
    }

    start() {
        const bulkEveryMin = parseInt(process.env.EMAIL_BULK_WORKER_CRON_MINUTES || '1', 10) || 1;
        console.log(`🚀 EmailWorkerService: bulk cada ${bulkEveryMin} min, purga diaria (retención ${process.env.EMAIL_LOG_RETENTION_DAYS || 30} días)`);

        this.bulkTask = new CronJob(
            `*/${bulkEveryMin} * * * *`,
            async () => {
                if (this.isBulkRunning) return;
                this.isBulkRunning = true;
                try {
                    const r = await EmailOrchestrator.processBulkBatch();
                    if (r.processed > 0) {
                        console.log(`[EmailWorker] Bulk procesados: ${r.processed}`);
                    }
                } catch (e) {
                    console.error('[EmailWorker] bulk:', e);
                } finally {
                    this.isBulkRunning = false;
                }
            },
            null,
            true,
            'America/Caracas'
        );

        this.purgeTask = new CronJob(
            '15 4 * * *',
            async () => {
                try {
                    const n = await EmailOrchestrator.purgeOldLogs();
                    if (n > 0) {
                        console.log(`[EmailWorker] Purga email_logs: ${n} filas`);
                    }
                } catch (e) {
                    console.error('[EmailWorker] purge:', e);
                }
            },
            null,
            true,
            'America/Caracas'
        );

        EmailOrchestrator.processBulkBatch().catch((e) => console.error('[EmailWorker] bulk inicial:', e));
        EmailOrchestrator.purgeOldLogs().catch((e) => console.error('[EmailWorker] purge inicial:', e));
    }

    stop() {
        if (this.bulkTask) {
            this.bulkTask.stop();
            this.bulkTask = null;
        }
        if (this.purgeTask) {
            this.purgeTask.stop();
            this.purgeTask = null;
        }
    }
}

module.exports = new EmailWorkerService();
