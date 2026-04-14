const AuthService = require('../services/AuthService');
const { verifyRecaptcha } = require('../services/RecaptchaService');

function isMobileUserAgent(ua) {
    const s = String(ua || '');
    return /Android|iPhone|iPad|iPod|Mobile/i.test(s);
}

// Rate limit simple en memoria para login (mitiga bypass reCAPTCHA en móvil).
// Nota: si tienes múltiples instancias/PM2 cluster, esto es por-proceso.
const LOGIN_ATTEMPTS = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 min
const LOGIN_MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '20', 10); // por IP+usuario

function recordAndCheckLoginAttempt(key) {
    const now = Date.now();
    const arr = LOGIN_ATTEMPTS.get(key) || [];
    const fresh = arr.filter((t) => now - t <= LOGIN_WINDOW_MS);
    fresh.push(now);
    LOGIN_ATTEMPTS.set(key, fresh);
    return { attempts: fresh.length, blocked: fresh.length > LOGIN_MAX_ATTEMPTS };
}

/**
 * Auth Controller
 * Maneja todas las operaciones de autenticación
 */
class AuthController {
    
    // ==================== LOGIN ====================

    /**
     * POST /api/auth/login
     * Login unificado - detecta tipo de usuario automáticamente
     */
    static async login(req, res) {
        try {
            const { email, identifier, password, type, recaptchaToken } = req.body;

            // Rate limiting antes de intentar auth
            const loginIdForLimit = (identifier || email || '').trim().toLowerCase() || 'unknown';
            const ip = req.ip || req.connection?.remoteAddress || 'unknown';
            const limitKey = `${ip}::${loginIdForLimit}`;
            const lim = recordAndCheckLoginAttempt(limitKey);
            if (lim.blocked) {
                console.warn('[Auth] Rate limit login', { ip, loginIdForLimit, attempts: lim.attempts });
                return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' });
            }

            if (process.env.RECAPTCHA_SECRET_KEY) {
                if (!recaptchaToken) {
                    console.warn('[reCAPTCHA] Login sin token. ¿RECAPTCHA_SITE_KEY está en .env y el script carga en el cliente?');
                }
                const recap = await verifyRecaptcha(recaptchaToken, 'login');
                if (!recap.ok) {
                    if (!recap.skipped) {
                        console.warn('[reCAPTCHA] Login falló:', recap.error, {
                            details: recap.details,
                            score: recap.score,
                            minScore: recap.minScore,
                            action: recap.action,
                            hostname: recap.hostname,
                            challengeTs: recap.challengeTs
                        });
                    }

                    const bypassMobile = String(process.env.RECAPTCHA_BYPASS_MOBILE || '').trim() === '1';
                    if (bypassMobile && isMobileUserAgent(req.headers['user-agent'])) {
                        console.warn('[reCAPTCHA] BYPASS móvil habilitado para login', {
                            ip,
                            loginIdForLimit,
                            reason: recap.error,
                            details: recap.details,
                            hostname: recap.hostname
                        });
                        // Continuar login sin bloquear por reCAPTCHA
                    } else {
                        return res.status(400).json({
                            error: recap.skipped
                                ? 'Error de verificación'
                                : (recap.error || 'Verificación de seguridad fallida. Intenta de nuevo.'),
                            ...(recap.details && { recaptchaDetails: recap.details })
                        });
                    }
                }
            }

            const loginId = identifier || email; // DNI o correo electrónico

            if (!loginId || !password) {
                return res.status(400).json({ 
                    error: 'Usuario (DNI o correo) y contraseña son requeridos' 
                });
            }

            let result;

            // Si se especifica tipo, usarlo; si no, intentar detectar
            if (type === 'TENANT_ADMIN') {
                result = await AuthService.loginTenantAdmin(loginId, password);
            } else if (type === 'SUPERADMIN') {
                result = await AuthService.loginSuperAdmin(loginId, password);
            } else if (type === 'SECURITY') {
                const SecurityUserController = require('./SecurityUserController');
                req.body = { email: loginId, identifier: loginId, password };
                await SecurityUserController.login(req, res);
                return;
            } else {
                // Por defecto, intentar detectar tipo automáticamente
                // Orden: SuperAdmin → TenantAdmin → Owner → Security
                try {
                    result = await AuthService.loginSuperAdmin(loginId, password);
                } catch (superAdminError) {
                    try {
                        result = await AuthService.loginTenantAdmin(loginId, password);
                    } catch (adminError) {
                        try {
                            result = await AuthService.loginByNickname(loginId, password);
                        } catch (nicknameError) {
                            try {
                                result = await AuthService.loginOwner(loginId, password);
                            } catch (ownerError) {
                                try {
                                    const SecurityUserController = require('./SecurityUserController');
                                    req.body = { email: loginId, identifier: loginId, password };
                                    await SecurityUserController.login(req, res);
                                    return;
                                } catch (securityError) {
                                    // Si todos fallan, devolver error genérico
                                    return res.status(401).json({ 
                                        error: 'Credenciales inválidas' 
                                    });
                                }
                            }
                        }
                    }
                }
            }

            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('Login error:', error);
            res.status(401).json({ 
                error: error.message || 'Error de autenticación' 
            });
        }
    }

