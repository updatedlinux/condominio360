const Migration = require('./Migration');

/**
 * Si congelamiento PERMANENTE: opción de pasar a tasa diaria tras 1 mes calendario impago.
 */
class AddPermanentFreezeUnpaidMigration extends Migration {
    async up() {
        if (!(await this.tableExists('BillingPreliminaries'))) return;

        if (!(await this.columnExists('BillingPreliminaries', 'rate_unpaid_migrate_after_month'))) {
            await this.query(`
                ALTER TABLE BillingPreliminaries
                ADD rate_unpaid_migrate_after_month BIT NOT NULL DEFAULT 0
            `);
            console.log('   ✅ BillingPreliminaries.rate_unpaid_migrate_after_month');
        }
    }
}

module.exports = AddPermanentFreezeUnpaidMigration;
