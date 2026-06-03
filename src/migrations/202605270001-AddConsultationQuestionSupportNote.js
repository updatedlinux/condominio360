const Migration = require('./Migration');
const { connectDB } = require('../config/database');

/**
 * Nota de apoyo opcional por pregunta en cartas consulta.
 */
class AddConsultationQuestionSupportNote extends Migration {
    async up() {
        const pool = await connectDB();
        const exists = await pool.request().query(`
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'ConsultationQuestions' AND COLUMN_NAME = 'support_note'
        `);
        if (exists.recordset.length === 0) {
            await this.query(`
                ALTER TABLE ConsultationQuestions
                ADD support_note NVARCHAR(1000) NULL
            `);
            console.log('   ✅ ConsultationQuestions.support_note');
        }
    }
}

module.exports = AddConsultationQuestionSupportNote;
