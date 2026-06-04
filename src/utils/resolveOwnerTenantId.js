const PropertyModel = require('../models/PropertyModel');

/**
 * Resuelve tenant_id para propietario (JWT puede no traer tenantId hasta elegir inmueble).
 */
async function resolveOwnerTenantId(user, queryTenantId = null) {
    if (!user?.userId) return null;

    if (user.tenantId) {
        return user.tenantId;
    }

    if (user.propertyId) {
        const property = await PropertyModel.findById(user.propertyId);
        if (property?.tenant_id) {
            return property.tenant_id;
        }
    }

    if (queryTenantId) {
        const properties = await PropertyModel.getByOwner(user.userId);
        const allowed = properties.some(
            (p) => String(p.tenant_id).toLowerCase() === String(queryTenantId).toLowerCase()
        );
        if (allowed) {
            return queryTenantId;
        }
    }

    const properties = await PropertyModel.getByOwner(user.userId);
    if (properties.length === 1) {
        return properties[0].tenant_id;
    }

    return null;
}

module.exports = { resolveOwnerTenantId };
