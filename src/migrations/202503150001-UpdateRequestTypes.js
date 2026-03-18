const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Actualizar tabla RequestTypes para soportar campos dinámicos
 * y configuración de tipos de solicitud personalizables
 */
class UpdateRequestTypes extends Migration {
    async up() {
        // 1. Agregar columna is_system para identificar tipos predefinidos
        const isSystemExists = await this.columnExists('RequestTypes', 'is_system');
        if (!isSystemExists) {
            await this.query(`
                ALTER TABLE RequestTypes 
                ADD is_system BIT DEFAULT 0
            `);
            console.log('   ✅ Columna is_system agregada');
        }

        // 2. Agregar columna icon para el tipo
        const iconExists = await this.columnExists('RequestTypes', 'icon');
        if (!iconExists) {
            await this.query(`
                ALTER TABLE RequestTypes 
                ADD icon NVARCHAR(50) NULL
            `);
            console.log('   ✅ Columna icon agregada');
        }

        // 3. Agregar columna color para el tipo
        const colorExists = await this.columnExists('RequestTypes', 'color');
        if (!colorExists) {
            await this.query(`
                ALTER TABLE RequestTypes 
                ADD color NVARCHAR(20) NULL
            `);
            console.log('   ✅ Columna color agregada');
        }

        // 4. Agregar columna requires_approval
        const requiresApprovalExists = await this.columnExists('RequestTypes', 'requires_approval');
        if (!requiresApprovalExists) {
            await this.query(`
                ALTER TABLE RequestTypes 
                ADD requires_approval BIT DEFAULT 0
            `);
            console.log('   ✅ Columna requires_approval agregada');
        }

        // 5. Agregar columna auto_assign_to
        const autoAssignExists = await this.columnExists('RequestTypes', 'auto_assign_to');
        if (!autoAssignExists) {
            await this.query(`
                ALTER TABLE RequestTypes 
                ADD auto_assign_to NVARCHAR(100) NULL
            `);
            console.log('   ✅ Columna auto_assign_to agregada');
        }

        // 6. Actualizar form_schema para soportar JSON más completo
        // La columna ya existe, solo verificamos que tenga el tamaño adecuado
        const schemaResult = await this.query(`
            SELECT CHARACTER_MAXIMUM_LENGTH 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'RequestTypes' AND COLUMN_NAME = 'form_schema'
        `);

        if (schemaResult.recordset[0]?.CHARACTER_MAXIMUM_LENGTH < 4000) {
            // Cambiar a NVARCHAR(MAX) si es necesario
            await this.query(`
                ALTER TABLE RequestTypes 
                ALTER COLUMN form_schema NVARCHAR(MAX)
            `);
            console.log('   ✅ Columna form_schema actualizada a NVARCHAR(MAX)');
        }

        // 7. Agregar índice en tenant_id + is_active
        const indexExists = await this.indexExists('RequestTypes', 'IX_RequestTypes_Tenant_Active');
        if (!indexExists) {
            await this.query(`
                CREATE INDEX IX_RequestTypes_Tenant_Active 
                ON RequestTypes(tenant_id, is_active)
                INCLUDE (name, description, icon, color)
            `);
            console.log('   ✅ Índice IX_RequestTypes_Tenant_Active creado');
        }

        console.log('   ✅ RequestTypes actualizada exitosamente');
    }

    async down() {
        // Eliminar en orden inverso
        const columnsToRemove = [
            'auto_assign_to',
            'requires_approval',
            'color',
            'icon',
            'is_system'
        ];

        for (const column of columnsToRemove) {
            const exists = await this.columnExists('RequestTypes', column);
            if (exists) {
                await this.query(`ALTER TABLE RequestTypes DROP COLUMN ${column}`);
                console.log(`   ✅ Columna ${column} eliminada`);
            }
        }

        // Eliminar índice
        const indexExists = await this.indexExists('RequestTypes', 'IX_RequestTypes_Tenant_Active');
        if (indexExists) {
            await this.query('DROP INDEX IX_RequestTypes_Tenant_Active ON RequestTypes');
            console.log('   ✅ Índice eliminado');
        }
    }
}

module.exports = UpdateRequestTypes;
