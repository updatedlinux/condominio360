const Migration = require('./Migration');

/**
 * Migración: Agregar columnas de configuración de mudanza a RequestTypes
 */
class AddMoveColumnsToRequestTypes extends Migration {
    async up() {
        const columns = [
            { name: 'is_move_type', type: 'BIT', default: '0' },
            { name: 'move_type', type: 'NVARCHAR(20)', default: null },
            { name: 'days_allowed', type: 'NVARCHAR(MAX)', default: null },
            { name: 'time_range', type: 'NVARCHAR(20)', default: null },
            { name: 'requires_insurance', type: 'BIT', default: '0' },
            { name: 'requires_moving_company', type: 'BIT', default: '0' },
            { name: 'move_instructions', type: 'NVARCHAR(MAX)', default: null }
        ];

        for (const col of columns) {
            const exists = await this.columnExists('RequestTypes', col.name);
            if (!exists) {
                const defaultClause = col.default !== null ? `DEFAULT ${col.default}` : '';
                await this.query(`
                    ALTER TABLE RequestTypes 
                    ADD ${col.name} ${col.type} ${defaultClause}
                `);
                console.log(`   ✅ Columna ${col.name} agregada`);
            } else {
                console.log(`   ⚠️ Columna ${col.name} ya existe`);
            }
        }
    }

    async down() {
        const columns = ['is_move_type', 'move_type', 'days_allowed', 'time_range', 
                        'requires_insurance', 'requires_moving_company', 'move_instructions'];
        
        for (const col of columns) {
            const exists = await this.columnExists('RequestTypes', col.name);
            if (exists) {
                await this.query(`ALTER TABLE RequestTypes DROP COLUMN ${col}`);
                console.log(`   ✅ Columna ${col} eliminada`);
            }
        }
    }
}

module.exports = AddMoveColumnsToRequestTypes;
