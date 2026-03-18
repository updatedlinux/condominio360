const { sql, connectDB } = require('../config/database');

class VisitorModel {
    /**
     * Find or create a visitor (Identity)
     */
    static async findOrCreate(data) {
        // Removed 'type' from Visitors table as it is now in Passes
        const { tenant_id, dni, first_name, last_name, phone, photo_url } = data;
        try {
            const pool = await connectDB();

            const check = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('dni', sql.NVarChar, dni)
                .query('SELECT * FROM Visitors WHERE tenant_id = @tenant_id AND dni = @dni');

            if (check.recordset.length > 0) {
                return check.recordset[0];
            }

            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('first_name', sql.NVarChar, first_name)
                .input('last_name', sql.NVarChar, last_name)
                .input('dni', sql.NVarChar, dni)
                .input('phone', sql.NVarChar, phone || null)
                .input('photo_url', sql.NVarChar, photo_url || null)
                .query(`
                    INSERT INTO Visitors (tenant_id, first_name, last_name, dni, phone, photo_url)
                    OUTPUT INSERTED.*
                    VALUES (@tenant_id, @first_name, @last_name, @dni, @phone, @photo_url)
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error in findOrCreate visitor:', error);
            throw error;
        }
    }

    /**
     * Create a Pass (Authorization)
     */
    static async createPass(data) {
        const { tenant_id, visitor_id, user_id, property_id, type, alias, valid_from, valid_until } = data;
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('visitor_id', sql.UniqueIdentifier, visitor_id)
                .input('user_id', sql.UniqueIdentifier, user_id)
                .input('property_id', sql.UniqueIdentifier, property_id || null)
                .input('type', sql.NVarChar, type) // 'ONE_TIME', 'FREQUENT'
                .input('alias', sql.NVarChar, alias || null)
                .input('valid_from', sql.DateTime2, valid_from || new Date())
                .input('valid_until', sql.DateTime2, valid_until || null)
                .query(`
                    INSERT INTO VisitorPasses (tenant_id, visitor_id, user_id, property_id, type, alias, valid_from, valid_until)
                    OUTPUT INSERTED.*
                    VALUES (@tenant_id, @visitor_id, @user_id, @property_id, @type, @alias, @valid_from, @valid_until)
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error creating visitor pass:', error);
            throw error;
        }
    }

    /**
     * Find valid pass for a visitor
     */
    static async findValidPass(tenantId, visitorId) {
        try {
            const pool = await connectDB();
            // Looks for active passes that are either FREQUENT (and active) or ONE_TIME (and within date range)
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('visitor_id', sql.UniqueIdentifier, visitorId)
                .query(`
                    SELECT TOP 1 * FROM VisitorPasses
                    WHERE tenant_id = @tenant_id 
                    AND visitor_id = @visitor_id
                    AND status = 'ACTIVE'
                    AND (
                        (type = 'FREQUENT') OR 
                        (type = 'ONE_TIME' AND CAST(valid_from AS DATE) <= CAST(SYSDATETIME() AS DATE) AND (valid_until IS NULL OR CAST(valid_until AS DATE) >= CAST(SYSDATETIME() AS DATE)))
                    )
                    ORDER BY created_at DESC
                `);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding valid pass:', error);
            throw error;
        }
    }

    /**
     * Search visitors by DNI or Name within a tenant
     */
    static async search(tenantId, query) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('query', sql.NVarChar, `%${query}%`)
                .query(`
                    SELECT * FROM Visitors 
                    WHERE tenant_id = @tenant_id 
                    AND (dni LIKE @query OR first_name LIKE @query OR last_name LIKE @query)
                    ORDER BY created_at DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error searching visitors:', error);
            throw error;
        }
    }

    /**
     * Log Entry
     */
    static async logEntry(data) {
        const { tenant_id, visitor_id, pass_id, property_id, user_id, access_method, vehicle_plate, notes } = data;
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('visitor_id', sql.UniqueIdentifier, visitor_id)
                .input('pass_id', sql.UniqueIdentifier, pass_id || null)
                .input('property_id', sql.UniqueIdentifier, property_id || null)
                .input('user_id', sql.UniqueIdentifier, user_id || null)
                .input('access_method', sql.NVarChar, access_method || 'PEDESTRIAN')
                .input('vehicle_plate', sql.NVarChar, vehicle_plate || null)
                .input('notes', sql.NVarChar, notes || null)
                .query(`
                    INSERT INTO VisitorLogs (tenant_id, visitor_id, pass_id, property_id, user_id, access_method, vehicle_plate, notes, entry_time)
                    OUTPUT INSERTED.*
                    VALUES (@tenant_id, @visitor_id, @pass_id, @property_id, @user_id, @access_method, @vehicle_plate, @notes, SYSDATETIME())
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error logging visit entry:', error);
            throw error;
        }
    }

    /**
     * Log exit
     */
    static async logExit(visitId, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, visitId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    UPDATE VisitorLogs 
                    SET exit_time = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenant_id AND exit_time IS NULL
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error logging visit exit:', error);
            throw error;
        }
    }

    /**
     * Get active visits (not exited yet)
     */
    static async getActiveVisits(tenantId) {
        const pool = await connectDB(); // Ensure pool is obtained
        try {
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT vl.*, 
                           v.first_name, v.last_name, v.dni, v.photo_url,
                           vp.type as pass_type, vp.alias as pass_alias,
                           p.name as property_name,
                           u.first_name as auth_user_first_name, u.last_name as auth_user_last_name
                    FROM VisitorLogs vl
                    INNER JOIN Visitors v ON vl.visitor_id = v.id
                    LEFT JOIN VisitorPasses vp ON vl.pass_id = vp.id
                    LEFT JOIN Properties p ON vl.property_id = p.id
                    LEFT JOIN Users u ON vl.user_id = u.id
                    WHERE vl.tenant_id = @tenant_id AND vl.exit_time IS NULL
                    ORDER BY vl.entry_time DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching active visits:', error);
            throw error;
        }
    }
}

module.exports = VisitorModel;
