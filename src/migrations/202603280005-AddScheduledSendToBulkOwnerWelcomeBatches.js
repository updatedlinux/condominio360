const Migration = require('./Migration');

/**
 * Permite programar el inicio del envío de correos de bienvenida (carga masiva).
 * scheduled_send_at en UTC; el cron compara con SYSUTCDATETIME().
 */
class AddScheduledSendToBulkOwnerWelcomeBatches extends Migration {
    async up() {
        const tableExists = await this.tableExists('BulkOwnerWelcomeBatches');
        if (!tableExists) {
            console.log('   ⚠️ Tabla BulkOwnerWelcomeBatches no existe, omitiendo...');
            return;
        }
        if (await this.columnExists('BulkOwnerWelcomeBatches', 'scheduled_send_at')) {
            console.log('   ⚠️ Columna scheduled_send_at ya existe, omitiendo...');
            return;
        }

        await this.query(`
            ALTER TABLE BulkOwnerWelcomeBatches
            ADD scheduled_send_at DATETIME2 NULL
        `);

        if (!(await this.indexExists('BulkOwnerWelcomeBatches', 'IX_BulkOwnerWelcomeBatches_ScheduledDue'))) {
            await this.query(`
                CREATE NONCLUSTERED INDEX IX_BulkOwnerWelcomeBatches_ScheduledDue
                ON BulkOwnerWelcomeBatches (status, scheduled_send_at)
            `);
        }

        console.log('   ✅ scheduled_send_at añadido a BulkOwnerWelcomeBatches');
    }

    async down() {
        const tableExists = await this.tableExists('BulkOwnerWelcomeBatches');
        if (!tableExists) return;

        if (await this.indexExists('BulkOwnerWelcomeBatches', 'IX_BulkOwnerWelcomeBatches_ScheduledDue')) {
            await this.query('DROP INDEX IX_BulkOwnerWelcomeBatches_ScheduledDue ON BulkOwnerWelcomeBatches');
        }

        if (await this.columnExists('BulkOwnerWelcomeBatches', 'scheduled_send_at')) {
            await this.query('ALTER TABLE BulkOwnerWelcomeBatches DROP COLUMN scheduled_send_at');
        }

        console.log('   ✅ Columna scheduled_send_at eliminada');
    }
}

module.exports = AddScheduledSendToBulkOwnerWelcomeBatches;
