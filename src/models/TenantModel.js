const { sql, connectDB } = require('../config/database');

class TenantModel {
    /**
     * Find a tenant by their slug (useful for subdomain resolution)
     * @param {string} slug 
     * @returns {Promise<Object|null>}
     */
    static async findBySlug(slug) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('slug', sql.NVarChar, slug)
                .query('SELECT * FROM Tenants WHERE slug = @slug AND active = 1');

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding tenant by slug:', error);
            throw error;
        }
    }

    /**
     * Find a tenant by ID
     * @param {string} id 
     * @returns {Promise<Object|null>}
     */
    static async findById(id) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT t.*, 
                        (SELECT COUNT(*) FROM Buildings WHERE tenant_id = t.id AND is_active = 1) as building_count,
                        (SELECT COUNT(*) FROM Properties WHERE tenant_id = t.id) as property_count
                    FROM Tenants t 
                    WHERE t.id = @id
                `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding tenant by id:', error);
            throw error;
        }
    }

    /**
     * Create a new tenant (SuperAdmin only)
     * @param {Object} tenantData 
     */
    static async create(tenantData) {
        const { name, slug, address, billing_type, building_type, settings } = tenantData;
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('name', sql.NVarChar, name)
                .input('slug', sql.NVarChar, slug)
                .input('address', sql.NVarChar, address || null)
                .input('billing_type', sql.NVarChar, billing_type || 'FIXED')
                .input('building_type', sql.NVarChar, building_type || 'SINGLE')
                .input('settings', sql.NVarChar, JSON.stringify(settings || {}))
                .query(`
                    INSERT INTO Tenants (name, slug, address, billing_type, building_type, settings)
                    OUTPUT INSERTED.*
                    VALUES (@name, @slug, @address, @billing_type, @building_type, @settings)
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error creating tenant:', error);
            throw error;
        }
    }

    /**
     * Update tenant settings
     * @param {string} id 
     * @param {Object} data 
     */
    static async update(id, data) {
        const allowedFields = ['name', 'address', 'billing_type', 'billing_mode', 'payment_info', 'building_type', 'settings', 'active'];
        const updates = [];
        const inputs = [{ name: 'id', type: sql.UniqueIdentifier, value: id }];

        for (const [key, value] of Object.entries(data)) {
            if (allowedFields.includes(key) && value !== undefined) {
                updates.push(`${key} = @${key}`);
                if (key === 'settings') {
                    inputs.push({ name: key, type: sql.NVarChar, value: JSON.stringify(value) });
                } else {
                    inputs.push({ name: key, type: sql.NVarChar, value });
                }
            }
        }

        if (updates.length === 0) return null;

        try {
            const pool = await connectDB();
            const request = pool.request();
            inputs.forEach(input => request.input(input.name, input.type, input.value));

            const result = await request.query(`
                UPDATE Tenants 
                SET ${updates.join(', ')}, updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE id = @id
            `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error updating tenant:', error);
            throw error;
        }
    }

    /**
     * Get all tenants with stats
     */
    static async getAll(options = {}) {
        const { page = 1, limit = 50, active = null } = options;
        const offset = (page - 1) * limit;

        try {
            const pool = await connectDB();
            
            let whereClause = '';
            if (active !== null) {
                whereClause = 'WHERE active = @active';
            }

            const countResult = await pool.request()
                .input('active', sql.Bit, active)
                .query(`SELECT COUNT(*) as total FROM Tenants ${whereClause}`);

            const total = countResult.recordset[0].total;

            const dataResult = await pool.request()
                .input('active', sql.Bit, active)
                .input('offset', sql.Int, offset)
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT t.*,
                        (SELECT COUNT(*) FROM Properties WHERE tenant_id = t.id) as property_count,
                        (SELECT COUNT(*) FROM Buildings WHERE tenant_id = t.id AND is_active = 1) as building_count,
                        (SELECT COUNT(*) FROM Users u 
                         INNER JOIN PropertyOwners po ON u.id = po.user_id 
                         INNER JOIN Properties p ON po.property_id = p.id 
                         WHERE p.tenant_id = t.id) as owner_count
                    FROM Tenants t
                    ${whereClause}
                    ORDER BY t.created_at DESC
                    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
                `);

            return {
                tenants: dataResult.recordset,
                pagination: { total, page, limit, pages: Math.ceil(total / limit) }
            };
        } catch (error) {
            console.error('Error getting tenants:', error);
            throw error;
        }
    }
}

module.exports = TenantModel;
