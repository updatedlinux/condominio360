const { sql, connectDB } = require('../config/database');
const bcrypt = require('bcrypt');

/**
 * Modelo para SecurityUsers
 * Gestiona los usuarios de vigilancia/seguridad
 */
class SecurityUserModel {
    
    /**
     * Crear un nuevo usuario de seguridad
     */
    static async create(data) {
        const {
            tenant_id,
            email,
            password,
            first_name,
            last_name,
            phone,
            document_type = 'DNI',
            document_number,
            created_by
        } = data;

        try {
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(password, saltRounds);

            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('email', sql.NVarChar, email)
                .input('password_hash', sql.NVarChar, password_hash)
                .input('first_name', sql.NVarChar, first_name)
                .input('last_name', sql.NVarChar, last_name)
                .input('phone', sql.NVarChar, phone || null)
                .input('document_type', sql.NVarChar, document_type)
                .input('document_number', sql.NVarChar, document_number || null)
                .input('created_by', sql.UniqueIdentifier, created_by || null)
                .query(`
                    INSERT INTO SecurityUsers 
                        (tenant_id, email, password_hash, first_name, last_name, phone, 
                         document_type, document_number, created_by)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @email, @password_hash, @first_name, @last_name, @phone,
                         @document_type, @document_number, @created_by)
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error creating security user:', error);
            throw error;
        }
    }

    /**
     * Buscar por email (para login)
     */
    static async findByEmail(email) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('email', sql.NVarChar, email)
                .query('SELECT * FROM SecurityUsers WHERE email = @email AND is_active = 1');

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding security user:', error);
            throw error;
        }
    }

    /**
     * Buscar por document_number (DNI)
     */
    static async findByDocumentNumber(documentNumber) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('document_number', sql.NVarChar, documentNumber)
                .query('SELECT * FROM SecurityUsers WHERE document_number = @document_number AND is_active = 1');

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding security user by document:', error);
            throw error;
        }
    }

    /**
     * Buscar por DNI o email (para login)
     */
    static async findByDniOrEmail(identifier) {
        if (!identifier) return null;
        if (identifier.includes('@')) {
            return await this.findByEmail(identifier);
        }
        return await this.findByDocumentNumber(identifier);
    }

    /**
     * Obtener por ID
     */
    static async findById(id) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('SELECT * FROM SecurityUsers WHERE id = @id');

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding security user by id:', error);
            throw error;
        }
    }

    /**
     * Listar por tenant
     */
    static async getByTenant(tenantId, options = {}) {
        const { is_active = null, limit = 50 } = options;
        
        try {
            const pool = await connectDB();
            let query = `
                SELECT su.*, t.name as tenant_name,
                       cb.first_name + ' ' + cb.last_name as created_by_name
                FROM SecurityUsers su
                INNER JOIN Tenants t ON su.tenant_id = t.id
                LEFT JOIN Users cb ON su.created_by = cb.id
                WHERE su.tenant_id = @tenantId
            `;
            
            if (is_active !== null) {
                query += ` AND su.is_active = @isActive`;
            }
            
            query += ` ORDER BY su.created_at DESC OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY`;

            const request = pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('limit', sql.Int, limit);
            
            if (is_active !== null) {
                request.input('isActive', sql.Bit, is_active ? 1 : 0);
            }

            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            console.error('Error getting security users:', error);
            throw error;
        }
    }

    /**
     * Actualizar usuario
     */
    static async update(id, data) {
        const allowedFields = ['first_name', 'last_name', 'phone', 'is_active', 'document_number'];
        const updates = [];
        
        for (const [key, value] of Object.entries(data)) {
            if (allowedFields.includes(key)) {
                updates.push(`${key} = @${key}`);
            }
        }

        if (updates.length === 0) return null;

        try {
            const pool = await connectDB();
            const request = pool.request().input('id', sql.UniqueIdentifier, id);
            
            for (const [key, value] of Object.entries(data)) {
                if (allowedFields.includes(key)) {
                    request.input(key, sql.NVarChar, value);
                }
            }

            const result = await request.query(`
                UPDATE SecurityUsers 
                SET ${updates.join(', ')}, updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE id = @id
            `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error updating security user:', error);
            throw error;
        }
    }

    /**
     * Cambiar contraseña
     */
    static async updatePassword(id, password) {
        try {
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(password, saltRounds);

            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('password_hash', sql.NVarChar, password_hash)
                .query(`
                    UPDATE SecurityUsers 
                    SET password_hash = @password_hash, updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error updating password:', error);
            throw error;
        }
    }

    /**
     * Validar contraseña
     */
    static async validatePassword(plainPassword, hashedPassword) {
        if (!hashedPassword) return false;
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    /**
     * Actualizar último login
     */
    static async updateLastLogin(id) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('UPDATE SecurityUsers SET last_login = SYSDATETIME() WHERE id = @id');
        } catch (error) {
            console.error('Error updating last login:', error);
        }
    }
}

module.exports = SecurityUserModel;
