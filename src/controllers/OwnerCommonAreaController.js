const CommonAreaModel = require('../models/CommonAreaModel');
const PropertyModel = require('../models/PropertyModel');
const AuditService = require('../services/AuditService');
const EmailService = require('../services/EmailService');
const { connectDB, sql } = require('../config/database');

/**
 * Controller para Reservas de Áreas Comunes - Panel Propietario
 */
class OwnerCommonAreaController {
    /**
     * Resolver tenantId del propietario (token o primera propiedad)
     */
    static async resolveTenantId(req) {
        if (req.user.tenantId) return req.user.tenantId;
        const properties = await PropertyModel.getByOwner(req.user.userId);
        if (properties.length === 0) return null;
        return properties[0].tenant_id;
    }

    /**
     * GET /api/owner/common-areas
     * Listar áreas comunes disponibles del conjunto
     */
    static async getAreas(req, res) {
        try {
            const tenantId = await OwnerCommonAreaController.resolveTenantId(req);
            if (!tenantId) {
                return res.status(400).json({ success: false, error: 'No se pudo determinar el conjunto residencial. Verifica que tengas una unidad asignada.' });
            }

            const areas = await CommonAreaModel.findAreasByTenant(tenantId, { onlyActive: true });
            res.json({ success: true, areas });
        } catch (error) {
            console.error('Error getting common areas:', error);
            res.status(500).json({ success: false, error: 'Error al obtener áreas comunes' });
        }
    }

    /**
     * GET /api/owner/common-areas/:id
     * Detalle de área común
     */
    static async getAreaDetail(req, res) {
        try {
            const { id } = req.params;
            const tenantId = await OwnerCommonAreaController.resolveTenantId(req);
            if (!tenantId) {
                return res.status(400).json({ success: false, error: 'No se pudo determinar el conjunto residencial.' });
            }

            const area = await CommonAreaModel.findAreaById(id);
            if (!area || area.tenant_id !== tenantId || !area.is_active) {
                return res.status(404).json({ success: false, error: 'Área no encontrada' });
            }

            res.json({ success: true, area });
        } catch (error) {
            console.error('Error getting area detail:', error);
            res.status(500).json({ success: false, error: 'Error al obtener detalle' });
        }
    }

    /**
     * GET /api/owner/common-areas/:id/slots
     * Obtener slots disponibles para una fecha
     */
    static async getAvailableSlots(req, res) {
        try {
            const { id } = req.params;
            const { date, durationHours } = req.query;
            const tenantId = await OwnerCommonAreaController.resolveTenantId(req);

            if (!tenantId) {
                return res.status(400).json({ success: false, error: 'No se pudo determinar el conjunto residencial.' });
            }
            if (!date) {
                return res.status(400).json({ success: false, error: 'Se requiere la fecha' });
            }

            const area = await CommonAreaModel.findAreaById(id);
            if (!area || area.tenant_id !== tenantId || !area.is_active) {
                return res.status(404).json({ success: false, error: 'Área no encontrada' });
            }

            const dur = parseInt(durationHours) || area.max_duration_hours || 1;
            const [slots, existingReservations] = await Promise.all([
                CommonAreaModel.getAvailableSlots(id, date, dur),
                CommonAreaModel.getReservationsForAreaDate(id, date)
            ]);
            res.json({ success: true, slots, existingReservations });
        } catch (error) {
            console.error('Error getting slots:', error);
            res.status(500).json({ success: false, error: 'Error al obtener horarios disponibles' });
        }
    }

