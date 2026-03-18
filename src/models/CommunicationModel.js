const { sql, connectDB } = require('../config/database');

/**
 * Modelo para Comunicados/Cartas
 */
class CommunicationModel {
    /**
     * Crear un nuevo comunicado
     */
    static async create(data) {
        const pool = await connectDB();
        const { tenantId, createdBy, title, content, category = 'GENERAL', 
                priority = 'NORMAL', targetType = 'ALL', targetBuilding = null, 
                targetPropertyId = null, sendEmail = false, status = 'DRAFT' } = data;
        
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('created_by', sql.UniqueIdentifier, createdBy)
            .input('title', sql.NVarChar, title)
            .input('content', sql.NVarChar, content)
            .input('category', sql.NVarChar, category)
            .input('priority', sql.NVarChar, priority)
            .input('target_type', sql.NVarChar, targetType)
            .input('target_building', sql.NVarChar, targetBuilding)
            .input('target_property_id', sql.UniqueIdentifier, targetPropertyId)
            .input('send_email', sql.Bit, sendEmail)
            .input('status', sql.NVarChar, status)
            .query(`
                INSERT INTO Communications (tenant_id, created_by, title, content, category, 
                    priority, target_type, target_building, target_property_id, send_email, status)
                OUTPUT INSERTED.*
                VALUES (@tenant_id, @created_by, @title, @content, @category,
                    @priority, @target_type, @target_building, @target_property_id, @send_email, @status)
            `);
        
        return result.recordset[0];
    }

    /**
     * Actualizar comunicado
     */
    static async update(communicationId, data) {
        const pool = await connectDB();
        const { title, content, category, priority, targetType, 
                targetBuilding, targetPropertyId, sendEmail, status } = data;
        
        const updates = [];
        const inputs = [];
        
        if (title !== undefined) { updates.push('title = @title'); inputs.push({ name: 'title', type: sql.NVarChar, value: title }); }
        if (content !== undefined) { updates.push('content = @content'); inputs.push({ name: 'content', type: sql.NVarChar, value: content }); }
        if (category !== undefined) { updates.push('category = @category'); inputs.push({ name: 'category', type: sql.NVarChar, value: category }); }
        if (priority !== undefined) { updates.push('priority = @priority'); inputs.push({ name: 'priority', type: sql.NVarChar, value: priority }); }
        if (targetType !== undefined) { updates.push('target_type = @target_type'); inputs.push({ name: 'target_type', type: sql.NVarChar, value: targetType }); }
        if (targetBuilding !== undefined) { updates.push('target_building = @target_building'); inputs.push({ name: 'target_building', type: sql.NVarChar, value: targetBuilding }); }
        if (targetPropertyId !== undefined) { updates.push('target_property_id = @target_property_id'); inputs.push({ name: 'target_property_id', type: sql.UniqueIdentifier, value: targetPropertyId }); }
        if (sendEmail !== undefined) { updates.push('send_email = @send_email'); inputs.push({ name: 'send_email', type: sql.Bit, value: sendEmail }); }
        if (status !== undefined) {
            updates.push('status = @status');
            inputs.push({ name: 'status', type: sql.NVarChar, value: status });
            if (status === 'PUBLISHED') {
                updates.push('published_at = @published_at');
                inputs.push({ name: 'published_at', type: sql.DateTime2, value: new Date() });
            }
        }
        updates.push('updated_at = SYSDATETIME()');
        
        const request = pool.request();
        inputs.forEach(input => request.input(input.name, input.type, input.value));
        request.input('id', sql.UniqueIdentifier, communicationId);
        
        const result = await request.query(`
            UPDATE Communications
            SET ${updates.join(', ')}
            OUTPUT INSERTED.*
            WHERE id = @id
        `);
        
        return result.recordset[0];
    }

