const ExcelJS = require('exceljs');
const PropertyModel = require('../models/PropertyModel');
const BuildingModel = require('../models/BuildingModel');
const UserModel = require('../models/UserModel');
const TenantModel = require('../models/TenantModel');
const AuditService = require('../services/AuditService');
const { normalizePropertyTypeOrDefault } = require('../utils/propertyType');

/**
 * Controller para gestión de Propiedades/Inmuebles
 */
class PropertyController {

    // ==================== SUPERADMIN ENDPOINTS ====================

    /**
     * POST /api/admin/tenants/:tenantId/properties
     * Crear propiedad (SuperAdmin)
     */
    static async create(req, res) {
        try {
            const { tenantId } = req.params;
            const { name, type, building_id, floor, area_sqm, alicuota, owner_id } = req.body;

            if (!name) {
                return res.status(400).json({ success: false, error: 'El nombre es requerido' });
            }

            // Si se especifica building_id, verificar que pertenece al tenant
            if (building_id) {
                const building = await BuildingModel.findById(building_id);
                if (!building || building.tenant_id !== tenantId) {
                    return res.status(400).json({ success: false, error: 'Edificio/calle no válido' });
                }
            }

            const property = await PropertyModel.create({
                tenant_id: tenantId,
                name,
                type: normalizePropertyTypeOrDefault(type),
                building_id,
                floor,
                area_sqm,
                alicuota
            });

            // Si se especifica owner_id, asociar propietario
            if (owner_id) {
                await PropertyModel.addOwner(property.id, owner_id, {
                    is_primary_owner: true,
                    percentage_ownership: 100
                });
            }

            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'PROPERTY_CREATED',
                entityType: 'PROPERTY',
                entityId: property.id,
                metadata: { name, building_id }
            });

