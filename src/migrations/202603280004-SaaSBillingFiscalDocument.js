const Migration = require('./Migration');

/**
 * Tipo de documento de cobro (factura fiscal vs comprobante sin costo) y adjunto de factura fiscal.
 */
class SaaSBillingFiscalDocument extends Migration {
    async up() {
        if (!(await this.tableExists('SaaSInvoices'))) return;

        if (!(await this.columnExists('SaaSInvoices', 'billing_document_type'))) {
            await this.query(`
                ALTER TABLE SaaSInvoices ADD billing_document_type NVARCHAR(20) NULL
            `);
            console.log('   ➕ SaaSInvoices.billing_document_type');
        }
        if (!(await this.columnExists('SaaSInvoices', 'fiscal_invoice_attachment_path'))) {
            await this.query(`
                ALTER TABLE SaaSInvoices ADD fiscal_invoice_attachment_path NVARCHAR(500) NULL
            `);
            console.log('   ➕ SaaSInvoices.fiscal_invoice_attachment_path');
        }
        if (!(await this.columnExists('SaaSInvoices', 'fiscal_invoice_attachment_mime'))) {
            await this.query(`
                ALTER TABLE SaaSInvoices ADD fiscal_invoice_attachment_mime NVARCHAR(100) NULL
            `);
            console.log('   ➕ SaaSInvoices.fiscal_invoice_attachment_mime');
        }
    }

    async down() {
        if (!(await this.tableExists('SaaSInvoices'))) return;
        if (await this.columnExists('SaaSInvoices', 'fiscal_invoice_attachment_mime')) {
            await this.query('ALTER TABLE SaaSInvoices DROP COLUMN fiscal_invoice_attachment_mime');
        }
        if (await this.columnExists('SaaSInvoices', 'fiscal_invoice_attachment_path')) {
            await this.query('ALTER TABLE SaaSInvoices DROP COLUMN fiscal_invoice_attachment_path');
        }
        if (await this.columnExists('SaaSInvoices', 'billing_document_type')) {
            await this.query('ALTER TABLE SaaSInvoices DROP COLUMN billing_document_type');
        }
    }
}

module.exports = SaaSBillingFiscalDocument;