    /**
     * POST /api/auth/login/owner
     * Login específico para propietarios
     */
    static async loginOwner(req, res) {
        try {
            const { email, identifier, password } = req.body;
            const loginId = identifier || email;

            if (!loginId || !password) {
                return res.status(400).json({ 
                    error: 'Usuario (DNI o correo) y contraseña son requeridos' 
                });
            }

            const result = await AuthService.loginOwner(loginId, password);

            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('Owner login error:', error);
            res.status(401).json({ 
                error: error.message || 'Error de autenticación' 
            });
        }
    }

    /**
     * POST /api/auth/login/admin
     * Login específico para admins de junta
     */
    static async loginTenantAdmin(req, res) {
        try {
            const { email, identifier, password } = req.body;
            const loginId = identifier || email;

            if (!loginId || !password) {
                return res.status(400).json({ 
                    error: 'Usuario (DNI o correo) y contraseña son requeridos' 
                });
            }

            const result = await AuthService.loginTenantAdmin(loginId, password);

            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('Admin login error:', error);
            res.status(401).json({ 
                error: error.message || 'Error de autenticación' 
            });
        }
    }

    /**
     * POST /api/auth/login/superadmin
     * Login para superadmin
     */
    static async loginSuperAdmin(req, res) {
        try {
            const { email, identifier, password } = req.body;
            const loginId = identifier || email;

            if (!loginId || !password) {
                return res.status(400).json({ 
                    error: 'Usuario (DNI o correo) y contraseña son requeridos' 
                });
            }

            const result = await AuthService.loginSuperAdmin(loginId, password);

            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('Superadmin login error:', error);
            res.status(401).json({ 
                error: error.message || 'Error de autenticación' 
            });
        }
    }

    // ==================== REGISTRO E INVITACIONES ====================

    /**
     * POST /api/auth/complete-registration
     * Completar registro desde invitación
     */
    static async completeRegistration(req, res) {
        try {
            const { token, password, email } = req.body;

            if (!token || !password) {
                return res.status(400).json({ 
                    error: 'Token y contraseña son requeridos' 
                });
            }

            // Validar contraseña
            if (password.length < 8) {
                return res.status(400).json({ 
                    error: 'La contraseña debe tener al menos 8 caracteres' 
                });
            }

            const result = await AuthService.completeRegistration(token, password, email);

            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('Complete registration error:', error);
            res.status(400).json({ 
                error: error.message || 'Error al completar registro' 
            });
        }
    }

