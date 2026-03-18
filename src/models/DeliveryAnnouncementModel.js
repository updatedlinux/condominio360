const { sql, connectDB } = require('../config/database');

/**
 * Modelo para DeliveryAnnouncements
 * Gestiona los deliveries anunciados por propietarios
 */
class DeliveryAnnouncementModel {
    
    /**
     * Crear un nuevo anuncio de delivery
     */
    static async create(data) {
        const {
            tenant_id,
            property_id,
            user_id,
            name,
            company,
            tracking_number,
            expected_date,
            notes
        } = data;

        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('property_id', sql.UniqueIdentifier, property_id)
                .input('user_id', sql.UniqueIdentifier, user_id)
                .input('name', sql.NVarChar, name)
                .input('company', sql.NVarChar, company)
                .input('tracking_number', sql.NVarChar, tracking_number || null)
                .input('expected_date', sql.Date, expected_date)
                .input('notes', sql.NVarChar, notes || null)
                .query(`
                    INSERT INTO DeliveryAnnouncements 
                        (tenant_id, property_id, user_id, name, company, tracking_number, expected_date, notes)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @property_id, @user_id, @name, @company, @tracking_number, @expected_date, @notes)
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error creating delivery announcement:', error);
            throw error;
        }
    }

    /**
     * Obtener deliveries por propietario
     */
    static async getByUser(userId, options = {}) {
        const { status = null, limit = 50 } = options;
        
        try {
            const pool = await connectDB();
            let query = `
                SELECT da.*, p.name as property_name, t.name as tenant_name
                FROM DeliveryAnnouncements da
                INNER JOIN Properties p ON da.property_id = p.id
                INNER JOIN Tenants t ON da.tenant_id = t.id
                WHERE da.user_id = @userId
            `;
            
            if (status) {
                query += ` AND da.status = @status`;
            }
            
            query += ` ORDER BY da.created_at DESC OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`;

            const result = await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .input('status', sql.NVarChar, status)
                .input('limit', sql.Int, limit)
                .query(query);

            return result.recordset;
        } catch (error) {
            console.error('Error getting deliveries by user:', error);
            throw error;
        }
    }

    /**
     * Obtener deliveries por tenant (para seguridad)
     */
    static async getByTenant(tenantId, options = {}) {
        const { 
            status = null, 
            date = null, 
            search = null,
            limit = 100 
        } = options;
        
        try {
            const pool = await connectDB();
            let query = `
                SELECT da.*, 
                       p.name as property_name, p.building_id,
                       b.name as building_name,
                       u.first_name + ' ' + u.last_name as owner_name,
                       u.email as owner_email,
                       u.dni as owner_dni
                FROM DeliveryAnnouncements da
                INNER JOIN Properties p ON da.property_id = p.id
                INNER JOIN Users u ON da.user_id = u.id
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE da.tenant_id = @tenantId
            `;
            
            if (status) {
                query += ` AND da.status = @status`;
            }
            
            if (date) {
                query += ` AND da.expected_date = @date`;
            }
            
            if (search) {
                query += ` AND (
                    da.name LIKE @search 
                    OR da.company LIKE @search
                    OR u.first_name LIKE @search
                    OR u.last_name LIKE @search
                    OR u.email LIKE @search
                )`;
            }
            
            query += ` ORDER BY da.expected_date DESC, da.created_at DESC OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`;

            const request = pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('limit', sql.Int, limit);
            
            if (status) request.input('status', sql.NVarChar, status);
            if (date) request.input('date', sql.Date, date);
            if (search) request.input('search', sql.NVarChar, `%${search}%`);
            
            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            console.error('Error getting deliveries by tenant:', error);
            throw error;
        }
    }

    /**
     * Buscar deliveries por nombre/email del propietario
     */
    static async searchByOwner(tenantId, searchTerm) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('search', sql.NVarChar, `%${searchTerm}%`)
                .query(`
                    SELECT da.*, 
                           p.name as property_name,
                           b.name as building_name,
                           u.first_name + ' ' + u.last_name as owner_name,
                           u.email as owner_email,
                           u.dni as owner_dni
                    FROM DeliveryAnnouncements da
                    INNER JOIN Properties p ON da.property_id = p.id
                    INNER JOIN Users u ON da.user_id = u.id
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    WHERE da.tenant_id = @tenantId
                    AND da.status IN ('ANNOUNCED', 'ARRIVED')
                    AND (
                        u.first_name LIKE @search
                        OR u.last_name LIKE @search
                        OR u.email LIKE @search
                        OR u.dni LIKE @search
                    )
                    ORDER BY da.expected_date DESC
                `);
            
            return result.recordset;
        } catch (error) {
            console.error('Error searching deliveries by owner:', error);
            throw error;
        }
    }

    /**
     * Marcar delivery como llegado
     * @param {string} tenantId - Validación multitenant: solo actualiza si pertenece al tenant
     */
    static async markArrived(id, receivedBy, tenantId = null) {
        try {
            const pool = await connectDB();
            const req = pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('received_by', sql.UniqueIdentifier, receivedBy);
            if (tenantId) req.input('tenant_id', sql.UniqueIdentifier, tenantId);
            const whereClause = tenantId ? 'WHERE id = @id AND tenant_id = @tenant_id' : 'WHERE id = @id';
            const result = await req.query(`
                UPDATE DeliveryAnnouncements 
                SET status = 'ARRIVED',
                    arrival_time = SYSDATETIME(),
                    received_by = @received_by,
                    updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                ${whereClause}
            `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error marking delivery as arrived:', error);
            throw error;
        }
    }

    /**
     * Marcar delivery como entregado
     * @param {string} tenantId - Validación multitenant: solo actualiza si pertenece al tenant
     */
    static async markDelivered(id, tenantId = null) {
        try {
            const pool = await connectDB();
            const req = pool.request().input('id', sql.UniqueIdentifier, id);
            if (tenantId) req.input('tenant_id', sql.UniqueIdentifier, tenantId);
            const whereClause = tenantId ? 'WHERE id = @id AND tenant_id = @tenant_id' : 'WHERE id = @id';
            const result = await req.query(`
                UPDATE DeliveryAnnouncements 
                SET status = 'DELIVERED',
                    delivered_at = SYSDATETIME(),
                    updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                ${whereClause}
            `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error marking delivery as delivered:', error);
            throw error;
        }
    }

    /**
     * Obtener conteo para dashboard
     */
    static async getCountByProperty(propertyId, status = null) {
        try {
            const pool = await connectDB();
            let query = `
                SELECT COUNT(*) as count 
                FROM DeliveryAnnouncements 
                WHERE property_id = @propertyId
            `;
            
            if (status) {
                query += ` AND status = @status`;
            }

            const request = pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId);
            
            if (status) request.input('status', sql.NVarChar, status);
            
            const result = await request.query(query);
            return result.recordset[0].count;
        } catch (error) {
            console.error('Error getting delivery count:', error);
            throw error;
        }
    }
}

module.exports = DeliveryAnnouncementModel;
