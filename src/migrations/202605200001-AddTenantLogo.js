const Migration = require('./Migration');

/**
 * Logo del conjunto para comprobantes PDF de recibos (superadmin).
 */
class AddTenantLogo extends Migration {
    async up() {
        if (!(await this.tableExists('Tenants'))) {
            console.log('   ⚠️ Tenants no existe, omitiendo logo_path...');
            return;
        }

        if (!(await this.columnExists('Tenants', 'logo_path'))) {
            await this.query('ALTER TABLE Tenants ADD logo_path NVARCHAR(500) NULL');
            console.log('   ✅ Tenants.logo_path');
        }
    }
}

module.exports = AddTenantLogo;
