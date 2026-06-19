const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const UserModel = require('../models/UserModel');
const TenantAdminModel = require('../models/TenantAdminModel');
const PropertyModel = require('../models/PropertyModel');
const TenantModel = require('../models/TenantModel');
const EmailService = require('./EmailService');
const {
    normalizeLoginIdentifier,
    normalizePassword,
    looksLikeEmailOrDni
} = require('../utils/authCredentials');

/**
 * Servicio de Autenticación
 * Maneja login, registro, invitaciones y recuperación de contraseña
 * para ambos tipos de usuarios: Propietarios y Admins de Junta
 */
class AuthService {
    
    // ==================== LOGIN ====================

    /**
     * Login por nickname de inmueble (cuando no hay DNI/correo actualizados)
     * Usuario y contraseña = mismo valor (nickname)
     * @param {string} nickname 
     * @param {string} password 
     * @returns {Promise<Object>}
     */
    static async loginByNickname(nickname, password) {
        const normalized = normalizeLoginIdentifier(nickname).toLowerCase();
        const pwd = normalizePassword(password);
        if (!normalized) throw new Error('Credenciales inválidas');

        const property = await PropertyModel.findByNickname(normalized);
        if (!property || !property.nickname_password_hash) {
            throw new Error('Credenciales inválidas');
        }

        const isValid = await bcrypt.compare(pwd, property.nickname_password_hash);
        if (!isValid) {
            throw new Error('Credenciales inválidas');
        }

        const propertyWithOwners = await PropertyModel.getWithOwners(property.id);
        const owners = (propertyWithOwners?.owners || []).map(o => ({
            id: o.user_id,
            firstName: o.first_name,
            lastName: o.last_name,
            email: o.email,
            dni: o.dni
        }));

        const token = jwt.sign(
            {
                userId: null,
                propertyId: property.id,
                tenantId: property.tenant_id,
                type: 'OWNER_NICKNAME'
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        return {
            token,
            nicknameFlow: true,
            requiresOwnerSelection: owners.length > 1,
            owners,
            property: {
                id: property.id,
                name: property.name,
                building: property.building_name,
                tenantId: property.tenant_id,
                tenantName: property.tenant_name,
                tenantSlug: property.tenant_slug
            }
        };
    }

    /**
     * Login para Propietarios
     * @param {string} identifier - DNI o correo electrónico
     * @param {string} password 
     * @returns {Promise<Object>}
     */
    static async loginOwner(identifier, password) {
        const loginId = normalizeLoginIdentifier(identifier);
        const pwd = normalizePassword(password);
        const user = await UserModel.findByDniOrEmail(loginId);
        
        if (!user) {
            throw new Error('Credenciales inválidas');
        }

        if (user.registration_status !== 'ACTIVE') {
            if (user.registration_status === 'INVITED' || user.registration_status === 'PENDING') {
                throw new Error('Confirma tu invitación mediante el correo que te enviamos para activar tu cuenta.');
            }
            throw new Error('Cuenta no activada. Verifica tu email o contacta al administrador.');
        }

        const isValid = await UserModel.validatePassword(pwd, user.password_hash);
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
        const loginId = normalizeLoginIdentifier(identifier);
        const pwd = normalizePassword(password);
        const admin = await TenantAdminModel.findByDniOrEmail(loginId);
        
        if (!admin) {
            throw new Error('Credenciales inválidas');
        }

        const isValid = await TenantAdminModel.validatePassword(pwd, admin.password_hash);
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
        const loginId = normalizeLoginIdentifier(identifier);
        const pwd = normalizePassword(password);
        const user = await UserModel.findByDniOrEmail(loginId);
        
        if (!user || !user.is_superadmin) {
            throw new Error('Credenciales inválidas');
        }

        const isValid = await UserModel.validatePassword(pwd, user.password_hash);
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

    /**
     * Login unificado (sin tipo explícito).
     * Si el identificador parece cédula/correo, evita login por nickname de inmueble
     * (colisiones y contraseñas desincronizadas tras cambio de clave).
     */
    static async loginUnified(loginId, password) {
        const id = normalizeLoginIdentifier(loginId);
        const pwd = normalizePassword(password);
        const skipNickname = looksLikeEmailOrDni(id);

        try {
            return await AuthService.loginSuperAdmin(id, pwd);
        } catch (_) { /* continuar */ }

        try {
            return await AuthService.loginTenantAdmin(id, pwd);
        } catch (_) { /* continuar */ }

        if (!skipNickname) {
            try {
                return await AuthService.loginByNickname(id, pwd);
            } catch (_) { /* continuar */ }
        }

        try {
            return await AuthService.loginOwner(id, pwd);
        } catch (_) { /* continuar */ }

        throw new Error('Credenciales inválidas');
    }

    // ==================== REGISTRO DESDE INVITACIÓN ====================

    /** Enlace de invitación válido 24 horas desde invited_at */
    static isInvitationExpired(invitedAt) {
        if (!invitedAt) return true;
        const maxMs = 24 * 60 * 60 * 1000;
        return Date.now() - new Date(invitedAt).getTime() > maxMs;
    }

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

        // Invitación: 24 horas desde invited_at (coherente con el correo y verify-invitation)
        if (AuthService.isInvitationExpired(user.invited_at)) {
            throw new Error('El enlace de invitación ha expirado. Solicite una nueva invitación.');
        }

        const updated = await UserModel.completeRegistration(token, password, email);

        if (!updated) {
            throw new Error('Error al completar el registro');
        }

        const passwordOk = await UserModel.validatePassword(password, updated.password_hash);
        if (!passwordOk) {
            throw new Error('No se pudo guardar la contraseña. Intenta de nuevo o solicita un nuevo enlace.');
        }

        return {
            message: 'Registro completado exitosamente. Ya puedes iniciar sesión.',
            email: updated.email,
            dni: updated.dni
        };
    }

    // ==================== RECUPERACIÓN DE CONTRASEÑA ====================

    /** Nombre para saludo en correos (nombre + apellido). */
    static _displayNameForEmail(user) {
        if (!user) return 'Usuario';
        const a = user.first_name != null ? String(user.first_name).trim() : '';
        const b = user.last_name != null ? String(user.last_name).trim() : '';
        const joined = [a, b].filter(Boolean).join(' ');
        return joined || a || b || 'Usuario';
    }

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

        // Generar token de reset (válido 24 h, alineado con el envío desde administración)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await this._deleteResetTokensForUser(user.id, type);
        await this._saveResetToken(user.id, type, resetToken, resetTokenExpiry);

        // Enviar email
        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        const resetLink = `${baseUrl}/auth/reset-password?token=${resetToken}&type=${type}`;

        const resetMeta = {};
        if (type === 'TENANT_ADMIN' && user.tenant_id) {
            resetMeta.tenantId = user.tenant_id;
        } else if (type === 'OWNER') {
            const props = await PropertyModel.getByOwner(user.id);
            if (props?.[0]?.tenant_id) {
                resetMeta.tenantId = props[0].tenant_id;
            }
        }

        await EmailService.sendPasswordReset(
            user.email,
            AuthService._displayNameForEmail(user),
            resetLink,
            { ...resetMeta, validityHours: 24 }
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
        const userType = reset.user_type || reset.type;
        const pwd = normalizePassword(newPassword);

        if (userType === 'OWNER') {
            await UserModel.updatePassword(reset.user_id, pwd);
            await PropertyModel.syncNicknamePasswordsForOwner(reset.user_id, pwd);
            const user = await UserModel.findById(reset.user_id);
            if (user) {
                const props = await PropertyModel.getByOwner(user.id);
                const tenantId = props?.[0]?.tenant_id || null;
                await EmailService.sendPasswordChanged(user.email, AuthService._displayNameForEmail(user), { tenantId });
            }
        } else {
            await TenantAdminModel.update(reset.user_id, { password: pwd });
            const admin = await TenantAdminModel.findById(reset.user_id);
            await EmailService.sendPasswordChanged(admin.email, AuthService._displayNameForEmail(admin), {
                tenantId: admin.tenant_id || null
            });
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
        const currentPwd = normalizePassword(currentPassword);
        const newPwd = normalizePassword(newPassword);
        let isValid;

        if (type === 'OWNER' || type === 'SUPERADMIN') {
            const user = await UserModel.findById(userId);
            if (!user) {
                throw new Error('Usuario no encontrado');
            }
            isValid = await UserModel.validatePassword(currentPwd, user.password_hash);
            if (!isValid) {
                throw new Error('Contraseña actual incorrecta');
            }
            await UserModel.updatePassword(userId, newPwd);
            if (type === 'OWNER') {
                await PropertyModel.syncNicknamePasswordsForOwner(userId, newPwd);
            }
            const refreshed = await UserModel.findById(userId);
            let tenantId = null;
            if (type === 'OWNER') {
                const props = await PropertyModel.getByOwner(userId);
                tenantId = props?.[0]?.tenant_id || null;
            }
            await EmailService.sendPasswordChanged(refreshed.email, AuthService._displayNameForEmail(refreshed), {
                tenantId,
                idempotencyKey: `pwchg:${userId}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`
            });
        } else {
            const admin = await TenantAdminModel.findById(userId);
            isValid = await TenantAdminModel.validatePassword(currentPwd, admin.password_hash);
            if (!isValid) {
                throw new Error('Contraseña actual incorrecta');
            }
            await TenantAdminModel.update(userId, { password: newPwd });
            await EmailService.sendPasswordChanged(admin.email, AuthService._displayNameForEmail(admin), {
                tenantId: admin.tenant_id || null
            });
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

    /**
     * Enviar correo con enlace de restablecimiento (Super Admin, contexto de un condominio).
     * @param {string} userId
     * @param {string} tenantId
     */
    static async sendOwnerPasswordResetFromAdmin(userId, tenantId) {
        const { connectDB, sql } = require('../config/database');
        const pool = await connectDB();

        const userResult = await pool.request()
            .input('userId', sql.UniqueIdentifier, userId)
            .input('tenantId', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT u.id, u.email, u.first_name, u.last_name
                FROM Users u
                INNER JOIN TenantUsers tu ON u.id = tu.user_id
                    AND tu.tenant_id = @tenantId
                    AND tu.role = 'OWNER'
                    AND tu.status = 'ACTIVE'
                WHERE u.id = @userId
            `);

        if (!userResult.recordset.length) {
            throw new Error('El propietario no pertenece a este condominio o no está activo');
        }

        const user = userResult.recordset[0];
        if (!user.email || !String(user.email).trim()) {
            throw new Error('El propietario no tiene correo electrónico registrado');
        }

        await this._deleteResetTokensForUser(userId, 'OWNER');

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await this._saveResetToken(userId, 'OWNER', resetToken, resetTokenExpiry);

        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        const resetLink = `${baseUrl}/auth/reset-password?token=${resetToken}&type=OWNER`;

        await EmailService.sendPasswordReset(user.email, AuthService._displayNameForEmail(user), resetLink, {
            tenantId,
            validityHours: 24
        });
    }

    // ==================== MÉTODOS PRIVADOS ====================

    static async _ensurePasswordResetsTable() {
        const { connectDB } = require('../config/database');
        const pool = await connectDB();
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
    }

    static async _deleteResetTokensForUser(userId, userType) {
        const { connectDB, sql } = require('../config/database');
        await this._ensurePasswordResetsTable();
        const pool = await connectDB();
        await pool.request()
            .input('userId', sql.UniqueIdentifier, userId)
            .input('type', sql.NVarChar, userType)
            .query('DELETE FROM PasswordResets WHERE user_id = @userId AND user_type = @type');
    }

    static async _saveResetToken(userId, type, token, expiresAt) {
        const { connectDB, sql } = require('../config/database');
        await this._ensurePasswordResetsTable();
        const pool = await connectDB();

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
