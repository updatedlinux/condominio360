const Migration = require('./Migration');

/**
 * Deuda histórica pre-sistema: un recibo global por inmueble, pagos parciales en USD.
 */
class CreatePropertyHistoricalDebts extends Migration {
    async up() {
        if (!(await this.tableExists('PropertyHistoricalDebts'))) {
            await this.query(`
                CREATE TABLE PropertyHistoricalDebts (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    property_id UNIQUEIDENTIFIER NOT NULL,
                    invoice_id UNIQUEIDENTIFIER NOT NULL,
                    status NVARCHAR(20) NOT NULL DEFAULT N'ACTIVE',
                    description NVARCHAR(500) NULL,
                    input_amount DECIMAL(18, 6) NOT NULL,
                    input_currency NVARCHAR(3) NOT NULL,
                    principal_usd DECIMAL(18, 6) NOT NULL,
                    exchange_rate_at_creation DECIMAL(18, 6) NOT NULL,
                    exchange_rate_date DATE NULL,
                    rate_freeze_mode NVARCHAR(20) NOT NULL DEFAULT N'NONE',
                    rate_freeze_window_days INT NULL,
                    rate_unpaid_migrate_after_month BIT NOT NULL DEFAULT 0,
                    created_by UNIQUEIDENTIFIER NULL,
                    cancelled_at DATETIME2 NULL,
                    cancelled_by UNIQUEIDENTIFIER NULL,
                    cancel_reason NVARCHAR(500) NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_PropertyHistoricalDebts_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                    CONSTRAINT FK_PropertyHistoricalDebts_Property FOREIGN KEY (property_id) REFERENCES Properties(id),
                    CONSTRAINT FK_PropertyHistoricalDebts_Invoice FOREIGN KEY (invoice_id) REFERENCES BillingInvoices(id),
                    CONSTRAINT CK_PropertyHistoricalDebts_Status CHECK (status IN (N'ACTIVE', N'CANCELLED')),
                    CONSTRAINT CK_PropertyHistoricalDebts_RateFreeze CHECK (
                        rate_freeze_mode IN (N'NONE', N'PERMANENT', N'WINDOW')
                    )
                )
            `);
            await this.query(`
                CREATE UNIQUE INDEX UQ_PropertyHistoricalDebts_ActiveProperty
                ON PropertyHistoricalDebts(property_id)
                WHERE status = N'ACTIVE'
            `);
            await this.query(`
                CREATE INDEX IX_PropertyHistoricalDebts_Tenant
                ON PropertyHistoricalDebts(tenant_id, status)
            `);
            console.log('   ✅ Tabla PropertyHistoricalDebts creada');
        }

        if (await this.tableExists('BillingInvoices')) {
            const invoiceCols = [
                { name: 'invoice_kind', sql: "NVARCHAR(20) NOT NULL DEFAULT N'STANDARD'" },
                { name: 'historical_debt_id', sql: 'UNIQUEIDENTIFIER NULL' },
                { name: 'paid_amount_usd', sql: 'DECIMAL(18, 6) NOT NULL DEFAULT 0' },
                { name: 'legacy_exchange_rate_usd', sql: 'DECIMAL(18, 6) NULL' },
                { name: 'legacy_exchange_rate_date', sql: 'DATE NULL' },
                { name: 'legacy_rate_freeze_mode', sql: "NVARCHAR(20) NULL" },
                { name: 'legacy_rate_freeze_window_days', sql: 'INT NULL' },
                { name: 'legacy_rate_unpaid_migrate_after_month', sql: 'BIT NULL' },
                { name: 'legacy_debt_created_at', sql: 'DATETIME2 NULL' }
            ];
            for (const c of invoiceCols) {
                if (!(await this.columnExists('BillingInvoices', c.name))) {
                    await this.query(`ALTER TABLE BillingInvoices ADD ${c.name} ${c.sql}`);
                    console.log(`   ✅ BillingInvoices.${c.name}`);
                }
            }

            if (await this.columnExists('BillingInvoices', 'preliminary_id')) {
                await this.query(`
                    ALTER TABLE BillingInvoices ALTER COLUMN preliminary_id UNIQUEIDENTIFIER NULL
                `);
                console.log('   ✅ BillingInvoices.preliminary_id nullable');
            }

            await this.query(`
                IF NOT EXISTS (
                    SELECT 1 FROM sys.check_constraints
                    WHERE name = 'CK_BillingInvoices_InvoiceKind'
                )
                ALTER TABLE BillingInvoices ADD CONSTRAINT CK_BillingInvoices_InvoiceKind
                    CHECK (invoice_kind IN (N'STANDARD', N'LEGACY_DEBT'))
            `);

            if (!(await this.indexExists('BillingInvoices', 'IX_BillingInvoices_LegacyDebt'))) {
                await this.query(`
                    CREATE INDEX IX_BillingInvoices_LegacyDebt
                    ON BillingInvoices(tenant_id, invoice_kind, status)
                    WHERE invoice_kind = N'LEGACY_DEBT'
                `);
            }

        }

        if (await this.tableExists('BillingPaymentReports')) {
            if (!(await this.columnExists('BillingPaymentReports', 'monto_abonado_usd'))) {
                await this.query(`
                    ALTER TABLE BillingPaymentReports ADD monto_abonado_usd DECIMAL(18, 6) NULL
                `);
                console.log('   ✅ BillingPaymentReports.monto_abonado_usd');
            }
        }

        if (await this.tableExists('Properties')) {
            if (!(await this.indexExists('Properties', 'UQ_Properties_Tenant_Slug'))) {
                await this.query(`
                    CREATE UNIQUE INDEX UQ_Properties_Tenant_Slug
                    ON Properties(tenant_id, slug)
                    WHERE slug IS NOT NULL AND slug <> N''
                `);
                console.log('   ✅ UQ_Properties_Tenant_Slug');
            }
        }
    }
}

module.exports = CreatePropertyHistoricalDebts;
