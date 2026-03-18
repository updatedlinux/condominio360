const CommuniqueModel = require('../models/CommuniqueModel');
const { connectDB, sql } = require('../config/database');
const path = require('path');

/**
 * Controller para propietarios ver comunicados
 */
class OwnerCommuniqueController {
    /**
     * GET /api/owner/communiques
     * Listar comunicados disponibles para el propietario
     */
    static async getCommuniques(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;

            const result = await CommuniqueModel.getForOwner(tenantId, userId, page, limit);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            console.error('Error getting communiques:', error);
            res.status(500).json({ error: 'Error al obtener comunicados' });
        }
    }

    /**
     * GET /api/owner/communiques/:id
     * Ver comunicado completo (sin marcar como leído automáticamente)
     */
    static async getCommuniqueById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;

            const communique = await CommuniqueModel.findById(id, tenantId);

            if (!communique) {
                return res.status(404).json({ error: 'Comunicado no encontrado' });
            }

            // Verificar si ya fue leído (para mostrar estado)
            const isRead = await CommuniqueModel.hasUserRead(id, userId);

            // Si es PDF, retornar info para descargar
            if (communique.file_type === 'pdf') {
                return res.json({
                    success: true,
                    data: {
                        id: communique.id,
                        title: communique.title,
                        description: communique.description,
                        author_name: communique.author_name,
                        created_at: communique.created_at,
                        file_type: 'pdf',
                        filename: path.basename(communique.storage_path),
                        is_read: isRead
                    }
                });
            }

            // Para DOCX, retornar el HTML
            res.json({
                success: true,
                data: {
                    id: communique.id,
                    title: communique.title,
                    description: communique.description,
                    author_name: communique.author_name,
                    created_at: communique.created_at,
                    file_type: 'docx',
                    html_content: communique.html_content,
                    is_read: isRead
                }
            });

        } catch (error) {
            console.error('Error getting communique:', error);
            res.status(500).json({ error: 'Error al obtener comunicado' });
        }
    }

    /**
     * POST /api/owner/communiques/:id/read
     * Marcar comunicado como leído
     */
    static async markAsRead(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const ipAddress = req.ip;
            const userAgent = req.headers['user-agent'];

            // Verificar que el comunicado existe y pertenece al tenant
            const communique = await CommuniqueModel.findById(id, tenantId);
            if (!communique) {
                return res.status(404).json({ error: 'Comunicado no encontrado' });
            }

            // Registrar lectura
            await CommuniqueModel.recordRead(id, userId, ipAddress, userAgent);

            res.json({
                success: true,
                message: 'Comunicado marcado como leído'
            });

        } catch (error) {
            console.error('Error marking as read:', error);
            res.status(500).json({ error: 'Error al marcar como leído' });
        }
    }

    /**
     * GET /api/owner/communiques/:id/read
     * Verificar si el usuario ha leído el comunicado
     */
    static async checkReadStatus(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.userId;

            const hasRead = await CommuniqueModel.hasUserRead(id, userId);

            res.json({
                success: true,
                data: { hasRead }
            });
        } catch (error) {
            console.error('Error checking read status:', error);
            res.status(500).json({ error: 'Error al verificar estado' });
        }
    }

    /**
     * GET /api/owner/communiques/unread/count
     * Obtener cantidad de comunicados no leídos
     */
    static async getUnreadCount(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;

            const pool = await connectDB();
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('userId', sql.UniqueIdentifier, userId)
                .query(`
                    SELECT COUNT(*) as unread_count
                    FROM Communiques c
                    LEFT JOIN CommuniqueReads r ON c.id = r.communique_id AND r.user_id = @userId
                    WHERE c.tenant_id = @tenantId 
                    AND c.status = 'active'
                    AND r.id IS NULL
                `);

            res.json({
                success: true,
                data: { unreadCount: result.recordset[0].unread_count }
            });
        } catch (error) {
            console.error('Error getting unread count:', error);
            res.status(500).json({ error: 'Error al obtener conteo' });
        }
    }
}

module.exports = OwnerCommuniqueController;
