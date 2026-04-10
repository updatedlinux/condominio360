const { sql, connectDB } = require('../config/database');

const MAX_MESSAGE_LENGTH = 250;

function coerceScheduledAt(value) {
    if (value === null || value === undefined || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) {
        throw new Error('Fecha programada no válida');
    }
    return d;
}

class InAppNotificationModel {
    /**
     * Crear notificación (DRAFT o SCHEDULED)
     */
    static async create(data) {
        const pool = await connectDB();
        const { tenantId, createdBy, message, status = 'DRAFT', scheduledAt = null, sendWhatsapp = false } = data;

        if (!message || message.trim().length === 0) {
            throw new Error('El mensaje es requerido');
        }
        const trimmed = message.trim().slice(0, MAX_MESSAGE_LENGTH);
        if (trimmed.length === 0) {
            throw new Error('El mensaje no puede estar vacío');
        }

        const scheduledAtSql = coerceScheduledAt(scheduledAt);

        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('created_by', sql.UniqueIdentifier, createdBy)
            .input('message', sql.NVarChar, trimmed)
            .input('status', sql.NVarChar, status)
            .input('scheduled_at', sql.DateTime2, scheduledAtSql)
            .input('send_whatsapp', sql.Bit, sendWhatsapp)
            .query(`
                INSERT INTO InAppNotifications (tenant_id, created_by, message, status, scheduled_at, send_whatsapp)
                OUTPUT INSERTED.*
                VALUES (@tenant_id, @created_by, @message, @status, @scheduled_at, @send_whatsapp)
            `);

        return result.recordset[0];
    }

    /**
     * Actualizar notificación (solo DRAFT o SCHEDULED, antes de enviarse)
     */
    static async update(id, data) {
        const pool = await connectDB();
        const { message, status, scheduledAt, sendWhatsapp } = data;

        const updates = [];
        const request = pool.request().input('id', sql.UniqueIdentifier, id);

        if (message !== undefined) {
            const trimmed = message.trim().slice(0, MAX_MESSAGE_LENGTH);
            if (trimmed.length === 0) throw new Error('El mensaje no puede estar vacío');
            updates.push('message = @message');
            request.input('message', sql.NVarChar, trimmed);
        }
        if (status !== undefined) {
            updates.push('status = @status');
            request.input('status', sql.NVarChar, status);
        }
        if (scheduledAt !== undefined) {
            updates.push('scheduled_at = @scheduled_at');
            request.input('scheduled_at', sql.DateTime2, coerceScheduledAt(scheduledAt));
        }
        if (sendWhatsapp !== undefined) {
            updates.push('send_whatsapp = @send_whatsapp');
            request.input('send_whatsapp', sql.Bit, sendWhatsapp);
        }

        if (updates.length === 0) return null;

        updates.push('updated_at = SYSDATETIME()');

        const result = await request.query(`
            UPDATE InAppNotifications
            SET ${updates.join(', ')}
            OUTPUT INSERTED.*
            WHERE id = @id AND status IN ('DRAFT', 'SCHEDULED')
        `);

        return result.recordset[0] || null;
    }

    /**
     * Marcar como enviada
     */
    static async markAsSent(id) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query(`
                UPDATE InAppNotifications
                SET status = 'SENT', sent_at = SYSUTCDATETIME(), updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE id = @id
            `);
        return result.recordset[0] || null;
    }

    /**
     * Listar por tenant (admin)
     */
    static async findByTenant(tenantId, options = {}) {
        const pool = await connectDB();
        const { status, page = 1, limit = 20 } = options;
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE n.tenant_id = @tenant_id';
        if (status) whereClause += ' AND n.status = @status';

        const countResult = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('status', sql.NVarChar, status || null)
            .query(`SELECT COUNT(*) as total FROM InAppNotifications n ${whereClause}`);

        const total = countResult.recordset[0].total;

        const dataResult = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('status', sql.NVarChar, status || null)
            .input('offset', sql.Int, offset)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT n.*, ISNULL(ta.first_name + ' ' + ISNULL(ta.last_name, ''), 'Administración') as author_name
                FROM InAppNotifications n
                LEFT JOIN TenantAdmins ta ON n.created_by = ta.id
                ${whereClause}
                ORDER BY 
                    CASE n.status 
                        WHEN 'DRAFT' THEN 1 
                        WHEN 'SCHEDULED' THEN 2 
                        WHEN 'SENT' THEN 3 
                    END,
                    COALESCE(n.sent_at, n.scheduled_at, n.created_at) DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);

        return {
            notifications: dataResult.recordset,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) }
        };
    }

    /**
     * Obtener por ID
     */
    static async findById(id, tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT n.*, ISNULL(ta.first_name + ' ' + ISNULL(ta.last_name, ''), 'Administración') as author_name
                FROM InAppNotifications n
                LEFT JOIN TenantAdmins ta ON n.created_by = ta.id
                WHERE n.id = @id AND n.tenant_id = @tenant_id
            `);
        return result.recordset[0] || null;
    }

    /**
     * Últimas N notificaciones enviadas para propietarios (por tenant)
     */
    static async getLatestForTenant(tenantId, limit = 4) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT TOP (@limit) n.id, n.message, n.sent_at,
                    ISNULL(ta.first_name + ' ' + ISNULL(ta.last_name, ''), 'Administración') as author_name
                FROM InAppNotifications n
                LEFT JOIN TenantAdmins ta ON n.created_by = ta.id
                WHERE n.tenant_id = @tenant_id AND n.status = 'SENT'
                ORDER BY n.sent_at DESC
            `);
        return result.recordset || [];
    }

    /**
     * Obtener programadas pendientes de enviar (para cron)
     */
    static async getScheduledDue() {
        const pool = await connectDB();
        const result = await pool.request().query(`
            SELECT * FROM InAppNotifications
            WHERE status = 'SCHEDULED' AND scheduled_at IS NOT NULL
        `);
        const rows = result.recordset || [];
        const now = Date.now();
        return rows.filter((row) => {
            const raw = row.scheduled_at;
            if (raw == null) return false;
            const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
            return !Number.isNaN(ms) && ms <= now;
        });
    }

    /**
     * Eliminar (solo draft/scheduled)
     */
    static async delete(id, tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                DELETE FROM InAppNotifications
                WHERE id = @id AND tenant_id = @tenant_id AND status IN ('DRAFT', 'SCHEDULED')
            `);
        return result.rowsAffected[0] > 0;
    }

    static getMaxLength() {
        return MAX_MESSAGE_LENGTH;
    }
}

module.exports = InAppNotificationModel;