    /**
     * GET /api/auth/verify-invitation
     * Verificar si un token de invitación es válido
     */
    static async verifyInvitation(req, res) {
        try {
            const { token } = req.query;

            if (!token) {
                return res.status(400).json({ error: 'Token requerido' });
            }

            const UserModel = require('../models/UserModel');
            const user = await UserModel.findByInvitationToken(token);

            if (!user) {
                return res.status(404).json({ 
                    valid: false,
                    error: 'Token inválido o expirado' 
                });
            }

            if (AuthService.isInvitationExpired(user.invited_at)) {
                return res.status(400).json({ 
                    valid: false,
                    error: 'Token expirado' 
                });
            }

            res.json({
                valid: true,
                user: {
                    firstName: user.first_name,
                    lastName: user.last_name,
                    email: user.email,
                    dni: user.dni
                }
            });

        } catch (error) {
            console.error('Verify invitation error:', error);
            res.status(500).json({ 
                error: 'Error al verificar invitación' 
            });
        }
    }

    // ==================== RECUPERACIÓN DE CONTRASEÑA ====================

    /**
     * POST /api/auth/forgot-password
     * Solicitar recuperación de contraseña
     */
    static async forgotPassword(req, res) {
        try {
            const { email, type } = req.body;

            if (!email) {
                return res.status(400).json({ 
                    error: 'Email es requerido' 
                });
            }

            const result = await AuthService.requestPasswordReset(email, type || 'OWNER');

            // Siempre devolver éxito (no revelar si el email existe)
            res.json({
                success: true,
                message: result.message
            });

        } catch (error) {
            console.error('Forgot password error:', error);
            // Aunque haya error, no revelar información
            res.json({
                success: true,
                message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña.'
            });
        }
    }

    /**
     * GET /api/auth/verify-reset-token
     * Verificar si token de reset es válido
     */
    static async verifyResetToken(req, res) {
        try {
            const { token } = req.query;

            if (!token) {
                return res.status(400).json({ error: 'Token requerido' });
            }

            const reset = await AuthService.verifyResetToken(token);

            res.json({
                valid: true,
                type: reset.user_type || reset.type
            });

        } catch (error) {
            res.status(400).json({ 
                valid: false,
                error: error.message 
            });
        }
    }

    /**
     * POST /api/auth/reset-password
     * Restablecer contraseña
     */
    static async resetPassword(req, res) {
        try {
            const { token, password } = req.body;

            if (!token || !password) {
                return res.status(400).json({ 
                    error: 'Token y contraseña son requeridos' 
                });
            }

            if (password.length < 8) {
                return res.status(400).json({ 
                    error: 'La contraseña debe tener al menos 8 caracteres' 
                });
            }

            const result = await AuthService.resetPassword(token, password);

            res.json({
                success: true,
                message: result.message
            });

        } catch (error) {
            console.error('Reset password error:', error);
            res.status(400).json({ 
                error: error.message || 'Error al restablecer contraseña' 
            });
        }
    }

    // ==================== SELECCIÓN DE UNIDAD ====================

    /**
     * POST /api/auth/select-property
     * Seleccionar unidad (para propietarios con múltiples unidades)
     */
    static async selectProperty(req, res) {
        try {
            const { propertyId } = req.body;
            const userId = req.user.userId;

            if (!propertyId) {
                return res.status(400).json({ 
                    error: 'propertyId es requerido' 
                });
            }

            const result = await AuthService.selectProperty(userId, propertyId);

            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('Select property error:', error);
            res.status(400).json({ 
                error: error.message || 'Error al seleccionar unidad' 
            });
        }
    }

    // ==================== PERFIL Y SEGURIDAD ====================

