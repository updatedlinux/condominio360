const Migration = require('./Migration');

/**
 * SuperAdmin: habilitar/deshabilitar acceso vehicular (NFC) por condominio.
 */
class AddVehicleAccessFeatureFlag extends Migration {
    async up() {
        if (!(await this.tableExists('Tenants'))) {
            console.log('   ⚠️ Tenants no existe, omitiendo flag de acceso vehicular...');
            return;
        }

        if (!(await this.columnExists('Tenants', 'vehicle_access_enabled'))) {
            await this.query(`
                ALTER TABLE Tenants ADD vehicle_access_enabled BIT NOT NULL DEFAULT 1
            `);
            console.log('   ✅ Tenants.vehicle_access_enabled');
        }
    }
}

module.exports = AddVehicleAccessFeatureFlag;
