const Migration = require('./Migration');

/**
 * SuperAdmin: habilitar/deshabilitar anuncios de visitas y deliveries por condominio.
 */
class AddVisitDeliveryFeatureFlags extends Migration {
    async up() {
        if (!(await this.tableExists('Tenants'))) {
            console.log('   ⚠️ Tenants no existe, omitiendo flags de visitas/deliveries...');
            return;
        }

        const cols = [
            { name: 'visits_announcements_enabled', sql: 'BIT NOT NULL DEFAULT 1' },
            { name: 'deliveries_announcements_enabled', sql: 'BIT NOT NULL DEFAULT 1' }
        ];

        for (const c of cols) {
            if (!(await this.columnExists('Tenants', c.name))) {
                await this.query(`ALTER TABLE Tenants ADD ${c.name} ${c.sql}`);
                console.log(`   ✅ Tenants.${c.name}`);
            }
        }
    }
}

module.exports = AddVisitDeliveryFeatureFlags;
