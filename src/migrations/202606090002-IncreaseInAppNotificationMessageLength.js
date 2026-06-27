const Migration = require('./Migration');

/**
 * Mensajes in-app / WhatsApp: límite de 250 → 2000 caracteres.
 */
class IncreaseInAppNotificationMessageLength extends Migration {
    async up() {
        if (await this.tableExists('InAppNotifications')) {
            if (await this.columnExists('InAppNotifications', 'message')) {
                await this.query('ALTER TABLE InAppNotifications ALTER COLUMN message NVARCHAR(2000) NOT NULL');
                console.log('   ✅ InAppNotifications.message → NVARCHAR(2000)');
            }
        }

        if (await this.tableExists('WhatsAppOutboundQueue')) {
            if (await this.columnExists('WhatsAppOutboundQueue', 'message_body')) {
                await this.query('ALTER TABLE WhatsAppOutboundQueue ALTER COLUMN message_body NVARCHAR(2000) NOT NULL');
                console.log('   ✅ WhatsAppOutboundQueue.message_body → NVARCHAR(2000)');
            }
        }
    }
}

module.exports = IncreaseInAppNotificationMessageLength;
