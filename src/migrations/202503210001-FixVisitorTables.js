const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Agregar updated_at a VisitorPasses y corregir columnas en Visitors
 */
class FixVisitorTables extends Migration {
    async up() {
        // 1. Agregar updated_at a VisitorPasses si no existe
        const columnExists = await this.columnExists('VisitorPasses', 'updated_at');
        if (!columnExists) {
            await this.query(`
                ALTER TABLE VisitorPasses 
                ADD updated_at DATETIME2 DEFAULT SYSDATETIME()
            `);
            console.log('   ✅ Columna updated_at agregada a VisitorPasses');
        } else {
            console.log('   ⚠️ Columna updated_at ya existe en VisitorPasses');
        }

        // 2. Agregar is_active a Visitors si no existe (para marcar visitantes activos/inactivos)
        const isActiveExists = await this.columnExists('Visitors', 'is_active');
        if (!isActiveExists) {
            await this.query(`
                ALTER TABLE Visitors 
                ADD is_active BIT DEFAULT 1
            `);
            console.log('   ✅ Columna is_active agregada a Visitors');
        } else {
            console.log('   ⚠️ Columna is_active ya existe en Visitors');
        }

        // 3. Actualizar registros existentes para que tengan valores por defecto
        await this.query(`
            UPDATE VisitorPasses 
            SET updated_at = created_at 
            WHERE updated_at IS NULL
        `);
        
        console.log('   ✅ Migración completada');
    }

    async down() {
        // No eliminamos columnas para preservar datos
        console.log('   ⚠️ Down migration no implementada para preservar datos');
    }
}

module.exports = FixVisitorTables;