    /**
     * GET /api/auth/me
     * Obtener información del usuario logueado
     */
    static async getMe(req, res) {
        try {
            const { userId, type } = req.user;
            let userData;

            if (type === 'TENANT_ADMIN') {
                const TenantAdminModel = require('../models/TenantAdminModel');
                const admin = await TenantAdminModel.findById(userId);
                userData = {
                    id: admin.id,
                    email: admin.email,
                    firstName: admin.first_name,
                    lastName: admin.last_name,
                    role: admin.role,
                    type: 'TENANT_ADMIN',
                    mustChangePassword: !!(admin.must_change_password),
                    tenant: {
                        id: admin.tenant_id,
                        name: admin.tenant_name,
                        slug: admin.tenant_slug
                    }
                };
            } else if (type === 'SUPERADMIN') {
                const UserModel = require('../models/UserModel');
                const user = await UserModel.findById(userId);
                userData = {
                    id: user.id,
                    email: user.email,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    type: 'SUPERADMIN'
                };
            } else {
                // Owner
                const UserModel = require('../models/UserModel');
                const PropertyModel = require('../models/PropertyModel');
                
                const user = await UserModel.findById(userId);
                const properties = await PropertyModel.getByOwner(userId);

                userData = {
                    id: user.id,
                    email: user.email,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    dni: user.dni,
                    type: 'OWNER',
                    properties: properties.map(p => ({
                        id: p.id,
                        name: p.name,
                        tenantId: p.tenant_id,
                        tenantName: p.tenant_name,
                        isPrimary: p.is_primary_owner
                    }))
                };
            }

            res.json({
                success: true,
                user: userData
            });

        } catch (error) {
            console.error('Get me error:', error);
            res.status(500).json({ 
                error: 'Error al obtener información del usuario' 
            });
        }
    }

    /**
     * POST /api/auth/change-password
     * Cambiar contraseña (usuario logueado)
     */
    static async changePassword(req, res) {
        try {
            const { currentPassword, newPassword } = req.body;
            const { userId, type } = req.user;

            if (!currentPassword || !newPassword) {
                return res.status(400).json({ 
                    error: 'Contraseña actual y nueva son requeridas' 
                });
            }

            if (newPassword.length < 8) {
                return res.status(400).json({ 
                    error: 'La nueva contraseña debe tener al menos 8 caracteres' 
                });
            }

            await AuthService.changePassword(userId, type, currentPassword, newPassword);

            res.json({
                success: true,
                message: 'Contraseña actualizada exitosamente'
            });

        } catch (error) {
            console.error('Change password error:', error);
            res.status(400).json({ 
                error: error.message || 'Error al cambiar contraseña' 
            });
        }
    }

    /**
     * POST /api/auth/select-tenant
     * Seleccionar tenant (para usuarios con acceso a múltiples tenants)
     * En la práctica, solo SuperAdmins pueden tener múltiples tenants
     */
    static async selectTenant(req, res) {
        try {
            const { tenantId } = req.body;
            const { userId, type } = req.user;

            if (!tenantId) {
                return res.status(400).json({ 
                    error: 'Tenant ID es requerido' 
                });
            }

            // Para TenantAdmin, verificar que el tenant coincida
            if (type === 'TENANT_ADMIN') {
                const TenantAdminModel = require('../models/TenantAdminModel');
                const admin = await TenantAdminModel.findById(userId);
                
                if (!admin || admin.tenant_id !== tenantId) {
                    return res.status(403).json({ 
                        error: 'No tienes acceso a este tenant' 
                    });
                }

                // Generar nuevo token con el tenant confirmado
                const jwt = require('jsonwebtoken');
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

                return res.json({
                    success: true,
                    token,
                    role: 'ADMIN',
                    user: {
                        id: admin.id,
                        email: admin.email,
                        firstName: admin.first_name,
                        lastName: admin.last_name,
                        type: 'TENANT_ADMIN'
                    }
                });
            }

            // Para otros tipos de usuario, usar el servicio
            const result = await AuthService.selectTenant(userId, type, tenantId);

            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('Select tenant error:', error);
            res.status(400).json({ 
                error: error.message || 'Error al seleccionar tenant' 
            });
        }
    }

