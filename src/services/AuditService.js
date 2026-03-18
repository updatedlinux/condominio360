const AuditLogModel = require('../models/AuditLogModel');

/**
 * Servicio para registrar actividades de auditoría
 */
class AuditService {
    /**
     * Registrar una acción en el log de auditoría
     * @param {Object} data - Datos del log
     * @param {string} data.tenantId - ID del tenant
     * @param {string} data.actorId - ID del usuario que realiza la acción
     * @param {string} data.action - Tipo de acción (e.g., 'COMMUNICATION_CREATED')
     * @param {string} data.entityType - Tipo de entidad (e.g., 'COMMUNICATION')
     * @param {string} data.entityId - ID de la entidad afectada
     * @param {Object} data.metadata - Datos adicionales
     */
    static async log(data) {
        try {
            const { tenantId, actorId, action, entityType, entityId, metadata } = data;
            await AuditLogModel.create({
                tenant_id: tenantId,
                actor_id: actorId,
                action,
                entity_type: entityType,
                entity_id: entityId,
                new_values: metadata || null
            });
        } catch (error) {
            // Silently fail - don't break the main flow for audit errors
            console.error('Audit log error:', error.message);
        }
    }
}

module.exports = AuditService;