            res.status(201).json({ success: true, property });
        } catch (error) {
            console.error('Error creating property:', error);
            res.status(500).json({ success: false, error: 'Error al crear propiedad' });
        }
    }

    /**
     * POST /api/admin/tenants/:tenantId/properties/bulk
     * Crear múltiples propiedades (SuperAdmin)
     */
    static async createBulk(req, res) {
        try {
            const { tenantId } = req.params;
            const { properties, building_id } = req.body;

            if (!Array.isArray(properties) || properties.length === 0) {
                return res.status(400).json({ success: false, error: 'Se requiere un array de propiedades' });
            }

            // Verificar edificio si se especifica
            if (building_id) {
                const building = await BuildingModel.findById(building_id);
                if (!building || building.tenant_id !== tenantId) {
                    return res.status(400).json({ success: false, error: 'Edificio/calle no válido' });
                }
            }

            const propsToCreate = properties.map(p => ({
                tenant_id: tenantId,
                name: p.name,
                type: normalizePropertyTypeOrDefault(p.type),
                building_id: p.building_id || building_id,
                floor: p.floor,
                area_sqm: p.area_sqm,
                alicuota: p.alicuota
            }));

            const created = await PropertyModel.createMany(propsToCreate);

            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'PROPERTIES_CREATED_BULK',
                entityType: 'PROPERTY',
                metadata: { count: created.length }
            });

            res.status(201).json({ success: true, properties: created });
        } catch (error) {
            console.error('Error creating properties:', error);
            res.status(500).json({ success: false, error: 'Error al crear propiedades' });
        }
    }

    /**
     * GET /api/admin/tenants/:tenantId/properties
     * Listar propiedades (SuperAdmin)
     */
    static async list(req, res) {
        try {
            const { tenantId } = req.params;
            const { building_id, page, limit } = req.query;

            const result = await PropertyModel.findByTenant(tenantId, {
                building_id,
                page: parseInt(page) || 1,
                limit: parseInt(limit) || 50
            });

            res.json({ success: true, ...result });
        } catch (error) {
            console.error('Error listing properties:', error);
            res.status(500).json({ success: false, error: 'Error al listar propiedades' });
        }
    }

    /**
     * GET /api/admin/properties/:id
     * Obtener propiedad con detalle (SuperAdmin)
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const property = await PropertyModel.getWithOwners(id);

            if (!property) {
                return res.status(404).json({ success: false, error: 'Propiedad no encontrada' });
            }

            res.json({ success: true, property });
        } catch (error) {
            console.error('Error getting property:', error);
            res.status(500).json({ success: false, error: 'Error al obtener propiedad' });
        }
    }

    /**
     * PUT /api/admin/properties/:id
     * Actualizar propiedad (SuperAdmin)
     */
    static async update(req, res) {
        try {
            const { id } = req.params;
            const updateData = { ...req.body };
            if (updateData.type !== undefined) {
                updateData.type = normalizePropertyTypeOrDefault(updateData.type);
            }
            const property = await PropertyModel.update(id, updateData);

            if (!property) {
                return res.status(404).json({ success: false, error: 'Propiedad no encontrada' });
            }

            await AuditService.log({
                tenantId: property.tenant_id,
                actorId: req.user.userId,
                action: 'PROPERTY_UPDATED',
                entityType: 'PROPERTY',
                entityId: id
            });

            res.json({ success: true, property });
        } catch (error) {
            console.error('Error updating property:', error);
            res.status(500).json({ success: false, error: 'Error al actualizar propiedad' });
        }
    }

    /**
     * DELETE /api/admin/properties/:id
     * Eliminar propiedad (SuperAdmin)
     */
    static async delete(req, res) {
        try {
            const { id } = req.params;
            const property = await PropertyModel.findById(id);

            if (!property) {
                return res.status(404).json({ success: false, error: 'Propiedad no encontrada' });
            }

            await PropertyModel.delete(id);

            await AuditService.log({
                tenantId: property.tenant_id,
                actorId: req.user.userId,
                action: 'PROPERTY_DELETED',
                entityType: 'PROPERTY',
                entityId: id
            });

            res.json({ success: true, message: 'Propiedad eliminada' });
        } catch (error) {
            console.error('Error deleting property:', error);
            res.status(500).json({ success: false, error: 'Error al eliminar propiedad' });
        }
    }

    /**
     * POST /api/admin/properties/:id/owners
     * Asociar propietario (SuperAdmin)
     */
    static async addOwner(req, res) {
        try {
            const { id } = req.params;
            const { user_id, is_primary_owner, percentage_ownership, tenant_id } = req.body;

            if (!user_id) {
                return res.status(400).json({ success: false, error: 'El usuario es requerido' });
            }

            const property = await PropertyModel.findById(id);
            if (!property) {
                return res.status(404).json({ success: false, error: 'Propiedad no encontrada' });
            }
            if (tenant_id && property.tenant_id !== tenant_id) {
                return res.status(403).json({ success: false, error: 'La propiedad no pertenece al tenant indicado' });
            }

            const link = await PropertyModel.addOwner(id, user_id, {
                is_primary_owner,
                percentage_ownership
            });

            await AuditService.log({
                tenantId: req.body.tenant_id,
                actorId: req.user.userId,
                action: 'OWNER_ADDED',
                entityType: 'PROPERTY',
                entityId: id,
                metadata: { user_id }
            });

            res.status(201).json({ success: true, link });
        } catch (error) {
            console.error('Error adding owner:', error);
            res.status(500).json({ success: false, error: 'Error al asociar propietario' });
        }
    }

    // ==================== TENANT ADMIN ENDPOINTS ====================

    /**
     * GET /api/tenant-admin/properties
     * Listar propiedades (TenantAdmin - solo lectura)
     */
    static async listForTenantAdmin(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { building_id, page, limit, search } = req.query;

            let properties;
            if (search) {
                properties = await PropertyModel.search(tenantId, search);
                const withOwners = properties.filter((p) => (p.owner_count || 0) > 0).length;
                const apartments = properties.filter(
                    (p) => String(p.type || '').toLowerCase().trim() === 'apartment'
                ).length;
                res.json({
                    success: true,
                    properties,
                    pagination: { total: properties.length },
                    stats: {
                        total: properties.length,
                        with_owners: withOwners,
                        without_owners: properties.length - withOwners,
                        apartments
                    }
                });
            } else {
                const result = await PropertyModel.findByTenant(tenantId, {
                    building_id,
                    page: parseInt(page) || 1,
                    limit: parseInt(limit) || 50
                });
                const stats = await PropertyModel.getStatsForTenant(tenantId, building_id || null);
                res.json({ success: true, ...result, stats });
            }
        } catch (error) {
            console.error('Error listing properties:', error);
            res.status(500).json({ success: false, error: 'Error al listar propiedades' });
        }
    }

    /**
     * GET /api/tenant-admin/properties/export
     * Excel: todos los inmuebles del tenant con detalle
     */
    static async exportForTenantAdmin(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const tenant = await TenantModel.findById(tenantId);
            const rows = await PropertyModel.findAllForExport(tenantId);
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Condominio360';
            const sheet = workbook.addWorksheet('Inmuebles');
            sheet.columns = [
                { header: 'Unidad', key: 'name', width: 22 },
                { header: 'Slug', key: 'slug', width: 18 },
                { header: 'Tipo', key: 'type', width: 14 },
                { header: 'Edificio/Calle', key: 'edificio', width: 22 },
                { header: 'Código edificio/calle', key: 'edificio_codigo', width: 14 },
                { header: 'Piso', key: 'piso', width: 10 },
                { header: 'Área (m²)', key: 'area_m2', width: 12 },
                { header: 'Alícuota (%)', key: 'alicuota', width: 12 },
                { header: 'Nickname', key: 'nickname', width: 14 },
                { header: 'Nickname activo', key: 'nickname_activo', width: 14 },
                { header: 'Nº propietarios', key: 'num_propietarios', width: 14 },
                { header: 'Propietarios (detalle)', key: 'propietarios_detalle', width: 60 },
                { header: 'Creado', key: 'created_at', width: 20 },
                { header: 'Actualizado', key: 'updated_at', width: 20 },
                { header: 'ID inmueble', key: 'id', width: 38 }
            ];
            sheet.getRow(1).font = { bold: true };
            rows.forEach((r) => {
                sheet.addRow({
                    name: r.name,
                    slug: r.slug || '',
                    type: r.type,
                    edificio: r.edificio || '',
                    edificio_codigo: r.edificio_codigo || '',
                    piso: r.piso || '',
                    area_m2: r.area_m2 != null ? parseFloat(r.area_m2) : '',
                    alicuota: r.alicuota != null ? parseFloat(r.alicuota) : '',
                    nickname: r.nickname || '',
                    nickname_activo: r.nickname_activo || '',
                    num_propietarios: r.num_propietarios,
                    propietarios_detalle: r.propietarios_detalle || '',
                    created_at: r.created_at ? new Date(r.created_at) : '',
                    updated_at: r.updated_at ? new Date(r.updated_at) : '',
                    id: r.id
                });
            });
            const safeName = (tenant?.name || 'condominio').replace(/[^\w\s-]/g, '').slice(0, 40);
            const filename = `inmuebles-${safeName}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            await workbook.xlsx.write(res);
        } catch (error) {
            console.error('Export properties (tenant admin) error:', error);
            res.status(500).json({ success: false, error: 'Error al exportar inmuebles' });
        }
    }

    /**
     * GET /api/tenant-admin/properties/:id
     * Ver detalle de propiedad (TenantAdmin - solo lectura)
     */
    static async getForTenantAdmin(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const property = await PropertyModel.getWithOwners(id);

            if (!property || property.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Propiedad no encontrada' });
            }

            res.json({ success: true, property });
        } catch (error) {
            console.error('Error getting property:', error);
            res.status(500).json({ success: false, error: 'Error al obtener propiedad' });
        }
    }

    /**
     * GET /api/tenant-admin/properties/:id/owners
     * Obtener propietarios de una propiedad específica
     */
    static async getPropertyOwners(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            // Verificar que la propiedad pertenece al tenant
            const property = await PropertyModel.findById(id);
            if (!property || property.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Propiedad no encontrada' });
            }

            // Obtener propietarios
            const { connectDB, sql } = require('../config/database');
            const pool = await connectDB();
            
            const result = await pool.request()
                .input('property_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT 
                        u.id, u.first_name, u.last_name, u.email, u.phone, u.dni,
                        po.percentage_ownership, po.is_primary_owner
                    FROM Users u
                    INNER JOIN PropertyOwners po ON u.id = po.user_id
                    WHERE po.property_id = @property_id
                    ORDER BY po.is_primary_owner DESC, u.last_name
                `);

            res.json({ 
                success: true, 
                owners: result.recordset,
                count: result.recordset.length
            });
        } catch (error) {
            console.error('Error getting property owners:', error);
            res.status(500).json({ success: false, error: 'Error al obtener propietarios' });
        }
    }

    // ==================== OWNER ENDPOINTS ====================

    /**
     * GET /api/properties/my-properties
     * Obtener propiedades del propietario logueado
     */
    static async getMyProperties(req, res) {
        try {
            const userId = req.user.userId;
            const properties = await PropertyModel.getByOwner(userId);
            res.json({ success: true, properties });
        } catch (error) {
            console.error('Error getting my properties:', error);
            res.status(500).json({ success: false, error: 'Error al obtener propiedades' });
        }
    }

    /**
     * GET /api/properties/:id (para propietarios)
     * Ver detalle de propiedad
     */
    static async show(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.userId;

            const property = await PropertyModel.getWithOwners(id);

            if (!property) {
                return res.status(404).json({ success: false, error: 'Propiedad no encontrada' });
            }

            // Verificar que el usuario es propietario de esta propiedad
            const isOwner = property.owners.some(o => o.user_id === userId);
            if (!isOwner) {
                return res.status(403).json({ success: false, error: 'No tienes acceso a esta propiedad' });
            }

            res.json({ success: true, property });
        } catch (error) {
            console.error('Error getting property:', error);
            res.status(500).json({ success: false, error: 'Error al obtener propiedad' });
        }
    }
}

module.exports = PropertyController;
