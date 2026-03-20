const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const UserModel = require('../models/UserModel');
const TenantAdminModel = require('../models/TenantAdminModel');
const PropertyModel = require('../models/PropertyModel');
const TenantModel = require('../models/TenantModel');
const EmailService = require('./EmailService');

/**
 * Servicio de Autenticación
 * Maneja login, registro, invitaciones y recuperación de contraseña
 * para ambos tipos de usuarios: Propietarios y Admins de Junta
 */
class AuthService {
    
    // ==================== LOGIN ====================

    /**
     * Login para Propietarios
     * @param {string} identifier - DNI o correo electrónico
     * @param {string} password 
     * @returns {Promise<Object>}
     */
    static async loginOwner(identifier, password) {
        const user = await UserModel.findByDniOrEmail(identifier);
        
        if (!user) {
            throw new Error('Credenciales inválidas');
        }

        if (user.registration_status !== 'ACTIVE') {
            if (user.registration_status === 'INVITED' || user.registration_status === 'PENDING') {
                throw new Error('Confirma tu invitación mediante el correo que te enviamos para activar tu cuenta.');
            }
            throw new Error('Cuenta no activada. Verifica tu email o contacta al administrador.');
        }

        const isValid = await UserModel.validatePassword(password, user.password_hash);
        if (!isValid) {
            throw new Error('Credenciales inválidas');
        }

        // Obtener unidades del propietario
        const properties = await PropertyModel.getByOwner(user.id);
        
        if (properties.length === 0) {
            throw new Error('No tienes unidades asignadas. Contacta a la junta de condominio.');
        }

        // Si solo tiene una propiedad, incluir tenantId en el token
        const singleProperty = properties.length === 1 ? properties[0] : null;

        // Generar token (con tenantId si solo tiene una propiedad)
        const token = jwt.sign(
            {
                userId: user.id,
                email: user.email,
                type: 'OWNER',
                isSuperAdmin: user.is_superadmin,
                ...(singleProperty && {
                    tenantId: singleProperty.tenant_id,
                    propertyId: singleProperty.id
                })
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        return {
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                dni: user.dni,
                type: 'OWNER'
            },
            properties: properties.map(p => ({
                id: p.id,
                name: p.name,
                type: p.type,
                building: p.building_name,
                floor: p.floor,
                area: p.area_sqm,
                alicuota: p.alicuota,
                tenantId: p.tenant_id,
                tenantName: p.tenant_name,
                tenantSlug: p.tenant_slug,
                isPrimary: p.is_primary_owner,
                percentage: p.percentage_ownership
            }))
        };
    }

    /**
     * Login para Admins de Junta
     * @param {string} identifier - DNI o correo electrónico
     * @param {string} password 
     * @returns {Promise<Object>}
     */
    static async loginTenantAdmin(identifier, password) {
        const admin = await TenantAdminModel.findByDniOrEmail(identifier);
        
        if (!admin) {
            throw new Error('Credenciales inválidas');
        }

        const isValid = await TenantAdminModel.validatePassword(password, admin.password_hash);
        if (!isValid) {
            throw new Error('Credenciales inválidas');
        }

        // Actualizar último login
        await TenantAdminModel.updateLastLogin(admin.id);

        // Obtener info del tenant
        const tenant = await TenantModel.findById(admin.tenant_id);

        // Generar token
        const token = jwt.sign(
            {
                userId: admin.id,
                email: admin.email,
                tenantId: admin.tenant_id,
                type: 'TENANT_ADMIN',
                role: admin.role
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        return {
            token,
            user: {
                id: admin.id,
                email: admin.email,
                firstName: admin.first_name,
                lastName: admin.last_name,
                role: admin.role,
                type: 'TENANT_ADMIN',
                mustChangePassword: !!(admin.must_change_password)
            },
            tenant: {
                id: tenant.id,
                name: tenant.name,
                slug: tenant.slug
            }
        };
    }

    /**
     * Login para Superadmin
     * @param {string} identifier - DNI o correo electrónico
     * @param {string} password 
     * @returns {Promise<Object>}
     */
    static async loginSuperAdmin(identifier, password) {
        const user = await UserModel.findByDniOrEmail(identifier);
        
        if (!user || !user.is_superadmin) {
            throw new Error('Credenciales inválidas');
        }

        const isValid = await UserModel.validatePassword(password, user.password_hash);
        if (!isValid) {
            throw new Error('Credenciales inválidas');
        }

        const token = jwt.sign(
            {
                userId: user.id,
                email: user.email,
                type: 'SUPERADMIN',
                isSuperAdmin: true
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        return {
            token,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                type: 'SUPERADMIN',
                isSuperAdmin: true
            }
        };
    }

    // ==================== REGISTRO DESDE INVITACIÓN ====================

    /**
     * Completar registro desde invitación
     * @param {string} token 
     * @param {string} password 
     * @param {string} email - Opcional, puede actualizar email
     */
    static async completeRegistration(token, password, email = null) {
        const user = await UserModel.findByInvitationToken(token);
        
        if (!user) {
            throw new Error('Token de invitación inválido o expirado');
        }

        // Verificar que no haya expirado (7 días)
        const invitedAt = new Date(user.invited_at);
        const now = new Date();
        const diffDays = (now - invitedAt) / (1000 * 60 * 60 * 24);
        
        if (diffDays > 7) {
            throw new Error('El enlace de invitación ha expirado. Solicite una nueva invitación.');
        }

        const updated = await UserModel.completeRegistration(token, password, email);
        
        if (!updated) {
            throw new Error('Error al completar el registro');
        }

        return {
            message: 'Registro completado exitosamente. Ya puedes iniciar sesión.',
            email: updated.email
        };
    }

    // ==================== RECUPERACIÓN DE CONTRASEÑA ====================

    /**
     * Solicitar recuperación de contraseña
     * @param {string} email 
     * @param {string} type - 'OWNER' o 'TENANT_ADMIN'
     */
    static async requestPasswordReset(email, type = 'OWNER') {
        let user;
        
        if (type === 'OWNER') {
            user = await UserModel.findByEmail(email);
        } else {
            user = await TenantAdminModel.findByEmail(email);
        }

        if (!user) {
            // No revelar si el email existe o no (seguridad)
            return { 
                message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña.' 
            };
        }

        // Generar token de reset
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

        // Guardar token (usar tabla o campo temporal)
        // Por simplicidad, usaremos una tabla PasswordResets
        await this._saveResetToken(user.id, type, resetToken, resetTokenExpiry);

        // Enviar email
        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        const resetLink = `${baseUrl}/auth/reset-password?token=${resetToken}&type=${type}`;
        
        await EmailService.sendPasswordReset(
            user.email,
            user.first_name,
            resetLink
        );

        return { 
            message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña.' 
        };
    }

    /**
     * Verificar token de reset
     */
    static async verifyResetToken(token) {
        const reset = await this._getResetToken(token);
        
        if (!reset) {
            throw new Error('Token inválido o expirado');
        }

        if (new Date(reset.expires_at) < new Date()) {
            throw new Error('Token expirado');
        }

        return reset;
    }

    /**
     * Restablecer contraseña
     * @param {string} token 
     * @param {string} newPassword 
     */
    static async resetPassword(token, newPassword) {
        const reset = await this.verifyResetToken(token);
        
        if (reset.type === 'OWNER') {
            await UserModel.update(reset.user_id, { password: newPassword });
            const user = await UserModel.findById ? await UserModel.findById(reset.user_id) : null;
            if (user) {
                await EmailService.sendPasswordChanged(user.email, user.first_name);
            }
        } else {
            await TenantAdminModel.update(reset.user_id, { password: newPassword });
            const admin = await TenantAdminModel.findById(reset.user_id);
            await EmailService.sendPasswordChanged(admin.email, admin.first_name);
        }

        // Invalidar token usado
        await this._deleteResetToken(token);

        return { message: 'Contraseña actualizada exitosamente' };
    }

    // ==================== UTILIDADES ====================

    /**
     * Seleccionar unidad para propietario con múltiples unidades
     * Genera nuevo token scoped a ese tenant
     */
    static async selectProperty(userId, propertyId) {
        const properties = await PropertyModel.getByOwner(userId);
        const selected = properties.find(p => p.id === propertyId);
        
        if (!selected) {
            throw new Error('Unidad no encontrada o no tienes acceso');
        }

        const user = await UserModel.findById ? await UserModel.findById(userId) : null;
        
        // Generar token scoped al tenant
        const token = jwt.sign(
            {
                userId: userId,
                email: user?.email,
                tenantId: selected.tenant_id,
                propertyId: selected.id,
                type: 'OWNER',
                isPropertyScoped: true
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        return {
            token,
            user: user ? {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                dni: user.dni,
                type: 'OWNER'
            } : null,
            property: {
                id: selected.id,
                name: selected.name,
                type: selected.type,
                building: selected.building_name || selected.building,
                floor: selected.floor,
                area: selected.area_sqm,
                alicuota: selected.alicuota,
                tenantId: selected.tenant_id,
                tenantName: selected.tenant_name,
                tenantSlug: selected.tenant_slug,
                isPrimary: selected.is_primary_owner,
                percentage: selected.percentage_ownership
            }
        };
    }

    /**
     * Cambiar contraseña (usuario logueado)
     */
    static async changePassword(userId, type, currentPassword, newPassword) {
        let user;
        let isValid;

        if (type === 'OWNER' || type === 'SUPERADMIN') {
            // Necesitamos obtener el usuario con password_hash
            // Asumiendo que tenemos un método para esto o lo agregamos
            throw new Error('Método no implementado completamente');
        } else {
            const admin = await TenantAdminModel.findById(userId);
            isValid = await TenantAdminModel.validatePassword(currentPassword, admin.password_hash);
            if (!isValid) {
                throw new Error('Contraseña actual incorrecta');
            }
            await TenantAdminModel.update(userId, { password: newPassword });
            await EmailService.sendPasswordChanged(admin.email, admin.first_name);
        }

        return { message: 'Contraseña actualizada exitosamente' };
    }

    /**
     * Seleccionar tenant para usuario
     * Usado principalmente por SuperAdmins o casos especiales
     */
    static async selectTenant(userId, type, tenantId) {
        const jwt = require('jsonwebtoken');
        
        if (type === 'SUPERADMIN') {
            const user = await UserModel.findById(userId);
            
            const token = jwt.sign(
                {
                    userId: user.id,
                    email: user.email,
                    tenantId: tenantId, // Superadmin asume el contexto de este tenant
                    type: 'SUPERADMIN',
                    isSuperAdmin: true
                },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
            );

            return {
                token,
                role: 'SUPERADMIN',
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    type: 'SUPERADMIN'
                }
            };
        }

        throw new Error('Tipo de usuario no soportado para selección de tenant');
    }

    // ==================== MÉTODOS PRIVADOS ====================

    static async _saveResetToken(userId, type, token, expiresAt) {
        const { connectDB, sql } = require('../config/database');
        const pool = await connectDB();
        
        // Crear tabla si no existe
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PasswordResets]') AND type in (N'U'))
            CREATE TABLE PasswordResets (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                user_id UNIQUEIDENTIFIER NOT NULL,
                user_type NVARCHAR(20) NOT NULL,
                token NVARCHAR(255) NOT NULL UNIQUE,
                expires_at DATETIME2 NOT NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME()
            )
        `);

        await pool.request()
            .input('userId', sql.UniqueIdentifier, userId)
            .input('type', sql.NVarChar, type)
            .input('token', sql.NVarChar, token)
            .input('expiresAt', sql.DateTime2, expiresAt)
            .query(`
                INSERT INTO PasswordResets (user_id, user_type, token, expires_at)
                VALUES (@userId, @type, @token, @expiresAt)
            `);
    }

    static async _getResetToken(token) {
        const { connectDB, sql } = require('../config/database');
        const pool = await connectDB();
        
        const result = await pool.request()
            .input('token', sql.NVarChar, token)
            .query('SELECT * FROM PasswordResets WHERE token = @token');
        
        return result.recordset[0] || null;
    }

    static async _deleteResetToken(token) {
        const { connectDB, sql } = require('../config/database');
        const pool = await connectDB();
        
        await pool.request()
            .input('token', sql.NVarChar, token)
            .query('DELETE FROM PasswordResets WHERE token = @token');
    }
}

module.exports = AuthService;
