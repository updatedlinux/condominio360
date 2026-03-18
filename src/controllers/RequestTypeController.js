const RequestTypeModel = require('../models/RequestTypeModel');

class RequestTypeController {
    /**
     * List available request types (Public for tenant members)
     */
    static async index(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            const types = await RequestTypeModel.getAllByTenant(tenantId);
            res.json(types);
        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    /**
     * Create a new request type (Admin only)
     */
    static async create(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPERADMIN') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            const { name, description, form_schema } = req.body;

            // Basic validation
            if (!name || !form_schema || !Array.isArray(form_schema)) {
                return res.status(400).json({ error: 'Invalid input. Name and form_schema (array) are required.' });
            }

            const newType = await RequestTypeModel.create({
                tenant_id: tenantId,
                name,
                description,
                form_schema
            });

            res.status(201).json(newType);
        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }
}

module.exports = RequestTypeController;
