const CommunicationModel = require('../models/CommunicationModel');
const AuditService = require('../services/AuditService');
const { connectDB, sql } = require('../config/database');

/**
 * Controller para Comunicados desde Tenant Admin
 */
class TenantAdminCommunicationController {
    /**
     * GET /api/tenant-admin/communications
     * Listar comunicados
     */
    static async getCommunications(req, res) {
        try {
            const { status, category, page = 1, limit = 20 } = req.query;
            const tenantId = req.user.tenantId;
            
            const result = await CommunicationModel.findByTenant(tenantId, {
                status,
                category,
                page: parseInt(page),
                limit: parseInt(limit)
            });
            
            res.json({ success: true, ...result });
        } catch (error) {
            console.error('Error getting communications:', error);
            res.status(500).json({ success: false, error: 'Error al obtener comunicados' });
        }
    }

    /**
     * GET /api/tenant-admin/communications/:id
     * Detalle de comunicado
     */
    static async getCommunicationDetail(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            
            const communication = await CommunicationModel.findById(id);
            if (!communication || communication.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Comunicado no encontrado' });
            }
            
            // Get recipients details
            const pool = await connectDB();
            const recipientsResult = await pool.request()
                .input('communication_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT cr.user_id, cr.read_at, cr.email_delivered, 
                           ISNULL(u.first_name + ' ' + ISNULL(u.last_name, ''), '') as display_name,
                           u.email
                    FROM CommunicationRecipients cr
                    JOIN Users u ON cr.user_id = u.id
                    ORDER BY u.first_name, u.last_name
                `);
            
            res.json({
                success: true,
                communication: {
                    ...communication,
                    recipients: recipientsResult.recordset
                }
            });
        } catch (error) {
            console.error('Error getting communication detail:', error);
            res.status(500).json({ success: false, error: 'Error al obtener detalle' });
        }
    }

    /**
     * POST /api/tenant-admin/communications
     * Crear comunicado
     */
    static async createCommunication(req, res) {
        try {
            const { title, content, category = 'GENERAL', priority = 'NORMAL', 
                    targetType = 'ALL', targetBuilding, targetPropertyId, 
                    sendEmail = false, publishNow = false } = req.body;
            
            const tenantId = req.user.tenantId;
            const createdBy = req.user.id;
            
            // Validaciones
            if (!title || !content) {
                return res.status(400).json({ success: false, error: 'Título y contenido son requeridos' });
            }
            
            // Crear
            const status = publishNow ? 'PUBLISHED' : 'DRAFT';
            const communication = await CommunicationModel.create({
                tenantId,
                createdBy,
                title,
                content,
                category,
                priority,
                targetType,
                targetBuilding,
                targetPropertyId,
                sendEmail,
                status
            });
            
            // Si se publica, crear recipients
            if (status === 'PUBLISHED') {
                await CommunicationModel.createRecipients(
                    communication.id, tenantId, targetType, targetBuilding, targetPropertyId
                );
                
                // Actualizar published_at
                const pool = await connectDB();
                await pool.request()
                    .input('id', sql.UniqueIdentifier, communication.id)
                    .query("UPDATE Communications SET published_at = SYSDATETIME() WHERE id = @id");
                communication.published_at = new Date();
            }
            
            await AuditService.log({
                tenantId,
                actorId: createdBy,
                action: 'COMMUNICATION_CREATED',
                entityType: 'COMMUNICATION',
                entityId: communication.id,
                metadata: { title, status, targetType }
            });
            
            res.status(201).json({
                success: true,
                message: publishNow ? 'Comunicado publicado' : 'Borrador guardado',
                communication
            });
        } catch (error) {
            console.error('Error creating communication:', error);
            res.status(500).json({ success: false, error: 'Error al crear comunicado' });
        }
    }

    /**
     * PUT /api/tenant-admin/communications/:id
     * Actualizar comunicado
     */
    static async updateCommunication(req, res) {
        try {
            const { id } = req.params;
            const { title, content, category, priority, targetType, 
                    targetBuilding, targetPropertyId, sendEmail } = req.body;
            
            const tenantId = req.user.tenantId;
            
            // Verificar existencia
            const existing = await CommunicationModel.findById(id);
            if (!existing || existing.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Comunicado no encontrado' });
            }
            
            // No permitir editar si ya está archivado
            if (existing.status === 'ARCHIVED') {
                return res.status(400).json({ success: false, error: 'No se puede editar un comunicado archivado' });
            }
            
            const communication = await CommunicationModel.update(id, {
                title,
                content,
                category,
                priority,
                targetType,
                targetBuilding,
                targetPropertyId,
                sendEmail
            });
            
            await AuditService.log({
                tenantId,
                actorId: req.user.id,
                action: 'COMMUNICATION_UPDATED',
                entityType: 'COMMUNICATION',
                entityId: id,
                metadata: { title }
            });
            
            res.json({
                success: true,
                message: 'Comunicado actualizado',
                communication
            });
        } catch (error) {
            console.error('Error updating communication:', error);
            res.status(500).json({ success: false, error: 'Error al actualizar' });
        }
    }

    /**
     * POST /api/tenant-admin/communications/:id/publish
     * Publicar comunicado (borrador -> publicado)
     */
    static async publishCommunication(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            
            const existing = await CommunicationModel.findById(id);
            if (!existing || existing.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Comunicado no encontrado' });
            }
            
            if (existing.status === 'PUBLISHED') {
                return res.status(400).json({ success: false, error: 'El comunicado ya está publicado' });
            }
            
            if (existing.status === 'ARCHIVED') {
                return res.status(400).json({ success: false, error: 'No se puede publicar un comunicado archivado' });
            }
            
            const communication = await CommunicationModel.update(id, { status: 'PUBLISHED' });
            
            // Crear recipients
            await CommunicationModel.createRecipients(
                id, tenantId, communication.target_type, communication.target_building, communication.target_property_id
            );
            
            // TODO: Enviar emails si send_email = 1
            
            await AuditService.log({
                tenantId,
                actorId: req.user.id,
                action: 'COMMUNICATION_PUBLISHED',
                entityType: 'COMMUNICATION',
                entityId: id
            });
            
            res.json({
                success: true,
                message: 'Comunicado publicado exitosamente',
                communication
            });
        } catch (error) {
            console.error('Error publishing communication:', error);
            res.status(500).json({ success: false, error: 'Error al publicar' });
        }
    }

    /**
     * POST /api/tenant-admin/communications/:id/archive
     * Archivar comunicado
     */
    static async archiveCommunication(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            
            const existing = await CommunicationModel.findById(id);
            if (!existing || existing.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Comunicado no encontrado' });
            }
            
            const communication = await CommunicationModel.update(id, { status: 'ARCHIVED' });
            
            await AuditService.log({
                tenantId,
                actorId: req.user.id,
                action: 'COMMUNICATION_ARCHIVED',
                entityType: 'COMMUNICATION',
                entityId: id
            });
            
            res.json({
                success: true,
                message: 'Comunicado archivado',
                communication
            });
        } catch (error) {
            console.error('Error archiving communication:', error);
            res.status(500).json({ success: false, error: 'Error al archivar' });
        }
    }

    /**
     * DELETE /api/tenant-admin/communications/:id
     * Eliminar comunicado
     */
    static async deleteCommunication(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            
            const existing = await CommunicationModel.findById(id);
            if (!existing || existing.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Comunicado no encontrado' });
            }
            
            await CommunicationModel.delete(id);
            
            await AuditService.log({
                tenantId,
                actorId: req.user.id,
                action: 'COMMUNICATION_DELETED',
                entityType: 'COMMUNICATION',
                entityId: id
            });
            
            res.json({ success: true, message: 'Comunicado eliminado' });
        } catch (error) {
            console.error('Error deleting communication:', error);
            res.status(500).json({ success: false, error: 'Error al eliminar' });
        }
    }

    /**
     * GET /api/tenant-admin/communications/stats
     * Estadísticas de comunicados
     */
    static async getStats(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const pool = await connectDB();
            
            const statsResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT 
                        COUNT(CASE WHEN status = 'DRAFT' THEN 1 END) as drafts,
                        COUNT(CASE WHEN status = 'PUBLISHED' THEN 1 END) as published,
                        COUNT(CASE WHEN status = 'ARCHIVED' THEN 1 END) as archived,
                        COUNT(*) as total
                    FROM Communications
                    WHERE tenant_id = @tenant_id
                `);
            
            const byCategoryResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT category, COUNT(*) as count
                    FROM Communications
                    WHERE tenant_id = @tenant_id AND status = 'PUBLISHED'
                    GROUP BY category
                `);
            
            res.json({
                success: true,
                stats: statsResult.recordset[0],
                byCategory: byCategoryResult.recordset
            });
        } catch (error) {
            console.error('Error getting stats:', error);
            res.status(500).json({ success: false, error: 'Error al obtener estadísticas' });
        }
    }
}

module.exports = TenantAdminCommunicationController;
