const { sql, connectDB } = require('../config/database');
const bcrypt = require('bcrypt');

/**
 * Modelo para usuarios administrativos de Junta de Condominio
 * Estos usuarios tienen acceso al Panel de Junta, no al Panel de Propietario
 */
class TenantAdminModel {
    /**
     * Find admin by email
     * @param {string} email 
     * @returns {Promise<Object|null>}
     */
    static async findByEmail(email) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('email', sql.NVarChar, email)
                .query('SELECT * FROM TenantAdmins WHERE email = @email AND is_active = 1');

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding tenant admin:', error);
            throw error;
        }
    }

    /**
     * Find admin by DNI or email (para login)
     * Si es DNI, busca el User y luego el TenantAdmin vinculado por user_id
     * @param {string} identifier - DNI o correo electrónico
     * @returns {Promise<Object|null>}
     */
    static async findByDniOrEmail(identifier) {
        if (!identifier) return null;
        if (identifier.includes('@')) {
            return await this.findByEmail(identifier);
        }
        // Buscar User por DNI y luego TenantAdmin vinculado
        const UserModel = require('./UserModel');
        const user = await UserModel.findByDni(identifier);
        if (!user) return null;
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('user_id', sql.UniqueIdentifier, user.id)
                .query('SELECT * FROM TenantAdmins WHERE user_id = @user_id AND is_active = 1');
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding tenant admin by user:', error);
            throw error;
        }
    }

    /**
     * Find admin by ID
     * @param {string} id 
     * @returns {Promise<Object|null>}
     */
    static async findById(id) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT ta.*, t.name as tenant_name, t.slug as tenant_slug
                    FROM TenantAdmins ta
                    INNER JOIN Tenants t ON ta.tenant_id = t.id
                    WHERE ta.id = @id
                `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding tenant admin by id:', error);
            throw error;
        }
    }

    /**
     * Get all admins for a tenant
     * @param {string} tenantId 
     * @returns {Promise<Array>}
     */
    static async getByTenant(tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT id, email, first_name, last_name, phone, role, is_active, 
                           last_login, created_at, updated_at
                    FROM TenantAdmins
                    WHERE tenant_id = @tenantId
                    ORDER BY created_at DESC
                `);

            return result.recordset;
        } catch (error) {
            console.error('Error fetching tenant admins:', error);
            throw error;
        }
    }

    /**
     * Primer admin de junta activo del tenant (para FK que apunta a TenantAdmins, p. ej. superadmin en contexto de condominio).
     */
    static async findFirstActiveIdForTenant(tenantId) {
        const list = await TenantAdminModel.getByTenant(tenantId);
        if (!list || list.length === 0) return null;
        const row = list.find((x) => x.is_active !== false && x.is_active !== 0) || list[0];
        return row.id || null;
    }

    /**
     * Create new tenant admin (by superadmin)
     * @param {Object} adminData 
     * @param {string} createdBy - Superadmin user ID
     */
    static async create(adminData, createdBy) {
        const { 
            tenant_id, 
            email, 
            password, 
            first_name, 
            last_name, 
            phone, 
            role = 'ADMIN',
            user_id = null
        } = adminData;

        try {
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(password, saltRounds);

            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('user_id', sql.UniqueIdentifier, user_id)
                .input('email', sql.NVarChar, email)
                .input('password_hash', sql.NVarChar, password_hash)
                .input('first_name', sql.NVarChar, first_name)
                .input('last_name', sql.NVarChar, last_name)
                .input('phone', sql.NVarChar, phone || null)
                .input('role', sql.NVarChar, role)
                .input('created_by', sql.UniqueIdentifier, createdBy)
                .query(`
                    INSERT INTO TenantAdmins 
                        (tenant_id, user_id, email, password_hash, first_name, last_name, phone, role, created_by)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @user_id, @email, @password_hash, @first_name, @last_name, @phone, @role, @created_by)
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error creating tenant admin:', error);
            throw error;
        }
    }

    /**
     * Update admin
     * @param {string} id 
     * @param {Object} data 
     */
    static async update(id, data) {
        const allowedFields = ['first_name', 'last_name', 'phone', 'role', 'is_active'];
        const updates = [];
        
        for (const [key, value] of Object.entries(data)) {
            if (allowedFields.includes(key)) {
                updates.push(`${key} = @${key}`);
            }
        }

        // Handle password update separately (también limpia must_change_password)
        if (data.password) {
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(data.password, saltRounds);
            updates.push('password_hash = @password_hash');
            updates.push('must_change_password = 0');
        }

        if (updates.length === 0) return null;

        try {
            const pool = await connectDB();
            const request = pool.request().input('id', sql.UniqueIdentifier, id);
            
            // Add all parameters
            for (const [key, value] of Object.entries(data)) {
                if (allowedFields.includes(key)) {
                    if (key === 'is_active') {
                        request.input(key, sql.Bit, value ? 1 : 0);
                    } else {
                        request.input(key, sql.NVarChar, value);
                    }
                }
            }

            if (data.password) {
                const saltRounds = 10;
                const password_hash = await bcrypt.hash(data.password, saltRounds);
                request.input('password_hash', sql.NVarChar, password_hash);
            }

            const result = await request.query(`
                UPDATE TenantAdmins 
                SET ${updates.join(', ')}, updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE id = @id
            `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error updating tenant admin:', error);
            throw error;
        }
    }

    /**
     * Delete admin (soft delete by setting is_active = 0)
     * @param {string} id 
     */
    static async delete(id) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query(`
                    UPDATE TenantAdmins 
                    SET is_active = 0, updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error deleting tenant admin:', error);
            throw error;
        }
    }

    /**
     * Update last login timestamp
     * @param {string} id 
     */
    static async updateLastLogin(id) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('last_login', sql.DateTime2, new Date())
                .query(`
                    UPDATE TenantAdmins 
                    SET last_login = @last_login
                    WHERE id = @id
                `);
        } catch (error) {
            console.error('Error updating last login:', error);
            throw error;
        }
    }

    /**
     * Validate password
     * @param {string} plainPassword 
     * @param {string} hashedPassword 
     * @returns {Promise<boolean>}
     */
    static async validatePassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    /**
     * Check if email already exists for this tenant
     * @param {string} email 
     * @param {string} tenantId 
     * @param {string} excludeId - Optional admin ID to exclude
     * @returns {Promise<boolean>}
     */
    static async emailExists(email, tenantId, excludeId = null) {
        try {
            const pool = await connectDB();
            let query = 'SELECT COUNT(*) as count FROM TenantAdmins WHERE email = @email AND tenant_id = @tenantId';
            
            if (excludeId) {
                query += ' AND id != @excludeId';
            }

            const request = pool.request()
                .input('email', sql.NVarChar, email)
                .input('tenantId', sql.UniqueIdentifier, tenantId);
            
            if (excludeId) {
                request.input('excludeId', sql.UniqueIdentifier, excludeId);
            }

            const result = await request.query(query);
            return result.recordset[0].count > 0;
        } catch (error) {
            console.error('Error checking email:', error);
            throw error;
        }
    }
}

module.exports = TenantAdminModel;
