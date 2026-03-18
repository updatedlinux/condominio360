const { sql, connectDB } = require('../config/database');

/**
 * Modelo para Unidades Inmobiliarias (Properties)
 * Gestiona apartamentos, casas y otros inmuebles
 */
class PropertyModel {
    /**
     * Crear una nueva propiedad
     */
    static async create(data) {
        const pool = await connectDB();
        const { tenant_id, name, type, building_id, floor, area_sqm, alicuota } = data;
        
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenant_id)
            .input('name', sql.NVarChar, name)
            .input('type', sql.NVarChar, type || 'Apartment')
            .input('building_id', sql.UniqueIdentifier, building_id)
            .input('floor', sql.NVarChar, floor)
            .input('area_sqm', sql.Decimal(10, 2), area_sqm)
            .input('alicuota', sql.Decimal(10, 4), alicuota || 0)
            .query(`
                INSERT INTO Properties (tenant_id, name, type, building_id, floor, area_sqm, alicuota)
                OUTPUT INSERTED.*
                VALUES (@tenant_id, @name, @type, @building_id, @floor, @area_sqm, @alicuota)
            `);
        
        return result.recordset[0];
    }

    /**
     * Crear múltiples propiedades (bulk insert)
     */
    static async createMany(properties) {
        const pool = await connectDB();
        const created = [];
        
        for (const prop of properties) {
            const result = await this.create(prop);
            created.push(result);
        }
        
        return created;
    }

    /**
     * Actualizar propiedad
     */
    static async update(id, data) {
        const pool = await connectDB();
        const { name, type, building_id, floor, area_sqm, alicuota } = data;
        
        const updates = [];
        const inputs = [{ name: 'id', type: sql.UniqueIdentifier, value: id }];
        
        if (name !== undefined) {
            updates.push('name = @name');
            inputs.push({ name: 'name', type: sql.NVarChar, value: name });
        }
        if (type !== undefined) {
            updates.push('type = @type');
            inputs.push({ name: 'type', type: sql.NVarChar, value: type });
        }
        if (building_id !== undefined) {
            updates.push('building_id = @building_id');
            inputs.push({ name: 'building_id', type: sql.UniqueIdentifier, value: building_id });
        }
        if (floor !== undefined) {
            updates.push('floor = @floor');
            inputs.push({ name: 'floor', type: sql.NVarChar, value: floor });
        }
        if (area_sqm !== undefined) {
            updates.push('area_sqm = @area_sqm');
            inputs.push({ name: 'area_sqm', type: sql.Decimal(10, 2), value: area_sqm });
        }
        if (alicuota !== undefined) {
            updates.push('alicuota = @alicuota');
            inputs.push({ name: 'alicuota', type: sql.Decimal(10, 4), value: alicuota });
        }
        
        if (updates.length === 0) return null;
        
        updates.push('updated_at = SYSDATETIME()');
        
        const request = pool.request();
        inputs.forEach(input => request.input(input.name, input.type, input.value));
        
        const result = await request.query(`
            UPDATE Properties
            SET ${updates.join(', ')}
            OUTPUT INSERTED.*
            WHERE id = @id
        `);
        
        return result.recordset[0];
    }

    /**
     * Obtener propiedad por ID con info de edificio
     */
    static async findById(id) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query(`
                SELECT p.*, b.name as building_name, b.code as building_code
                FROM Properties p
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.id = @id
            `);
        return result.recordset[0];
    }

    /**
     * Listar propiedades por tenant
     */
    static async findByTenant(tenantId, options = {}) {
        const pool = await connectDB();
        const { building_id, page = 1, limit = 50 } = options;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE p.tenant_id = @tenant_id';
        if (building_id) whereClause += ' AND p.building_id = @building_id';
        
        const countResult = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('building_id', sql.UniqueIdentifier, building_id)
            .query(`SELECT COUNT(*) as total FROM Properties p ${whereClause}`);
        
        const total = countResult.recordset[0].total;
        
        const dataResult = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('building_id', sql.UniqueIdentifier, building_id)
            .input('offset', sql.Int, offset)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT p.*, b.name as building_name, b.code as building_code,
                    (SELECT COUNT(*) FROM PropertyOwners WHERE property_id = p.id) as owner_count
                FROM Properties p
                LEFT JOIN Buildings b ON p.building_id = b.id
                ${whereClause}
                ORDER BY b.name, p.name
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);
        
        return {
            properties: dataResult.recordset,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) }
        };
    }

    /**
     * Listar propiedades por edificio
     */
    static async findByBuilding(buildingId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('building_id', sql.UniqueIdentifier, buildingId)
            .query(`
                SELECT p.*, 
                    (SELECT COUNT(*) FROM PropertyOwners WHERE property_id = p.id) as owner_count
                FROM Properties p
                WHERE p.building_id = @building_id
                ORDER BY p.floor, p.name
            `);
        return result.recordset;
    }

    /**
     * Obtener propiedades por propietario (todas, sin filtrar por tenant)
     */
    static async getByOwner(userId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('user_id', sql.UniqueIdentifier, userId)
            .query(`
                SELECT p.*, t.name as tenant_name, t.slug as tenant_slug,
                    po.is_primary_owner, po.percentage_ownership,
                    b.name as building_name
                FROM Properties p
                INNER JOIN PropertyOwners po ON p.id = po.property_id
                INNER JOIN Tenants t ON p.tenant_id = t.id
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE po.user_id = @user_id
                ORDER BY t.name, b.name, p.name
            `);
        return result.recordset;
    }

    /**
     * Obtener propiedades de un propietario SOLO en un tenant (para TenantAdmin)
     * Evita que el admin de junta vea inmuebles del propietario en otros conjuntos
     */
    static async getByOwnerInTenant(userId, tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT p.*, t.name as tenant_name, t.slug as tenant_slug,
                    po.is_primary_owner, po.percentage_ownership,
                    b.name as building_name
                FROM Properties p
                INNER JOIN PropertyOwners po ON p.id = po.property_id
                INNER JOIN Tenants t ON p.tenant_id = t.id
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE po.user_id = @user_id AND p.tenant_id = @tenant_id
                ORDER BY b.name, p.name
            `);
        return result.recordset;
    }

    /**
     * Obtener propiedad con sus propietarios
     */
    static async getWithOwners(propertyId) {
        const pool = await connectDB();
        
        const propertyResult = await pool.request()
            .input('id', sql.UniqueIdentifier, propertyId)
            .query(`
                SELECT p.*, b.name as building_name, b.code as building_code
                FROM Properties p
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.id = @id
            `);
        
        if (propertyResult.recordset.length === 0) return null;
        
        const property = propertyResult.recordset[0];
        
        const ownersResult = await pool.request()
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .query(`
                SELECT po.*, u.first_name, u.last_name, u.email, u.phone, u.dni
                FROM PropertyOwners po
                INNER JOIN Users u ON po.user_id = u.id
                WHERE po.property_id = @property_id
                ORDER BY po.is_primary_owner DESC
            `);
        
        property.owners = ownersResult.recordset;
        return property;
    }

    /**
     * Asociar propietario a propiedad
     */
    static async addOwner(propertyId, userId, data = {}) {
        const pool = await connectDB();
        const { is_primary_owner = false, percentage_ownership = 100 } = data;
        
        const result = await pool.request()
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('is_primary_owner', sql.Bit, is_primary_owner)
            .input('percentage_ownership', sql.Decimal(5, 2), percentage_ownership)
            .query(`
                INSERT INTO PropertyOwners (property_id, user_id, is_primary_owner, percentage_ownership)
                OUTPUT INSERTED.*
                VALUES (@property_id, @user_id, @is_primary_owner, @percentage_ownership)
            `);
        
        return result.recordset[0];
    }

    /**
     * Actualizar propietario de propiedad
     */
    static async updateOwner(propertyId, userId, data) {
        const pool = await connectDB();
        const { is_primary_owner, percentage_ownership } = data;
        
        const updates = [];
        const inputs = [
            { name: 'property_id', type: sql.UniqueIdentifier, value: propertyId },
            { name: 'user_id', type: sql.UniqueIdentifier, value: userId }
        ];
        
        if (is_primary_owner !== undefined) {
            updates.push('is_primary_owner = @is_primary_owner');
            inputs.push({ name: 'is_primary_owner', type: sql.Bit, value: is_primary_owner });
        }
        if (percentage_ownership !== undefined) {
            updates.push('percentage_ownership = @percentage_ownership');
            inputs.push({ name: 'percentage_ownership', type: sql.Decimal(5, 2), value: percentage_ownership });
        }
        
        if (updates.length === 0) return null;
        
        const request = pool.request();
        inputs.forEach(input => request.input(input.name, input.type, input.value));
        
        const result = await request.query(`
            UPDATE PropertyOwners
            SET ${updates.join(', ')}
            OUTPUT INSERTED.*
            WHERE property_id = @property_id AND user_id = @user_id
        `);
        
        return result.recordset[0];
    }

    /**
     * Eliminar propietario de propiedad
     */
    static async removeOwner(propertyId, userId) {
        const pool = await connectDB();
        await pool.request()
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .input('user_id', sql.UniqueIdentifier, userId)
            .query('DELETE FROM PropertyOwners WHERE property_id = @property_id AND user_id = @user_id');
        return true;
    }

    /**
     * Eliminar propiedad
     */
    static async delete(id) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query('DELETE FROM Properties WHERE id = @id');
        return true;
    }

    /**
     * Buscar propiedades disponibles (sin propietario principal)
     */
    static async findAvailable(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT p.*, b.name as building_name
                FROM Properties p
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.tenant_id = @tenant_id
                AND NOT EXISTS (
                    SELECT 1 FROM PropertyOwners po 
                    WHERE po.property_id = p.id AND po.is_primary_owner = 1
                )
                ORDER BY b.name, p.name
            `);
        return result.recordset;
    }

    /**
     * Buscar por nombre o número
     */
    static async search(tenantId, query) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('query', sql.NVarChar, `%${query}%`)
            .query(`
                SELECT p.*, b.name as building_name
                FROM Properties p
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.tenant_id = @tenant_id
                AND (p.name LIKE @query OR b.name LIKE @query)
                ORDER BY b.name, p.name
            `);
        return result.recordset;
    }
}

module.exports = PropertyModel;
