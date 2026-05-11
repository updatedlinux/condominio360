const { sql, connectDB } = require('../config/database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

class UserModel {
    /**
     * Find user by email (Global)
     * Busca en Users.email y en UserEmails (correos secundarios)
     * @param {string} email 
     * @returns {Promise<Object|null>}
     */
    static async findByEmail(email) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('email', sql.NVarChar, email)
                .query(`
                    SELECT u.* FROM Users u
                    WHERE u.is_active = 1 AND (
                        u.email = @email
                        OR EXISTS (SELECT 1 FROM UserEmails ue WHERE ue.user_id = u.id AND ue.email = @email)
                    )
                `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding user:', error);
            throw error;
        }
    }

    /**
     * Verificar si un correo está en uso por OTRO usuario (no por excludeUserId)
     * Usado al crear propietario: dos propietarios distintos no pueden compartir email
     * @param {string} email 
     * @param {string|null} excludeUserId - Usuario a excluir (ej. el que estamos editando)
     * @returns {Promise<boolean>}
     */
    static async emailExistsForOtherUser(email, excludeUserId = null) {
        try {
            const pool = await connectDB();
            let query = `
                SELECT 1 as found WHERE EXISTS (
                    SELECT 1 FROM Users WHERE email = @email AND is_active = 1
                ) OR EXISTS (
                    SELECT 1 FROM UserEmails WHERE email = @email
                )
            `;
            const request = pool.request().input('email', sql.NVarChar, email);

            if (excludeUserId) {
                query = `
                    SELECT 1 as found WHERE EXISTS (
                        SELECT 1 FROM Users WHERE email = @email AND id != @excludeId AND is_active = 1
                    ) OR EXISTS (
                        SELECT 1 FROM UserEmails WHERE email = @email AND user_id != @excludeId
                    )
                `;
                request.input('excludeId', sql.UniqueIdentifier, excludeUserId);
            }

            const result = await request.query(query);
            return result.recordset.length > 0;
        } catch (error) {
            console.error('Error checking email for other user:', error);
            throw error;
        }
    }

    /**
     * Verificar si el usuario ya tiene este correo (primario o secundario)
     * @param {string} userId 
     * @param {string} email 
     * @returns {Promise<boolean>}
     */
    static async userHasEmail(userId, email) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('user_id', sql.UniqueIdentifier, userId)
                .input('email', sql.NVarChar, email)
                .query(`
                    SELECT 1 as found WHERE EXISTS (
                        SELECT 1 FROM Users WHERE id = @user_id AND email = @email
                    ) OR EXISTS (
                        SELECT 1 FROM UserEmails WHERE user_id = @user_id AND email = @email
                    )
                `);
            return result.recordset.length > 0;
        } catch (error) {
            console.error('Error checking user has email:', error);
            throw error;
        }
    }

    /**
     * Agregar correo secundario a un usuario
     * @param {string} userId 
     * @param {string} email 
     * @returns {Promise<Object>}
     */
    static async addSecondaryEmail(userId, email) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('user_id', sql.UniqueIdentifier, userId)
                .input('email', sql.NVarChar, email)
                .query(`
                    INSERT INTO UserEmails (user_id, email, is_primary)
                    OUTPUT INSERTED.*
                    VALUES (@user_id, @email, 0)
                `);
            return result.recordset[0];
        } catch (error) {
            if (error.number === 2627 || error.message?.includes('UNIQUE') || error.message?.includes('duplicate')) {
                throw new Error('Este correo ya está registrado en el sistema');
            }
            console.error('Error adding secondary email:', error);
            throw error;
        }
    }

    /**
     * Obtener todos los correos de un usuario (primario + secundarios)
     * @param {string} userId 
     * @returns {Promise<Array<{email: string, is_primary: boolean}>>}
     */
    static async getEmails(userId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('user_id', sql.UniqueIdentifier, userId)
                .query(`
                    SELECT email, 1 as is_primary FROM Users WHERE id = @user_id AND email IS NOT NULL AND LTRIM(RTRIM(email)) != ''
                    UNION ALL
                    SELECT ue.email, ue.is_primary FROM UserEmails ue WHERE ue.user_id = @user_id
                    ORDER BY is_primary DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error getting user emails:', error);
            throw error;
        }
    }

    /**
     * Find user by DNI or email (para login)
     * @param {string} identifier - DNI o correo electrónico
     * @returns {Promise<Object|null>}
     */
    static async findByDniOrEmail(identifier) {
        try {
            const pool = await connectDB();
            const isEmail = identifier && identifier.includes('@');
            if (isEmail) {
                return await this.findByEmail(identifier);
            }
            return await this.findByDni(identifier);
        } catch (error) {
            console.error('Error finding user by DNI or email:', error);
            throw error;
        }
    }

    /**
     * Find user by DNI (cédula) - Identificador único
     * @param {string} dni 
     * @returns {Promise<Object|null>}
     */
    static async findByDni(dni) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('dni', sql.NVarChar, dni)
                .query('SELECT * FROM Users WHERE dni = @dni');

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding user by DNI:', error);
            throw error;
        }
    }

    /**
     * Generar token de invitación para usuario existente (tras aprobación de actualización de datos)
     * Permite que el propietario defina su contraseña
     * @param {string} userId 
     * @returns {Promise<string|null>} - Token generado o null
     */
    static async setInvitationTokenForPasswordSetup(userId) {
        try {
            const invitation_token = crypto.randomBytes(32).toString('hex');
            const pool = await connectDB();
            await pool.request()
                .input('id', sql.UniqueIdentifier, userId)
                .input('invitation_token', sql.NVarChar, invitation_token)
                .input('invited_at', sql.DateTime2, new Date())
                .query(`
                    UPDATE Users 
                    SET invitation_token = @invitation_token, 
                        invited_at = @invited_at, 
                        registration_status = 'INVITED',
                        updated_at = SYSDATETIME()
                    WHERE id = @id
                `);
            return invitation_token;
        } catch (error) {
            console.error('Error setting invitation token:', error);
            throw error;
        }
    }

    /**
     * Find user by invitation token
     * @param {string} token 
     * @returns {Promise<Object|null>}
     */
    static async findByInvitationToken(token) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('token', sql.NVarChar, token)
                .query('SELECT * FROM Users WHERE invitation_token = @token AND is_active = 1');

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding user by invitation token:', error);
            throw error;
        }
    }

    /**
     * Create a new global user (para onboarding e invitaciones)
     * @param {Object} userData 
     */
    static async create(userData) {
        const { 
            first_name, 
            last_name, 
            email, 
            password, 
            dni, 
            phone,
            is_superadmin = false,
            registration_status = 'PENDING'
        } = userData;
        
        try {
            const saltRounds = 10;
            const password_hash = password ? await bcrypt.hash(password, saltRounds) : null;

            const pool = await connectDB();
            const result = await pool.request()
                .input('first_name', sql.NVarChar, first_name)
                .input('last_name', sql.NVarChar, last_name)
                .input('email', sql.NVarChar, email || null)
                .input('password_hash', sql.NVarChar, password_hash)
                .input('dni', sql.NVarChar, dni)
                .input('phone', sql.NVarChar, phone || null)
                .input('is_superadmin', sql.Bit, is_superadmin ? 1 : 0)
                .input('registration_status', sql.NVarChar, registration_status)
                .query(`
                    INSERT INTO Users (first_name, last_name, email, password_hash, dni, phone, is_superadmin, registration_status)
                    OUTPUT INSERTED.*
                    VALUES (@first_name, @last_name, @email, @password_hash, @dni, @phone, @is_superadmin, @registration_status)
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error creating user:', error);
            throw error;
        }
    }

    /**
     * Listar todos los superadministradores
     * @returns {Promise<Array>}
     */
    static async findAllSuperAdmins() {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .query(`
                    SELECT id, first_name, last_name, email, phone, is_active, created_at, updated_at
                    FROM Users 
                    WHERE is_superadmin = 1 
                    ORDER BY created_at DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error finding superadmins:', error);
            throw error;
        }
    }

    /**
     * Crear un nuevo superadministrador
     * @param {Object} data - { first_name, last_name, email, password, phone? }
     * @returns {Promise<Object>}
     */
    static async createSuperAdmin(data) {
        const { first_name, last_name, email, password, phone } = data;
        
        if (!first_name || !last_name || !email || !password) {
            throw new Error('Nombre, apellido, email y contraseña son requeridos');
        }
        
        try {
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(password, saltRounds);
            const pool = await connectDB();

            // Verificar si el email ya existe
            const existing = await this.findByEmail(email);
            if (existing) {
                throw new Error('El email ya está registrado');
            }

            const result = await pool.request()
                .input('first_name', sql.NVarChar, first_name)
                .input('last_name', sql.NVarChar, last_name)
                .input('email', sql.NVarChar, email)
                .input('password_hash', sql.NVarChar, password_hash)
                .input('phone', sql.NVarChar, phone || null)
                .input('is_superadmin', sql.Bit, 1)
                .query(`
                    INSERT INTO Users (first_name, last_name, email, password_hash, phone, is_superadmin, is_active)
                    OUTPUT INSERTED.id, INSERTED.first_name, INSERTED.last_name, INSERTED.email, INSERTED.phone, INSERTED.created_at
                    VALUES (@first_name, @last_name, @email, @password_hash, @phone, @is_superadmin, 1)
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error creating superadmin:', error);
            throw error;
        }
    }

    /**
     * Eliminar un superadministrador
     * @param {string} id - User ID
     * @param {string} currentUserId - ID del usuario que ejecuta (no puede eliminarse a sí mismo)
     * @returns {Promise<Object|null>}
     */
    static async deleteSuperAdmin(id, currentUserId) {
        try {
            const pool = await connectDB();

            if (id === currentUserId) {
                throw new Error('No puede eliminarse a sí mismo');
            }

            const all = await this.findAllSuperAdmins();
            if (all.length <= 1) {
                throw new Error('Debe existir al menos un superadministrador');
            }

            const req = () => pool.request().input('id', sql.UniqueIdentifier, id);

            // Eliminar referencias antes de borrar el usuario (orden por dependencias FK)
            await req().query('DELETE FROM TenantUsers WHERE user_id = @id');

            await req().query('DELETE FROM Requests WHERE user_id = @id').catch(() => {});

            await req().query('DELETE FROM PropertyOwners WHERE user_id = @id').catch(() => {});

            // VisitorLogs referencia VisitorPasses: borrar/actualizar antes que VisitorPasses
            await req().query('DELETE FROM VisitorLogs WHERE pass_id IN (SELECT id FROM VisitorPasses WHERE user_id = @id)').catch(() => {});
            await req().query('UPDATE VisitorLogs SET user_id = NULL WHERE user_id = @id').catch(() => {});
            await req().query('DELETE FROM VisitorPasses WHERE user_id = @id').catch(() => {});

            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('is_superadmin', sql.Bit, 1)
                .query(`
                    DELETE FROM Users 
                    WHERE id = @id AND is_superadmin = @is_superadmin
                `);

            if (result.rowsAffected[0] === 0) {
                throw new Error('Superadministrador no encontrado');
            }
            return { id };
        } catch (error) {
            console.error('Error deleting superadmin:', error);
            throw error;
        }
    }

    /**
     * Create user invitation (for property owners)
     * Generates invitation token and sets status to INVITED
     * @param {Object} userData 
     * @returns {Promise<Object>}
     */
    static async createInvitation(userData) {
        const { first_name, last_name, email, dni, phone } = userData;
        
        try {
            // Generar token único
            const invitation_token = crypto.randomBytes(32).toString('hex');
            const dummyPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
            
            const pool = await connectDB();
            const result = await pool.request()
                .input('first_name', sql.NVarChar, first_name)
                .input('last_name', sql.NVarChar, last_name)
                .input('email', sql.NVarChar, email || null)
                .input('dni', sql.NVarChar, dni)
                .input('phone', sql.NVarChar, phone || null)
                .input('invitation_token', sql.NVarChar, invitation_token)
                .input('invited_at', sql.DateTime2, new Date())
                .input('password_hash', sql.NVarChar, dummyPassword)
                .query(`
                    INSERT INTO Users (first_name, last_name, email, dni, phone, invitation_token, invited_at, password_hash, is_active, registration_status)
                    OUTPUT INSERTED.*
                    VALUES (@first_name, @last_name, @email, @dni, @phone, @invitation_token, @invited_at, @password_hash, 1, 'INVITED')
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error creating user invitation:', error);
            throw error;
        }
    }

    /**
     * Complete registration from invitation
     * @param {string} token - Invitation token
     * @param {string} password - New password
     * @param {string} email - Email (can be different from invitation)
     */
    static async completeRegistration(token, password, email = null) {
        try {
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(password, saltRounds);

            const pool = await connectDB();
            
            // Build query dynamically based on whether email is provided
            let query = `
                UPDATE Users 
                SET password_hash = @password_hash,
                    registration_status = 'ACTIVE',
                    email_verified = 1,
                    invitation_token = NULL,
                    is_active = 1,
                    updated_at = SYSDATETIME()
            `;
            
            if (email) {
                query += `, email = @email`;
            }
            
            query += `
                OUTPUT INSERTED.*
                WHERE invitation_token = @token AND registration_status = 'INVITED'
            `;

            const request = pool.request()
                .input('token', sql.NVarChar, token)
                .input('password_hash', sql.NVarChar, password_hash);
            
            if (email) {
                request.input('email', sql.NVarChar, email);
            }

            const result = await request.query(query);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error completing registration:', error);
            throw error;
        }
    }

    /**
     * Update user data
     * @param {string} id 
     * @param {Object} data 
     */
    static async update(id, data) {
        const allowedFields = ['first_name', 'last_name', 'email', 'phone', 'avatar_url', 'is_active'];
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
            
            // Add all parameters
            for (const [key, value] of Object.entries(data)) {
                if (allowedFields.includes(key)) {
                    request.input(key, sql.NVarChar, value);
                }
            }

            const result = await request.query(`
                UPDATE Users 
                SET ${updates.join(', ')}, updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE id = @id
            `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error updating user:', error);
            throw error;
        }
    }

    /**
     * Find user by ID
     * @param {string} id 
     * @returns {Promise<Object|null>}
     */
    static async findById(id) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('SELECT * FROM Users WHERE id = @id');

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding user by ID:', error);
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
        if (!hashedPassword) return false;
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    /**
     * Update user password (for admin password reset)
     * También activa la cuenta si está en estado INVITED o PENDING
     * @param {string} id - User ID
     * @param {string} password - New plain text password
     * @returns {Promise<Object|null>}
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
                    UPDATE Users 
                    SET password_hash = @password_hash,
                        registration_status = 'ACTIVE',
                        is_active = 1,
                        email_verified = 1,
                        invitation_token = NULL,
                        updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id
                `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error updating password:', error);
            throw error;
        }
    }

    /**
     * Check if DNI already exists
     * @param {string} dni 
     * @param {string} excludeUserId - Optional user ID to exclude (for updates)
     * @returns {Promise<boolean>}
     */
    static async dniExists(dni, excludeUserId = null) {
        try {
            const pool = await connectDB();
            let query = 'SELECT COUNT(*) as count FROM Users WHERE dni = @dni';
            
            if (excludeUserId) {
                query += ' AND id != @excludeId';
            }

            const request = pool.request().input('dni', sql.NVarChar, dni);
            
            if (excludeUserId) {
                request.input('excludeId', sql.UniqueIdentifier, excludeUserId);
            }

            const result = await request.query(query);
            return result.recordset[0].count > 0;
        } catch (error) {
            console.error('Error checking DNI:', error);
            throw error;
        }
    }

    // ==================== MÉTODOS PARA TENANT ADMIN ====================

    /**
     * Obtener propietarios por tenant (para Tenant Admin)
     * @param {string} tenantId 
     * @param {Object} options - { page, limit, search }
     * @returns {Promise<Object>}
     */
    static async findOwnersByTenant(tenantId, options = {}) {
        const { page = 1, limit = 50, search = null } = options;
        const offset = (page - 1) * limit;

        try {
            const pool = await connectDB();
            
            // Buscar propietarios tanto por PropertyOwners como por TenantUsers (rol OWNER)
            let searchClause = '';
            if (search) {
                searchClause = ` AND (u.first_name LIKE @search OR u.last_name LIKE @search OR u.email LIKE @search OR u.dni LIKE @search)`;
            }

            // Contar total - incluye propietarios con propiedades O propietarios con rol OWNER en TenantUsers
            const countResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('search', sql.NVarChar, search ? `%${search}%` : null)
                .query(`
                    SELECT COUNT(DISTINCT u.id) as total
                    FROM Users u
                    WHERE u.id IN (
                        -- Propietarios con propiedades en este tenant
                        SELECT po.user_id 
                        FROM PropertyOwners po
                        INNER JOIN Properties p ON po.property_id = p.id
                        WHERE p.tenant_id = @tenant_id
                        UNION
                        -- Usuarios con rol OWNER en este tenant
                        SELECT tu.user_id
                        FROM TenantUsers tu
                        WHERE tu.tenant_id = @tenant_id AND tu.role = 'OWNER'
                    )
                    ${searchClause}
                `);
            
            const total = countResult.recordset[0].total;

            // Obtener datos
            const dataResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('search', sql.NVarChar, search ? `%${search}%` : null)
                .input('offset', sql.Int, offset)
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT DISTINCT 
                        u.id, u.first_name, u.last_name, u.email, u.phone, u.dni,
                        u.is_active, u.created_at, u.updated_at,
                        (SELECT COUNT(*) FROM PropertyOwners po_cnt
                         INNER JOIN Properties p_cnt ON po_cnt.property_id = p_cnt.id
                         WHERE po_cnt.user_id = u.id AND p_cnt.tenant_id = @tenant_id) as property_count,
                        (SELECT STRING_AGG(p.name + ' (' + ISNULL(b.name, 'Sin edificio') + ')', ', ')
                         FROM PropertyOwners po2
                         INNER JOIN Properties p ON po2.property_id = p.id
                         LEFT JOIN Buildings b ON p.building_id = b.id
                         WHERE po2.user_id = u.id AND p.tenant_id = @tenant_id) as properties
                    FROM Users u
                    WHERE u.id IN (
                        SELECT po.user_id 
                        FROM PropertyOwners po
                        INNER JOIN Properties p ON po.property_id = p.id
                        WHERE p.tenant_id = @tenant_id
                        UNION
                        SELECT tu.user_id
                        FROM TenantUsers tu
                        WHERE tu.tenant_id = @tenant_id AND tu.role = 'OWNER'
                    )
                    ${searchClause}
                    ORDER BY u.last_name, u.first_name
                    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
                `);

            return {
                owners: dataResult.recordset,
                pagination: { total, page, limit, pages: Math.ceil(total / limit) }
            };
        } catch (error) {
            console.error('Error finding owners by tenant:', error);
            throw error;
        }
    }

    /**
     * Filas de exportación: una por vínculo propietario–inmueble en el tenant (incluye filas sin inmueble asignado en el conjunto)
     */
    static async findOwnersForExport(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT
                    u.id AS user_id,
                    u.first_name,
                    u.last_name,
                    u.email,
                    u.phone,
                    u.dni,
                    u.is_active,
                    u.created_at AS usuario_creado,
                    upd.last_approved_at AS ultima_actualizacion_aprobada,
                    ISNULL(upd.approved_count, 0) AS actualizaciones_aprobadas,
                    p.id AS property_id,
                    p.name AS inmueble,
                    COALESCE(b.name, p.building) AS edificio,
                    po.is_primary_owner,
                    po.percentage_ownership AS porcentaje_participacion
                FROM Users u
                INNER JOIN TenantUsers tu
                    ON u.id = tu.user_id AND tu.tenant_id = @tenant_id AND tu.role = N'OWNER' AND tu.status = N'ACTIVE'
                LEFT JOIN (
                    SELECT user_id,
                           MAX(reviewed_at) AS last_approved_at,
                           COUNT(*)         AS approved_count
                    FROM DataUpdateRequests
                    WHERE status = N'APPROVED'
                    GROUP BY user_id
                ) upd ON upd.user_id = u.id
                LEFT JOIN PropertyOwners po ON u.id = po.user_id
                LEFT JOIN Properties p ON po.property_id = p.id AND p.tenant_id = @tenant_id
                LEFT JOIN Buildings b ON p.building_id = b.id
                ORDER BY u.last_name, u.first_name, p.name
            `);
        return result.recordset;
    }

    /**
     * Obtener un propietario con sus propiedades (para Tenant Admin)
     * @param {string} userId 
     * @param {string} tenantId
     * @returns {Promise<Object|null>}
     */
    static async getOwnerWithProperties(userId, tenantId) {
        try {
            const pool = await connectDB();
            
            // Verificar que el usuario es propietario en este tenant (por propiedad o por rol)
            const checkResult = await pool.request()
                .input('user_id', sql.UniqueIdentifier, userId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT COUNT(*) as count
                    FROM (
                        SELECT po.user_id
                        FROM PropertyOwners po
                        INNER JOIN Properties p ON po.property_id = p.id
                        WHERE po.user_id = @user_id AND p.tenant_id = @tenant_id
                        UNION
                        SELECT tu.user_id
                        FROM TenantUsers tu
                        WHERE tu.user_id = @user_id AND tu.tenant_id = @tenant_id AND tu.role = 'OWNER'
                    ) as owner_check
                `);
            
            if (checkResult.recordset[0].count === 0) {
                return null;
            }

            // Obtener datos del usuario
            const userResult = await pool.request()
                .input('id', sql.UniqueIdentifier, userId)
                .query(`
                    SELECT id, first_name, last_name, email, phone, dni, 
                           is_active, created_at, updated_at
                    FROM Users WHERE id = @id
                `);

            if (userResult.recordset.length === 0) return null;

            const user = userResult.recordset[0];

            // Obtener propiedades
            const propertiesResult = await pool.request()
                .input('user_id', sql.UniqueIdentifier, userId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT p.*, b.name as building_name, b.code as building_code,
                        po.is_primary_owner, po.percentage_ownership
                    FROM Properties p
                    INNER JOIN PropertyOwners po ON p.id = po.property_id
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    WHERE po.user_id = @user_id AND p.tenant_id = @tenant_id
                    ORDER BY b.name, p.name
                `);

            user.properties = propertiesResult.recordset;
            return user;
        } catch (error) {
            console.error('Error getting owner with properties:', error);
            throw error;
        }
    }

    /**
     * Buscar propietario por DNI y/o email y devolver sus condominios (tenants)
     * Usado por SuperAdmin para localizar propietarios
     * @param {string} [dni]
     * @param {string} [email]
     * @returns {Promise<{user: Object|null, tenants: Array}>}
     */
    static async findOwnerWithTenants(dni, email) {
        try {
            let user = null;
            if (dni && dni.trim()) {
                user = await this.findByDni(dni.trim());
            }
            if (!user && email && email.trim()) {
                user = await this.findByEmail(email.trim());
            }
            if (!user) {
                return { user: null, tenants: [] };
            }

            const pool = await connectDB();
            const result = await pool.request()
                .input('user_id', sql.UniqueIdentifier, user.id)
                .query(`
                    SELECT DISTINCT t.id, t.name, t.slug
                    FROM Tenants t
                    INNER JOIN Properties p ON p.tenant_id = t.id
                    INNER JOIN PropertyOwners po ON po.property_id = p.id
                    WHERE po.user_id = @user_id AND t.active = 1
                    ORDER BY t.name
                `);

            return { user, tenants: result.recordset || [] };
        } catch (error) {
            console.error('Error finding owner with tenants:', error);
            throw error;
        }
    }
}

module.exports = UserModel;
