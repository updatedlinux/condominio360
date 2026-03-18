const { sql, connectDB } = require('../config/database');

/**
 * Modelo para manejar la cola de notificaciones
 */
class NotificationQueueModel {
    /**
     * Obtener notificaciones pendientes
     */
    static async getPending(limit = 50) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT TOP (@limit) * FROM NotificationQueue
                    WHERE status = 'PENDING'
                    ORDER BY created_at ASC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error getting pending notifications:', error);
            throw error;
        }
    }

    /**
     * Obtener notificaciones pendientes para un tenant específico
     */
    static async getPendingByTenant(tenantId, limit = 50) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT TOP (@limit) * FROM NotificationQueue
                    WHERE tenant_id = @tenant_id AND status = 'PENDING'
                    ORDER BY created_at ASC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error getting pending notifications:', error);
            throw error;
        }
    }

    /**
     * Marcar notificación como enviada
     */
    static async markAsSent(id) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query(`
                    UPDATE NotificationQueue
                    SET status = 'SENT',
                        sent_at = SYSDATETIME(),
                        updated_at = SYSDATETIME()
                    WHERE id = @id
                `);
        } catch (error) {
            console.error('Error marking notification as sent:', error);
            throw error;
        }
    }

    /**
     * Marcar notificación como fallida
     */
    static async markAsFailed(id, errorMessage) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('error', sql.NVarChar, errorMessage)
                .query(`
                    UPDATE NotificationQueue
                    SET status = 'FAILED',
                        error_message = @error,
                        updated_at = SYSDATETIME()
                    WHERE id = @id
                `);
        } catch (error) {
            console.error('Error marking notification as failed:', error);
            throw error;
        }
    }
}

module.exports = NotificationQueueModel;
