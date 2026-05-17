const Migration = require('./Migration');

/**
 * Congelamiento de tasa BCV por preliminar (NONE | PERMANENT | WINDOW).
 */
class AddPreliminaryRateFreeze extends Migration {
    async up() {
        if (!(await this.tableExists('BillingPreliminaries'))) {
            console.log('   ⚠️ BillingPreliminaries no existe, omitiendo...');
            return;
        }

        const cols = [
            { name: 'exchange_rate_date', sql: 'DATE NULL' },
            { name: 'rate_freeze_mode', sql: "NVARCHAR(20) NOT NULL DEFAULT N'NONE'" },
            { name: 'rate_freeze_window_days', sql: 'INT NULL' }
        ];

        for (const c of cols) {
            if (!(await this.columnExists('BillingPreliminaries', c.name))) {
                await this.query(`ALTER TABLE BillingPreliminaries ADD ${c.name} ${c.sql}`);
                console.log(`   ✅ BillingPreliminaries.${c.name}`);
            }
        }

        await this.query(`
            IF NOT EXISTS (
                SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_BillingPreliminaries_RateFreezeMode'
            )
            ALTER TABLE BillingPreliminaries ADD CONSTRAINT CK_BillingPreliminaries_RateFreezeMode
                CHECK (rate_freeze_mode IN (N'NONE', N'PERMANENT', N'WINDOW'))
        `);
    }
}

module.exports = AddPreliminaryRateFreeze;
