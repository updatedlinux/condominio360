const { sql, connectDB } = require('../config/database');

/**
 * Modelo para solicitudes de actualización de datos de propietarios
 */
class DataUpdateRequestModel {
    static async create(userId, oldData, newData) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('old_data', sql.NVarChar, JSON.stringify(oldData))
            .input('new_data', sql.NVarChar, JSON.stringify(newData))
            .query(`
                INSERT INTO DataUpdateRequests (user_id, old_data, new_data)
                OUTPUT INSERTED.*
                VALUES (@user_id, @old_data, @new_data)
            `);
        return result.recordset[0];
    }

    static async findById(id) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query(`
                SELECT dur.*, 
                    u.first_name, u.last_name, u.email, u.dni, u.phone
                FROM DataUpdateRequests dur
                INNER JOIN Users u ON dur.user_id = u.id
                WHERE dur.id = @id
            `);
        return result.recordset[0] || null;
    }

    static async list({ page = 1, limit = 20, status = null } = {}) {
        const pool = await connectDB();
        const offset = (page - 1) * limit;

        let whereClause = '';
        const request = pool.request()
            .input('limit', sql.Int, limit)
            .input('offset', sql.Int, offset);

        if (status) {
            whereClause = 'WHERE dur.status = @status';
            request.input('status', sql.NVarChar, status);
        }

        const countReq = pool.request();
        if (status) countReq.input('status', sql.NVarChar, status);

        const [dataResult, countResult] = await Promise.all([
            request.query(`
                SELECT dur.id, dur.user_id, dur.status, dur.requested_at, dur.reviewed_at,
                    u.first_name, u.last_name, u.email, u.dni
                FROM DataUpdateRequests dur
                INNER JOIN Users u ON dur.user_id = u.id
                ${whereClause}
                ORDER BY dur.requested_at DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `),
            countReq.query(`
                SELECT COUNT(*) as total FROM DataUpdateRequests dur ${whereClause}
            `)
        ]);

        return {
            rows: dataResult.recordset,
            total: countResult.recordset[0].total
        };
    }

    static async approve(id, reviewedBy, finalData) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('reviewed_by', sql.UniqueIdentifier, reviewedBy)
            .input('new_data', sql.NVarChar, JSON.stringify(finalData))
            .query(`
                UPDATE DataUpdateRequests 
                SET status = 'APPROVED', new_data = @new_data,
                    reviewed_at = SYSDATETIME(), reviewed_by = @reviewed_by,
                    updated_at = SYSDATETIME()
                WHERE id = @id
            `);
    }

    static async reject(id, reviewedBy, reason = null) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('reviewed_by', sql.UniqueIdentifier, reviewedBy)
            .input('reason', sql.NVarChar, reason || null)
            .query(`
                UPDATE DataUpdateRequests 
                SET status = 'REJECTED', rejection_reason = @reason,
                    reviewed_at = SYSDATETIME(), reviewed_by = @reviewed_by,
                    updated_at = SYSDATETIME()
                WHERE id = @id
            `);
    }

    static async getPendingByUser(userId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('user_id', sql.UniqueIdentifier, userId)
            .query(`
                SELECT TOP 1 * FROM DataUpdateRequests 
                WHERE user_id = @user_id AND status = 'PENDING'
                ORDER BY requested_at DESC
            `);
        return result.recordset[0] || null;
    }
}

module.exports = DataUpdateRequestModel;
