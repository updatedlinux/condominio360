const jwt = require('jsonwebtoken');
const UserModel = require('../models/UserModel');
const TenantAdminModel = require('../models/TenantAdminModel');

/**
 * Authentication Middleware
 * Verifica el JWT token y adjunta el usuario a req.user
 * 
 * Soporta 3 tipos de usuarios:
 * - OWNER: Propietarios de unidades
 * - TENANT_ADMIN: Administradores de Junta
 * - SUPERADMIN: Administradores del SaaS
 */

/**
 * Middleware base de autenticación
 */
const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ error: 'No se proporcionó token de autenticación' });
    }

    const token = authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
        return res.status(401).json({ error: 'Token inválido' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Debug logging
        if (process.env.NODE_ENV === 'development') {
            console.log('[Auth Middleware] Token decoded:', { 
                type: decoded.type, 
                tenantId: decoded.tenantId,
                userId: decoded.userId 
            });
        }
        
        // Verificar que el token no esté expirado
        if (decoded.exp && decoded.exp < Date.now() / 1000) {
            return res.status(401).json({ error: 'Token expirado' });
        }

        // Adjuntar datos del token a la request
        req.user = decoded;
        req.token = token;

        // Si es un token con propertyId (owner con una sola propiedad o ya seleccionó)
        if (decoded.propertyId) {
            req.propertyId = decoded.propertyId;
        }

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
        }
        return res.status(401).json({ error: 'Token inválido' });
    }
};

/**
 * Middleware para verificar que sea token de flujo nickname (OWNER_NICKNAME)
 */
const requireOwnerNickname = (req, res, next) => {
    if (!req.user || req.user.type !== 'OWNER_NICKNAME') {
        return res.status(403).json({ error: 'Token inválido para esta operación' });
    }
    next();
};

/**
 * Middleware para verificar que sea Propietario (OWNER)
 */
const requireOwner = (req, res, next) => {
    if (!req.user || req.user.type !== 'OWNER') {
        return res.status(403).json({ error: 'Acceso denegado. Se requiere ser propietario.' });
    }
    next();
};

/**
 * Middleware para verificar que sea Admin de Junta
 */
const requireTenantAdmin = (req, res, next) => {
    if (!req.user || req.user.type !== 'TENANT_ADMIN') {
        return res.status(403).json({ error: 'Acceso denegado. Se requiere ser administrador de junta.' });
    }
    next();
};

/**
 * Middleware para verificar que sea Seguridad/Vigilante
 */
const requireSecurity = (req, res, next) => {
    // Permitir acceso a usuarios de seguridad o admins de tenant (para supervisión)
    if (!req.user || (req.user.type !== 'SECURITY' && req.user.type !== 'TENANT_ADMIN')) {
        return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de seguridad o administrador.' });
    }
    next();
};

/**
 * Middleware para verificar que sea Superadmin
 */
const requireSuperAdmin = (req, res, next) => {
    if (!req.user || !req.user.isSuperAdmin) {
        return res.status(403).json({ error: 'Acceso denegado. Se requiere ser superadministrador.' });
    }
    next();
};

/**
 * Middleware para verificar que tenga acceso a un tenant específico
 * Verifica que el tenantId en el token coincida con el de la request
 */
const requireTenantAccess = (req, res, next) => {
    const tenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId;
    
    if (!tenantId) {
        return res.status(400).json({ error: 'Se requiere tenantId' });
    }

    // Para TenantAdmins, el tenant viene en el token
    if (req.user.type === 'TENANT_ADMIN') {
        if (req.user.tenantId !== tenantId) {
            return res.status(403).json({ error: 'No tienes acceso a este conjunto residencial' });
        }
    }
    
    // Para Owners con token scoped, verificar el propertyId pertenece al tenant
    if (req.user.type === 'OWNER' && req.user.isPropertyScoped) {
        if (req.user.tenantId !== tenantId) {
            return res.status(403).json({ error: 'No tienes acceso a este conjunto residencial' });
        }
    }

    req.tenantId = tenantId;
    next();
};

/**
 * Middleware para verificar que tenga un rol específico (para TenantAdmins)
 */
const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || req.user.type !== 'TENANT_ADMIN') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ 
                error: 'Acceso denegado. No tienes el rol requerido.',
                required: allowedRoles,
                current: req.user.role
            });
        }

        next();
    };
};

/**
 * Middleware para verificar que tenga acceso a una propiedad específica
 * Para operaciones sobre unidades inmobiliarias
 */
const requirePropertyAccess = async (req, res, next) => {
    const propertyId = req.params.propertyId || req.body.propertyId;
    
    if (!propertyId) {
        return res.status(400).json({ error: 'Se requiere propertyId' });
    }

    try {
        // Si es TenantAdmin, tiene acceso a todas las propiedades de su tenant
        if (req.user.type === 'TENANT_ADMIN') {
            const PropertyModel = require('../models/PropertyModel');
            const property = await PropertyModel.findById(propertyId);
            
            if (!property || property.tenant_id !== req.user.tenantId) {
                return res.status(404).json({ error: 'Unidad no encontrada' });
            }
            
            req.property = property;
            next();
            return;
        }

        // Si es Owner, verificar que sea propietario de esta unidad
        if (req.user.type === 'OWNER') {
            // Si el token ya está scoped a esta propiedad
            if (req.user.isPropertyScoped && req.user.propertyId === propertyId) {
                next();
                return;
            }

            // Verificar ownership
            const PropertyModel = require('../models/PropertyModel');
            const properties = await PropertyModel.getByOwner(req.user.userId);
            const hasAccess = properties.some(p => p.id === propertyId);

            if (!hasAccess) {
                return res.status(403).json({ error: 'No tienes acceso a esta unidad' });
            }

            next();
            return;
        }

        return res.status(403).json({ error: 'Acceso denegado' });
    } catch (error) {
        console.error('Error verificando acceso a propiedad:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

/**
 * Middleware opcional: autentica si hay token, pero no requiere
 */
const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        req.user = null;
        return next();
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        req.token = token;
    } catch (error) {
        req.user = null;
    }

    next();
};

module.exports = {
    authenticate,
    requireOwnerNickname,
    requireOwner,
    requireTenantAdmin,
    requireSecurity,
    requireSuperAdmin,
    requireTenantAccess,
    requireRole,
    requirePropertyAccess,
    optionalAuth
};
