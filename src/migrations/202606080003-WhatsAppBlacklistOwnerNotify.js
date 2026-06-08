const Migration = require('./Migration');

/** Registro de correo enviado al propietario al entrar en lista negra WhatsApp. */
class WhatsAppBlacklistOwnerNotify extends Migration {
    async up() {
        if (await this.tableExists('WhatsAppPhoneBlacklist')) {
            if (!(await this.columnExists('WhatsAppPhoneBlacklist', 'owner_notified_at'))) {
                await this.query(`
                    ALTER TABLE WhatsAppPhoneBlacklist ADD owner_notified_at DATETIME2 NULL
                `);
                console.log('   ✅ WhatsAppPhoneBlacklist.owner_notified_at');
            }
        }
    }

    async down() {
        if (
            await this.tableExists('WhatsAppPhoneBlacklist')
            && (await this.columnExists('WhatsAppPhoneBlacklist', 'owner_notified_at'))
        ) {
            await this.query('ALTER TABLE WhatsAppPhoneBlacklist DROP COLUMN owner_notified_at');
        }
    }
}

module.exports = WhatsAppBlacklistOwnerNotify;