    /**
     * Eliminar comunicado
     */
    static async delete(communicationId) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, communicationId)
            .query('DELETE FROM Communications WHERE id = @id');
        return true;
    }

    /**
     * Obtener comunicado por ID con stats
     */
    static async findById(communicationId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, communicationId)
            .query(`
                SELECT c.*,
                       ISNULL(u.first_name + ' ' + ISNULL(u.last_name, ''), '') as author_name,
                       u.email as author_email,
                       (SELECT COUNT(*) FROM CommunicationRecipients WHERE communication_id = c.id) as total_recipients,
                       (SELECT COUNT(*) FROM CommunicationRecipients WHERE communication_id = c.id AND read_at IS NOT NULL) as read_count,
                       (SELECT COUNT(*) FROM CommunicationRecipients WHERE communication_id = c.id AND email_delivered = 1) as email_delivered_count
                FROM Communications c
                JOIN Users u ON c.created_by = u.id
                WHERE c.id = @id
            `);
        return result.recordset[0];
    }

    /**
     * Listar comunicados por tenant
     */
    static async findByTenant(tenantId, options = {}) {
        const pool = await connectDB();
        const { status, category, page = 1, limit = 20 } = options;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE c.tenant_id = @tenant_id';
        if (status) whereClause += ' AND c.status = @status';
        if (category) whereClause += ' AND c.category = @category';
        
        const countResult = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('status', sql.NVarChar, status || null)
            .input('category', sql.NVarChar, category || null)
            .query(`SELECT COUNT(*) as total FROM Communications c ${whereClause}`);
        
        const total = countResult.recordset[0].total;
        
        const dataResult = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('status', sql.NVarChar, status || null)
            .input('category', sql.NVarChar, category || null)
            .input('offset', sql.Int, offset)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT c.*,
                       ISNULL(u.first_name + ' ' + ISNULL(u.last_name, ''), '') as author_name,
                       (SELECT COUNT(*) FROM CommunicationRecipients WHERE communication_id = c.id) as total_recipients,
                       (SELECT COUNT(*) FROM CommunicationRecipients WHERE communication_id = c.id AND read_at IS NOT NULL) as read_count
                FROM Communications c
                JOIN Users u ON c.created_by = u.id
                ${whereClause}
                ORDER BY c.created_at DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);
        
        return {
            communications: dataResult.recordset,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) }
        };
    }

    /**
     * Obtener comunicados para un usuario (para el Owner Portal)
     */
    static async findForUser(userId, tenantId, options = {}) {
        const pool = await connectDB();
        const { category, page = 1, limit = 20, onlyUnread = false } = options;
        const offset = (page - 1) * limit;
        
        // Build dynamic conditions
        const conditions = ['c.tenant_id = @tenant_id', 'c.status = @status'];
        if (category) conditions.push('c.category = @category');
        if (onlyUnread) conditions.push('cr.read_at IS NULL');
        
        const whereClause = 'WHERE ' + conditions.join(' AND ');
        
        const countResult = await pool.request()
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('status', sql.NVarChar, 'PUBLISHED')
            .input('category', sql.NVarChar, category || null)
            .query(`
                SELECT COUNT(*) as total FROM Communications c
                LEFT JOIN CommunicationRecipients cr ON c.id = cr.communication_id AND cr.user_id = @user_id
                ${whereClause}
                AND (c.target_type = 'ALL' OR cr.user_id IS NOT NULL)
            `);
        
        const total = countResult.recordset[0].total;
        
        const dataResult = await pool.request()
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('status', sql.NVarChar, 'PUBLISHED')
            .input('category', sql.NVarChar, category || null)
            .input('offset', sql.Int, offset)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT c.*, ISNULL(u.first_name + ' ' + ISNULL(u.last_name, ''), '') as author_name,
                       cr.read_at, cr.read_at IS NOT NULL as is_read
                FROM Communications c
                JOIN Users u ON c.created_by = u.id
                LEFT JOIN CommunicationRecipients cr ON c.id = cr.communication_id AND cr.user_id = @user_id
                ${whereClause}
                AND (c.target_type = 'ALL' OR cr.user_id IS NOT NULL)
                ORDER BY c.published_at DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);
        
        return {
            communications: dataResult.recordset,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) }
        };
    }

    /**
     * Marcar como leído
     */
    static async markAsRead(communicationId, userId) {
        const pool = await connectDB();
        await pool.request()
            .input('communication_id', sql.UniqueIdentifier, communicationId)
            .input('user_id', sql.UniqueIdentifier, userId)
            .query(`
                UPDATE CommunicationRecipients
                SET read_at = COALESCE(read_at, SYSDATETIME())
                WHERE communication_id = @communication_id AND user_id = @user_id
            `);
        return true;
    }

    /**
     * Crear recipients para un comunicado (al publicar)
     */
    static async createRecipients(communicationId, tenantId, targetType, targetBuilding, targetPropertyId) {
        const pool = await connectDB();
        let userQuery = '';
        
        switch (targetType) {
            case 'ALL':
                userQuery = `
                    SELECT DISTINCT u.id
                    FROM Users u
                    JOIN Properties p ON u.id = p.owner_id
                    WHERE p.tenant_id = @tenant_id
                `;
                break;
            case 'BUILDING':
                userQuery = `
                    SELECT DISTINCT u.id
                    FROM Users u
                    JOIN Properties p ON u.id = p.owner_id
                    WHERE p.tenant_id = @tenant_id AND p.building = @target_building
                `;
                break;
            case 'PROPERTY':
                userQuery = `
                    SELECT owner_id as id
                    FROM Properties
                    WHERE id = @target_property_id AND tenant_id = @tenant_id
                `;
                break;
            default:
                return;
        }
        
        await pool.request()
            .input('communication_id', sql.UniqueIdentifier, communicationId)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('target_building', sql.NVarChar, targetBuilding)
            .input('target_property_id', sql.UniqueIdentifier, targetPropertyId)
            .query(`
                INSERT INTO CommunicationRecipients (communication_id, user_id)
                SELECT @communication_id, u.id
                FROM (${userQuery}) u
                WHERE NOT EXISTS (
                    SELECT 1 FROM CommunicationRecipients cr 
                    WHERE cr.communication_id = @communication_id AND cr.user_id = u.id
                )
            `);
    }

    /**
     * Contar comunicados no leídos
     */
    static async countUnread(userId, tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT COUNT(*) as count FROM Communications c
                LEFT JOIN CommunicationRecipients cr ON c.id = cr.communication_id AND cr.user_id = @user_id
                WHERE c.tenant_id = @tenant_id 
                  AND c.status = 'PUBLISHED'
                  AND cr.read_at IS NULL
                  AND (c.target_type = 'ALL' OR cr.user_id IS NOT NULL)
            `);
        return result.recordset[0].count;
    }
}

module.exports = CommunicationModel;
