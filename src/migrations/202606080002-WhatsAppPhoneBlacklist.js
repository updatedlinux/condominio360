const Migration = require('./Migration');

/**
 * Lista negra de chatId WhatsApp con fallos 500 recurrentes (protección anti-ban).
 */
class WhatsAppPhoneBlacklist extends Migration {
    async up() {
        if (!(await this.tableExists('WhatsAppPhoneBlacklist'))) {
            await this.query(`
                CREATE TABLE WhatsAppPhoneBlacklist (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    chat_id NVARCHAR(30) NOT NULL,
                    user_id UNIQUEIDENTIFIER NULL,
                    consecutive_failures INT NOT NULL DEFAULT 0,
                    is_blocked BIT NOT NULL DEFAULT 0,
                    last_error NVARCHAR(500) NULL,
                    last_failure_at DATETIME2 NULL,
                    blocked_at DATETIME2 NULL,
                    last_success_at DATETIME2 NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    CONSTRAINT FK_WPB_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                    CONSTRAINT UQ_WPB_Tenant_Chat UNIQUE (tenant_id, chat_id)
                )
            `);
            console.log('   ✅ Tabla WhatsAppPhoneBlacklist');
        }

        if (!(await this.indexExists('WhatsAppPhoneBlacklist', 'IX_WPB_Blocked'))) {
            await this.query(`
                CREATE NONCLUSTERED INDEX IX_WPB_Blocked
                ON WhatsAppPhoneBlacklist (tenant_id, chat_id)
                WHERE is_blocked = 1
            `);
        }

        if (await this.tableExists('WhatsAppOutboundQueue')) {
            await this.query(`
                IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WAQ_Status')
                    ALTER TABLE WhatsAppOutboundQueue DROP CONSTRAINT CK_WAQ_Status
            `);
            await this.query(`
                ALTER TABLE WhatsAppOutboundQueue ADD CONSTRAINT CK_WAQ_Status
                CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED'))
            `);
            console.log('   ✅ WhatsAppOutboundQueue.status incluye SKIPPED');
        }
    }

    async down() {
        if (await this.tableExists('WhatsAppOutboundQueue')) {
            await this.query(`
                IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WAQ_Status')
                    ALTER TABLE WhatsAppOutboundQueue DROP CONSTRAINT CK_WAQ_Status
            `);
            await this.query(`
                ALTER TABLE WhatsAppOutboundQueue ADD CONSTRAINT CK_WAQ_Status
                CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
            `);
        }
        if (await this.tableExists('WhatsAppPhoneBlacklist')) {
            await this.query('DROP TABLE WhatsAppPhoneBlacklist');
        }
    }
}

module.exports = WhatsAppPhoneBlacklist;
