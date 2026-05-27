const Migration = require('./Migration');
const { connectDB } = require('../config/database');

/**
 * Banco de Venezuela en conciliación + campos enriquecidos en movimientos
 * (cédula pagador, teléfono, medio de pago, banco contraparte).
 */
class AddBancoDeVenezuelaReconciliation extends Migration {
    async up() {
        const pool = await connectDB();

        const cols = [
            { name: 'payer_document', def: 'NVARCHAR(20) NULL' },
            { name: 'payer_phone', def: 'NVARCHAR(20) NULL' },
            { name: 'payment_method', def: 'NVARCHAR(30) NULL' },
            { name: 'counterparty_bank_code', def: 'NVARCHAR(10) NULL' }
        ];

        for (const col of cols) {
            const exists = await pool.request().query(`
                SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'BankStatementMovements' AND COLUMN_NAME = '${col.name}'
            `);
            if (exists.recordset.length === 0) {
                await this.query(`ALTER TABLE BankStatementMovements ADD ${col.name} ${col.def}`);
                console.log(`   ✅ BankStatementMovements.${col.name}`);
            }
        }

        const seed = {
            code: 'BDV',
            name: 'Banco de Venezuela',
            parser_key: 'bdv-pdf',
            display_order: 15
        };

        const exists = await pool.request()
            .input('code', this.sql.NVarChar, seed.code)
            .query('SELECT id FROM Banks WHERE code = @code');

        if (exists.recordset.length === 0) {
            await pool.request()
                .input('code', this.sql.NVarChar, seed.code)
                .input('name', this.sql.NVarChar, seed.name)
                .input('parser_key', this.sql.NVarChar, seed.parser_key)
                .input('display_order', this.sql.Int, seed.display_order)
                .query(`
                    INSERT INTO Banks (code, name, parser_key, supports_pdf, is_active, display_order)
                    VALUES (@code, @name, @parser_key, 1, 1, @display_order)
                `);
            console.log(`   ✅ Banco sembrado: ${seed.code}`);
        }
    }
}

module.exports = AddBancoDeVenezuelaReconciliation;
