const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Agregar campos para tipos de mudanza a RequestTypes
 */
class AddMoveTypeToRequestTypes extends Migration {
    async up() {
        // Verificar si la columna ya existe
        const columnExists = await this.columnExists('RequestTypes', 'is_move_type');
        
        if (!columnExists) {
            await this.query(`
                ALTER TABLE RequestTypes 
                ADD is_move_type BIT DEFAULT 0
            `);
            console.log('   ✅ Columna is_move_type agregada');
        } else {
            console.log('   ⚠️ Columna is_move_type ya existe');
        }

        // Agregar campo para tipo de mudanza (ENTRY, EXIT, BOTH)
        const moveTypeExists = await this.columnExists('RequestTypes', 'move_type');
        if (!moveTypeExists) {
            await this.query(`
                ALTER TABLE RequestTypes 
                ADD move_type NVARCHAR(20) NULL 
                    CHECK (move_type IN ('ENTRY', 'EXIT', 'BOTH'))
            `);
            console.log('   ✅ Columna move_type agregada');
        } else {
            console.log('   ⚠️ Columna move_type ya existe');
        }

        // Agregar campo para requerir seguro
        const requiresInsuranceExists = await this.columnExists('RequestTypes', 'requires_insurance');
        if (!requiresInsuranceExists) {
            await this.query(`
                ALTER TABLE RequestTypes 
                ADD requires_insurance BIT DEFAULT 0
            `);
            console.log('   ✅ Columna requires_insurance agregada');
        } else {
            console.log('   ⚠️ Columna requires_insurance ya existe');
        }

        // Agregar campo para requerir empresa de mudanza
        const requiresCompanyExists = await this.columnExists('RequestTypes', 'requires_moving_company');
        if (!requiresCompanyExists) {
            await this.query(`
                ALTER TABLE RequestTypes 
                ADD requires_moving_company BIT DEFAULT 0
            `);
            console.log('   ✅ Columna requires_moving_company agregada');
        } else {
            console.log('   ⚠️ Columna requires_moving_company ya existe');
        }
    }

    async down() {
        // Eliminar columnas si existen
        const columns = ['is_move_type', 'move_type', 'requires_insurance', 'requires_moving_company'];
        
        for (const column of columns) {
            const exists = await this.columnExists('RequestTypes', column);
            if (exists) {
                await this.query(`
                    ALTER TABLE RequestTypes 
                    DROP COLUMN ${column}
                `);
                console.log(`   ✅ Columna ${column} eliminada`);
            }
        }
    }
}

module.exports = AddMoveTypeToRequestTypes;
