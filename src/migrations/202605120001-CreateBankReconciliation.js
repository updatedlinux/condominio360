const Migration = require('./Migration');
const { connectDB } = require('../config/database');

/**
 * Migración: Conciliación bancaria (semiautomática)
 *
 * Crea:
 *   - Banks                       (catálogo global, gestionable por SuperAdmin)
 *   - TenantBankAccounts          (cuentas reales de cada condominio para recibir pagos)
 *   - BankStatementImports        (cada vez que un tenant admin sube un extracto)
 *   - BankStatementMovements      (líneas normalizadas del extracto)
 *
 * Hace seed inicial de BANCAMIGA y UBIIPAGOS como bancos soportados.
 */
class CreateBankReconciliation extends Migration {
    async up() {
        const pool = await connectDB();

        if (!(await this.tableExists('Banks'))) {
            await this.query(`
                CREATE TABLE Banks (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    code NVARCHAR(40) NOT NULL UNIQUE,
                    name NVARCHAR(120) NOT NULL,
                    parser_key NVARCHAR(60) NOT NULL,
                    supports_pdf BIT NOT NULL DEFAULT 1,
                    supports_csv BIT NOT NULL DEFAULT 0,
                    supports_xlsx BIT NOT NULL DEFAULT 0,
                    is_active BIT NOT NULL DEFAULT 1,
                    notes NVARCHAR(500) NULL,
                    display_order INT NOT NULL DEFAULT 100,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
                )
            `);
            console.log('   ✅ Tabla Banks creada');
        }

        if (!(await this.tableExists('TenantBankAccounts'))) {
            await this.query(`
                CREATE TABLE TenantBankAccounts (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    bank_id UNIQUEIDENTIFIER NOT NULL,
                    account_holder NVARCHAR(255) NOT NULL,
                    account_holder_dni NVARCHAR(20) NULL,
                    account_type NVARCHAR(20) NOT NULL,
                    account_number NVARCHAR(40) NULL,
                    mobile_phone NVARCHAR(20) NULL,
                    is_default BIT NOT NULL DEFAULT 0,
                    is_active BIT NOT NULL DEFAULT 1,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_TenantBankAccounts_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id) ON DELETE CASCADE,
                    CONSTRAINT FK_TenantBankAccounts_Bank FOREIGN KEY (bank_id) REFERENCES Banks(id),
                    CONSTRAINT CK_TenantBankAccounts_Type CHECK (account_type IN (N'CORRIENTE', N'AHORROS', N'PAGO_MOVIL', N'FINTECH'))
                )
            `);
            await this.query(`CREATE INDEX IX_TenantBankAccounts_Tenant ON TenantBankAccounts(tenant_id, is_active)`);
            console.log('   ✅ Tabla TenantBankAccounts creada');
        }

        if (!(await this.tableExists('BankStatementImports'))) {
            await this.query(`
                CREATE TABLE BankStatementImports (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    bank_id UNIQUEIDENTIFIER NOT NULL,
                    tenant_bank_account_id UNIQUEIDENTIFIER NULL,
                    source_file_path NVARCHAR(500) NOT NULL,
                    source_file_name NVARCHAR(255) NOT NULL,
                    source_mime NVARCHAR(100) NULL,
                    source_size_bytes INT NULL,
                    period_from DATE NULL,
                    period_to DATE NULL,
                    total_credits_count INT NOT NULL DEFAULT 0,
                    total_debits_count INT NOT NULL DEFAULT 0,
                    total_credits_ves DECIMAL(18,2) NOT NULL DEFAULT 0,
                    total_debits_ves DECIMAL(18,2) NOT NULL DEFAULT 0,
                    matched_count INT NOT NULL DEFAULT 0,
                    suggested_count INT NOT NULL DEFAULT 0,
                    unmatched_count INT NOT NULL DEFAULT 0,
                    status NVARCHAR(20) NOT NULL DEFAULT 'PROCESSED',
                    error_message NVARCHAR(MAX) NULL,
                    imported_by UNIQUEIDENTIFIER NOT NULL,
                    imported_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_BSImports_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id) ON DELETE CASCADE,
                    CONSTRAINT FK_BSImports_Bank FOREIGN KEY (bank_id) REFERENCES Banks(id),
                    CONSTRAINT FK_BSImports_Account FOREIGN KEY (tenant_bank_account_id) REFERENCES TenantBankAccounts(id),
                    CONSTRAINT FK_BSImports_ImportedBy FOREIGN KEY (imported_by) REFERENCES Users(id),
                    CONSTRAINT CK_BSImports_Status CHECK (status IN (N'PROCESSING', N'PROCESSED', N'FAILED'))
                )
            `);
            await this.query(`CREATE INDEX IX_BSImports_Tenant ON BankStatementImports(tenant_id, imported_at DESC)`);
            console.log('   ✅ Tabla BankStatementImports creada');
        }

        if (!(await this.tableExists('BankStatementMovements'))) {
            await this.query(`
                CREATE TABLE BankStatementMovements (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    import_id UNIQUEIDENTIFIER NOT NULL,
                    movement_date DATE NULL,
                    reference NVARCHAR(80) NULL,
                    description NVARCHAR(500) NULL,
                    amount_ves DECIMAL(18,2) NOT NULL DEFAULT 0,
                    direction NVARCHAR(10) NOT NULL,
                    balance_ves DECIMAL(18,2) NULL,
                    raw_line NVARCHAR(MAX) NULL,
                    match_status NVARCHAR(20) NOT NULL DEFAULT 'UNMATCHED',
                    match_score DECIMAL(5,2) NULL,
                    matched_payment_report_id UNIQUEIDENTIFIER NULL,
                    matched_by UNIQUEIDENTIFIER NULL,
                    matched_at DATETIME2 NULL,
                    notes NVARCHAR(500) NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_BSMovements_Import FOREIGN KEY (import_id) REFERENCES BankStatementImports(id) ON DELETE CASCADE,
                    CONSTRAINT FK_BSMovements_PaymentReport FOREIGN KEY (matched_payment_report_id) REFERENCES BillingPaymentReports(id),
                    CONSTRAINT FK_BSMovements_MatchedBy FOREIGN KEY (matched_by) REFERENCES Users(id),
                    CONSTRAINT CK_BSMovements_Direction CHECK (direction IN (N'CREDIT', N'DEBIT')),
                    CONSTRAINT CK_BSMovements_MatchStatus CHECK (match_status IN (N'UNMATCHED', N'SUGGESTED', N'CONFIRMED', N'IGNORED'))
                )
            `);
            await this.query(`CREATE INDEX IX_BSMovements_Import ON BankStatementMovements(import_id, direction, match_status)`);
            await this.query(`CREATE INDEX IX_BSMovements_PaymentReport ON BankStatementMovements(matched_payment_report_id) WHERE matched_payment_report_id IS NOT NULL`);
            console.log('   ✅ Tabla BankStatementMovements creada');
        }

        const seed = [
            { code: 'BANCAMIGA', name: 'Bancamiga', parser_key: 'bancamiga-pdf', display_order: 10 },
            { code: 'UBIIPAGOS', name: 'UbiiPagos', parser_key: 'ubiipagos-pdf', display_order: 20 }
        ];

        for (const b of seed) {
            const exists = await pool.request()
                .input('code', this.sql.NVarChar, b.code)
                .query('SELECT id FROM Banks WHERE code = @code');
            if (exists.recordset.length === 0) {
                await pool.request()
                    .input('code', this.sql.NVarChar, b.code)
                    .input('name', this.sql.NVarChar, b.name)
                    .input('parser_key', this.sql.NVarChar, b.parser_key)
                    .input('display_order', this.sql.Int, b.display_order)
                    .query(`
                        INSERT INTO Banks (code, name, parser_key, supports_pdf, is_active, display_order)
                        VALUES (@code, @name, @parser_key, 1, 1, @display_order)
                    `);
                console.log(`   ✅ Banco sembrado: ${b.code}`);
            }
        }
    }
}

module.exports = CreateBankReconciliation;
