const Migration = require('./Migration');
const { connectDB } = require('../config/database');

/**
 * Migración: Reportes de Pago por Propietarios
 * - BillingPaymentReports: reportes enviados por propietarios para confirmar pago
 */
class CreateBillingPaymentReports extends Migration {
    async up() {
        const pool = await connectDB();

        const exists = await this.tableExists('BillingPaymentReports');
        if (!exists) {
            await this.query(`
                CREATE TABLE BillingPaymentReports (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    invoice_id UNIQUEIDENTIFIER NOT NULL,
                    submitted_by UNIQUEIDENTIFIER NOT NULL,
                    banco_emisor NVARCHAR(255) NOT NULL,
                    fecha_transferencia NVARCHAR(20) NOT NULL,
                    ref_transferencia NVARCHAR(255) NOT NULL,
                    monto_abonado_ves DECIMAL(15,2) NOT NULL,
                    comentario NVARCHAR(500) NULL,
                    attachment_path NVARCHAR(500) NULL,
                    status NVARCHAR(30) DEFAULT 'PENDING_CONFIRMATION',
                    rejection_reason NVARCHAR(500) NULL,
                    confirmed_by UNIQUEIDENTIFIER NULL,
                    confirmed_at DATETIME2 NULL,
                    rejected_at DATETIME2 NULL,
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_BillingPaymentReports_Invoice FOREIGN KEY (invoice_id) REFERENCES BillingInvoices(id) ON DELETE CASCADE,
                    CONSTRAINT FK_BillingPaymentReports_SubmittedBy FOREIGN KEY (submitted_by) REFERENCES Users(id),
                    CONSTRAINT FK_BillingPaymentReports_ConfirmedBy FOREIGN KEY (confirmed_by) REFERENCES TenantAdmins(id)
                )
            `);
            console.log('   ✅ Tabla BillingPaymentReports creada');
        }
    }
}

module.exports = CreateBillingPaymentReports;
