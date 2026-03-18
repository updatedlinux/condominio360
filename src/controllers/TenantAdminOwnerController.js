const UserModel = require('../models/UserModel');
const PropertyModel = require('../models/PropertyModel');
const AuditService = require('../services/AuditService');

/**
 * Controller para gestión de Propietarios desde Tenant Admin
 * NOTA: TenantAdmin solo puede VER y EDITAR propietarios existentes
 * NO puede crear nuevos propietarios (eso lo hace el SuperAdmin en onboarding)
 */
class TenantAdminOwnerController {

    /**
     * GET /api/tenant-admin/owners
     * Listar propietarios del tenant
     */
    static async list(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { page, limit, search } = req.query;

            console.log(`[DEBUG] Listing owners for tenant: ${tenantId}, page: ${page}, search: ${search || 'none'}`);

            const result = await UserModel.findOwnersByTenant(tenantId, {
                page: parseInt(page) || 1,
                limit: parseInt(limit) || 50,
                search
            });

            console.log(`[DEBUG] Found ${result.owners.length} owners, total: ${result.pagination.total}`);

            res.json({ success: true, ...result });
        } catch (error) {
            console.error('Error listing owners:', error);
            res.status(500).json({ success: false, error: 'Error al listar propietarios' });
        }
    }

    /**
     * GET /api/tenant-admin/owners/:id
     * Obtener detalle de propietario
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const owner = await UserModel.getOwnerWithProperties(id, tenantId);

            if (!owner) {
                return res.status(404).json({ success: false, error: 'Propietario no encontrado' });
            }

            res.json({ success: true, owner });
        } catch (error) {
            console.error('Error getting owner:', error);
            res.status(500).json({ success: false, error: 'Error al obtener propietario' });
        }
    }

    /**
     * PUT /api/tenant-admin/owners/:id
     * DESHABILITADO: Solo el SuperAdmin puede editar datos de propietarios.
     * Un propietario puede pertenecer a varios condominios; los cambios se replicarían en todos.
     */
    static async update(req, res) {
        return res.status(403).json({
            success: false,
            error: 'Solo el SuperAdmin puede editar datos de propietarios. Un propietario puede pertenecer a varios condominios y los cambios afectarían a todos.'
        });
    }

    /**
     * GET /api/tenant-admin/owners/:id/properties
     * Obtener propiedades de un propietario
     */
    static async getProperties(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            // Verificar que el usuario es propietario en este tenant
            const check = await UserModel.getOwnerWithProperties(id, tenantId);
            if (!check) {
                return res.status(404).json({ success: false, error: 'Propietario no encontrado' });
            }

            // Solo propiedades de ESTE tenant (nunca mostrar inmuebles de otros conjuntos)
            const tenantProperties = await PropertyModel.getByOwnerInTenant(id, tenantId);

            res.json({ success: true, properties: tenantProperties });
        } catch (error) {
            console.error('Error getting owner properties:', error);
            res.status(500).json({ success: false, error: 'Error al obtener propiedades' });
        }
    }

    /**
     * PUT /api/tenant-admin/owners/:userId/properties/:propertyId
     * Actualizar relación propietario-propiedad
     * Permite cambiar: is_primary_owner, percentage_ownership
     */
    static async updatePropertyLink(req, res) {
        try {
            const { userId, propertyId } = req.params;
            const tenantId = req.user.tenantId;
            const { is_primary_owner, percentage_ownership } = req.body;

            // Verificar que la propiedad pertenece al tenant
            const property = await PropertyModel.findById(propertyId);
            if (!property || property.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Propiedad no encontrada' });
            }

            const updateData = {};
            if (is_primary_owner !== undefined) updateData.is_primary_owner = is_primary_owner;
            if (percentage_ownership !== undefined) updateData.percentage_ownership = percentage_ownership;

            const updated = await PropertyModel.updateOwner(propertyId, userId, updateData);

            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'OWNER_PROPERTY_UPDATED',
                entityType: 'PROPERTY_OWNER',
                entityId: propertyId,
                metadata: { user_id: userId, ...updateData }
            });

            res.json({ success: true, link: updated });
        } catch (error) {
            console.error('Error updating property link:', error);
            res.status(500).json({ success: false, error: 'Error al actualizar relación' });
        }
    }

    /**
     * POST /api/tenant-admin/owners/:id/password
     * DESHABILITADO: Solo el SuperAdmin puede establecer/restablecer contraseñas de propietarios.
     * Un propietario puede pertenecer a varios condominios y la contraseña afectaría su acceso a todos.
     */
    static async setPassword(req, res) {
        return res.status(403).json({
            success: false,
            error: 'Solo el SuperAdmin puede establecer contraseñas de propietarios. Un propietario puede pertenecer a varios condominios y la contraseña afectaría su acceso a todos.'
        });
    }
}

module.exports = TenantAdminOwnerController;
