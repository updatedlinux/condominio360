const { v4: uuidv4 } = require('uuid');
const { sql, connectDB } = require('../config/database');

const CONSULTATION_QUEUE_TYPES = ['consultation_creation', 'consultation_activation'];

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
     * Encolar una notificación
     */
    static async enqueue({ tenant_id, user_id, type, title, message, data }) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, uuidv4())
            .input('tenant_id', sql.UniqueIdentifier, tenant_id)
            .input('user_id', sql.UniqueIdentifier, user_id)
            .input('type', sql.VarChar, type)
            .input('title', sql.NVarChar, title)
            .input('message', sql.NVarChar, message)
            .input('data', sql.NVarChar, typeof data === 'string' ? data : JSON.stringify(data || {}))
            .query(`
                INSERT INTO NotificationQueue (id, tenant_id, user_id, type, title, message, data, status, created_at)
                VALUES (@id, @tenant_id, @user_id, @type, @title, @message, @data, 'PENDING', SYSDATETIME())
            `);
    }

    /**
     * Encolar varias notificaciones (inserción secuencial, tolerante a fallos parciales)
     */
    static async enqueueMany(items) {
        let queued = 0;
        for (const item of items) {
            await NotificationQueueModel.enqueue(item);
            queued++;
        }
        return queued;
    }

    /**
     * Notificaciones pendientes por tipos (p. ej. consultas)
     */
    static async getPendingByTypes(types, limit = 50) {
        const pool = await connectDB();
        const typeList = types.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
        const result = await pool.request()
            .input('limit', sql.Int, limit)
            .query(`
                SELECT TOP (@limit) *
                FROM NotificationQueue
                WHERE status = 'PENDING'
                AND type IN (${typeList})
                ORDER BY created_at ASC
            `);
        return result.recordset;
    }

    /**
     * Eliminar pendientes de consulta (para re-encolar en conciliación)
     */
    static async deletePendingConsultationNotifications(consultationId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('pattern', sql.NVarChar, `%${consultationId}%`)
            .query(`
                DELETE FROM NotificationQueue
                WHERE status = 'PENDING'
                AND type IN ('consultation_creation', 'consultation_activation')
                AND data LIKE @pattern
            `);
        return result.rowsAffected[0] || 0;
    }

    static async countPendingConsultationNotifications(consultationId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('pattern', sql.NVarChar, `%${consultationId}%`)
            .query(`
                SELECT COUNT(*) AS n
                FROM NotificationQueue
                WHERE status = 'PENDING'
                AND type IN ('consultation_creation', 'consultation_activation')
                AND data LIKE @pattern
            `);
        return result.recordset[0]?.n || 0;
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
module.exports.CONSULTATION_QUEUE_TYPES = CONSULTATION_QUEUE_TYPES;
