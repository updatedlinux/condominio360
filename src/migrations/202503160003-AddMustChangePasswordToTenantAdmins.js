const Migration = require('./Migration');

/**
 * Migración: Agregar columna must_change_password a TenantAdmins
 * Obliga al admin de junta a cambiar contraseña en el primer login
 */
class AddMustChangePasswordToTenantAdmins extends Migration {
    async up() {
        const exists = await this.columnExists('TenantAdmins', 'must_change_password');
        if (exists) {
            console.log('   ⚠️ Columna must_change_password ya existe, omitiendo...');
            return;
        }

        await this.query(`
            ALTER TABLE TenantAdmins
            ADD must_change_password BIT NOT NULL DEFAULT 0
        `);

        console.log('   ✅ Columna must_change_password agregada a TenantAdmins');
    }

    async down() {
        const exists = await this.columnExists('TenantAdmins', 'must_change_password');
        if (!exists) {
            console.log('   ⚠️ Columna must_change_password no existe');
            return;
        }

        await this.query(`
            ALTER TABLE TenantAdmins
            DROP COLUMN must_change_password
        `);

        console.log('   ✅ Columna must_change_password eliminada');
    }
}

module.exports = AddMustChangePasswordToTenantAdmins;