    /**
     * POST /api/auth/nickname/submit-update
     * Enviar solicitud de actualización desde flujo nickname (sin login como propietario)
     */
    static async submitNicknameUpdate(req, res) {
        try {
            const { propertyId, tenantId } = req.user;
            const { owner_id, first_name, last_name, dni, email, phone } = req.body;

            if (req.user.type !== 'OWNER_NICKNAME' || !propertyId || !owner_id) {
                return res.status(400).json({ error: 'Datos incompletos' });
            }

            const PropertyModel = require('../models/PropertyModel');
            const DataUpdateRequestModel = require('../models/DataUpdateRequestModel');
            const UserModel = require('../models/UserModel');
            const EmailService = require('../services/EmailService');
            const AdminController = require('./AdminController');

            const propertyWithOwners = await PropertyModel.getWithOwners(propertyId);
            if (!propertyWithOwners) {
                return res.status(404).json({ error: 'Inmueble no encontrado' });
            }
            const owner = propertyWithOwners.owners.find(o => o.user_id === owner_id);
            if (!owner) {
                return res.status(403).json({ error: 'No eres propietario de este inmueble' });
            }

            const pending = await DataUpdateRequestModel.getPendingByUser(owner_id);
            if (pending) {
                return res.status(400).json({ error: 'Ya tienes una solicitud pendiente. Espera a que sea revisada.' });
            }

            const oldData = {
                first_name: owner.first_name,
                last_name: owner.last_name,
                dni: owner.dni,
                email: owner.email,
                phone: owner.phone
            };
            const newData = {
                first_name: (first_name || owner.first_name || '').trim(),
                last_name: (last_name || owner.last_name || '').trim(),
                dni: (dni || owner.dni || '').trim(),
                email: (email || owner.email || '').trim(),
                phone: (phone || owner.phone || '').trim() || null
            };

            if (!newData.first_name || !newData.last_name || !newData.dni || !newData.email) {
                return res.status(400).json({ error: 'Nombre, apellido, cédula y correo son obligatorios' });
            }

            const request = await DataUpdateRequestModel.create(owner_id, oldData, newData);

            await AdminController.logAudit(req, 'CREATE', 'DATA_UPDATE_REQUEST', request.id,
                `Solicitud de actualización (nickname): ${owner.first_name} ${owner.last_name}`, null);

            const superadmins = await UserModel.findAllSuperAdmins();
            const adminUrl = `${process.env.APP_URL || 'http://localhost:3000'}/admin`;
            try {
                // Enviar al correo NUEVO indicado en la solicitud (donde recibirán las notificaciones)
                await EmailService.sendDataUpdateRequestToOwner(newData.email, newData.first_name);
                for (const sa of superadmins) {
                    if (sa.email) {
                        await EmailService.sendDataUpdateRequestToSuperAdmin(
                            sa.email,
                            newData.first_name,
                            newData.last_name,
                            newData.email,
                            adminUrl
                        ).catch(e => console.error('Email to superadmin:', e));
                    }
                }
            } catch (emailErr) {
                console.error('Error sending emails:', emailErr);
            }

            res.status(201).json({
                success: true,
                message: 'Solicitud enviada. Serás contactado para ratificar los datos.',
                request: { id: request.id, status: 'PENDING' }
            });
        } catch (error) {
            console.error('Submit nickname update error:', error);
            res.status(500).json({ error: 'Error al enviar solicitud' });
        }
    }

    /**
     * POST /api/auth/logout
     * Cerrar sesión (cliente debe eliminar token)
     */
    static async logout(req, res) {
        // En JWT el logout es manejado por el cliente
        // Aquí podríamos agregar el token a una blacklist si fuera necesario
        res.json({
            success: true,
            message: 'Sesión cerrada exitosamente'
        });
    }
}

module.exports = AuthController;
