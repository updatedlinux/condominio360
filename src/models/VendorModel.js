const { sql, connectDB } = require('../config/database');

/**
 * Modelo para Proveedores (Vendors)
 */
class VendorModel {
    /**
     * Crear proveedor
     */
    static async create(data) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, data.tenant_id)
                .input('name', sql.NVarChar, data.name)
                .input('description', sql.NVarChar, data.description || null)
                .input('contact_name', sql.NVarChar, data.contact_name || null)
                .input('contact_email', sql.NVarChar, data.contact_email || null)
                .input('contact_phone', sql.NVarChar, data.contact_phone || null)
                .input('service_type', sql.NVarChar, data.service_type || null)
                .query(`
                    INSERT INTO Vendors (tenant_id, name, description, contact_name, contact_email, contact_phone, service_type)
                    OUTPUT INSERTED.*
                    VALUES (@tenant_id, @name, @description, @contact_name, @contact_email, @contact_phone, @service_type)
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error creating vendor:', error);
            throw error;
        }
    }

    /**
     * Obtener todos los proveedores de un tenant
     */
    static async getByTenant(tenantId, options = {}) {
        try {
            const pool = await connectDB();
            let query = `
                SELECT v.*, 
                    (SELECT COUNT(*) FROM VendorContracts WHERE vendor_id = v.id AND status = 'ACTIVE') as active_contracts
                FROM Vendors v
                WHERE v.tenant_id = @tenant_id
            `;

            if (options.status) {
                query += ` AND v.status = @status`;
            }

            query += ` ORDER BY v.name`;

            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            if (options.status) {
                request.input('status', sql.NVarChar, options.status);
            }

            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching vendors:', error);
            throw error;
        }
    }

    /**
     * Obtener proveedor por ID
     */
    static async findById(id, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT v.*, 
                        (SELECT COUNT(*) FROM VendorContracts WHERE vendor_id = v.id AND status = 'ACTIVE') as active_contracts
                    FROM Vendors v
                    WHERE v.id = @id AND v.tenant_id = @tenant_id
                `);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding vendor:', error);
            throw error;
        }
    }

    /**
     * Actualizar proveedor
     */
    static async update(id, tenantId, data) {
        try {
            const pool = await connectDB();
            
            const updates = [];
            const request = pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            if (data.name !== undefined) {
                updates.push('name = @name');
                request.input('name', sql.NVarChar, data.name);
            }
            if (data.description !== undefined) {
                updates.push('description = @description');
                request.input('description', sql.NVarChar, data.description);
            }
            if (data.contact_name !== undefined) {
                updates.push('contact_name = @contact_name');
                request.input('contact_name', sql.NVarChar, data.contact_name);
            }
            if (data.contact_email !== undefined) {
                updates.push('contact_email = @contact_email');
                request.input('contact_email', sql.NVarChar, data.contact_email);
            }
            if (data.contact_phone !== undefined) {
                updates.push('contact_phone = @contact_phone');
                request.input('contact_phone', sql.NVarChar, data.contact_phone);
            }
            if (data.service_type !== undefined) {
                updates.push('service_type = @service_type');
                request.input('service_type', sql.NVarChar, data.service_type);
            }
            if (data.status !== undefined) {
                updates.push('status = @status');
                request.input('status', sql.NVarChar, data.status);
            }

            if (updates.length === 0) return null;

            updates.push('updated_at = SYSDATETIME()');

            const result = await request.query(`
                UPDATE Vendors 
                SET ${updates.join(', ')}
                OUTPUT INSERTED.*
                WHERE id = @id AND tenant_id = @tenant_id
            `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error updating vendor:', error);
            throw error;
        }
    }

    /**
     * Eliminar proveedor (soft delete cambiando status)
     */
    static async delete(id, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    UPDATE Vendors 
                    SET status = 'INACTIVE', updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenant_id
                `);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error deleting vendor:', error);
            throw error;
        }
    }
}

module.exports = VendorModel;
