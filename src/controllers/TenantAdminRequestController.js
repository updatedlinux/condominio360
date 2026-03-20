const RequestTypeModel = require('../models/RequestTypeModel');
const TenantMoveConfigModel = require('../models/TenantMoveConfigModel');
const EmailService = require('../services/EmailService');
const { sql, connectDB } = require('../config/database');

function formatRequestForApi(req) {
    if (!req) return req;
    const r = { ...req };
    ['created_at', 'updated_at'].forEach(field => {
        if (r[field] instanceof Date) {
            const iso = r[field].toISOString();
            r[field] = iso.slice(0, 19) + '-04:00';
        }
    });
    return r;
}

/**
 * Tenant Admin Request Controller
 * Gestión de tipos de solicitud y configuración de mudanzas
 * Solo accesible por admins de junta
 */
class TenantAdminRequestController {

    // ==================== TIPOS DE SOLICITUD ====================

    /**
     * GET /api/tenant-admin/request-types
     * Listar tipos de solicitud del tenant
     */
    static async getRequestTypes(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const types = await RequestTypeModel.getByTenant(tenantId);

            res.json({
                success: true,
                data: types
            });
        } catch (error) {
            console.error('Get request types error:', error);
            res.status(500).json({ error: 'Error al obtener tipos de solicitud' });
        }
    }

    /**
     * GET /api/tenant-admin/request-types/:id
     * Obtener detalle de un tipo de solicitud
     */
    static async getRequestTypeById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const type = await RequestTypeModel.findById(id, tenantId);

            if (!type) {
                return res.status(404).json({ error: 'Tipo de solicitud no encontrado' });
            }

            res.json({
                success: true,
                data: type
            });
        } catch (error) {
            console.error('Get request type error:', error);
            res.status(500).json({ error: 'Error al obtener tipo de solicitud' });
        }
    }

    /**
     * POST /api/tenant-admin/request-types
     * Crear nuevo tipo de solicitud
     */
    static async createRequestType(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const {
                name,
                description,
                form_schema,
                icon,
                color,
                requires_approval,
                auto_assign_to,
                is_move_type,
                move_type,
                move_config,
                requires_insurance,
                requires_moving_company
            } = req.body;

            // Validaciones básicas
            if (!name) {
                return res.status(400).json({ error: 'El nombre es requerido' });
            }

            // Validar estructura del form_schema si se proporciona
            if (form_schema) {
                // Validación estructural: verificar que los campos tengan el formato correcto
                if (form_schema.fields && !Array.isArray(form_schema.fields)) {
                    return res.status(400).json({ 
                        error: 'El formulario debe tener un array de campos'
                    });
                }
                // Validar que cada campo tenga las propiedades necesarias
                if (form_schema.fields) {
                    for (const field of form_schema.fields) {
                        if (!field.name || !field.type || !field.label) {
                            return res.status(400).json({ 
                                error: 'Todos los campos deben tener nombre, tipo y etiqueta'
                            });
                        }
                    }
                }
            }

            // Preparar datos de mudanza
            let days_allowed = null;
            let time_range = null;
            let move_instructions = null;
            
            if (is_move_type && move_config) {
                days_allowed = JSON.stringify(move_config.allowed_days || []);
                time_range = `${move_config.start_time || '08:00'}-${move_config.end_time || '17:00'}`;
                move_instructions = move_config.instructions || null;
            }

            const type = await RequestTypeModel.create({
                tenant_id: tenantId,
                name,
                description,
                form_schema,
                icon: icon || 'fa-file-alt',
                color: color || '#6B7280',
                requires_approval: requires_approval || false,
                auto_assign_to,
                is_system: false,
                is_move_type: is_move_type || false,
                move_type,
                days_allowed,
                time_range,
                requires_insurance: requires_insurance || false,
                requires_moving_company: requires_moving_company || false,
                move_instructions
            });

            res.status(201).json({
                success: true,
                message: 'Tipo de solicitud creado exitosamente',
                data: type
            });
        } catch (error) {
            console.error('Create request type error:', error);
            res.status(500).json({ error: 'Error al crear tipo de solicitud' });
        }
    }

    /**
     * PUT /api/tenant-admin/request-types/:id
     * Actualizar tipo de solicitud
     */
    static async updateRequestType(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const updateData = req.body;

            // No permitir modificar campos protegidos
            delete updateData.is_system;
            delete updateData.tenant_id;

            // Transformar datos de mudanza
            if (updateData.is_move_type && updateData.move_config) {
                updateData.days_allowed = JSON.stringify(updateData.move_config.allowed_days || []);
                updateData.time_range = `${updateData.move_config.start_time || '08:00'}-${updateData.move_config.end_time || '17:00'}`;
                updateData.move_instructions = updateData.move_config.instructions || null;
                delete updateData.move_config;
            }

            const type = await RequestTypeModel.update(id, tenantId, updateData);

            if (!type) {
                return res.status(404).json({ 
                    error: 'Tipo de solicitud no encontrado o no puede ser modificado' 
                });
            }

            res.json({
                success: true,
                message: 'Tipo de solicitud actualizado',
                data: type
            });
        } catch (error) {
            console.error('Update request type error:', error);
            res.status(500).json({ error: 'Error al actualizar tipo de solicitud' });
        }
    }

    /**
     * DELETE /api/tenant-admin/request-types/:id
     * Eliminar tipo de solicitud (soft delete)
     */
    static async deleteRequestType(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const type = await RequestTypeModel.delete(id, tenantId);

            if (!type) {
                return res.status(404).json({ 
                    error: 'Tipo de solicitud no encontrado o no puede ser eliminado' 
                });
            }

            res.json({
                success: true,
                message: 'Tipo de solicitud eliminado'
            });
        } catch (error) {
            console.error('Delete request type error:', error);
            res.status(500).json({ error: 'Error al eliminar tipo de solicitud' });
        }
    }

    // ==================== CONFIGURACIÓN DE MUDANZAS ====================

    /**
     * GET /api/tenant-admin/move-config
     * Obtener configuración de mudanzas
     */
    static async getMoveConfig(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const config = await TenantMoveConfigModel.getByTenant(tenantId);

            if (!config) {
                // Devolver configuración por defecto
                return res.json({
                    success: true,
                    data: {
                        allowed_days: [6], // Sábados
                        start_time: '08:00',
                        end_time: '17:00',
                        min_notice_days: 7,
                        max_moves_per_day: 0,
                        require_insurance: false,
                        require_elevator_booking: false,
                        notify_security: true,
                        notify_admin: true,
                        additional_instructions: ''
                    }
                });
            }

            res.json({
                success: true,
                data: config
            });
        } catch (error) {
            console.error('Get move config error:', error);
            res.status(500).json({ error: 'Error al obtener configuración' });
        }
    }

    /**
     * PUT /api/tenant-admin/move-config
     * Actualizar configuración de mudanzas
     */
    static async updateMoveConfig(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const {
                allowed_days,
                start_time,
                end_time,
                min_notice_days,
                max_moves_per_day,
                require_insurance,
                require_elevator_booking,
                notify_security,
                notify_admin,
                additional_instructions
            } = req.body;

            // Validaciones
            if (allowed_days && (!Array.isArray(allowed_days) || allowed_days.length === 0)) {
                return res.status(400).json({ 
                    error: 'Debe seleccionar al menos un día permitido' 
                });
            }

            if (min_notice_days !== undefined && (min_notice_days < 1 || min_notice_days > 30)) {
                return res.status(400).json({ 
                    error: 'La antelación mínima debe estar entre 1 y 30 días' 
                });
            }

            const config = await TenantMoveConfigModel.createOrUpdate(
                tenantId,
                {
                    allowed_days,
                    start_time,
                    end_time,
                    min_notice_days,
                    max_moves_per_day,
                    require_insurance,
                    require_elevator_booking,
                    notify_security,
                    notify_admin,
                    additional_instructions
                },
                userId
            );

            res.json({
                success: true,
                message: 'Configuración de mudanzas actualizada',
                data: config
            });
        } catch (error) {
            console.error('Update move config error:', error);
            res.status(500).json({ error: 'Error al actualizar configuración' });
        }
    }

    /**
     * GET /api/tenant-admin/move-config/available-dates
     * Obtener fechas disponibles para mudanzas
     */
    static async getAvailableMoveDates(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const dates = await TenantMoveConfigModel.getAvailableDates(tenantId);

            res.json({
                success: true,
                data: dates
            });
        } catch (error) {
            console.error('Get available dates error:', error);
            res.status(500).json({ error: 'Error al obtener fechas disponibles' });
        }
    }

    // ==================== GESTIÓN DE SOLICITUDES ====================

    /**
     * GET /api/tenant-admin/requests/stats
     * Estadísticas de solicitudes
     */
    static async getStats(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const pool = await connectDB();

            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT 
                        COUNT(*) as total,
                        COUNT(CASE WHEN status = 'OPEN' THEN 1 END) as [open],
                        COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END) as in_progress,
                        COUNT(CASE WHEN status = 'RESOLVED' THEN 1 END) as resolved,
                        COUNT(CASE WHEN status = 'CLOSED' THEN 1 END) as closed
                    FROM Requests
                    WHERE tenant_id = @tenant_id
                `);

            res.json({
                success: true,
                data: result.recordset[0]
            });
        } catch (error) {
            console.error('Get request stats error:', error);
            res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
    }

    /**
     * GET /api/tenant-admin/requests
     * Listar todas las solicitudes del tenant (para admins)
     */
    static async getAllRequests(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { status, request_type_id, page = 1, limit = 20 } = req.query;

            const pool = await connectDB();
            
            let query = `
                SELECT r.*, rt.name as request_type_name, rt.icon, rt.color, rt.requires_approval,
                       p.name as property_name,
                       u.first_name + ' ' + u.last_name as owner_name,
                       u.email as owner_email
                FROM Requests r
                LEFT JOIN RequestTypes rt ON r.request_type_id = rt.id
                LEFT JOIN Properties p ON r.property_id = p.id
                LEFT JOIN Users u ON r.user_id = u.id
                WHERE r.tenant_id = @tenant_id
            `;

            if (status) {
                query += ` AND r.status = @status`;
            }

            if (request_type_id) {
                query += ` AND r.request_type_id = @request_type_id`;
            }

            query += ` ORDER BY r.created_at DESC
                       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('status', sql.NVarChar, status)
                .input('request_type_id', sql.UniqueIdentifier, request_type_id)
                .input('offset', sql.Int, (page - 1) * limit)
                .input('limit', sql.Int, parseInt(limit))
                .query(query);

            // Contar total
            const countQuery = `
                SELECT COUNT(*) as total FROM Requests 
                WHERE tenant_id = @tenant_id
                ${status ? 'AND status = @status' : ''}
                ${request_type_id ? 'AND request_type_id = @request_type_id' : ''}
            `;

            const countResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('status', sql.NVarChar, status)
                .input('request_type_id', sql.UniqueIdentifier, request_type_id)
                .query(countQuery);

            res.json({
                success: true,
                data: result.recordset.map(r => formatRequestForApi({
                    ...r,
                    data: r.data ? JSON.parse(r.data) : null
                })),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult.recordset[0].total,
                    totalPages: Math.ceil(countResult.recordset[0].total / limit)
                }
            });
        } catch (error) {
            console.error('Get all requests error:', error);
            res.status(500).json({ error: 'Error al obtener solicitudes' });
        }
    }

    /**
     * GET /api/tenant-admin/requests/:id
     * Ver detalle de solicitud
     */
    static async getRequestById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT r.*, rt.name as request_type_name, rt.form_schema, rt.requires_approval,
                           p.name as property_name, p.building, p.floor,
                           u.first_name + ' ' + u.last_name as owner_name,
                           u.email as owner_email, u.phone as owner_phone
                    FROM Requests r
                    LEFT JOIN RequestTypes rt ON r.request_type_id = rt.id
                    LEFT JOIN Properties p ON r.property_id = p.id
                    LEFT JOIN Users u ON r.user_id = u.id
                    WHERE r.id = @id AND r.tenant_id = @tenant_id
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Solicitud no encontrada' });
            }

            const request = result.recordset[0];
            request.data = request.data ? JSON.parse(request.data) : null;
            request.form_schema = request.form_schema ? JSON.parse(request.form_schema) : null;

            res.json({
                success: true,
                data: formatRequestForApi(request)
            });
        } catch (error) {
            console.error('Get request error:', error);
            res.status(500).json({ error: 'Error al obtener solicitud' });
        }
    }

    /**
     * PUT /api/tenant-admin/requests/:id/status
     * Cambiar estado de solicitud
     */
    static async updateRequestStatus(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const { status, resolution_notes } = req.body;

            const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'APPROVED', 'REJECTED'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ error: 'Estado inválido' });
            }

            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('status', sql.NVarChar, status)
                .input('resolution_notes', sql.NVarChar, resolution_notes)
                .query(`
                    UPDATE Requests 
                    SET status = @status, 
                        resolution_notes = COALESCE(@resolution_notes, resolution_notes),
                        updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenant_id
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Solicitud no encontrada' });
            }

            const request = result.recordset[0];
            
            // Obtener datos del propietario y tipo de solicitud para notificación
            const ownerResult = await pool.request()
                .input('userId', sql.UniqueIdentifier, request.user_id)
                .query('SELECT email, first_name FROM Users WHERE id = @userId');
            
            const requestTypeResult = await pool.request()
                .input('requestTypeId', sql.UniqueIdentifier, request.request_type_id)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query('SELECT name FROM RequestTypes WHERE id = @requestTypeId AND tenant_id = @tenantId');
            
            const ownerEmail = ownerResult.recordset[0]?.email;
            const ownerName = ownerResult.recordset[0]?.first_name || 'Propietario';
            const requestType = requestTypeResult.recordset[0] || { name: 'Solicitud' };
            
            // Enviar notificación al propietario (no bloqueante)
            if (ownerEmail) {
                EmailService.sendRequestStatusUpdate(request, requestType, ownerEmail, ownerName, resolution_notes)
                    .catch(err => console.error('Error enviando email de actualización:', err));
            }

            res.json({
                success: true,
                message: 'Estado actualizado',
                data: formatRequestForApi(result.recordset[0])
            });
        } catch (error) {
            console.error('Update request status error:', error);
            res.status(500).json({ error: 'Error al actualizar estado' });
        }
    }
}

module.exports = TenantAdminRequestController;
