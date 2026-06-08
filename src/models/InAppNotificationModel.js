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

function coerceBool(value) {
    if (value === true || value === 1 || value === '1' || value === 'true') return true;
    if (value === false || value === 0 || value === '0' || value === 'false') return false;
    return undefined;
}

class InAppNotificationModel {
    static async create(data) {
        const pool = await connectDB();
        const {
            tenantId,
            createdBy,
            message,
            status = 'DRAFT',
            scheduledAt = null,
            sendWhatsapp = false,
            targetBuilding = null,
            attachmentPath = null,
            attachmentMime = null,
            attachmentOriginalName = null
        } = data;

        const trimmed = (message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
        const hasAttachment = !!(attachmentPath && attachmentMime);
        if (!trimmed && !hasAttachment) {
            throw new Error('El mensaje o un adjunto es requerido');
        }

        const scheduledAtSql = coerceScheduledAt(scheduledAt);

        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('created_by', sql.UniqueIdentifier, createdBy)
            .input('message', sql.NVarChar, trimmed)
            .input('status', sql.NVarChar, status)
            .input('scheduled_at', sql.DateTime2, scheduledAtSql)
            .input('send_whatsapp', sql.Bit, sendWhatsapp)
            .input('target_building', sql.NVarChar, targetBuilding || null)
            .input('attachment_path', sql.NVarChar, attachmentPath)
            .input('attachment_mime', sql.NVarChar, attachmentMime)
            .input('attachment_original_name', sql.NVarChar, attachmentOriginalName)
            .query(`
                INSERT INTO InAppNotifications
                (tenant_id, created_by, message, status, scheduled_at, send_whatsapp,
                 target_building, attachment_path, attachment_mime, attachment_original_name)
                OUTPUT INSERTED.*
                VALUES (@tenant_id, @created_by, @message, @status, @scheduled_at, @send_whatsapp,
                        @target_building, @attachment_path, @attachment_mime, @attachment_original_name)
            `);

        return result.recordset[0];
    }

    static async update(id, data) {
        const pool = await connectDB();
        const {
            message,
            status,
            scheduledAt,
            sendWhatsapp,
            targetBuilding,
            attachmentPath,
            attachmentMime,
            attachmentOriginalName,
            clearAttachment
        } = data;

        const updates = [];
        const request = pool.request().input('id', sql.UniqueIdentifier, id);

        if (message !== undefined) {
            const trimmed = (message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
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
        if (targetBuilding !== undefined) {
            updates.push('target_building = @target_building');
            request.input('target_building', sql.NVarChar, targetBuilding || null);
        }
        if (clearAttachment) {
            updates.push('attachment_path = NULL, attachment_mime = NULL, attachment_original_name = NULL');
        } else if (attachmentPath !== undefined) {
            updates.push('attachment_path = @attachment_path');
            updates.push('attachment_mime = @attachment_mime');
            updates.push('attachment_original_name = @attachment_original_name');
            request.input('attachment_path', sql.NVarChar, attachmentPath);
            request.input('attachment_mime', sql.NVarChar, attachmentMime);
            request.input('attachment_original_name', sql.NVarChar, attachmentOriginalName);
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
     * Últimas N notificaciones enviadas visibles para un edificio (NULL = todo el conjunto).
     */
    static async getLatestForTenant(tenantId, limit = 4, buildingName = null) {
        const pool = await connectDB();
        const req = pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('limit', sql.Int, limit);

        let buildingClause = '';
        if (buildingName) {
            buildingClause = ' AND (n.target_building IS NULL OR n.target_building = @building)';
            req.input('building', sql.NVarChar, buildingName);
        }

        const result = await req.query(`
            SELECT TOP (@limit)
                n.id, n.message, n.sent_at, n.target_building,
                n.attachment_path, n.attachment_mime, n.attachment_original_name,
                ISNULL(ta.first_name + ' ' + ISNULL(ta.last_name, ''), 'Administración') as author_name
            FROM InAppNotifications n
            LEFT JOIN TenantAdmins ta ON n.created_by = ta.id
            WHERE n.tenant_id = @tenant_id AND n.status = 'SENT'
            ${buildingClause}
            ORDER BY n.sent_at DESC
        `);
        return result.recordset || [];
    }

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

InAppNotificationModel.coerceBool = coerceBool;

module.exports = InAppNotificationModel;
