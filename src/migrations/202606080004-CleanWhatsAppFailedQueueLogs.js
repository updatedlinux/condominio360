const Migration = require('./Migration');

/**
 * Limpia cola WhatsApp fallida/omitida/pendiente, lista negra y eventos webhook
 * acumulados durante pruebas OpenWA (arranque en cero).
 */
class CleanWhatsAppFailedQueueLogs extends Migration {
    async up() {
        const stats = {};

        if (await this.tableExists('WhatsAppOutboundQueue')) {
            const before = await this.query(`
                SELECT status, COUNT(*) AS n
                FROM WhatsAppOutboundQueue
                GROUP BY status
            `);
            stats.queueBefore = before.recordset || [];

            const del = await this.query(`
                DELETE FROM WhatsAppOutboundQueue
                WHERE status IN (N'FAILED', N'SKIPPED', N'PENDING')
            `);
            stats.queueDeleted = del.rowsAffected?.[0] ?? 0;

            const after = await this.query(`
                SELECT status, COUNT(*) AS n
                FROM WhatsAppOutboundQueue
                GROUP BY status
            `);
            stats.queueAfter = after.recordset || [];
            console.log('   🧹 WhatsAppOutboundQueue:', JSON.stringify(stats.queueBefore), '→ eliminados:', stats.queueDeleted);
        }

        if (await this.tableExists('WhatsAppPhoneBlacklist')) {
            const bl = await this.query('SELECT COUNT(*) AS n FROM WhatsAppPhoneBlacklist');
            stats.blacklistBefore = bl.recordset[0]?.n || 0;
            await this.query('DELETE FROM WhatsAppPhoneBlacklist');
            console.log('   🧹 WhatsAppPhoneBlacklist:', stats.blacklistBefore, 'registros eliminados');
        }

        if (await this.tableExists('WhatsAppWebhookEvents')) {
            const wh = await this.query('SELECT COUNT(*) AS n FROM WhatsAppWebhookEvents');
            stats.webhooksBefore = wh.recordset[0]?.n || 0;
            await this.query('DELETE FROM WhatsAppWebhookEvents');
            console.log('   🧹 WhatsAppWebhookEvents:', stats.webhooksBefore, 'registros eliminados');
        }

        if (await this.tableExists('WhatsAppGlobalSendLog')) {
            const gl = await this.query('SELECT COUNT(*) AS n FROM WhatsAppGlobalSendLog');
            stats.globalLogBefore = gl.recordset[0]?.n || 0;
            await this.query('DELETE FROM WhatsAppGlobalSendLog');
            console.log('   🧹 WhatsAppGlobalSendLog:', stats.globalLogBefore, 'registros eliminados');
        }

        console.log('   ✅ Limpieza WhatsApp (fallidos/pruebas) completada — envíos SENT se conservan');
    }

    async down() {
        console.log('   ⚠️ CleanWhatsAppFailedQueueLogs: no reversible (datos eliminados)');
    }
}

module.exports = CleanWhatsAppFailedQueueLogs;
