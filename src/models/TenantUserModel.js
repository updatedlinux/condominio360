const { sql, connectDB } = require('../config/database');

/**
 * Modelo para relación Usuario-Tenant
 * 
 * NOTA: Este modelo se ha simplificado según los requerimientos.
 * Los propietarios ya no se manejan a través de esta tabla,
 * sino a través de PropertyOwners.
 * 
 * Esta tabla ahora solo maneja roles especiales como:
 * - SECURITY: Personal de vigilancia/portería
 */
class TenantUserModel {
    /**
     * Add user to tenant with a special role
     * @param {string} userId 
     * @param {string} tenantId 
     * @param {string} role - 'SECURITY' (otros roles especiales)
     */
    static async add(userId, tenantId, role = 'SECURITY') {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('role', sql.NVarChar, role)
                .query(`
                    INSERT INTO TenantUsers (user_id, tenant_id, role, status)
                    VALUES (@userId, @tenantId, @role, 'ACTIVE')
                `);
            return true;
        } catch (error) {
            console.error('Error adding user to tenant:', error);
            throw error;
        }
    }

    /**
     * Get all tenants for a specific user
     * NOTA: Esta función ahora solo retorna roles especiales.
     * Para obtener los tenants donde es propietario, usar PropertyModel.getByOwner()
     * @param {string} userId 
     * @returns {Promise<Array>} List of tenants with special roles
     */
    static async getTenantsByUser(userId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .query(`
                    SELECT t.id, t.name, t.slug, tu.role, tu.status
                    FROM Tenants t
                    INNER JOIN TenantUsers tu ON t.id = tu.tenant_id
                    WHERE tu.user_id = @userId AND t.active = 1
                `);

            return result.recordset;
        } catch (error) {
            console.error('Error getting tenants for user:', error);
            throw error;
        }
    }

    /**
     * Check if user has a special role in tenant
     * @param {string} userId 
     * @param {string} tenantId 
     * @returns {Promise<Object|null>} Returns role info or null
     */
    static async checkMembership(userId, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT role, status 
                    FROM TenantUsers 
                    WHERE user_id = @userId AND tenant_id = @tenantId AND status = 'ACTIVE'
                `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error checking membership:', error);
            throw error;
        }
    }

    /**
     * Get all security personnel for a tenant
     * @param {string} tenantId 
     * @returns {Promise<Array>}
     */
    static async getSecurityPersonnel(tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active,
                           tu.role, tu.status, tu.created_at
                    FROM Users u
                    INNER JOIN TenantUsers tu ON u.id = tu.user_id
                    WHERE tu.tenant_id = @tenantId AND tu.role = 'SECURITY'
                    ORDER BY u.first_name, u.last_name
                `);

            return result.recordset;
        } catch (error) {
            console.error('Error getting security personnel:', error);
            throw error;
        }
    }

    /**
     * Remove user from tenant (soft delete by setting status to INACTIVE)
     * @param {string} userId 
     * @param {string} tenantId 
     */
    static async remove(userId, tenantId) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    UPDATE TenantUsers 
                    SET status = 'INACTIVE'
                    WHERE user_id = @userId AND tenant_id = @tenantId
                `);
            return true;
        } catch (error) {
            console.error('Error removing user from tenant:', error);
            throw error;
        }
    }

    /**
     * Update user role in tenant
     * @param {string} userId 
     * @param {string} tenantId 
     * @param {string} newRole 
     */
    static async updateRole(userId, tenantId, newRole) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('role', sql.NVarChar, newRole)
                .query(`
                    UPDATE TenantUsers 
                    SET role = @role
                    WHERE user_id = @userId AND tenant_id = @tenantId
                `);
            return true;
        } catch (error) {
            console.error('Error updating user role:', error);
            throw error;
        }
    }
}

module.exports = TenantUserModel;
