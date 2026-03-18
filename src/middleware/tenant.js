const TenantModel = require('../models/TenantModel');

/**
 * Tenant Middleware
 * Resolves the tenant based on the 'X-Tenant-ID' header or subdomain.
 * Attaches the tenant object to req.tenant.
 */
const tenantMiddleware = async (req, res, next) => {
    try {
        let tenant = null;

        // 1. Check Header (Prioridad para desarrollo/API testing)
        const tenantSlugHeader = req.get('X-Tenant-Slug');

        if (tenantSlugHeader) {
            tenant = await TenantModel.findBySlug(tenantSlugHeader);
        } else {
            // 2. Check Subdomain (Producción)
            // Host format: tenant.domain.com
            const host = req.get('host');
            const parts = host.split('.');

            // Suponiendo localhost:3000 o dominio.com (2 partes) vs tenant.dominio.com (3 partes)
            // Ajustar lógica según entorno local vs prod
            if (parts.length >= 3) {
                const subdomain = parts[0];
                // Ignorar 'www' o 'api' si fuera el caso
                if (subdomain !== 'www' && subdomain !== 'api') {
                    tenant = await TenantModel.findBySlug(subdomain);
                }
            }
        }

        // Si no se encuentra tenant, pero la ruta es pública o root, permitimos continuar sin tenant
        // O si es la landing page principal del SaaS
        if (tenant) {
            req.tenant = tenant;
        }

        next();
    } catch (error) {
        console.error('Tenant Middleware Error:', error);
        res.status(500).json({ error: 'Internal Server Error processing tenant' });
    }
};

module.exports = tenantMiddleware;
