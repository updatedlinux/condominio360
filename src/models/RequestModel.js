const { sql, connectDB } = require('../config/database');

class RequestModel {
    /**
     * Create a new request (ticket)
     * @param {Object} data 
     */
    static async create(data) {
        const { tenant_id, user_id, property_id, request_type_id, description, data: requestData, priority } = data;
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('user_id', sql.UniqueIdentifier, user_id)
                .input('property_id', sql.UniqueIdentifier, property_id || null)
                .input('request_type_id', sql.UniqueIdentifier, request_type_id)
                .input('description', sql.NVarChar, description || '')
                .input('data', sql.NVarChar, JSON.stringify(requestData || {}))
                .input('priority', sql.NVarChar, priority || 'MEDIUM')
                .query(`
                    INSERT INTO Requests (tenant_id, user_id, property_id, request_type_id, description, data, priority)
                    OUTPUT INSERTED.*
                    VALUES (@tenant_id, @user_id, @property_id, @request_type_id, @description, @data, @priority)
                `);

            const record = result.recordset[0];
            if (record) {
                record.data = JSON.parse(record.data);
            }
            return record;
        } catch (error) {
            console.error('Error creating request:', error);
            throw error;
        }
    }

    /**
     * Get all requests for a tenant
     * @param {string} tenantId 
     */
    static async getAllByTenant(tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT r.*, 
                        u.first_name, u.last_name, u.email,
                        p.name as property_name,
                        rt.name as type_name
                    FROM Requests r
                    INNER JOIN Users u ON r.user_id = u.id
                    LEFT JOIN Properties p ON r.property_id = p.id
                    LEFT JOIN RequestTypes rt ON r.request_type_id = rt.id
                    WHERE r.tenant_id = @tenant_id
                    ORDER BY r.created_at DESC
                `);
            return result.recordset.map(req => ({
                ...req,
                data: req.data ? JSON.parse(req.data) : null
            }));
        } catch (error) {
            console.error('Error fetching requests:', error);
            throw error;
        }
    }

    /**
     * Get requests by user (My Requests)
     * @param {string} userId 
     * @param {string} tenantId 
     */
    static async getAllByUser(userId, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('user_id', sql.UniqueIdentifier, userId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT r.*, p.name as property_name, rt.name as type_name
                    FROM Requests r
                    LEFT JOIN Properties p ON r.property_id = p.id
                    LEFT JOIN RequestTypes rt ON r.request_type_id = rt.id
                    WHERE r.user_id = @user_id AND r.tenant_id = @tenant_id
                    ORDER BY r.created_at DESC
                `);
            return result.recordset.map(req => ({
                ...req,
                data: req.data ? JSON.parse(req.data) : null
            }));
        } catch (error) {
            console.error('Error fetching user requests:', error);
            throw error;
        }
    }

    /**
     * Update request status
     */
    static async updateStatus(id, status, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('status', sql.NVarChar, status)
                .query(`
                    UPDATE Requests 
                    SET status = @status, updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenant_id
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error updating request status:', error);
            throw error;
        }
    }
}

module.exports = RequestModel;
