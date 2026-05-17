const Migration = require('./Migration');

/**
 * Fondos de reserva/ahorro configurables por condominio (Modo Completo).
 */
class CreateBillingReserveFunds extends Migration {
    async up() {
        if (!(await this.tableExists('BillingReserveFunds'))) {
            await this.query(`
                CREATE TABLE BillingReserveFunds (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    name NVARCHAR(200) NOT NULL,
                    fund_nature NVARCHAR(40) NOT NULL DEFAULT N'ORDINARY_RESERVE',
                    percentage DECIMAL(7, 4) NOT NULL,
                    include_extraordinary BIT NOT NULL DEFAULT 0,
                    is_active BIT NOT NULL DEFAULT 1,
                    notes NVARCHAR(500) NULL,
                    display_order INT NOT NULL DEFAULT 100,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_BillingReserveFunds_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id) ON DELETE CASCADE,
                    CONSTRAINT CK_BillingReserveFunds_Nature CHECK (
                        fund_nature IN (N'ORDINARY_RESERVE', N'SAVINGS', N'MAINTENANCE', N'OTHER')
                    ),
                    CONSTRAINT CK_BillingReserveFunds_Percentage CHECK (percentage > 0 AND percentage <= 100)
                )
            `);
            await this.query(`CREATE INDEX IX_BillingReserveFunds_Tenant ON BillingReserveFunds(tenant_id, is_active)`);
            console.log('   ✅ Tabla BillingReserveFunds creada');
        }

        if (!(await this.tableExists('BillingReserveFundContracts'))) {
            await this.query(`
                CREATE TABLE BillingReserveFundContracts (
                    reserve_fund_id UNIQUEIDENTIFIER NOT NULL,
                    vendor_contract_id UNIQUEIDENTIFIER NOT NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT PK_BillingReserveFundContracts PRIMARY KEY (reserve_fund_id, vendor_contract_id),
                    CONSTRAINT FK_BRFC_Fund FOREIGN KEY (reserve_fund_id) REFERENCES BillingReserveFunds(id) ON DELETE CASCADE,
                    CONSTRAINT FK_BRFC_Contract FOREIGN KEY (vendor_contract_id) REFERENCES VendorContracts(id) ON DELETE CASCADE
                )
            `);
            console.log('   ✅ Tabla BillingReserveFundContracts creada');
        }

        if (await this.tableExists('BillingPreliminaryItems')) {
            const col = await this.query(`
                SELECT 1 AS ok FROM sys.columns
                WHERE object_id = OBJECT_ID('BillingPreliminaryItems') AND name = 'reserve_fund_id'
            `);
            if (!col.recordset.length) {
                await this.query(`
                    ALTER TABLE BillingPreliminaryItems
                    ADD reserve_fund_id UNIQUEIDENTIFIER NULL
                    CONSTRAINT FK_BillingPreliminaryItems_ReserveFund
                        FOREIGN KEY (reserve_fund_id) REFERENCES BillingReserveFunds(id)
                `);
                console.log('   ✅ Columna reserve_fund_id en BillingPreliminaryItems');
            }
        }
    }
}

module.exports = CreateBillingReserveFunds;
