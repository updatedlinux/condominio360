const Migration = require('./Migration');

/**
 * SuperAdmin: habilitar/deshabilitar áreas comunes y reservas por condominio.
 */
class AddCommonAreasFeatureFlag extends Migration {
    async up() {
        if (!(await this.tableExists('Tenants'))) {
            console.log('   ⚠️ Tenants no existe, omitiendo flag de áreas comunes...');
            return;
        }

        if (!(await this.columnExists('Tenants', 'common_areas_enabled'))) {
            await this.query(`
                ALTER TABLE Tenants ADD common_areas_enabled BIT NOT NULL DEFAULT 1
            `);
            console.log('   ✅ Tenants.common_areas_enabled');
        }
    }
}

module.exports = AddCommonAreasFeatureFlag;
