const { connectDB, sql } = require('../config/database');

/**
 * Modelo para manejar comunicados
 */
class CommuniqueModel {
    /**
     * Crear nuevo comunicado
     */
    static async create(data) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, data.tenantId)
                .input('createdBy', sql.UniqueIdentifier, data.createdBy)
                .input('title', sql.NVarChar(500), data.title)
                .input('description', sql.NVarChar(sql.MAX), data.description)
                .input('originalFilename', sql.NVarChar(500), data.originalFilename)
                .input('fileType', sql.VarChar(10), data.fileType)
                .input('htmlContent', sql.NVarChar(sql.MAX), data.htmlContent)
                .input('storagePath', sql.NVarChar(1000), data.storagePath)
                .query(`
                    INSERT INTO Communiques (tenant_id, created_by, title, description, original_filename, file_type, html_content, storage_path)
                    OUTPUT INSERTED.*
                    VALUES (@tenantId, @createdBy, @title, @description, @originalFilename, @fileType, @htmlContent, @storagePath)
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error creating communique:', error);
            throw error;
        }
    }

    /**
     * Obtener comunicado por ID
     */
    static async findById(id, tenantId = null) {
        try {
            const pool = await connectDB();
            let query = `
                SELECT c.*, ISNULL(u.first_name + ' ' + u.last_name, 'Administrador') as author_name
                FROM Communiques c
                LEFT JOIN Users u ON c.created_by = u.id
                WHERE c.id = @id AND c.status = 'active'
            `;
            
            if (tenantId) {
                query += ' AND c.tenant_id = @tenantId';
            }

            const request = pool.request().input('id', sql.UniqueIdentifier, id);
            
            if (tenantId) {
                request.input('tenantId', sql.UniqueIdentifier, tenantId);
            }

            const result = await request.query(query);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding communique:', error);
            throw error;
        }
    }

    /**
     * Obtener comunicados paginados por tenant
     */
    static async getByTenant(tenantId, page = 1, limit = 10) {
        try {
            const pool = await connectDB();
            const offset = (page - 1) * limit;

            // Total count
            const countResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`SELECT COUNT(*) as total FROM Communiques WHERE tenant_id = @tenantId AND status = 'active'`);
            
            const total = countResult.recordset[0].total;

            // Paginated results
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('limit', sql.Int, limit)
                .input('offset', sql.Int, offset)
                .query(`
                    SELECT c.*, 
                           ISNULL(u.first_name + ' ' + u.last_name, 'Administrador') as author_name,
                           (SELECT COUNT(*) FROM CommuniqueReads WHERE communique_id = c.id) as read_count
                    FROM Communiques c
                    LEFT JOIN Users u ON c.created_by = u.id
                    WHERE c.tenant_id = @tenantId AND c.status = 'active'
                    ORDER BY c.created_at DESC
                    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
                `);

            return {
                communiques: result.recordset,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            console.error('Error getting communiques by tenant:', error);
            throw error;
        }
    }

    /**
     * Marcar como publicado
     */
    static async markAsPublished(id) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query(`UPDATE Communiques SET published_at = SYSDATETIME() WHERE id = @id`);
            return true;
        } catch (error) {
            console.error('Error marking communique as published:', error);
            throw error;
        }
    }

    /**
     * Registrar lectura por usuario
     */
    static async recordRead(communiqueId, userId, ipAddress = null, userAgent = null) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('communiqueId', sql.UniqueIdentifier, communiqueId)
                .input('userId', sql.UniqueIdentifier, userId)
                .input('ipAddress', sql.VarChar(50), ipAddress)
                .input('userAgent', sql.NVarChar(500), userAgent)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM CommuniqueReads WHERE communique_id = @communiqueId AND user_id = @userId)
                    INSERT INTO CommuniqueReads (communique_id, user_id, ip_address, user_agent)
                    VALUES (@communiqueId, @userId, @ipAddress, @userAgent)
                `);
            return true;
        } catch (error) {
            console.error('Error recording communique read:', error);
            return false;
        }
    }

    /**
     * Verificar si usuario ya leyó el comunicado
     */
    static async hasUserRead(communiqueId, userId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('communiqueId', sql.UniqueIdentifier, communiqueId)
                .input('userId', sql.UniqueIdentifier, userId)
                .query(`SELECT 1 FROM CommuniqueReads WHERE communique_id = @communiqueId AND user_id = @userId`);
            return result.recordset.length > 0;
        } catch (error) {
            console.error('Error checking if user read communique:', error);
            return false;
        }
    }

    /**
     * Agregar notificaciones a la cola (por lotes)
     */
    static async addToEmailQueue(communiqueId, recipients, batchSize = 3) {
        try {
            const pool = await connectDB();
            const totalBatches = Math.ceil(recipients.length / batchSize);
            
            for (let i = 0; i < recipients.length; i += batchSize) {
                const batch = recipients.slice(i, i + batchSize);
                const batchNumber = Math.floor(i / batchSize) + 1;
                
                await pool.request()
                    .input('communiqueId', sql.UniqueIdentifier, communiqueId)
                    .input('batchNumber', sql.Int, batchNumber)
                    .input('totalBatches', sql.Int, totalBatches)
                    .input('recipientsCount', sql.Int, batch.length)
                    .query(`
                        INSERT INTO CommuniqueEmailQueue (communique_id, batch_number, total_batches, recipients_count)
                        VALUES (@communiqueId, @batchNumber, @totalBatches, @recipientsCount)
                    `);

                // Insertar notificaciones individuales
                for (const recipient of batch) {
                    await pool.request()
                        .input('communiqueId', sql.UniqueIdentifier, communiqueId)
                        .input('userId', sql.UniqueIdentifier, recipient.id)
                        .input('email', sql.NVarChar(255), recipient.email)
                        .query(`
                            INSERT INTO CommuniqueNotifications (communique_id, user_id, email, status)
                            VALUES (@communiqueId, @userId, @email, 'pending')
                        `);
                }
            }
            
            return totalBatches;
        } catch (error) {
            console.error('Error adding to email queue:', error);
            throw error;
        }
    }

    /**
     * Obtener lotes pendientes de envío
     */
    static async getPendingBatches(limit = 1) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT TOP (@limit) q.*, c.title, c.description, t.name as tenant_name
                    FROM CommuniqueEmailQueue q
                    INNER JOIN Communiques c ON q.communique_id = c.id
                    INNER JOIN Tenants t ON c.tenant_id = t.id
                    WHERE q.status = 'pending'
                    ORDER BY q.created_at ASC, q.batch_number ASC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error getting pending batches:', error);
            return [];
        }
    }

    /**
     * Obtener destinatarios de un lote
     */
    static async getBatchRecipients(communiqueId, batchNumber, batchSize = 30) {
        try {
            const pool = await connectDB();
            const offset = (batchNumber - 1) * batchSize;
            
            const result = await pool.request()
                .input('communiqueId', sql.UniqueIdentifier, communiqueId)
                .input('offset', sql.Int, offset)
                .input('limit', sql.Int, batchSize)
                .query(`
                    SELECT n.*, u.first_name, u.last_name
                    FROM CommuniqueNotifications n
                    LEFT JOIN Users u ON n.user_id = u.id
                    WHERE n.communique_id = @communiqueId 
                    AND n.status = 'pending'
                    ORDER BY n.created_at ASC
                    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error getting batch recipients:', error);
            return [];
        }
    }

    /**
     * Actualizar estado de lote
     */
    static async updateBatchStatus(queueId, status, errorMessage = null) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('id', sql.UniqueIdentifier, queueId)
                .input('status', sql.VarChar(20), status)
                .input('errorMessage', sql.NVarChar(sql.MAX), errorMessage)
                .query(`
                    UPDATE CommuniqueEmailQueue 
                    SET status = @status, 
                        processed_at = CASE WHEN @status IN ('completed', 'failed') THEN SYSDATETIME() ELSE NULL END,
                        error_message = @errorMessage
                    WHERE id = @id
                `);
            return true;
        } catch (error) {
            console.error('Error updating batch status:', error);
            return false;
        }
    }

    /**
     * Actualizar estado de notificación
     */
    static async updateNotificationStatus(notificationId, status, message = null) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('id', sql.UniqueIdentifier, notificationId)
                .input('status', sql.VarChar(20), status)
                .input('message', sql.NVarChar(sql.MAX), message)
                .query(`
                    UPDATE CommuniqueNotifications 
                    SET status = @status, 
                        message = @message,
                        sent_at = CASE WHEN @status = 'sent' THEN SYSDATETIME() ELSE sent_at END
                    WHERE id = @id
                `);
            return true;
        } catch (error) {
            console.error('Error updating notification status:', error);
            return false;
        }
    }

    /**
     * Obtener estadísticas generales del tenant
     */
    static async getTenantStats(tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT 
                        (SELECT COUNT(*) FROM Communiques WHERE tenant_id = @tenantId AND status = 'active') as total_communiques,
                        (SELECT COUNT(*) FROM Communiques WHERE tenant_id = @tenantId AND status = 'active' AND MONTH(created_at) = MONTH(GETDATE()) AND YEAR(created_at) = YEAR(GETDATE())) as this_month,
                        (SELECT COUNT(*) FROM CommuniqueReads r INNER JOIN Communiques c ON r.communique_id = c.id WHERE c.tenant_id = @tenantId AND c.status = 'active') as total_reads,
                        (SELECT COUNT(*) FROM CommuniqueEmailQueue q INNER JOIN Communiques c ON q.communique_id = c.id WHERE c.tenant_id = @tenantId AND q.status = 'pending') as queue_pending
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error getting tenant communique stats:', error);
            return { total_communiques: 0, this_month: 0, total_reads: 0, queue_pending: 0 };
        }
    }

    /**
     * Obtener estadísticas del comunicado
     */
    static async getStats(communiqueId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('communiqueId', sql.UniqueIdentifier, communiqueId)
                .query(`
                    SELECT 
                        (SELECT COUNT(*) FROM CommuniqueNotifications WHERE communique_id = @communiqueId) as total_recipients,
                        (SELECT COUNT(*) FROM CommuniqueNotifications WHERE communique_id = @communiqueId AND status = 'sent') as sent_count,
                        (SELECT COUNT(*) FROM CommuniqueNotifications WHERE communique_id = @communiqueId AND status = 'error') as error_count,
                        (SELECT COUNT(*) FROM CommuniqueReads WHERE communique_id = @communiqueId) as read_count
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error getting communique stats:', error);
            return { total_recipients: 0, sent_count: 0, error_count: 0, read_count: 0 };
        }
    }

    /**
     * Obtener comunicados para un propietario (con estado de lectura)
     */
    static async getForOwner(tenantId, userId, page = 1, limit = 10) {
        try {
            const pool = await connectDB();
            const offset = (page - 1) * limit;

            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('userId', sql.UniqueIdentifier, userId)
                .input('limit', sql.Int, limit)
                .input('offset', sql.Int, offset)
                .query(`
                    SELECT c.*, 
                           ISNULL(u.first_name + ' ' + u.last_name, 'Administrador') as author_name,
                           CASE WHEN r.user_id IS NOT NULL THEN 1 ELSE 0 END as is_read,
                           r.read_at
                    FROM Communiques c
                    LEFT JOIN Users u ON c.created_by = u.id
                    LEFT JOIN CommuniqueReads r ON c.id = r.communique_id AND r.user_id = @userId
                    WHERE c.tenant_id = @tenantId AND c.status = 'active'
                    ORDER BY c.created_at DESC
                    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
                `);

            // Count total
            const countResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`SELECT COUNT(*) as total FROM Communiques WHERE tenant_id = @tenantId AND status = 'active'`);

            return {
                communiques: result.recordset,
                pagination: {
                    page,
                    limit,
                    total: countResult.recordset[0].total,
                    totalPages: Math.ceil(countResult.recordset[0].total / limit)
                }
            };
        } catch (error) {
            console.error('Error getting communiques for owner:', error);
            throw error;
        }
    }
}

module.exports = CommuniqueModel;
