const Migration = require('./Migration');
const { connectDB } = require('../config/database');

/**
 * Migración: Flujo de reportes de pago SaaS
 * - SystemSettings: Config global (saas_payment_info)
 * - SaaSPaymentReports: Reportes de pago de tenant admin a superadmin
 * - Campos paid en SaaSInvoices
 */
class CreateSaaSPaymentFlow extends Migration {
    async up() {
        const pool = await connectDB();

        // 1. SystemSettings para config global
        const settingsExists = await this.tableExists('SystemSettings');
        if (!settingsExists) {
            await this.query(`
                CREATE TABLE SystemSettings (
                    setting_key NVARCHAR(100) PRIMARY KEY,
                    setting_value NVARCHAR(MAX),
                    updated_at DATETIME2 DEFAULT SYSDATETIME()
                )
            `);
            console.log('   ✅ Tabla SystemSettings creada');
        }

        // 2. Campos paid en SaaSInvoices
        const paidColExists = await this.columnExists('SaaSInvoices', 'paid_amount_ves');
        if (!paidColExists) {
            await this.query(`
                ALTER TABLE SaaSInvoices ADD paid_amount_ves DECIMAL(18,2) NULL;
                ALTER TABLE SaaSInvoices ADD paid_at DATETIME2 NULL;
            `);
            console.log('   ✅ Campos paid agregados a SaaSInvoices');
        }

        // 3. SaaSPaymentReports
        const reportsExists = await this.tableExists('SaaSPaymentReports');
        if (!reportsExists) {
            await this.query(`
                CREATE TABLE SaaSPaymentReports (
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
                    CONSTRAINT FK_SaaSPaymentReports_Invoice FOREIGN KEY (invoice_id) REFERENCES SaaSInvoices(id) ON DELETE CASCADE,
                    CONSTRAINT FK_SaaSPaymentReports_SubmittedBy FOREIGN KEY (submitted_by) REFERENCES TenantAdmins(id),
                    CONSTRAINT FK_SaaSPaymentReports_ConfirmedBy FOREIGN KEY (confirmed_by) REFERENCES Users(id)
                )
            `);
            console.log('   ✅ Tabla SaaSPaymentReports creada');
        }
    }
}

module.exports = CreateSaaSPaymentFlow;
