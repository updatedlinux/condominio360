const { connectDB, sql } = require('../config/database');

/**
 * Conciliación bancaria y cuentas del condominio: solo en Modo Completo (FULL).
 * En Modo Apoyo (SUPPORT) la gestión de cobros es responsabilidad de la administradora externa.
 */
async function requireFullBillingMode(req, res, next) {
    try {
        const tenantId = req.user?.tenantId;
        if (!tenantId) {
            return res.status(403).json({
                success: false,
                error: 'La conciliación bancaria solo está disponible en Modo Completo de facturación.'
            });
        }

        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT billing_mode FROM Tenants WHERE id = @tenant_id');

        const billingMode = result.recordset[0]?.billing_mode || 'FULL';
        if (billingMode !== 'FULL') {
            return res.status(403).json({
                success: false,
                error: 'La conciliación bancaria solo está disponible en Modo Completo de facturación.',
                billing_mode: billingMode
            });
        }

        req.billingMode = billingMode;
        next();
    } catch (error) {
        console.error('requireFullBillingMode error:', error);
        res.status(500).json({ success: false, error: 'Error al verificar modo de facturación' });
    }
}

module.exports = requireFullBillingMode;
