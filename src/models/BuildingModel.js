const { sql, connectDB } = require('../config/database');

/**
 * Modelo para Edificios (Buildings)
 * Gestiona los edificios/torres dentro de un conjunto residencial
 */
class BuildingModel {
    /**
     * Crear un nuevo edificio
     */
    static async create(data) {
        const pool = await connectDB();
        const { tenant_id, name, code, floors, units_per_floor, address_suffix } = data;
        
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenant_id)
            .input('name', sql.NVarChar, name)
            .input('code', sql.NVarChar, code)
            .input('floors', sql.Int, floors)
            .input('units_per_floor', sql.Int, units_per_floor)
            .input('address_suffix', sql.NVarChar, address_suffix)
            .query(`
                INSERT INTO Buildings (tenant_id, name, code, floors, units_per_floor, address_suffix)
                OUTPUT INSERTED.*
                VALUES (@tenant_id, @name, @code, @floors, @units_per_floor, @address_suffix)
            `);
        
        return result.recordset[0];
    }

    /**
     * Actualizar edificio
     */
    static async update(id, data) {
        const pool = await connectDB();
        const { name, code, floors, units_per_floor, address_suffix, is_active } = data;
        
        const updates = [];
        const inputs = [{ name: 'id', type: sql.UniqueIdentifier, value: id }];
        
        if (name !== undefined) {
            updates.push('name = @name');
            inputs.push({ name: 'name', type: sql.NVarChar, value: name });
        }
        if (code !== undefined) {
            updates.push('code = @code');
            inputs.push({ name: 'code', type: sql.NVarChar, value: code });
        }
        if (floors !== undefined) {
            updates.push('floors = @floors');
            inputs.push({ name: 'floors', type: sql.Int, value: floors });
        }
        if (units_per_floor !== undefined) {
            updates.push('units_per_floor = @units_per_floor');
            inputs.push({ name: 'units_per_floor', type: sql.Int, value: units_per_floor });
        }
        if (address_suffix !== undefined) {
            updates.push('address_suffix = @address_suffix');
            inputs.push({ name: 'address_suffix', type: sql.NVarChar, value: address_suffix });
        }
        if (is_active !== undefined) {
            updates.push('is_active = @is_active');
            inputs.push({ name: 'is_active', type: sql.Bit, value: is_active });
        }
        
        if (updates.length === 0) return null;
        
        updates.push('updated_at = SYSDATETIME()');
        
        const request = pool.request();
        inputs.forEach(input => request.input(input.name, input.type, input.value));
        
        const result = await request.query(`
            UPDATE Buildings
            SET ${updates.join(', ')}
            OUTPUT INSERTED.*
            WHERE id = @id
        `);
        
        return result.recordset[0];
    }

    /**
     * Obtener edificio por ID
     */
    static async findById(id) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query('SELECT * FROM Buildings WHERE id = @id');
        return result.recordset[0];
    }

    /**
     * Listar edificios por tenant
     */
    static async findByTenant(tenantId, options = {}) {
        const pool = await connectDB();
        const { onlyActive = true } = options;
        
        let whereClause = 'WHERE tenant_id = @tenant_id';
        if (onlyActive) whereClause += ' AND is_active = 1';
        
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT b.*,
                    (SELECT COUNT(*) FROM Properties WHERE building_id = b.id) as unit_count
                FROM Buildings b
                ${whereClause}
                ORDER BY b.name
            `);
        
        return result.recordset;
    }

    /**
     * Eliminar edificio (soft delete)
     */
    static async delete(id) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query('UPDATE Buildings SET is_active = 0, updated_at = SYSDATETIME() WHERE id = @id');
        return true;
    }

    /**
     * Verificar si un tenant tiene múltiples edificios
     */
    static async isMultiBuilding(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT building_type FROM Tenants WHERE id = @tenant_id
            `);
        
        const buildingType = result.recordset[0]?.building_type || result.recordset[0]?.BUILDING_TYPE;
        return buildingType === 'MULTIPLE';
    }

    /**
     * Obtener conteo de edificios por tenant
     */
    static async countByTenant(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT COUNT(*) as count FROM Buildings 
                WHERE tenant_id = @tenant_id AND is_active = 1
            `);
        return result.recordset[0].count;
    }
}

module.exports = BuildingModel;
