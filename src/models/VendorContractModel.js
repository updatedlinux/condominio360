const { sql, connectDB } = require('../config/database');

/**
 * Modelo para Contratos de Proveedores (VendorContracts)
 */
class VendorContractModel {
    /**
     * Crear contrato
     */
    static async create(data) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('vendor_id', sql.UniqueIdentifier, data.vendor_id)
                .input('tenant_id', sql.UniqueIdentifier, data.tenant_id)
                .input('description', sql.NVarChar, data.description)
                .input('amount', sql.Decimal(15, 2), data.amount)
                .input('currency', sql.NVarChar, data.currency || 'VES')
                .input('billing_frequency', sql.NVarChar, data.billing_frequency || 'MONTHLY')
                .input('start_date', sql.Date, data.start_date)
                .input('end_date', sql.Date, data.end_date || null)
                .query(`
                    INSERT INTO VendorContracts (vendor_id, tenant_id, description, amount, currency, billing_frequency, start_date, end_date)
                    OUTPUT INSERTED.*
                    VALUES (@vendor_id, @tenant_id, @description, @amount, @currency, @billing_frequency, @start_date, @end_date)
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error creating vendor contract:', error);
            throw error;
        }
    }

    /**
     * Obtener contratos activos de un tenant
     */
    static async getActiveByTenant(tenantId, referenceDate = null) {
        try {
            const pool = await connectDB();
            const date = referenceDate || new Date().toISOString().split('T')[0];
            
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('reference_date', sql.Date, date)
                .query(`
                    SELECT vc.*, v.name as vendor_name, v.service_type
                    FROM VendorContracts vc
                    INNER JOIN Vendors v ON vc.vendor_id = v.id
                    WHERE vc.tenant_id = @tenant_id
                    AND vc.status = 'ACTIVE'
                    AND vc.start_date <= @reference_date
                    AND (vc.end_date IS NULL OR vc.end_date >= @reference_date)
                    ORDER BY v.name, vc.description
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching active contracts:', error);
            throw error;
        }
    }

    /**
     * Obtener todos los contratos de un tenant
     */
    static async getByTenant(tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT vc.*, v.name as vendor_name, v.service_type
                    FROM VendorContracts vc
                    INNER JOIN Vendors v ON vc.vendor_id = v.id
                    WHERE vc.tenant_id = @tenant_id
                    ORDER BY vc.created_at DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching contracts:', error);
            throw error;
        }
    }

    /**
     * Obtener contratos por proveedor
     */
    static async getByVendor(vendorId, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('vendor_id', sql.UniqueIdentifier, vendorId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT vc.*, v.name as vendor_name
                    FROM VendorContracts vc
                    INNER JOIN Vendors v ON vc.vendor_id = v.id
                    WHERE vc.vendor_id = @vendor_id AND vc.tenant_id = @tenant_id
                    ORDER BY vc.created_at DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching vendor contracts:', error);
            throw error;
        }
    }

    /**
     * Obtener contrato por ID
     */
    static async findById(id, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT vc.*, v.name as vendor_name, v.service_type
                    FROM VendorContracts vc
                    INNER JOIN Vendors v ON vc.vendor_id = v.id
                    WHERE vc.id = @id AND vc.tenant_id = @tenant_id
                `);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding contract:', error);
            throw error;
        }
    }

    /**
     * Actualizar contrato
     */
    static async update(id, tenantId, data) {
        try {
            const pool = await connectDB();
            
            const updates = [];
            const request = pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            if (data.description !== undefined) {
                updates.push('description = @description');
                request.input('description', sql.NVarChar, data.description);
            }
            if (data.amount !== undefined) {
                updates.push('amount = @amount');
                request.input('amount', sql.Decimal(15, 2), data.amount);
            }
            if (data.currency !== undefined) {
                updates.push('currency = @currency');
                request.input('currency', sql.NVarChar, data.currency);
            }
            if (data.billing_frequency !== undefined) {
                updates.push('billing_frequency = @billing_frequency');
                request.input('billing_frequency', sql.NVarChar, data.billing_frequency);
            }
            if (data.start_date !== undefined) {
                updates.push('start_date = @start_date');
                request.input('start_date', sql.Date, data.start_date);
            }
            if (data.end_date !== undefined) {
                updates.push('end_date = @end_date');
                request.input('end_date', sql.Date, data.end_date);
            }
            if (data.status !== undefined) {
                updates.push('status = @status');
                request.input('status', sql.NVarChar, data.status);
            }

            if (updates.length === 0) return null;

            updates.push('updated_at = SYSDATETIME()');

            const result = await request.query(`
                UPDATE VendorContracts 
                SET ${updates.join(', ')}
                OUTPUT INSERTED.*
                WHERE id = @id AND tenant_id = @tenant_id
            `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error updating contract:', error);
            throw error;
        }
    }

    /**
     * Eliminar contrato
     */
    static async delete(id, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    DELETE FROM VendorContracts 
                    OUTPUT DELETED.*
                    WHERE id = @id AND tenant_id = @tenant_id
                `);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error deleting contract:', error);
            throw error;
        }
    }
}

module.exports = VendorContractModel;
