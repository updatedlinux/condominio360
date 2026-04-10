const Migration = require('./Migration');

/**
 * Mensajes in-app: API WhatsApp por condominio (URL + clave), cola outbound y log global de rate limit.
 */
class WhatsAppMessaging extends Migration {
    async up() {
        if (!(await this.tableExists('Tenants'))) {
            console.log('   ⚠️ Tenants no existe, omitiendo WhatsApp messaging...');
            return;
        }

        const cols = [
            { name: 'whatsapp_api_base_url', sql: 'NVARCHAR(500) NULL' },
            { name: 'whatsapp_api_secret', sql: 'NVARCHAR(500) NULL' },
            { name: 'whatsapp_messaging_enabled', sql: 'BIT NOT NULL DEFAULT 0' }
        ];
        for (const c of cols) {
            if (!(await this.columnExists('Tenants', c.name))) {
                await this.query(`ALTER TABLE Tenants ADD ${c.name} ${c.sql}`);
                console.log(`   ✅ Tenants.${c.name}`);
            }
        }

        if (!(await this.tableExists('WhatsAppOutboundQueue'))) {
            await this.query(`
                CREATE TABLE WhatsAppOutboundQueue (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    in_app_notification_id UNIQUEIDENTIFIER NOT NULL,
                    user_id UNIQUEIDENTIFIER NOT NULL,
                    phone_national NVARCHAR(20) NOT NULL,
                    message_body NVARCHAR(500) NOT NULL,
                    status NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
                    error_message NVARCHAR(MAX) NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    sent_at DATETIME2 NULL,
                    CONSTRAINT FK_WAQ_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                    CONSTRAINT FK_WAQ_InApp FOREIGN KEY (in_app_notification_id) REFERENCES InAppNotifications(id) ON DELETE CASCADE,
                    CONSTRAINT CK_WAQ_Status CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
                )
            `);
            console.log('   ✅ Tabla WhatsAppOutboundQueue');
        }

        if (!(await this.indexExists('WhatsAppOutboundQueue', 'IX_WAQ_Pending_Created'))) {
            await this.query(`
                CREATE NONCLUSTERED INDEX IX_WAQ_Pending_Created
                ON WhatsAppOutboundQueue (created_at)
                WHERE status = 'PENDING'
            `);
        }
        if (!(await this.indexExists('WhatsAppOutboundQueue', 'IX_WAQ_Notification'))) {
            await this.query(`
                CREATE NONCLUSTERED INDEX IX_WAQ_Notification ON WhatsAppOutboundQueue (in_app_notification_id)
            `);
        }
        if (!(await this.indexExists('WhatsAppOutboundQueue', 'UQ_WAQ_Notif_User'))) {
            await this.query(`
                CREATE UNIQUE INDEX UQ_WAQ_Notif_User ON WhatsAppOutboundQueue (in_app_notification_id, user_id)
            `);
        }

        if (!(await this.tableExists('WhatsAppGlobalSendLog'))) {
            await this.query(`
                CREATE TABLE WhatsAppGlobalSendLog (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    sent_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
                )
            `);
            console.log('   ✅ Tabla WhatsAppGlobalSendLog');
        }
        if (!(await this.indexExists('WhatsAppGlobalSendLog', 'IX_WGSL_SentAt'))) {
            await this.query(`
                CREATE NONCLUSTERED INDEX IX_WGSL_SentAt ON WhatsAppGlobalSendLog (sent_at)
            `);
        }

        console.log('   ✅ Migración WhatsApp messaging completada');
    }

    async down() {
        if (await this.tableExists('WhatsAppGlobalSendLog')) {
            await this.query('DROP TABLE WhatsAppGlobalSendLog');
        }
        if (await this.tableExists('WhatsAppOutboundQueue')) {
            await this.query('DROP TABLE WhatsAppOutboundQueue');
        }
        for (const c of ['whatsapp_messaging_enabled', 'whatsapp_api_secret', 'whatsapp_api_base_url']) {
            if (await this.columnExists('Tenants', c)) {
                await this.query(`ALTER TABLE Tenants DROP COLUMN ${c}`);
            }
        }
        console.log('   ✅ Rollback WhatsApp messaging');
    }
}

module.exports = WhatsAppMessaging;