    /**
     * POST /api/owner/common-areas/reservations
     * Crear reserva
     */
    static async createReservation(req, res) {
        try {
            const { commonAreaId, reservationDate, startTime, endTime, numGuests, notes } = req.body;
            const userId = req.user.userId;
            const tenantId = await OwnerCommonAreaController.resolveTenantId(req);
            const propertyId = req.user.propertyId;

            if (!tenantId) {
                return res.status(400).json({ success: false, error: 'No se pudo determinar el conjunto residencial.' });
            }
            if (!propertyId) {
                return res.status(400).json({ success: false, error: 'Debes tener una unidad seleccionada para reservar. Si tienes varias unidades, selecciona una al iniciar sesión.' });
            }
            if (!commonAreaId || !reservationDate || !startTime || !endTime) {
                return res.status(400).json({ success: false, error: 'Faltan datos requeridos: área, fecha, hora inicio y fin.' });
            }

            // Verificar que la propiedad del token pertenece al tenant
            const properties = await PropertyModel.getByOwner(userId);
            const property = properties.find(p => p.id === propertyId);
            if (!property || property.tenant_id !== tenantId) {
                return res.status(403).json({ success: false, error: 'La unidad con la que iniciaste sesión no pertenece a este conjunto.' });
            }

            const area = await CommonAreaModel.findAreaById(commonAreaId);
            if (!area || area.tenant_id !== tenantId || !area.is_active) {
                return res.status(404).json({ success: false, error: 'Área no encontrada' });
            }

            const isAvailable = await CommonAreaModel.checkAvailability(commonAreaId, reservationDate, startTime, endTime);
            if (!isAvailable) {
                return res.status(409).json({ success: false, error: 'El horario seleccionado ya no está disponible. Por favor elige otro.' });
            }

            const reservation = await CommonAreaModel.createReservation({
                tenantId,
                commonAreaId,
                propertyId,
                userId,
                reservationDate,
                startTime,
                endTime,
                numGuests: numGuests || 1,
                notes
            });

            await AuditService.log({
                tenantId,
                actorId: userId,
                action: 'RESERVATION_CREATED',
                entityType: 'RESERVATION',
                entityId: reservation.id,
                metadata: { areaName: area.name, reservationDate, startTime, endTime }
            });

            try {
                const pool = await connectDB();
                const userResult = await pool.request()
                    .input('userId', sql.UniqueIdentifier, userId)
                    .query('SELECT email, first_name, last_name FROM Users WHERE id = @userId');
                const owner = userResult.recordset[0];
                if (owner?.email) {
                    const ownerName = (owner.first_name || '') + ' ' + (owner.last_name || '');
                    await EmailService.sendReservationReceivedNotification(
                        reservation,
                        owner.email,
                        ownerName.trim() || 'Propietario',
                        area.name,
                        !!area.requires_approval
                    );
                }
            } catch (emailErr) {
                console.error('Error sending reservation email:', emailErr);
            }

            res.status(201).json({
                success: true,
                message: area.requires_approval
                    ? 'Reserva enviada. La junta de condominio la revisará y te notificará.'
                    : 'Reserva confirmada.',
                reservation
            });
        } catch (error) {
            console.error('Error creating reservation:', error);
            res.status(500).json({ success: false, error: 'Error al crear reserva' });
        }
    }

    /**
     * GET /api/owner/common-areas/reservations
     * Mis reservas
     */
    static async getMyReservations(req, res) {
        try {
            const userId = req.user.userId;
            const { upcoming } = req.query;

            const reservations = await CommonAreaModel.findReservationsByUser(userId, {
                upcoming: upcoming === 'true' || !upcoming,
                page: parseInt(req.query.page) || 1,
                limit: parseInt(req.query.limit) || 20
            });

            res.json({ success: true, reservations });
        } catch (error) {
            console.error('Error getting reservations:', error);
            res.status(500).json({ success: false, error: 'Error al obtener reservas' });
        }
    }

    /**
     * POST /api/owner/common-areas/reservations/:id/cancel
     * Cancelar reserva (solo PENDING o CONFIRMED)
     */
    static async cancelReservation(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.userId;

            const reservation = await CommonAreaModel.findReservationById(id);
            if (!reservation) {
                return res.status(404).json({ success: false, error: 'Reserva no encontrada' });
            }
            if (reservation.user_id !== userId) {
                return res.status(403).json({ success: false, error: 'No puedes cancelar esta reserva' });
            }
            if (!['PENDING', 'CONFIRMED'].includes(reservation.status)) {
                return res.status(400).json({ success: false, error: 'Esta reserva no puede cancelarse' });
            }

            await CommonAreaModel.cancelReservation(id, userId);

            res.json({
                success: true,
                message: 'Reserva cancelada'
            });
        } catch (error) {
            console.error('Error cancelling reservation:', error);
            res.status(500).json({ success: false, error: 'Error al cancelar' });
        }
    }
}

module.exports = OwnerCommonAreaController;
