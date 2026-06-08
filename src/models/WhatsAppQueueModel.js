const { sql, connectDB } = require('../config/database');

const WINDOW_SECONDS = 120;
const MAX_SENDS_PER_WINDOW = 30;

class WhatsAppQueueModel {
    static async countGlobalSendsInWindow() {
        const pool = await connectDB();
        const r = await pool.request().query(`
            SELECT COUNT(*) AS c FROM WhatsAppGlobalSendLog
            WHERE sent_at >= DATEADD(SECOND, -${WINDOW_SECONDS}, SYSUTCDATETIME())
        `);
        return r.recordset[0]?.c || 0;
    }

    static async logGlobalSend() {
        const pool = await connectDB();
        await pool.request().query(`
            INSERT INTO WhatsAppGlobalSendLog (sent_at) VALUES (SYSUTCDATETIME())
        `);
    }

    static async purgeOldGlobalLogs() {
        const pool = await connectDB();
        await pool.request().query(`
            DELETE FROM WhatsAppGlobalSendLog
            WHERE sent_at < DATEADD(MINUTE, -10, SYSUTCDATETIME())
        `);
    }

    static async rowExistsForNotificationAndUser(inAppNotificationId, userId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('nid', sql.UniqueIdentifier, inAppNotificationId)
            .input('uid', sql.UniqueIdentifier, userId)
            .query(`
                SELECT TOP 1 id FROM WhatsAppOutboundQueue
                WHERE in_app_notification_id = @nid AND user_id = @uid
            `);
        return !!r.recordset[0];
    }

    static async enqueueRow(data) {
        const pool = await connectDB();
        const {
            tenantId,
            inAppNotificationId,
            userId,
            chatId,
            phoneNational,
            messageBody,
            messageType = 'TEXT',
            attachmentPath = null
        } = data;
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('in_app_notification_id', sql.UniqueIdentifier, inAppNotificationId)
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('chat_id', sql.NVarChar, chatId)
            .input('phone_national', sql.NVarChar, phoneNational)
            .input('message_body', sql.NVarChar, messageBody)
            .input('message_type', sql.NVarChar, messageType)
            .input('attachment_path', sql.NVarChar, attachmentPath)
            .query(`
                INSERT INTO WhatsAppOutboundQueue
                (tenant_id, in_app_notification_id, user_id, chat_id, phone_national, message_body,
                 message_type, attachment_path, status)
                OUTPUT INSERTED.*
                VALUES (@tenant_id, @in_app_notification_id, @user_id, @chat_id, @phone_national, @message_body,
                        @message_type, @attachment_path, 'PENDING')
            `);
        return result.recordset[0] || null;
    }

    static async hasRowsForNotification(inAppNotificationId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('nid', sql.UniqueIdentifier, inAppNotificationId)
            .query(`
                SELECT TOP 1 id FROM WhatsAppOutboundQueue
                WHERE in_app_notification_id = @nid
            `);
        return !!r.recordset[0];
    }

    static async getNextPending() {
        const pool = await connectDB();
        const r = await pool.request().query(`
            SELECT TOP 1 q.*, n.attachment_original_name, n.attachment_mime
            FROM WhatsAppOutboundQueue q
            LEFT JOIN InAppNotifications n ON n.id = q.in_app_notification_id
            WHERE q.status = 'PENDING'
            ORDER BY q.created_at ASC
        `);
        return r.recordset[0] || null;
    }

    static async markSent(id, openwaMessageId = null) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('mid', sql.NVarChar, openwaMessageId)
            .query(`
                UPDATE WhatsAppOutboundQueue
                SET status = 'SENT',
                    sent_at = SYSUTCDATETIME(),
                    openwa_message_id = COALESCE(@mid, openwa_message_id),
                    delivery_status = COALESCE(delivery_status, 'QUEUED_SENT')
                WHERE id = @id
            `);
    }

    static async markFailed(id, errorMessage) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('err', sql.NVarChar, (errorMessage || '').slice(0, 4000))
            .query(`
                UPDATE WhatsAppOutboundQueue
                SET status = 'FAILED', error_message = @err
                WHERE id = @id
            `);
    }
}

WhatsAppQueueModel.WINDOW_SECONDS = WINDOW_SECONDS;
WhatsAppQueueModel.MAX_SENDS_PER_WINDOW = MAX_SENDS_PER_WINDOW;

module.exports = WhatsAppQueueModel;
