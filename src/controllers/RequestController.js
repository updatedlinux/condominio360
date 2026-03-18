const RequestModel = require('../models/RequestModel');

class RequestController {
    /**
     * Create a new request
     */
    static async create(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            const { request_type_id, data, property_id, description, priority } = req.body;

            // TODO: Validate 'data' against the schema defined in RequestType (Future improvement)

            const request = await RequestModel.create({
                tenant_id: tenantId,
                user_id: req.user.userId,
                property_id,
                request_type_id,
                data,
                description,
                priority
            });

            res.status(201).json(request);
        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    /**
     * List requests.
     * Admins see all tenant requests.
     * Residents see only their own.
     */
    static async index(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            let requests;
            if (req.user.role === 'ADMIN' || req.user.role === 'SUPERADMIN' || req.user.role === 'SECURITY') {
                requests = await RequestModel.getAllByTenant(tenantId);
            } else {
                requests = await RequestModel.getAllByUser(req.user.userId, tenantId);
            }

            res.json(requests);
        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    /**
     * Update status (Admin only)
     */
    static async updateStatus(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPERADMIN') {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            const { id } = req.params;
            const { status } = req.body;

            const updatedRequest = await RequestModel.updateStatus(id, status, tenantId);
            if (!updatedRequest) return res.status(404).json({ error: 'Request not found' });

            res.json(updatedRequest);
        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}

module.exports = RequestController;
