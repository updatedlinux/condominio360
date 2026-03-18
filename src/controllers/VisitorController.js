const VisitorModel = require('../models/VisitorModel');

class VisitorController {
    /**
     * Pre-register / Create Pass (Resident Action)
     */
    static async createPass(req, res) {
        try {
            const tenantId = req.user.tenantId; // Middleware ensures this
            const userId = req.user.userId;

            const {
                dni, first_name, last_name, phone, // Visitor Info
                type, alias, valid_from, valid_until, property_id // Pass Info
            } = req.body;

            // 1. Find or Create Visitor Identity
            console.log('Finding/Creating visitor:', { dni, first_name, last_name });
            const visitor = await VisitorModel.findOrCreate({
                tenant_id: tenantId,
                dni, first_name, last_name, phone
            });
            console.log('Visitor found/created:', visitor);

            if (visitor.is_banned) return res.status(403).json({ error: 'Visitor is banned.' });

            // 2. Create Pass
            console.log('Creating pass for visitor:', visitor.id);
            const pass = await VisitorModel.createPass({
                tenant_id: tenantId,
                visitor_id: visitor.id,
                user_id: userId,
                property_id: property_id || null,
                type: type || 'ONE_TIME', // 'ONE_TIME', 'FREQUENT'
                alias,
                valid_from,
                valid_until
            });
            console.log('Pass created:', pass);

            res.status(201).json({ pass, visitor });
        } catch (error) {
            console.error('Create Pass Error:', error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    /**
     * Register a visit (Entry)
     * Handles visitor creation/lookup and log entry in one go.
     */
    static async registerEntry(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            const {
                dni, first_name, last_name, // Identity (Optional if known)
                access_method, vehicle_plate, // Access Details
                property_id, notes
            } = req.body;

            if (!dni) return res.status(400).json({ error: 'DNI required' });

            // 1. Find Visitor (or Create if sufficient info provided)
            let visitor = await VisitorModel.findOrCreate({
                tenant_id: tenantId,
                dni, first_name, last_name
            });

            // If creation failed implicitly (e.g. strict mode) or we want to handle not found:
            // Since findOrCreate tries to insert, it needs name. If DNI exists, it returns it.
            // If DNI doesn't exist and name is missing, it will fail at DB level (NOT NULL constraint).
            // We should catch that cleaner, but for now assuming frontend sends names for new visitors.

            if (visitor.is_banned) return res.status(403).json({ error: 'BANNED' });

            // 2. Check for Valid Pass
            const pass = await VisitorModel.findValidPass(tenantId, visitor.id);

            // 3. Log Entry
            const log = await VisitorModel.logEntry({
                tenant_id: tenantId,
                visitor_id: visitor.id,
                pass_id: pass ? pass.id : null,
                property_id: property_id || (pass ? pass.property_id : null),
                user_id: req.user.userId, // Security Guard
                access_method,
                vehicle_plate,
                notes
            });

            res.status(201).json({ log, visitor, pass });

        } catch (error) {
            console.error('Register Entry Error:', error);
            res.status(500).json({ error: 'Internal Server Error', details: error.message });
        }
    }

    /**
     * Register Exit
     */
    static async registerExit(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            const { visitId } = req.params;

            const visit = await VisitorModel.logExit(visitId, tenantId);
            if (!visit) {
                return res.status(404).json({ error: 'Visit not found or already exited' });
            }

            res.json(visit);
        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    /**
     * List Active Visits (Dashboard for Security)
     */
    static async getActive(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            const visits = await VisitorModel.getActiveVisits(tenantId);
            res.json(visits);
        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    /**
     * Search Visitor Helper
     */
    static async search(req, res) {
        try {
            const tenantId = req.user.tenantId || (req.tenant ? req.tenant.id : null);
            if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });

            const { q } = req.query;
            if (!q) return res.json([]);

            const visitors = await VisitorModel.search(tenantId, q);
            res.json(visitors);
        } catch (error) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}

module.exports = VisitorController;
