const CommonAreaModel = require('../models/CommonAreaModel');
const TenantAdminModel = require('../models/TenantAdminModel');
const AuditService = require('../services/AuditService');
const EmailService = require('../services/EmailService');

/**
 * Controller para Áreas Comunes desde Tenant Admin
 */
class TenantAdminCommonAreaController {
    /**
     * GET /api/tenant-admin/common-areas
     * Listar áreas comunes
     */
    static async getAreas(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { includeInactive } = req.query;
            
            const areas = await CommonAreaModel.findAreasByTenant(tenantId, {
                onlyActive: includeInactive !== 'true'
            });
            
            res.json({ success: true, areas });
        } catch (error) {
            console.error('Error getting areas:', error);
            res.status(500).json({ success: false, error: 'Error al obtener áreas comunes' });
        }
    }

    /**
     * GET /api/tenant-admin/common-areas/:id
     * Detalle de área común
     */
    static async getAreaDetail(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            
            const area = await CommonAreaModel.findAreaById(id);
            if (!area || area.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Área no encontrada' });
            }
            
            res.json({ success: true, area });
        } catch (error) {
            console.error('Error getting area detail:', error);
            res.status(500).json({ success: false, error: 'Error al obtener detalle' });
        }
    }

    /**
     * POST /api/tenant-admin/common-areas
     * Crear área común
     */
    static async createArea(req, res) {
        try {
            const { name, description, type, capacity, minHoursAdvance, maxDaysAdvance,
                    minDurationHours, maxDurationHours, openingTime, closingTime,
                    requiresApproval, imageUrl, rules } = req.body;
            
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            
            if (!name) {
                return res.status(400).json({ success: false, error: 'El nombre es requerido' });
            }
            
            const area = await CommonAreaModel.createArea({
                tenantId,
                name,
                description,
                type: type || 'OTHER',
                capacity: capacity || 10,
                minHoursAdvance: minHoursAdvance || 24,
                maxDaysAdvance: maxDaysAdvance || 30,
                minDurationHours: minDurationHours || 1,
                maxDurationHours: maxDurationHours || 4,
                openingTime: openingTime || '08:00',
                closingTime: closingTime || '20:00',
                requiresApproval: requiresApproval || false,
                imageUrl,
                rules
            });
            
            await AuditService.log({
                tenantId,
                actorId: userId,
                action: 'COMMON_AREA_CREATED',
                entityType: 'COMMON_AREA',
                entityId: area.id,
                metadata: { name, type }
            });
            
            res.status(201).json({
                success: true,
                message: 'Área común creada',
                area
            });
        } catch (error) {
            console.error('Error creating area:', error);
            res.status(500).json({ success: false, error: 'Error al crear área' });
        }
    }

    /**
     * PUT /api/tenant-admin/common-areas/:id
     * Actualizar área común
     */
    static async updateArea(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            
            const existing = await CommonAreaModel.findAreaById(id);
            if (!existing || existing.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Área no encontrada' });
            }
            
            // Mapear camelCase del body a snake_case para el modelo
            const camelToSnake = {
                name: 'name', description: 'description', type: 'type', capacity: 'capacity',
                minHoursAdvance: 'min_hours_advance', maxDaysAdvance: 'max_days_advance',
                minDurationHours: 'min_duration_hours', maxDurationHours: 'max_duration_hours',
                openingTime: 'opening_time', closingTime: 'closing_time',
                requiresApproval: 'requires_approval', isActive: 'is_active',
                imageUrl: 'image_url', rules: 'rules'
            };
            const updateData = {};
            for (const [camel, snake] of Object.entries(camelToSnake)) {
                if (req.body[camel] !== undefined) updateData[snake] = req.body[camel];
            }
            
            const area = await CommonAreaModel.updateArea(id, updateData);
            
            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'COMMON_AREA_UPDATED',
                entityType: 'COMMON_AREA',
                entityId: id,
                metadata: { name: req.body.name }
            });
            
            res.json({
                success: true,
                message: 'Área común actualizada',
                area
            });
        } catch (error) {
            console.error('Error updating area:', error);
            res.status(500).json({ success: false, error: 'Error al actualizar' });
        }
    }

    /**
     * DELETE /api/tenant-admin/common-areas/:id
     * Eliminar área común (o marcar inactiva)
     */
    static async deleteArea(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            
            const existing = await CommonAreaModel.findAreaById(id);
            if (!existing || existing.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Área no encontrada' });
            }
            
            // Marcar como inactiva en lugar de eliminar
            await CommonAreaModel.updateArea(id, { is_active: false });
            
            await AuditService.log({
                tenantId,
                actorId: req.user.userId,
                action: 'COMMON_AREA_DEACTIVATED',
                entityType: 'COMMON_AREA',
                entityId: id
            });
            
            res.json({ success: true, message: 'Área común desactivada' });
        } catch (error) {
            console.error('Error deleting area:', error);
            res.status(500).json({ success: false, error: 'Error al eliminar' });
        }
    }

    // ==================== RESERVATIONS ====================

    /**
     * GET /api/tenant-admin/common-areas/reservations
     * Listar reservas
     */
    static async getReservations(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { status, areaId, date, page, limit } = req.query;
            
            const result = await CommonAreaModel.findReservationsByTenant(tenantId, {
                status,
                areaId,
                date,
                page: parseInt(page) || 1,
                limit: parseInt(limit) || 20
            });
            
            res.json({ success: true, ...result });
        } catch (error) {
            console.error('Error getting reservations:', error);
            res.status(500).json({ success: false, error: 'Error al obtener reservas' });
        }
    }

    /**
     * GET /api/tenant-admin/common-areas/reservations/today
     * Reservas de hoy
     */
    static async getTodayReservations(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const reservations = await CommonAreaModel.getTodayReservations(tenantId);
            
            res.json({ success: true, reservations });
        } catch (error) {
            console.error('Error getting today reservations:', error);
            res.status(500).json({ success: false, error: 'Error al obtener reservas' });
        }
    }

    /**
     * POST /api/tenant-admin/common-areas/reservations/:id/approve
     * Aprobar reserva
     */
    static async approveReservation(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const adminId = req.user.userId;
            let approverUserId = null;
            try {
                const admin = await TenantAdminModel.findById(adminId);
                if (admin?.user_id) approverUserId = admin.user_id;
            } catch (_) {}
            
            const reservation = await CommonAreaModel.findReservationById(id);
            if (!reservation || reservation.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Reserva no encontrada' });
            }
            
            if (reservation.status !== 'PENDING') {
                return res.status(400).json({ success: false, error: 'La reserva no está pendiente' });
            }
            
            const updated = await CommonAreaModel.updateReservationStatus(id, 'CONFIRMED', approverUserId);
            
            await AuditService.log({
                tenantId,
                actorId: adminId,
                action: 'RESERVATION_APPROVED',
                entityType: 'RESERVATION',
                entityId: id
            });

            try {
                if (reservation.user_email) {
                    await EmailService.sendReservationApprovedNotification(
                        reservation,
                        reservation.user_email,
                        reservation.user_name || 'Propietario',
                        reservation.area_name || 'Área Común'
                    );
                }
            } catch (emailErr) {
                console.error('Error sending approval email:', emailErr);
            }
            
            res.json({
                success: true,
                message: 'Reserva aprobada',
                reservation: updated
            });
        } catch (error) {
            console.error('Error approving reservation:', error);
            res.status(500).json({ success: false, error: 'Error al aprobar' });
        }
    }

    /**
     * POST /api/tenant-admin/common-areas/reservations/:id/reject
     * Rechazar reserva
     */
    static async rejectReservation(req, res) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const tenantId = req.user.tenantId;
            const adminId = req.user.userId;
            let approverUserId = null;
            try {
                const admin = await TenantAdminModel.findById(adminId);
                if (admin?.user_id) approverUserId = admin.user_id;
            } catch (_) {}
            
            const reservation = await CommonAreaModel.findReservationById(id);
            if (!reservation || reservation.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Reserva no encontrada' });
            }
            
            const updated = await CommonAreaModel.updateReservationStatus(id, 'REJECTED', approverUserId, reason);
            
            await AuditService.log({
                tenantId,
                actorId: adminId,
                action: 'RESERVATION_REJECTED',
                entityType: 'RESERVATION',
                entityId: id,
                metadata: { reason }
            });

            try {
                if (reservation.user_email) {
                    await EmailService.sendReservationRejectedNotification(
                        reservation,
                        reservation.user_email,
                        reservation.user_name || 'Propietario',
                        reservation.area_name || 'Área Común',
                        reason || null
                    );
                }
            } catch (emailErr) {
                console.error('Error sending rejection email:', emailErr);
            }
            
            res.json({
                success: true,
                message: 'Reserva rechazada',
                reservation: updated
            });
        } catch (error) {
            console.error('Error rejecting reservation:', error);
            res.status(500).json({ success: false, error: 'Error al rechazar' });
        }
    }

    /**
     * GET /api/tenant-admin/common-areas/stats
     * Estadísticas
     */
    static async getStats(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { connectDB, sql } = require('../config/database');
            const pool = await connectDB();
            
            const statsResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT 
                        (SELECT COUNT(*) FROM CommonAreas WHERE tenant_id = @tenant_id AND is_active = 1) as active_areas,
                        (SELECT COUNT(*) FROM CommonAreaReservations WHERE tenant_id = @tenant_id AND reservation_date >= CAST(GETDATE() AS DATE) AND status IN ('PENDING', 'CONFIRMED')) as upcoming_reservations,
                        (SELECT COUNT(*) FROM CommonAreaReservations WHERE tenant_id = @tenant_id AND status = 'PENDING') as pending_approvals,
                        (SELECT COUNT(*) FROM CommonAreaReservations WHERE tenant_id = @tenant_id AND reservation_date = CAST(GETDATE() AS DATE) AND status IN ('PENDING', 'CONFIRMED')) as today_reservations
                `);
            
            res.json({
                success: true,
                stats: statsResult.recordset[0]
            });
        } catch (error) {
            console.error('Error getting stats:', error);
            res.status(500).json({ success: false, error: 'Error al obtener estadísticas' });
        }
    }
}

module.exports = TenantAdminCommonAreaController;
