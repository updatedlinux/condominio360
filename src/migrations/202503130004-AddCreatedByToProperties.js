const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Agregar campo created_by a Properties
 * Para auditoría - saber quién creó cada unidad inmobiliaria
 */
class AddCreatedByToProperties extends Migration {
    async up() {
        // 1. Agregar columna created_by
        const createdByExists = await this.columnExists('Properties', 'created_by');
        if (!createdByExists) {
            await this.query(`
                ALTER TABLE Properties 
                ADD created_by UNIQUEIDENTIFIER NULL
            `);
            console.log('   ✅ Columna created_by agregada a Properties');
        } else {
            console.log('   ⚠️ Columna created_by ya existe en Properties');
        }

        // 2. Agregar columna created_by_type (para saber si fue Superadmin, Junta, o sistema)
        const createdByTypeExists = await this.columnExists('Properties', 'created_by_type');
        if (!createdByTypeExists) {
            await this.query(`
                ALTER TABLE Properties 
                ADD created_by_type NVARCHAR(20) DEFAULT 'SYSTEM' 
                    CHECK (created_by_type IN ('SUPERADMIN', 'JUNTA', 'SYSTEM', 'IMPORT'))
            `);
            console.log('   ✅ Columna created_by_type agregada a Properties');
        } else {
            console.log('   ⚠️ Columna created_by_type ya existe en Properties');
        }

        // 3. Crear índice en created_by
        const indexExists = await this.indexExists('Properties', 'IX_Properties_CreatedBy');
        if (!indexExists) {
            await this.query(`
                CREATE INDEX IX_Properties_CreatedBy 
                ON Properties(created_by)
            `);
            console.log('   ✅ Índice IX_Properties_CreatedBy creado');
        } else {
            console.log('   ⚠️ Índice IX_Properties_CreatedBy ya existe');
        }

        // 4. Crear foreign key (opcional, ya que puede ser de diferentes tablas)
        // Nota: No creamos FK estricta porque created_by puede referenciar Users o TenantAdmins
    }

    async down() {
        // Eliminar índice
        const indexExists = await this.indexExists('Properties', 'IX_Properties_CreatedBy');
        if (indexExists) {
            await this.query(`DROP INDEX IF EXISTS IX_Properties_CreatedBy ON Properties`);
            console.log('   ✅ Índice IX_Properties_CreatedBy eliminado');
        }

        // Eliminar constraint CHECK si existe
        const checkConstraintExists = await this.query(`
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE 
            WHERE TABLE_NAME = 'Properties' AND COLUMN_NAME = 'created_by_type'
        `);
        
        if (checkConstraintExists.recordset[0].count > 0) {
            // Buscar el nombre de la constraint
            const constraintName = await this.query(`
                SELECT CONSTRAINT_NAME 
                FROM INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE 
                WHERE TABLE_NAME = 'Properties' AND COLUMN_NAME = 'created_by_type'
            `);
            
            if (constraintName.recordset.length > 0) {
                const name = constraintName.recordset[0].CONSTRAINT_NAME;
                await this.query(`ALTER TABLE Properties DROP CONSTRAINT ${name}`);
                console.log(`   ✅ Constraint ${name} eliminada`);
            }
        }

        // Eliminar columnas
        const columnsToRemove = ['created_by_type', 'created_by'];
        
        for (const column of columnsToRemove) {
            const exists = await this.columnExists('Properties', column);
            if (exists) {
                await this.query(`
                    ALTER TABLE Properties 
                    DROP COLUMN ${column}
                `);
                console.log(`   ✅ Columna ${column} eliminada de Properties`);
            }
        }
    }
}

module.exports = AddCreatedByToProperties;
