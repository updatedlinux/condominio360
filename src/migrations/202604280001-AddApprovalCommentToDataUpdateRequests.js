const Migration = require('./Migration');

/**
 * Comentario opcional del superadmin al aprobar (visible en correo y modal).
 * El rechazo ya usa rejection_reason; este campo cubre el mensaje en aprobación.
 */
class AddApprovalCommentToDataUpdateRequests extends Migration {
    async up() {
        if (!(await this.tableExists('DataUpdateRequests'))) {
            console.log('   ⚠️ DataUpdateRequests no existe, omitiendo approval_comment');
            return;
        }
        if (!(await this.columnExists('DataUpdateRequests', 'approval_comment'))) {
            await this.query(`
                ALTER TABLE DataUpdateRequests
                ADD approval_comment NVARCHAR(1000) NULL
            `);
            console.log('   ✅ Columna approval_comment agregada a DataUpdateRequests');
        }
    }

    async down() {
        if (await this.columnExists('DataUpdateRequests', 'approval_comment')) {
            await this.query(`ALTER TABLE DataUpdateRequests DROP COLUMN approval_comment`);
            console.log('   ✅ Columna approval_comment eliminada');
        }
    }
}

module.exports = AddApprovalCommentToDataUpdateRequests;
