const DeliveryAnnouncementModel = require('../models/DeliveryAnnouncementModel');
const AuditService = require('../services/AuditService');
const { sql, connectDB } = require('../config/database');

/**
 * Controller para gestión de Deliveries
 * Incluye funciones para propietarios y seguridad
 */
class DeliveryController {
    
    // ==================== PROPIETARIO ====================

    /**
     * POST /api/owner/deliveries
     * Crear anuncio de delivery (propietario)
     */
    static async create(req, res) {
        try {
            const userId = req.user.userId;
            const tenantId = req.user.tenantId;
            const propertyId = req.propertyId || req.body.propertyId;

            const { name, company, tracking_number, expected_date, notes } = req.body;

            // Validaciones
            if (!tenantId || !propertyId) {
                return res.status(400).json({ 
                    error: 'Se requiere tenantId y propertyId' 
                });
            }

            if (!name || !company || !expected_date) {
                return res.status(400).json({ 
                    error: 'Nombre, empresa y fecha esperada son requeridos' 
                });
            }

            // Validar formato de fecha
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(expected_date)) {
                return res.status(400).json({ 
                    error: 'Formato de fecha inválido. Use AAAA-MM-DD' 
                });
            }

            const delivery = await DeliveryAnnouncementModel.create({
                tenant_id: tenantId,
                property_id: propertyId,
                user_id: userId,
                name,
                company,
                tracking_number,
                expected_date,
                notes
            });

            await AuditService.log({
                tenantId,
                actorId: userId,
                action: 'DELIVERY_ANNOUNCED',
                entityType: 'DELIVERY',
                entityId: delivery.id,
                metadata: { name, company, expected_date }
            });

            res.status(201).json({
                success: true,
                delivery
            });

        } catch (error) {
            console.error('Create delivery error:', error);
            res.status(500).json({ error: 'Error al crear anuncio de delivery' });
        }
    }

    /**
     * GET /api/owner/deliveries
     * Listar deliveries del propietario
     */
    static async getByUser(req, res) {
        try {
            const userId = req.user.userId;
            const { status } = req.query;

            const deliveries = await DeliveryAnnouncementModel.getByUser(userId, {
                status,
                limit: 50
            });

            res.json({
                success: true,
                data: deliveries
            });

        } catch (error) {
            console.error('Get deliveries error:', error);
            res.status(500).json({ error: 'Error al obtener deliveries' });
        }
    }

    // ==================== SEGURIDAD ====================

    /**
     * GET /api/security/deliveries
     * Listar deliveries para seguridad
     */
    static async getForSecurity(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { status, date, search } = req.query;

            if (!tenantId) {
                return res.status(400).json({ error: 'Se requiere tenantId' });
            }

            const deliveries = await DeliveryAnnouncementModel.getByTenant(tenantId, {
                status: status || 'ANNOUNCED',
                date,
                search,
                limit: 100
            });

            res.json({
                success: true,
                data: deliveries
            });

        } catch (error) {
            console.error('Get security deliveries error:', error);
            res.status(500).json({ error: 'Error al obtener deliveries' });
        }
    }

    /**
     * GET /api/security/deliveries/search
     * Buscar deliveries por propietario
     */
    static async searchByOwner(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { q } = req.query;

            if (!tenantId) {
                return res.status(400).json({ error: 'Se requiere tenantId' });
            }

            if (!q || q.trim().length < 2) {
                return res.status(400).json({ 
                    error: 'Término de búsqueda debe tener al menos 2 caracteres' 
                });
            }

            const deliveries = await DeliveryAnnouncementModel.searchByOwner(
                tenantId, 
                q.trim()
            );

            res.json({
                success: true,
                data: deliveries
            });

        } catch (error) {
            console.error('Search deliveries error:', error);
            res.status(500).json({ error: 'Error al buscar deliveries' });
        }
    }

    /**
     * POST /api/security/deliveries/:id/arrive
     * Marcar delivery como llegado
     */
    static async markArrived(req, res) {
        try {
            const { id } = req.params;
            const securityUserId = req.user.userId;
            const tenantId = req.user.tenantId;
            if (!tenantId) {
                return res.status(400).json({ error: 'Contexto de tenant no disponible' });
            }

            const delivery = await DeliveryAnnouncementModel.markArrived(
                id, 
                securityUserId,
                tenantId
            );
            if (!delivery) {
                return res.status(404).json({ error: 'Delivery no encontrado' });
            }

            await AuditService.log({
                tenantId,
                actorId: securityUserId,
                action: 'DELIVERY_ARRIVED',
                entityType: 'DELIVERY',
                entityId: id,
                metadata: { 
                    delivery_name: delivery.name,
                    received_by: securityUserId 
                }
            });

            res.json({
                success: true,
                delivery
            });

        } catch (error) {
            console.error('Mark delivery arrived error:', error);
            res.status(500).json({ error: 'Error al marcar llegada' });
        }
    }

    /**
     * POST /api/security/deliveries/:id/deliver
     * Marcar delivery como entregado
     */
    static async markDelivered(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            if (!tenantId) {
                return res.status(400).json({ error: 'Contexto de tenant no disponible' });
            }

            const delivery = await DeliveryAnnouncementModel.markDelivered(id, tenantId);
            if (!delivery) {
                return res.status(404).json({ error: 'Delivery no encontrado' });
            }

            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'DELIVERY_DELIVERED',
                entityType: 'DELIVERY',
                entityId: id,
                metadata: { delivery_name: delivery.name }
            });

            res.json({
                success: true,
                delivery
            });

        } catch (error) {
            console.error('Mark delivery delivered error:', error);
            res.status(500).json({ error: 'Error al marcar entrega' });
        }
    }

    /**
     * POST /api/security/deliveries/manual
     * Crear delivery manualmente (para tercera edad que llama por teléfono)
     */
    static async createManual(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const securityUserId = req.user.userId;
            const { 
                owner_dni, 
                property_id: propertyIdParam,
                name, 
                company, 
                expected_date,
                notes 
            } = req.body;

            // Validaciones
            if (!owner_dni || !company || !expected_date) {
                return res.status(400).json({ 
                    error: 'Faltan campos requeridos: owner_dni, company, expected_date' 
                });
            }
            const ownerDniTrimmed = String(owner_dni).trim().replace(/\D/g, '');
            if (!/^\d{1,15}$/.test(ownerDniTrimmed)) {
                return res.status(400).json({ 
                    error: 'El DNI del propietario debe contener solo números (máx. 15 dígitos)' 
                });
            }

            const pool = await connectDB();

            // Buscar propietario por DNI (schema: PropertyOwners + Properties)
            const ownerResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('dni', sql.NVarChar, ownerDniTrimmed)
                .query(`
                    SELECT u.id, u.first_name, u.last_name, u.dni, u.email, u.phone,
                           p.id as property_id, p.name as property_name
                    FROM Users u
                    INNER JOIN PropertyOwners po ON u.id = po.user_id
                    INNER JOIN Properties p ON po.property_id = p.id
                    WHERE p.tenant_id = @tenantId
                    AND u.dni = @dni
                    ORDER BY po.is_primary_owner DESC
                `);

            if (ownerResult.recordset.length === 0) {
                return res.status(404).json({ 
                    error: 'No se encontró propietario con ese DNI' 
                });
            }

            let owner = ownerResult.recordset[0];
            const properties = ownerResult.recordset;
            if (propertyIdParam) {
                const matched = properties.find(p => String(p.property_id) === String(propertyIdParam));
                if (!matched) {
                    return res.status(400).json({ error: 'El inmueble seleccionado no pertenece al propietario' });
                }
                owner = matched;
            } else if (properties.length > 1) {
                return res.status(400).json({ 
                    error: 'El propietario tiene varios inmuebles. Seleccione el inmueble correspondiente.' 
                });
            }

            // Crear delivery
            const DeliveryAnnouncementModel = require('../models/DeliveryAnnouncementModel');
            const delivery = await DeliveryAnnouncementModel.create({
                tenant_id: tenantId,
                property_id: owner.property_id,
                user_id: owner.id,
                name: name || company || 'Delivery',
                company,
                tracking_number: null,
                expected_date,
                notes: notes || `Creado manualmente por vigilante${notes ? ' - ' + notes : ''}`
            });

            // Registrar en auditoría
            await AuditService.log({
                tenantId,
                actorId: securityUserId,
                action: 'MANUAL_DELIVERY_CREATED',
                entityType: 'DELIVERY',
                entityId: delivery.id,
                metadata: { 
                    name,
                    company,
                    owner_dni,
                    created_by: 'security_guard'
                }
            });

            res.status(201).json({
                success: true,
                message: 'Delivery registrado exitosamente',
                data: {
                    delivery,
                    owner: {
                        name: `${owner.first_name} ${owner.last_name}`,
                        dni: owner.dni,
                        property: owner.property_name
                    }
                }
            });

        } catch (error) {
            console.error('Create manual delivery error:', error);
            res.status(500).json({ error: 'Error al registrar delivery manual' });
        }
    }
}

module.exports = DeliveryController;
