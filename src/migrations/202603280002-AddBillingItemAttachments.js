const Migration = require('./Migration');

/**
 * Adjuntos opcionales por ítem de preliminar y de recibo (imagen/PDF de factura).
 */
class AddBillingItemAttachments extends Migration {
    async up() {
        const addCols = async (table) => {
            if (!(await this.tableExists(table))) return;
            if (!(await this.columnExists(table, 'attachment_path'))) {
                await this.query(`
                    ALTER TABLE ${table} ADD attachment_path NVARCHAR(500) NULL
                `);
                console.log(`   ➕ ${table}.attachment_path`);
            }
            if (!(await this.columnExists(table, 'attachment_mime'))) {
                await this.query(`
                    ALTER TABLE ${table} ADD attachment_mime NVARCHAR(100) NULL
                `);
                console.log(`   ➕ ${table}.attachment_mime`);
            }
        };

        await addCols('BillingPreliminaryItems');
        await addCols('BillingInvoiceItems');
    }

    async down() {
        for (const table of ['BillingInvoiceItems', 'BillingPreliminaryItems']) {
            if (!(await this.tableExists(table))) continue;
            if (await this.columnExists(table, 'attachment_mime')) {
                await this.query(`ALTER TABLE ${table} DROP COLUMN attachment_mime`);
            }
            if (await this.columnExists(table, 'attachment_path')) {
                await this.query(`ALTER TABLE ${table} DROP COLUMN attachment_path`);
            }
        }
    }
}

module.exports = AddBillingItemAttachments;
