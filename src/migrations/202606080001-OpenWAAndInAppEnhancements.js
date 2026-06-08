const Migration = require('./Migration');

/**
 * OpenWA (plataforma), alcance por edificio, adjuntos in-app, auditoría webhook.
 */
class OpenWAAndInAppEnhancements extends Migration {
    async up() {
        if (await this.tableExists('Tenants')) {
            if (!(await this.columnExists('Tenants', 'whatsapp_openwa_session_id'))) {
                await this.query(`
                    ALTER TABLE Tenants ADD whatsapp_openwa_session_id NVARCHAR(100) NULL
                `);
                console.log('   ✅ Tenants.whatsapp_openwa_session_id');
            }
        }

        if (await this.tableExists('InAppNotifications')) {
            const inAppCols = [
                { name: 'target_building', sql: 'NVARCHAR(100) NULL' },
                { name: 'attachment_path', sql: 'NVARCHAR(500) NULL' },
                { name: 'attachment_mime', sql: 'NVARCHAR(100) NULL' },
                { name: 'attachment_original_name', sql: 'NVARCHAR(255) NULL' }
            ];
            for (const c of inAppCols) {
                if (!(await this.columnExists('InAppNotifications', c.name))) {
                    await this.query(`ALTER TABLE InAppNotifications ADD ${c.name} ${c.sql}`);
                    console.log(`   ✅ InAppNotifications.${c.name}`);
                }
            }
        }

        if (await this.tableExists('WhatsAppOutboundQueue')) {
            const queueCols = [
                { name: 'chat_id', sql: 'NVARCHAR(30) NULL' },
                { name: 'message_type', sql: "NVARCHAR(20) NOT NULL DEFAULT 'TEXT'" },
                { name: 'attachment_path', sql: 'NVARCHAR(500) NULL' },
                { name: 'openwa_message_id', sql: 'NVARCHAR(200) NULL' },
                { name: 'delivery_status', sql: 'NVARCHAR(30) NULL' },
                { name: 'delivered_at', sql: 'DATETIME2 NULL' }
            ];
            for (const c of queueCols) {
                if (!(await this.columnExists('WhatsAppOutboundQueue', c.name))) {
                    await this.query(`ALTER TABLE WhatsAppOutboundQueue ADD ${c.name} ${c.sql}`);
                    console.log(`   ✅ WhatsAppOutboundQueue.${c.name}`);
                }
            }
            if (!(await this.indexExists('WhatsAppOutboundQueue', 'IX_WAQ_OpenWAMessageId'))) {
                await this.query(`
                    CREATE NONCLUSTERED INDEX IX_WAQ_OpenWAMessageId
                    ON WhatsAppOutboundQueue (openwa_message_id)
                    WHERE openwa_message_id IS NOT NULL
                `);
            }
        }

        if (!(await this.tableExists('WhatsAppWebhookEvents'))) {
            await this.query(`
                CREATE TABLE WhatsAppWebhookEvents (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NULL,
                    session_id NVARCHAR(100) NULL,
                    event_type NVARCHAR(50) NOT NULL,
                    openwa_message_id NVARCHAR(200) NULL,
                    queue_id UNIQUEIDENTIFIER NULL,
                    payload NVARCHAR(MAX) NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
                )
            `);
            console.log('   ✅ Tabla WhatsAppWebhookEvents');
        }

        if (!(await this.indexExists('WhatsAppWebhookEvents', 'IX_WWE_Created'))) {
            await this.query(`
                CREATE NONCLUSTERED INDEX IX_WWE_Created ON WhatsAppWebhookEvents (created_at DESC)
            `);
        }
        if (!(await this.indexExists('WhatsAppWebhookEvents', 'IX_WWE_Session'))) {
            await this.query(`
                CREATE NONCLUSTERED INDEX IX_WWE_Session ON WhatsAppWebhookEvents (session_id, event_type)
            `);
        }

        console.log('   ✅ Migración OpenWA + in-app enhancements completada');
    }

    async down() {
        if (await this.tableExists('WhatsAppWebhookEvents')) {
            await this.query('DROP TABLE WhatsAppWebhookEvents');
        }
        if (await this.tableExists('WhatsAppOutboundQueue')) {
            for (const c of ['delivered_at', 'delivery_status', 'openwa_message_id', 'attachment_path', 'message_type', 'chat_id']) {
                if (await this.columnExists('WhatsAppOutboundQueue', c)) {
                    await this.query(`ALTER TABLE WhatsAppOutboundQueue DROP COLUMN ${c}`);
                }
            }
        }
        if (await this.tableExists('InAppNotifications')) {
            for (const c of ['attachment_original_name', 'attachment_mime', 'attachment_path', 'target_building']) {
                if (await this.columnExists('InAppNotifications', c)) {
                    await this.query(`ALTER TABLE InAppNotifications DROP COLUMN ${c}`);
                }
            }
        }
        if (await this.columnExists('Tenants', 'whatsapp_openwa_session_id')) {
            await this.query('ALTER TABLE Tenants DROP COLUMN whatsapp_openwa_session_id');
        }
    }
}

module.exports = OpenWAAndInAppEnhancements;
