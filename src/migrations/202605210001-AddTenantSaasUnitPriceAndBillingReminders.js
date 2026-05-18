const Migration = require('./Migration');

/**
 * Tarifa SaaS por condominio + registro de recordatorios de pago enviados.
 */
class AddTenantSaasUnitPriceAndBillingReminders extends Migration {
    async up() {
        if (await this.tableExists('Tenants')) {
            if (!(await this.columnExists('Tenants', 'saas_unit_price_usd'))) {
                await this.query(`
                    ALTER TABLE Tenants ADD saas_unit_price_usd DECIMAL(18, 6) NULL
                `);
                console.log('   ✅ Tenants.saas_unit_price_usd');
            }
        }

        if (!(await this.tableExists('BillingPaymentReminderLog'))) {
            await this.query(`
                CREATE TABLE BillingPaymentReminderLog (
                    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    user_id UNIQUEIDENTIFIER NOT NULL,
                    reminder_type NVARCHAR(40) NOT NULL,
                    milestone_key NVARCHAR(40) NOT NULL,
                    invoice_ids NVARCHAR(MAX) NULL,
                    sent_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_BillingPaymentReminderLog_Tenant
                        FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                    CONSTRAINT FK_BillingPaymentReminderLog_User
                        FOREIGN KEY (user_id) REFERENCES Users(id)
                )
            `);
            await this.query(`
                CREATE INDEX IX_BillingPaymentReminderLog_lookup
                ON BillingPaymentReminderLog (tenant_id, user_id, reminder_type, milestone_key)
            `);
            console.log('   ✅ BillingPaymentReminderLog');
        }
    }
}

module.exports = AddTenantSaasUnitPriceAndBillingReminders;
