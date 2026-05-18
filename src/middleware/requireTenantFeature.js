const { connectDB, sql } = require('../config/database');

const FEATURES = {
    visits: {
        flagKey: 'visits_announcements_enabled',
        message: 'Los anuncios de visitas no están habilitados para este condominio.'
    },
    deliveries: {
        flagKey: 'deliveries_announcements_enabled',
        message: 'Los anuncios de deliveries no están habilitados para este condominio.'
    },
    vehicle_access: {
        flagKey: 'vehicle_access_enabled',
        message: 'El acceso vehicular no está habilitado para este condominio.'
    }
};

async function loadFlags(tenantId) {
    const pool = await connectDB();
    const result = await pool.request()
        .input('tenant_id', sql.UniqueIdentifier, tenantId)
        .query(`
            SELECT visits_announcements_enabled, deliveries_announcements_enabled, vehicle_access_enabled
            FROM Tenants WHERE id = @tenant_id
        `);
    const row = result.recordset[0];
    if (!row) return null;

    const normalize = (v) => v !== false && v !== 0;

    return {
        visits_announcements_enabled: normalize(row.visits_announcements_enabled),
        deliveries_announcements_enabled: normalize(row.deliveries_announcements_enabled),
        vehicle_access_enabled: row.vehicle_access_enabled === undefined || row.vehicle_access_enabled === null
            ? true
            : normalize(row.vehicle_access_enabled)
    };
}

function requireTenantFeature(feature) {
    const config = FEATURES[feature];
    if (!config) {
        throw new Error(`Unknown tenant feature: ${feature}`);
    }

    return async function requireTenantFeatureMiddleware(req, res, next) {
        try {
            const tenantId = req.user?.tenantId;
            if (!tenantId) {
                return res.status(403).json({
                    success: false,
                    error: config.message
                });
            }

            const flags = await loadFlags(tenantId);
            if (!flags) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            if (!flags[config.flagKey]) {
                return res.status(403).json({
                    success: false,
                    error: config.message,
                    feature_disabled: feature
                });
            }

            req.tenantPortalFeatures = flags;
            next();
        } catch (error) {
            console.error('requireTenantFeature error:', error);
            res.status(500).json({ success: false, error: 'Error al verificar funcionalidad del condominio' });
        }
    };
}

module.exports = {
    loadFlags,
    requireVisitsAnnouncements: requireTenantFeature('visits'),
    requireDeliveriesAnnouncements: requireTenantFeature('deliveries'),
    requireVehicleAccess: requireTenantFeature('vehicle_access')
};
