const Migration = require('./Migration');

/**
 * Migración: Eliminar FK de created_by en SecurityUsers
 * Permite que created_by sea cualquier ID (TenantAdmin, SuperAdmin, etc.)
 */
class FixSecurityUsersFK extends Migration {
    async up() {
        // Verificar si existe el constraint
        const constraintExists = await this.query(`
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
            WHERE TABLE_NAME = 'SecurityUsers' 
            AND CONSTRAINT_NAME = 'FK_SecurityUsers_CreatedBy'
        `);

        if (constraintExists.recordset[0].count > 0) {
            await this.query(`
                ALTER TABLE SecurityUsers 
                DROP CONSTRAINT FK_SecurityUsers_CreatedBy
            `);
            console.log('   ✅ FK_SecurityUsers_CreatedBy eliminado');
        } else {
            console.log('   ⚠️ Constraint FK_SecurityUsers_CreatedBy no existe');
        }
    }

    async down() {
        // No restauramos el FK porque causa problemas con IDs de diferentes tablas
        console.log('   ⚠️ No se restaura el FK en down() - causa incompatibilidad');
    }
}

module.exports = FixSecurityUsersFK;
