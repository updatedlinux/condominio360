const { CronJob } = require('cron');
const BulkOwnerWelcomeBatchModel = require('../models/BulkOwnerWelcomeBatchModel');
const OwnerBulkWelcomeEmailService = require('./OwnerBulkWelcomeEmailService');

/**
 * Dispara envíos de bienvenida masiva cuando llega la hora programada (UTC en BD).
 */
class BulkOwnerWelcomeSchedulerService {
    constructor() {
        this.task = null;
    }

    start() {
        this.task = new CronJob(
            '*/1 * * * *',
            async () => {
                await this.tick();
            },
            null,
            true,
            'America/Caracas'
        );
        console.log('✅ Programación de bienvenidas masivas: revisión cada minuto');
    }

    stop() {
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
    }

    async tick() {
        try {
            const ids = await BulkOwnerWelcomeBatchModel.findDueScheduledBatchIds();
            if (ids.length === 0) return;
            for (const batchId of ids) {
                OwnerBulkWelcomeEmailService.queueProcess(batchId);
            }
        } catch (err) {
            console.error('[BulkWelcomeScheduler]', err);
        }
    }
}

module.exports = new BulkOwnerWelcomeSchedulerService();
