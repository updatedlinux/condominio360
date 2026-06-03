const Migration = require('./Migration');
const { connectDB } = require('../config/database');

/**
 * Nota descriptiva opcional al pie de la carta consulta.
 */
class AddConsultationFooterNote extends Migration {
    async up() {
        const pool = await connectDB();
        const exists = await pool.request().query(`
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'Consultations' AND COLUMN_NAME = 'footer_note'
        `);
        if (exists.recordset.length === 0) {
            await this.query(`
                ALTER TABLE Consultations
                ADD footer_note NVARCHAR(MAX) NULL
            `);
            console.log('   ✅ Consultations.footer_note');
        }
    }
}

module.exports = AddConsultationFooterNote;
