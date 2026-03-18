const { sql, connectDB } = require('../config/database');

/**
 * Modelo para registro de auditoría
 * Registra acciones importantes del sistema para trazabilidad
 */
class AuditLogModel {
    /**
     * Crear un registro de auditoría
     * @param {Object} logData
     * @returns {Promise<Object>}
     */
    static async create(logData) {
        const {
            tenant_id = null,
            actor_id = null,
            actor_type = 'SYSTEM',
            actor_email = null,
            action,
            entity_type,
            entity_id = null,
            description = null,
            old_values = null,
            new_values = null,
            ip_address = null,
            user_agent = null
        } = logData;

        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('actor_id', sql.UniqueIdentifier, actor_id)
                .input('actor_type', sql.NVarChar, actor_type)
                .input('actor_email', sql.NVarChar, actor_email)
                .input('action', sql.NVarChar, action)
                .input('entity_type', sql.NVarChar, entity_type)
                .input('entity_id', sql.NVarChar, entity_id)
                .input('description', sql.NVarChar, description)
                .input('old_values', sql.NVarChar, old_values ? JSON.stringify(old_values) : null)
                .input('new_values', sql.NVarChar, new_values ? JSON.stringify(new_values) : null)
                .input('ip_address', sql.NVarChar, ip_address)
                .input('user_agent', sql.NVarChar, user_agent)
                .query(`
                    INSERT INTO AuditLogs 
                        (tenant_id, actor_id, actor_type, actor_email, action, entity_type, entity_id, 
                         description, old_values, new_values, ip_address, user_agent)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @actor_id, @actor_type, @actor_email, @action, @entity_type, @entity_id,
                         @description, @old_values, @new_values, @ip_address, @user_agent)
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error creating audit log:', error);
            // No lanzar error para no interrumpir el flujo principal
            return null;
        }
    }

    /**
     * Obtener logs por tenant
     * @param {string} tenantId
     * @param {Object} options - { limit, offset, action, entity_type, startDate, endDate }
     * @returns {Promise<Array>}
     */
    static async getByTenant(tenantId, options = {}) {
        const {
            limit = 50,
            offset = 0,
            action = null,
            entity_type = null,
            startDate = null,
            endDate = null
        } = options;

        try {
            let query = `
                SELECT * FROM AuditLogs
                WHERE tenant_id = @tenantId
            `;

            const request = pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('limit', sql.Int, limit)
                .input('offset', sql.Int, offset);

            if (action) {
                query += ' AND action = @action';
                request.input('action', sql.NVarChar, action);
            }

            if (entity_type) {
                query += ' AND entity_type = @entity_type';
                request.input('entity_type', sql.NVarChar, entity_type);
            }

            if (startDate) {
                query += ' AND created_at >= @startDate';
                request.input('startDate', sql.DateTime2, startDate);
            }

            if (endDate) {
                query += ' AND created_at <= @endDate';
                request.input('endDate', sql.DateTime2, endDate);
            }

            query += ' ORDER BY created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';

            const pool = await connectDB();
            const result = await request.query(query);

            return result.recordset.map(log => ({
                ...log,
                old_values: log.old_values ? JSON.parse(log.old_values) : null,
                new_values: log.new_values ? JSON.parse(log.new_values) : null
            }));
        } catch (error) {
            console.error('Error fetching audit logs:', error);
            throw error;
        }
    }

    /**
     * Obtener logs por actor
     * @param {string} actorId
     * @param {string} actorType
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    static async getByActor(actorId, actorType, limit = 50) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('actorId', sql.UniqueIdentifier, actorId)
                .input('actorType', sql.NVarChar, actorType)
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT * FROM AuditLogs
                    WHERE actor_id = @actorId AND actor_type = @actorType
                    ORDER BY created_at DESC
                    OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY
                `);

            return result.recordset.map(log => ({
                ...log,
                old_values: log.old_values ? JSON.parse(log.old_values) : null,
                new_values: log.new_values ? JSON.parse(log.new_values) : null
            }));
        } catch (error) {
            console.error('Error fetching actor audit logs:', error);
            throw error;
        }
    }

    /**
     * Obtener logs por entidad específica
     * @param {string} entityType
     * @param {string} entityId
     * @returns {Promise<Array>}
     */
    static async getByEntity(entityType, entityId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('entityType', sql.NVarChar, entityType)
                .input('entityId', sql.NVarChar, entityId)
                .query(`
                    SELECT * FROM AuditLogs
                    WHERE entity_type = @entityType AND entity_id = @entityId
                    ORDER BY created_at DESC
                `);

            return result.recordset.map(log => ({
                ...log,
                old_values: log.old_values ? JSON.parse(log.old_values) : null,
                new_values: log.new_values ? JSON.parse(log.new_values) : null
            }));
        } catch (error) {
            console.error('Error fetching entity audit logs:', error);
            throw error;
        }
    }

    /**
     * Limpiar logs antiguos (para mantenimiento)
     * @param {number} daysToKeep - Días de logs a mantener
     * @returns {Promise<number>} - Número de registros eliminados
     */
    static async cleanup(daysToKeep = 90) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('cutoffDate', sql.DateTime2, new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000))
                .query(`
                    DELETE FROM AuditLogs
                    WHERE created_at < @cutoffDate
                    SELECT @@ROWCOUNT as deletedCount
                `);

            return result.recordset[0].deletedCount;
        } catch (error) {
            console.error('Error cleaning up audit logs:', error);
            throw error;
        }
    }
}

module.exports = AuditLogModel;
