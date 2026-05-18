const SecurityUserModel = require('../models/SecurityUserModel');
const AuditService = require('../services/AuditService');
const TenantModel = require('../models/TenantModel');
const jwt = require('jsonwebtoken');

/**
 * Controller para gestión de Usuarios de Seguridad
 * Solo accesible por Tenant Admins
 */
class SecurityUserController {
    
    /**
     * GET /api/tenant-admin/security-users
     * Listar usuarios de seguridad del tenant
     */
    static async list(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const users = await SecurityUserModel.getByTenant(tenantId);

            res.json({
                success: true,
                users: users.map(u => ({
                    id: u.id,
                    email: u.email,
                    first_name: u.first_name,
                    last_name: u.last_name,
                    full_name: `${u.first_name} ${u.last_name}`,
                    phone: u.phone,
                    document_number: u.document_number,
                    is_active: u.is_active,
                    last_login: u.last_login,
                    created_at: u.created_at
                }))
            });

        } catch (error) {
            console.error('List security users error:', error);
            res.status(500).json({ error: 'Error al listar usuarios' });
        }
    }

    /**
     * POST /api/tenant-admin/security-users
     * Crear nuevo usuario de seguridad
     */
    static async create(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const adminId = req.user.userId;
            
            const {
                email,
                password,
                first_name,
                last_name,
                phone,
                document_number
            } = req.body;

            // Validaciones
            if (!email || !password || !first_name || !last_name) {
                return res.status(400).json({
                    error: 'Email, contraseña, nombre y apellido son requeridos'
                });
            }

            if (password.length < 6) {
                return res.status(400).json({
                    error: 'La contraseña debe tener al menos 6 caracteres'
                });
            }

            const user = await SecurityUserModel.create({
                tenant_id: tenantId,
                email,
                password,
                first_name,
                last_name,
                phone,
                document_number,
                created_by: adminId
            });

            await AuditService.log({
                tenantId,
                actorId: adminId,
                action: 'SECURITY_USER_CREATED',
                entityType: 'SECURITY_USER',
                entityId: user.id,
                metadata: { email, first_name, last_name }
            });

            res.status(201).json({
                success: true,
                user: {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    full_name: `${user.first_name} ${user.last_name}`,
                    phone: user.phone,
                    is_active: user.is_active
                }
            });

        } catch (error) {
            console.error('Create security user error:', error);
            if (error.message && error.message.includes('UQ_SecurityUsers_Email_Tenant')) {
                return res.status(400).json({ error: 'Ya existe un usuario con este email' });
            }
            res.status(500).json({ error: 'Error al crear usuario' });
        }
    }

    /**
     * PUT /api/tenant-admin/security-users/:id
     * Actualizar usuario de seguridad
     */
    static async update(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const adminId = req.user.userId;

            const allowedFields = ['first_name', 'last_name', 'phone', 'is_active', 'document_number'];
            const updateData = {};
            
            for (const field of allowedFields) {
                if (req.body[field] !== undefined) {
                    updateData[field] = req.body[field];
                }
            }

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ error: 'No hay campos para actualizar' });
            }

            // Verificar que el usuario pertenezca al tenant
            const existingUser = await SecurityUserModel.findById(id);
            if (!existingUser || existingUser.tenant_id !== tenantId) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            const user = await SecurityUserModel.update(id, updateData);

            await AuditService.log({
                tenantId,
                actorId: adminId,
                action: 'SECURITY_USER_UPDATED',
                entityType: 'SECURITY_USER',
                entityId: id,
                metadata: { updated_fields: Object.keys(updateData) }
            });

            res.json({
                success: true,
                user
            });

        } catch (error) {
            console.error('Update security user error:', error);
            res.status(500).json({ error: 'Error al actualizar usuario' });
        }
    }

    /**
     * POST /api/tenant-admin/security-users/:id/password
     * Cambiar contraseña de usuario de seguridad
     */
    static async setPassword(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const adminId = req.user.userId;
            const { password } = req.body;

            if (!password || password.length < 6) {
                return res.status(400).json({
                    error: 'La contraseña debe tener al menos 6 caracteres'
                });
            }

            // Verificar que el usuario pertenezca al tenant
            const existingUser = await SecurityUserModel.findById(id);
            if (!existingUser || existingUser.tenant_id !== tenantId) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            await SecurityUserModel.updatePassword(id, password);

            await AuditService.log({
                tenantId,
                actorId: adminId,
                action: 'SECURITY_USER_PASSWORD_RESET',
                entityType: 'SECURITY_USER',
                entityId: id,
                metadata: { user_email: existingUser.email }
            });

            res.json({
                success: true,
                message: 'Contraseña actualizada exitosamente'
            });

        } catch (error) {
            console.error('Set password error:', error);
            res.status(500).json({ error: 'Error al cambiar contraseña' });
        }
    }

    /**
     * DELETE /api/tenant-admin/security-users/:id
     * Desactivar usuario de seguridad
     */
    static async deactivate(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const adminId = req.user.userId;

            // Verificar que el usuario pertenezca al tenant
            const existingUser = await SecurityUserModel.findById(id);
            if (!existingUser || existingUser.tenant_id !== tenantId) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            await SecurityUserModel.update(id, { is_active: false });

            await AuditService.log({
                tenantId,
                actorId: adminId,
                action: 'SECURITY_USER_DEACTIVATED',
                entityType: 'SECURITY_USER',
                entityId: id
            });

            res.json({
                success: true,
                message: 'Usuario desactivado exitosamente'
            });

        } catch (error) {
            console.error('Deactivate security user error:', error);
            res.status(500).json({ error: 'Error al desactivar usuario' });
        }
    }

    // ==================== LOGIN PARA SEGURIDAD ====================

    /**
     * POST /api/auth/login/security
     * Login específico para usuarios de seguridad
     */
    static async login(req, res) {
        try {
            const { email, identifier, password } = req.body;
            const loginId = identifier || email;

            if (!loginId || !password) {
                return res.status(400).json({
                    error: 'Usuario (cédula de ID o correo) y contraseña son requeridos'
                });
            }

            const user = await SecurityUserModel.findByDniOrEmail(loginId);

            if (!user) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            const isValid = await SecurityUserModel.validatePassword(
                password, 
                user.password_hash
            );

            if (!isValid) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            // Actualizar último login
            await SecurityUserModel.updateLastLogin(user.id);

            // Obtener información del tenant
            const tenant = await TenantModel.findById(user.tenant_id);

            // Generar token JWT
            const token = jwt.sign(
                {
                    userId: user.id,
                    email: user.email,
                    tenantId: user.tenant_id,
                    type: 'SECURITY'
                },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
            );

            res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    type: 'SECURITY'
                },
                tenant: tenant ? {
                    id: tenant.id,
                    name: tenant.name,
                    code: tenant.code
                } : null
            });

        } catch (error) {
            console.error('Security login error:', error);
            res.status(500).json({ error: 'Error de autenticación' });
        }
    }
}

module.exports = SecurityUserController;
