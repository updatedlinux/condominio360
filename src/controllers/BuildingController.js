const BuildingModel = require('../models/BuildingModel');
const PropertyModel = require('../models/PropertyModel');
const TenantModel = require('../models/TenantModel');
const AuditService = require('../services/AuditService');

/**
 * Controller para gestión de Edificios
 * Usado por SuperAdmin y TenantAdmin
 */
class BuildingController {
    
    // ==================== SUPERADMIN ENDPOINTS ====================

    /**
     * POST /api/admin/tenants/:tenantId/buildings
     * Crear edificio (SuperAdmin)
     */
    static async create(req, res) {
        try {
            const { tenantId } = req.params;
            const { name, code, floors, units_per_floor, address_suffix } = req.body;

            if (!name) {
                return res.status(400).json({ success: false, error: 'El nombre es requerido' });
            }

            const building = await BuildingModel.create({
                tenant_id: tenantId,
                name,
                code,
                floors,
                units_per_floor,
                address_suffix
            });

            // Actualizar tipo de building del tenant si es necesario
            const buildingCount = await BuildingModel.countByTenant(tenantId);
            if (buildingCount > 1) {
                await TenantModel.update(tenantId, { building_type: 'MULTIPLE' });
            }

            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'BUILDING_CREATED',
                entityType: 'BUILDING',
                entityId: building.id,
                metadata: { name, code }
            });

            res.status(201).json({ success: true, building });
        } catch (error) {
            console.error('Error creating building:', error);
            res.status(500).json({ success: false, error: 'Error al crear edificio/calle' });
        }
    }

    /**
     * GET /api/admin/tenants/:tenantId/buildings
     * Listar edificios (SuperAdmin)
     */
    static async list(req, res) {
        try {
            const { tenantId } = req.params;
            const buildings = await BuildingModel.findByTenant(tenantId, { onlyActive: false });
            
            res.json({ success: true, buildings });
        } catch (error) {
            console.error('Error listing buildings:', error);
            res.status(500).json({ success: false, error: 'Error al listar edificios/calles' });
        }
    }

    /**
     * PUT /api/admin/buildings/:id
     * Actualizar edificio (SuperAdmin)
     */
    static async update(req, res) {
        try {
            const { id } = req.params;
            const building = await BuildingModel.update(id, req.body);
            
            if (!building) {
                return res.status(404).json({ success: false, error: 'Edificio/calle no encontrado' });
            }

            await AuditService.log({
                tenantId: building.tenant_id,
                actorId: req.user.userId,
                action: 'BUILDING_UPDATED',
                entityType: 'BUILDING',
                entityId: id
            });

            res.json({ success: true, building });
        } catch (error) {
            console.error('Error updating building:', error);
            res.status(500).json({ success: false, error: 'Error al actualizar edificio/calle' });
        }
    }

    /**
     * DELETE /api/admin/buildings/:id
     * Eliminar edificio (SuperAdmin)
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;
            const building = await BuildingModel.findById(id);
            
            if (!building) {
                return res.status(404).json({ success: false, error: 'Edificio/calle no encontrado' });
            }

            await BuildingModel.delete(id);

            await AuditService.log({
                tenantId: building.tenant_id,
                actorId: req.user.userId,
                action: 'BUILDING_DELETED',
                entityType: 'BUILDING',
                entityId: id
            });

            res.json({ success: true, message: 'Edificio/calle eliminado' });
        } catch (error) {
            console.error('Error deleting building:', error);
            res.status(500).json({ success: false, error: 'Error al eliminar edificio/calle' });
        }
    }

    // ==================== TENANT ADMIN ENDPOINTS ====================

    /**
     * GET /api/tenant-admin/buildings
     * Listar edificios (TenantAdmin - solo lectura)
     */
    static async listForTenantAdmin(req, res) {
        try {
            const tenantId = req.user.tenantId;
            console.log('[BuildingController] listForTenantAdmin - tenantId:', tenantId);
            
            const buildings = await BuildingModel.findByTenant(tenantId);
            console.log('[BuildingController] Buildings found:', buildings.length);
            
            const isMultiBuilding = await BuildingModel.isMultiBuilding(tenantId);
            console.log('[BuildingController] isMultiBuilding:', isMultiBuilding);
            
            res.json({ 
                success: true, 
                buildings,
                isMultiBuilding,
                buildingType: isMultiBuilding ? 'MULTIPLE' : 'SINGLE'
            });
        } catch (error) {
            console.error('Error listing buildings:', error);
            res.status(500).json({ success: false, error: 'Error al listar edificios/calles' });
        }
    }

    /**
     * GET /api/tenant-admin/buildings/:id/properties
     * Obtener propiedades de un edificio
     */
    static async getProperties(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            
            // Verificar que el edificio pertenece al tenant
            const building = await BuildingModel.findById(id);
            if (!building || building.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Edificio/calle no encontrado' });
            }

            const properties = await PropertyModel.findByBuilding(id);
            
            res.json({ success: true, properties });
        } catch (error) {
            console.error('Error getting properties:', error);
            res.status(500).json({ success: false, error: 'Error al obtener propiedades' });
        }
    }
}

module.exports = BuildingController;
