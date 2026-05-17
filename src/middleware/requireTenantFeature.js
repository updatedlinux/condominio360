const { connectDB, sql } = require('../config/database');

const MESSAGES = {
    visits: 'Los anuncios de visitas no están habilitados para este condominio.',
    deliveries: 'Los anuncios de deliveries no están habilitados para este condominio.'
};

const COLUMNS = {
    visits: 'visits_announcements_enabled',
    deliveries: 'deliveries_announcements_enabled'
};

async function loadFlags(tenantId) {
    const pool = await connectDB();
    const result = await pool.request()
        .input('tenant_id', sql.UniqueIdentifier, tenantId)
        .query(`
            SELECT visits_announcements_enabled, deliveries_announcements_enabled
            FROM Tenants WHERE id = @tenant_id
        `);
    const row = result.recordset[0];
    if (!row) return null;
    return {
        visits_announcements_enabled: row.visits_announcements_enabled !== false && row.visits_announcements_enabled !== 0,
        deliveries_announcements_enabled: row.deliveries_announcements_enabled !== false && row.deliveries_announcements_enabled !== 0
    };
}

function requireTenantFeature(feature) {
    const column = COLUMNS[feature];
    if (!column) {
        throw new Error(`Unknown tenant feature: ${feature}`);
    }

    return async function requireTenantFeatureMiddleware(req, res, next) {
        try {
            const tenantId = req.user?.tenantId;
            if (!tenantId) {
                return res.status(403).json({
                    success: false,
                    error: MESSAGES[feature]
                });
            }

            const flags = await loadFlags(tenantId);
            if (!flags) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            const enabledKey = feature === 'visits'
                ? 'visits_announcements_enabled'
                : 'deliveries_announcements_enabled';

            if (!flags[enabledKey]) {
                return res.status(403).json({
                    success: false,
                    error: MESSAGES[feature],
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
    requireDeliveriesAnnouncements: requireTenantFeature('deliveries')
};
