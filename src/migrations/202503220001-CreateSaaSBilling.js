const Migration = require('./Migration');
const { connectDB } = require('../config/database');

/**
 * Migración: Facturación SaaS (Condominio360 → Condominios)
 * - SaaSInvoices: Facturas mensuales del SaaS a cada condominio
 * - SaaSInvoiceItems: Items de factura (base 0.50×unidades + extraordinarios)
 */
class CreateSaaSBilling extends Migration {
    async up() {
        const pool = await connectDB();

        // 1. SaaSInvoices
        const invoicesExists = await this.tableExists('SaaSInvoices');
        if (!invoicesExists) {
            await this.query(`
                CREATE TABLE SaaSInvoices (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    period_month INT NOT NULL,
                    period_year INT NOT NULL,
                    total_usd DECIMAL(15,4) NOT NULL DEFAULT 0,
                    total_ves DECIMAL(18,2) NOT NULL DEFAULT 0,
                    bcv_rate DECIMAL(12,4) NOT NULL,
                    bcv_rate_date DATE NOT NULL,
                    payment_method NVARCHAR(50) NULL,
                    status NVARCHAR(20) DEFAULT 'PENDING',
                    property_count INT NOT NULL DEFAULT 0,
                    created_by UNIQUEIDENTIFIER NULL,
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_SaaSInvoices_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id) ON DELETE CASCADE,
                    CONSTRAINT UQ_SaaSInvoices_Period UNIQUE (tenant_id, period_month, period_year)
                )
            `);
            console.log('   ✅ Tabla SaaSInvoices creada');
        }

        // 2. SaaSInvoiceItems
        const itemsExists = await this.tableExists('SaaSInvoiceItems');
        if (!itemsExists) {
            await this.query(`
                CREATE TABLE SaaSInvoiceItems (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    invoice_id UNIQUEIDENTIFIER NOT NULL,
                    item_type NVARCHAR(30) NOT NULL DEFAULT 'BASE',
                    description NVARCHAR(500) NOT NULL,
                    quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
                    unit_price_usd DECIMAL(15,4) NOT NULL,
                    total_usd DECIMAL(15,4) NOT NULL,
                    sort_order INT DEFAULT 0,
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_SaaSInvoiceItems_Invoices FOREIGN KEY (invoice_id) REFERENCES SaaSInvoices(id) ON DELETE CASCADE
                )
            `);
            console.log('   ✅ Tabla SaaSInvoiceItems creada');
        }

        // Índices
        try {
            await this.query(`
                IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SaaSInvoices_Tenant_Status')
                CREATE INDEX IX_SaaSInvoices_Tenant_Status ON SaaSInvoices(tenant_id, status)
            `);
            await this.query(`
                IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SaaSInvoices_Period')
                CREATE INDEX IX_SaaSInvoices_Period ON SaaSInvoices(period_year, period_month)
            `);
        } catch (e) { /* índices pueden existir */ }
    }

    async down() {
        await this.query("IF EXISTS (SELECT * FROM sys.tables WHERE name = 'SaaSInvoiceItems') DROP TABLE SaaSInvoiceItems");
        await this.query("IF EXISTS (SELECT * FROM sys.tables WHERE name = 'SaaSInvoices') DROP TABLE SaaSInvoices");
        console.log('   ✅ Tablas SaaS Billing eliminadas');
    }
}

module.exports = CreateSaaSBilling;
