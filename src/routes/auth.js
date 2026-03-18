const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/AuthController');
const { authenticate, requireOwner, requireTenantAdmin, requireSuperAdmin } = require('../middleware/auth');

/**
 * Rutas de Autenticación
 * Base: /api/auth
 */

// ==================== LOGIN ====================

// Login unificado (detecta tipo automáticamente)
router.post('/login', AuthController.login);

// Login específico por tipo
router.post('/login/owner', AuthController.loginOwner);
router.post('/login/admin', AuthController.loginTenantAdmin);
router.post('/login/superadmin', AuthController.loginSuperAdmin);

// Login para seguridad
const SecurityUserController = require('../controllers/SecurityUserController');
router.post('/login/security', SecurityUserController.login);

// ==================== REGISTRO E INVITACIONES ====================

// Completar registro desde invitación
router.post('/complete-registration', AuthController.completeRegistration);

// Verificar token de invitación
router.get('/verify-invitation', AuthController.verifyInvitation);

// ==================== RECUPERACIÓN DE CONTRASEÑA ====================

// Solicitar recuperación
router.post('/forgot-password', AuthController.forgotPassword);

// Verificar token de reset
router.get('/verify-reset-token', AuthController.verifyResetToken);

// Restablecer contraseña
router.post('/reset-password', AuthController.resetPassword);

// ==================== RUTAS PROTEGIDAS ====================

// Obtener información del usuario logueado
router.get('/me', authenticate, AuthController.getMe);

// Seleccionar tenant (para usuarios con múltiples tenants)
router.post('/select-tenant', authenticate, AuthController.selectTenant);

// Seleccionar unidad (solo propietarios)
router.post('/select-property', authenticate, requireOwner, AuthController.selectProperty);

// Cambiar contraseña
router.post('/change-password', authenticate, AuthController.changePassword);

// Cerrar sesión
router.post('/logout', authenticate, AuthController.logout);

module.exports = router;
