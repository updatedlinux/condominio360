const CommuniqueModel = require('../models/CommuniqueModel');
const WordProcessingService = require('../services/WordProcessingService');
const CommuniqueQueueService = require('../services/CommuniqueQueueService');
const { connectDB, sql } = require('../config/database');
const path = require('path');

/**
 * Controller para gestión de comunicados (Tenant Admin)
 */
class TenantAdminCommuniqueController {
    /**
     * GET /api/tenant-admin/communiques
     * Listar comunicados del tenant
     */
    static async getCommuniques(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;

            const result = await CommuniqueModel.getByTenant(tenantId, page, limit);

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
     * GET /api/tenant-admin/communiques/:id
     * Obtener comunicado por ID
     */
    static async getCommuniqueById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const communique = await CommuniqueModel.findById(id, tenantId);

            if (!communique) {
                return res.status(404).json({ error: 'Comunicado no encontrado' });
            }

            // Obtener estadísticas
            const stats = await CommuniqueModel.getStats(id);

            res.json({
                success: true,
                data: { ...communique, stats }
            });
        } catch (error) {
            console.error('Error getting communique:', error);
            res.status(500).json({ error: 'Error al obtener comunicado' });
        }
    }

    /**
     * POST /api/tenant-admin/communiques
     * Crear nuevo comunicado (subir Word)
     */
    static async createCommunique(req, res) {
        try {
            const { title, description } = req.body;
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;

            console.log('👤 Creando comunicado - UserId:', userId, 'TenantId:', tenantId);

            if (!req.file) {
                return res.status(400).json({ error: 'Se requiere un archivo (DOCX o PDF)' });
            }
            
            // Verificar que el usuario existe (fallback a datos del token si no está en BD)
            let authorName = req.user.firstName + ' ' + req.user.lastName;
            
            try {
                const { connectDB, sql } = require('../config/database');
                const pool = await connectDB();
                const userCheck = await pool.request()
                    .input('userId', sql.UniqueIdentifier, userId)
                    .query('SELECT id, first_name, last_name FROM Users WHERE id = @userId');
                
                if (userCheck.recordset.length > 0) {
                    authorName = userCheck.recordset[0].first_name + ' ' + userCheck.recordset[0].last_name;
                    console.log('✅ Usuario verificado en BD:', userCheck.recordset[0]);
                } else {
                    console.warn('⚠️ Usuario no encontrado en BD, usando datos del token:', userId);
                }
            } catch (dbError) {
                console.warn('⚠️ Error verificando usuario en BD:', dbError.message);
            }

            if (!title) {
                return res.status(400).json({ error: 'El título es requerido' });
            }

            const file = req.file;
            const ext = path.extname(file.originalname).toLowerCase();

            if (!['.docx', '.pdf'].includes(ext)) {
                return res.status(400).json({ error: 'Solo se permiten archivos DOCX o PDF' });
            }

            console.log('📤 Procesando comunicado:', {
                title,
                filename: file.originalname,
                size: file.size,
                type: ext
            });

            let htmlContent = null;
            let processingResult = null;

            // Procesar según tipo de archivo
            if (ext === '.docx') {
                try {
                    processingResult = await WordProcessingService.processDocx(file.path);
                    
                    htmlContent = WordProcessingService.generateFullHtml(
                        title,
                        description,
                        processingResult.html,
                        authorName
                    );

                    console.log('✅ DOCX procesado:', {
                        htmlLength: htmlContent.length,
                        imagesExtracted: processingResult.images?.length || 0
                    });
                } catch (processError) {
                    console.error('Error procesando DOCX:', processError);
                    return res.status(500).json({ 
                        error: 'Error al procesar archivo Word',
                        details: processError.message
                    });
                }
            } else {
                // PDF - solo guardar el archivo
                processingResult = await WordProcessingService.processPdf(file.path);
            }

            // Guardar en base de datos
            const communique = await CommuniqueModel.create({
                tenantId,
                createdBy: userId,
                title,
                description,
                originalFilename: file.originalname,
                fileType: ext.substring(1), // quitar el punto
                htmlContent,
                storagePath: file.path
            });

            console.log('✅ Comunicado guardado:', communique.id);

            // Obtener destinatarios (propietarios del tenant)
            const recipients = await TenantAdminCommuniqueController.getRecipients(tenantId);

            console.log(`📧 ${recipients.length} destinatarios encontrados`);

            // Agregar a la cola de envío
            if (recipients.length > 0) {
                const totalBatches = await CommuniqueQueueService.queueCommunique(
                    communique.id,
                    recipients
                );

                res.json({
                    success: true,
                    message: 'Comunicado creado y agregado a la cola de envío',
                    data: {
                        communique,
                        queue: {
                            totalRecipients: recipients.length,
                            totalBatches,
                            batchSize: 3,
                            intervalMinutes: 2
                        }
                    }
                });
            } else {
                res.json({
                    success: true,
                    message: 'Comunicado creado (sin destinatarios)',
                    data: { communique, queue: null }
                });
            }

        } catch (error) {
            console.error('Error creating communique:', error);
            
            // Limpiar archivo en caso de error
            if (req.file && req.file.path) {
                await WordProcessingService.cleanupFile(req.file.path);
            }
            
            res.status(500).json({ error: 'Error al crear comunicado' });
        }
    }

    /**
     * DELETE /api/tenant-admin/communiques/:id
     * Eliminar comunicado (soft delete)
     */
    static async deleteCommunique(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    UPDATE Communiques 
                    SET status = 'deleted', updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenantId
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Comunicado no encontrado' });
            }

            res.json({
                success: true,
                message: 'Comunicado eliminado'
            });
        } catch (error) {
            console.error('Error deleting communique:', error);
            res.status(500).json({ error: 'Error al eliminar comunicado' });
        }
    }

    /**
     * GET /api/tenant-admin/communiques/stats/overview
     * Obtener estadísticas generales del tenant
     */
    static async getTenantStats(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const stats = await CommuniqueModel.getTenantStats(tenantId);

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('Error getting tenant stats:', error);
            res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
    }

    /**
     * GET /api/tenant-admin/communiques/:id/stats
     * Obtener estadísticas de un comunicado
     */
    static async getStats(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const communique = await CommuniqueModel.findById(id, tenantId);
            if (!communique) {
                return res.status(404).json({ error: 'Comunicado no encontrado' });
            }

            const stats = await CommuniqueModel.getStats(id);
            const queueStatus = await CommuniqueQueueService.getQueueStatus();

            res.json({
                success: true,
                data: { ...stats, queueStatus }
            });
        } catch (error) {
            console.error('Error getting stats:', error);
            res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
    }

    /**
     * GET /api/tenant-admin/communiques/:id/content
     * Ver contenido HTML del comunicado
     */
    static async getContent(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const communique = await CommuniqueModel.findById(id, tenantId);

            if (!communique) {
                return res.status(404).json({ error: 'Comunicado no encontrado' });
            }

            // Si es PDF, retornar link de descarga
            if (communique.file_type === 'pdf') {
                return res.json({
                    success: true,
                    data: {
                        type: 'pdf',
                        title: communique.title,
                        downloadUrl: `/uploads/communiques/${path.basename(communique.storage_path)}`
                    }
                });
            }

            // Si es DOCX, retornar HTML
            res.json({
                success: true,
                data: {
                    type: 'html',
                    title: communique.title,
                    html: communique.html_content
                }
            });

        } catch (error) {
            console.error('Error getting content:', error);
            res.status(500).json({ error: 'Error al obtener contenido' });
        }
    }

    /**
     * Obtener destinatarios (propietarios) del tenant
     */
    static async getRecipients(tenantId) {
        try {
            const pool = await connectDB();
            
            // Obtener usuarios del tenant con propiedades (propietarios)
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT DISTINCT u.id, u.email, u.first_name, u.last_name
                    FROM Users u
                    INNER JOIN PropertyOwners po ON u.id = po.user_id
                    INNER JOIN Properties p ON po.property_id = p.id
                    WHERE p.tenant_id = @tenantId
                    AND u.email IS NOT NULL
                    AND u.email != ''
                `);

            return result.recordset;
        } catch (error) {
            console.error('Error getting recipients:', error);
            return [];
        }
    }
}

module.exports = TenantAdminCommuniqueController;
