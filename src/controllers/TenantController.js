const TenantModel = require('../models/TenantModel');

class TenantController {
    /**
     * Get current tenant details
     */
    static async show(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            const tenant = await TenantModel.findById(tenantId);
            if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

            res.json(tenant);
        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    /**
     * Update tenant settings (Admin only)
     */
    static async update(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            // Solo admins pueden editar la configuración del condominio
            if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPERADMIN') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            const { name, address, billing_type, settings } = req.body;

            // Validar billing_type si se envía
            if (billing_type && !['FIXED', 'ALICUOTA'].includes(billing_type)) {
                return res.status(400).json({ error: 'Invalid billing_type. Must be FIXED or ALICUOTA' });
            }

            const updatedTenant = await TenantModel.update(tenantId, {
                name,
                address,
                billing_type,
                settings
            });

            res.json(updatedTenant);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}

module.exports = TenantController;
