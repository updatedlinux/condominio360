const ConsultationModel = require('../models/ConsultationModel');
const ConsultationNotificationService = require('../services/ConsultationNotificationService');
const { sql, connectDB } = require('../config/database');

/**
 * TenantAdmin Consultation Controller
 * Gestión de consultas/votaciones por parte de la Junta de Condominio
 */
class TenantAdminConsultationController {

    /**
     * GET /api/tenant-admin/consultations
     * Listar todas las consultas del tenant
     */
    static async index(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { status = 'all' } = req.query;

            const pool = await connectDB();
            
            let query = `
                SELECT 
                    c.*,
                    COALESCE(
                        u.first_name + ' ' + u.last_name,
                        ta.first_name + ' ' + ta.last_name,
                        'Administrador'
                    ) as created_by_name,
                    (SELECT COUNT(DISTINCT property_id) FROM ConsultationVotes WHERE consultation_id = c.id) as total_votes
                FROM Consultations c
                LEFT JOIN Users u ON c.created_by = u.id
                LEFT JOIN TenantAdmins ta ON c.created_by = ta.id
                WHERE c.tenant_id = @tenant_id
            `;

            if (status !== 'all') {
                query += ` AND c.status = @status`;
            }

            query += ` ORDER BY c.created_at DESC`;

            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            if (status !== 'all') {
                request.input('status', sql.NVarChar, status.toUpperCase());
            }

            const result = await request.query(query);

            // Enrich with eligible properties count and questions
            console.log(`[DEBUG] index: Enriching ${result.recordset.length} consultations with questions`);
            const consultations = await Promise.all(result.recordset.map(async (c) => {
                c.eligible_properties = await ConsultationModel.getEligiblePropertiesCount(c.id, tenantId);
                // Load questions for this consultation
                const consultationDetails = await ConsultationModel.findById(c.id, tenantId);
                if (consultationDetails) {
                    c.questions = consultationDetails.questions || [];
                    console.log(`[DEBUG] index: Consultation ${c.id} has ${c.questions.length} questions`);
                } else {
                    console.log(`[DEBUG] index: Consultation ${c.id} - no details found`);
                    c.questions = [];
                }
                return c;
            }));

            res.json({
                success: true,
                data: consultations
            });
        } catch (error) {
            console.error('Get consultations error:', error);
            res.status(500).json({ error: 'Error al obtener consultas' });
        }
    }

    /**
     * GET /api/tenant-admin/consultations/:id
     * Obtener detalle de una consulta con resultados completos
     */
    static async show(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;

            const pool = await connectDB();

            // Info de la consulta
            const consultResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT c.*, 
                        COALESCE(
                            u.first_name + ' ' + u.last_name,
                            ta.first_name + ' ' + ta.last_name,
                            'Administrador'
                        ) as created_by_name
                    FROM Consultations c
                    LEFT JOIN Users u ON c.created_by = u.id
                    LEFT JOIN TenantAdmins ta ON c.created_by = ta.id
                    WHERE c.id = @id AND c.tenant_id = @tenant_id
                `);

            if (consultResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Consulta no encontrada' });
            }

            const consultation = consultResult.recordset[0];

            // Conteo de inmuebles elegibles
            consultation.eligible_properties = await ConsultationModel.getEligiblePropertiesCount(id, tenantId);

            // Preguntas y opciones
            const questionsResult = await pool.request()
                .input('consultation_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT * FROM ConsultationQuestions 
                    WHERE consultation_id = @consultation_id 
                    ORDER BY order_index
                `);

            const questions = questionsResult.recordset;

            // Opciones para cada pregunta
            for (const q of questions) {
                const optionsResult = await pool.request()
                    .input('question_id', sql.UniqueIdentifier, q.id)
                    .query(`
                        SELECT * FROM ConsultationOptions 
                        WHERE question_id = @question_id 
                        ORDER BY order_index
                    `);
                q.options = optionsResult.recordset;

                // Contar votos por opción
                const votesResult = await pool.request()
                    .input('question_id', sql.UniqueIdentifier, q.id)
                    .query(`
                        SELECT 
                            o.id as option_id,
                            o.text as option_text,
                            COUNT(v.id) as vote_count
                        FROM ConsultationOptions o
                        LEFT JOIN ConsultationVotes v ON v.option_id = o.id
                        WHERE o.question_id = @question_id
                        GROUP BY o.id, o.text, o.order_index
                        ORDER BY o.order_index
                    `);
                q.results = votesResult.recordset;
            }

            consultation.questions = questions;

            // Lista de inmuebles que votaron
            consultation.voting_properties = await ConsultationModel.getVotingProperties(tenantId, id);

            res.json({
                success: true,
                data: consultation
            });
        } catch (error) {
            console.error('Get consultation error:', error);
            res.status(500).json({ error: 'Error al obtener consulta' });
        }
    }

    /**
     * POST /api/tenant-admin/consultations
     * Crear nueva consulta
     */
    static async create(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const { title, description, start_date, end_date, target_building, questions } = req.body;

            // Validaciones
            if (!title || !start_date || !end_date || !questions || questions.length === 0) {
                return res.status(400).json({ 
                    error: 'Título, fechas y al menos una pregunta son requeridos' 
                });
            }

            // Validar que las preguntas tengan opciones
            for (const q of questions) {
                if (!q.text || !q.options || q.options.length < 2) {
                    return res.status(400).json({ 
                        error: 'Cada pregunta debe tener texto y al menos 2 opciones' 
                    });
                }
            }

            // Validar fechas - La fecha de inicio debe ser al menos 1 día después de la creación
            // Usar fecha actual en Venezuela (GMT-4)
            const now = new Date();
            const venezuelaNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
            
            // Crear fecha de mañana en Venezuela
            const tomorrowVenezuela = new Date(venezuelaNow);
            tomorrowVenezuela.setDate(tomorrowVenezuela.getDate() + 1);
            tomorrowVenezuela.setHours(0, 0, 0, 0);
            
            // Parsear fecha de inicio (viene como YYYY-MM-DD)
            const [year, month, day] = start_date.split('-').map(Number);
            const startDateVenezuela = new Date(year, month - 1, day); // Mes es 0-indexed
            
            // Comparar fechas (solo año, mes, día)
            const startDateStr = `${startDateVenezuela.getFullYear()}-${String(startDateVenezuela.getMonth() + 1).padStart(2, '0')}-${String(startDateVenezuela.getDate()).padStart(2, '0')}`;
            const tomorrowStr = `${tomorrowVenezuela.getFullYear()}-${String(tomorrowVenezuela.getMonth() + 1).padStart(2, '0')}-${String(tomorrowVenezuela.getDate()).padStart(2, '0')}`;
            
            if (startDateStr < tomorrowStr) {
                return res.status(400).json({
                    error: `La fecha de inicio debe ser al menos 1 día después de hoy. Hoy es ${venezuelaNow.toLocaleDateString('es-VE')}, la fecha mínima es ${tomorrowVenezuela.toLocaleDateString('es-VE')}`
                });
            }

            // Parsear fecha de fin
            const [endYear, endMonth, endDay] = end_date.split('-').map(Number);
            const endDateVenezuela = new Date(endYear, endMonth - 1, endDay);
            
            if (endDateVenezuela <= startDateVenezuela) {
                return res.status(400).json({
                    error: 'La fecha de cierre debe ser posterior a la fecha de inicio'
                });
            }

            // Convertir a UTC para guardar en BD (00:00 GMT-4 = 04:00 UTC)
            const startDateUTC = new Date(Date.UTC(year, month - 1, day, 4, 0, 0));
            const endDateUTC = new Date(Date.UTC(endYear, endMonth - 1, endDay, 4, 0, 0));

            const consultation = await ConsultationModel.create({
                tenant_id: tenantId,
                created_by: userId,
                title,
                description,
                start_date: startDateUTC,
                end_date: endDateUTC,
                target_building: target_building || null,
                questions
            });

            // Send creation notifications
            const recipients = await ConsultationNotificationService.getRecipients(tenantId, target_building || null);
            await ConsultationNotificationService.sendCreationNotification(consultation, recipients);

            res.status(201).json({
                success: true,
                message: 'Consulta creada exitosamente',
                data: consultation
            });
        } catch (error) {
            console.error('Create consultation error:', error);
            res.status(500).json({ error: 'Error al crear consulta' });
        }
    }

    /**
     * PUT /api/tenant-admin/consultations/:id
     * Actualizar consulta (solo si no ha recibido votos)
     */
    static async update(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            const { title, description, start_date, end_date, status } = req.body;

            const pool = await connectDB();

            // Verificar si ya tiene votos
            const votesResult = await pool.request()
                .input('consultation_id', sql.UniqueIdentifier, id)
                .query('SELECT COUNT(*) as count FROM ConsultationVotes WHERE consultation_id = @consultation_id');

            if (votesResult.recordset[0].count > 0) {
                // Si tiene votos, solo permitir cambiar estado a CLOSED
                if (status) {
                    await pool.request()
                        .input('id', sql.UniqueIdentifier, id)
                        .input('tenant_id', sql.UniqueIdentifier, tenantId)
                        .input('status', sql.NVarChar, status)
                        .query(`
                            UPDATE Consultations 
                            SET status = @status, updated_at = SYSDATETIME()
                            WHERE id = @id AND tenant_id = @tenant_id
                        `);

                    return res.json({
                        success: true,
                        message: 'Estado de la consulta actualizado'
                    });
                }
                return res.status(400).json({ 
                    error: 'No se puede modificar una consulta que ya tiene votos' 
                });
            }

            // Sin votos, permitir actualización completa
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('title', sql.NVarChar, title)
                .input('description', sql.NVarChar, description)
                .input('start_date', sql.DateTime2, start_date)
                .input('end_date', sql.DateTime2, end_date)
                .input('status', sql.NVarChar, status)
                .query(`
                    UPDATE Consultations 
                    SET 
                        title = COALESCE(@title, title),
                        description = COALESCE(@description, description),
                        start_date = COALESCE(@start_date, start_date),
                        end_date = COALESCE(@end_date, end_date),
                        status = COALESCE(@status, status),
                        updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenant_id
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Consulta no encontrada' });
            }

            res.json({
                success: true,
                message: 'Consulta actualizada',
                data: result.recordset[0]
            });
        } catch (error) {
            console.error('Update consultation error:', error);
            res.status(500).json({ error: 'Error al actualizar consulta' });
        }
    }

    /**
     * DELETE /api/tenant-admin/consultations/:id
     * Eliminar consulta (solo si no tiene votos)
     */
    static async delete(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;

            const pool = await connectDB();

            // Verificar si tiene votos
            const votesResult = await pool.request()
                .input('consultation_id', sql.UniqueIdentifier, id)
                .query('SELECT COUNT(*) as count FROM ConsultationVotes WHERE consultation_id = @consultation_id');

            if (votesResult.recordset[0].count > 0) {
                return res.status(400).json({ 
                    error: 'No se puede eliminar una consulta que ya tiene votos' 
                });
            }

            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('DELETE FROM Consultations WHERE id = @id AND tenant_id = @tenant_id');

            res.json({
                success: true,
                message: 'Consulta eliminada'
            });
        } catch (error) {
            console.error('Delete consultation error:', error);
            res.status(500).json({ error: 'Error al eliminar consulta' });
        }
    }

    /**
     * POST /api/tenant-admin/consultations/:id/close
     * Cerrar consulta manualmente
     * Solo se puede cerrar anticipadamente si NO tiene votos
     */
    static async close(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;

            const pool = await connectDB();

            // Verificar si tiene votos
            const votesResult = await pool.request()
                .input('consultation_id', sql.UniqueIdentifier, id)
                .query('SELECT COUNT(*) as count FROM ConsultationVotes WHERE consultation_id = @consultation_id');

            const hasVotes = votesResult.recordset[0].count > 0;

            // Si tiene votos, verificar si la consulta ya terminó naturalmente
            const consultResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT end_date FROM Consultations WHERE id = @id AND tenant_id = @tenant_id');

            if (consultResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Consulta no encontrada' });
            }

            const endDate = new Date(consultResult.recordset[0].end_date);
            const now = new Date();

            // Solo permitir cierre anticipado si NO tiene votos
            if (hasVotes && endDate > now) {
                return res.status(400).json({
                    error: 'No se puede cerrar anticipadamente una consulta que ya tiene votos. Debe esperar a la fecha de cierre.'
                });
            }

            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    UPDATE Consultations 
                    SET status = 'CLOSED', updated_at = SYSDATETIME()
                    WHERE id = @id AND tenant_id = @tenant_id
                `);

            res.json({
                success: true,
                message: 'Consulta cerrada exitosamente'
            });
        } catch (error) {
            console.error('Close consultation error:', error);
            res.status(500).json({ error: 'Error al cerrar consulta' });
        }
    }

    /**
     * GET /api/tenant-admin/consultations/:id/results
     * Obtener resultados detallados con información de inmuebles
     */
    static async getResults(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;

            const pool = await connectDB();

            // Verificar que la consulta existe
            const consultResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT * FROM Consultations WHERE id = @id AND tenant_id = @tenant_id');

            if (consultResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Consulta no encontrada' });
            }

            const consultation = consultResult.recordset[0];

            // Inmuebles elegibles
            consultation.eligible_properties = await ConsultationModel.getEligiblePropertiesCount(id, tenantId);

            // Resultados por pregunta
            const results = await ConsultationModel.getResults(tenantId, id);

            // Organizar resultados por pregunta
            const questionsMap = {};
            results.forEach(r => {
                if (!questionsMap[r.question_id]) {
                    questionsMap[r.question_id] = {
                        question_id: r.question_id,
                        question_text: r.question_text,
                        question_support_note: r.question_support_note || null,
                        options: [],
                        total: 0
                    };
                }
                questionsMap[r.question_id].options.push({
                    option_id: r.option_id,
                    option_text: r.option_text,
                    votes: r.vote_count
                });
                questionsMap[r.question_id].total += r.vote_count;
            });

            // Inmuebles que votaron (con detalles)
            const votingProperties = await ConsultationModel.getVotingProperties(tenantId, id);
            console.log(`[DEBUG] show: votingProperties count=${votingProperties.length}`);

            // Obtener nombre del conjunto para el PDF
            const tenantResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT name FROM Tenants WHERE id = @tenant_id');
            const tenant_name = tenantResult.recordset[0]?.name || 'Condominio';

            res.json({
                success: true,
                data: {
                    consultation,
                    results: Object.values(questionsMap),
                    total_votes: votingProperties.length,
                    voting_properties: votingProperties,
                    tenant_name
                }
            });
        } catch (error) {
            console.error('Get results error:', error);
            res.status(500).json({ error: 'Error al obtener resultados' });
        }
    }

    /**
     * GET /api/tenant-admin/consultations/:id/eligible-properties
     * Obtener lista de inmuebles elegibles y su estado de votación
     */
    static async getEligibleProperties(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;

            const pool = await connectDB();

            // Get consultation target_building
            const consultResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT target_building FROM Consultations WHERE id = @id AND tenant_id = @tenant_id');

            if (consultResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Consulta no encontrada' });
            }

            const targetBuilding = consultResult.recordset[0].target_building;

            // Get all eligible properties: usar Buildings.name (building_id) o building (legacy)
            let query = `
                SELECT 
                    p.id, p.name, COALESCE(b.name, p.building) as building,
                    u.first_name + ' ' + u.last_name as owner_name,
                    CASE WHEN v.property_id IS NOT NULL THEN 1 ELSE 0 END as has_voted,
                    v.voted_at
                FROM Properties p
                INNER JOIN PropertyOwners po ON p.id = po.property_id
                LEFT JOIN Buildings b ON p.building_id = b.id
                LEFT JOIN Users u ON po.user_id = u.id
                LEFT JOIN (
                    SELECT DISTINCT property_id, voted_at 
                    FROM ConsultationVotes 
                    WHERE consultation_id = @consultation_id
                ) v ON p.id = v.property_id
                WHERE p.tenant_id = @tenant_id
            `;

            if (targetBuilding) {
                query += ` AND (p.building = @target_building OR b.name = @target_building)`;
            }

            query += ` ORDER BY COALESCE(b.name, p.building), p.name`;

            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('consultation_id', sql.UniqueIdentifier, id)
                .input('target_building', sql.NVarChar, targetBuilding)
                .query(query);

            res.json({
                success: true,
                data: result.recordset
            });
        } catch (error) {
            console.error('Get eligible properties error:', error);
            res.status(500).json({ error: 'Error al obtener inmuebles elegibles' });
        }
    }
}

module.exports = TenantAdminConsultationController;
