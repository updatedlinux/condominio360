const ConsultationModel = require('../models/ConsultationModel');
const { sql, connectDB } = require('../config/database');

/**
 * Helper to get user's properties
 */
async function getUserProperties(tenantId, userId) {
    try {
        console.log(`[DEBUG] getUserProperties: tenantId=${tenantId}, userId=${userId}`);
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('user_id', sql.UniqueIdentifier, userId)
            .query(`
                SELECT p.id, p.name, COALESCE(b.name, p.building) as building
                FROM Properties p
                INNER JOIN PropertyOwners po ON p.id = po.property_id
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.tenant_id = @tenant_id AND po.user_id = @user_id
                ORDER BY COALESCE(b.name, p.building), p.name
            `);
        console.log(`[DEBUG] getUserProperties: found ${result.recordset.length} properties`);
        return result.recordset;
    } catch (error) {
        console.error('Error fetching user properties:', error);
        return [];
    }
}

class ConsultationController {

    /**
     * GET /api/consultations/active
     * List active consultations for the owner
     */
    static async listActive(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;

            console.log(`[DEBUG] listActive: tenantId=${tenantId}, userId=${userId}`);

            // Get user's properties
            const userProperties = await getUserProperties(tenantId, userId);
            console.log(`[DEBUG] User has ${userProperties.length} properties:`, userProperties.map(p => ({id: p.id, name: p.name})));
            const userBuildingSet = new Set(userProperties.map(p => p.building).filter(b => b));

            // Get all active consultations for tenant (that have started and not ended)
            // Using GETUTCDATE() since dates are stored in UTC
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT * FROM Consultations 
                    WHERE tenant_id = @tenant_id 
                    AND status = 'OPEN' 
                    AND start_date <= GETUTCDATE()
                    AND end_date >= GETUTCDATE()
                    ORDER BY start_date DESC
                `);

            let consultations = result.recordset;

            // Filter by building eligibility
            consultations = consultations.filter(c => {
                if (!c.target_building) return true;
                return userBuildingSet.has(c.target_building);
            });

            // Check voting status for each consultation
            for (const c of consultations) {
                // Get consultation details with questions
                const consultationDetails = await ConsultationModel.findById(c.id, tenantId);
                if (consultationDetails) {
                    c.questions = consultationDetails.questions || [];
                }

                // Get eligible properties for this consultation
                const eligibleProperties = await ConsultationModel.getUserEligibleProperties(tenantId, userId, c.id);
                
                // Check which properties have voted
                const propertiesWithStatus = await Promise.all(
                    eligibleProperties.map(async (p) => {
                        const hasVoted = await ConsultationModel.hasPropertyVoted(tenantId, c.id, p.id);
                        return { ...p, has_voted: hasVoted };
                    })
                );

                c.eligible_properties = propertiesWithStatus;
                c.has_voted = propertiesWithStatus.some(p => p.has_voted);
                c.can_vote = propertiesWithStatus.some(p => !p.has_voted);
            }

            res.json({
                success: true,
                data: consultations
            });
        } catch (error) {
            console.error('List Consultations Error:', error);
            res.status(500).json({ error: 'Error al obtener consultas' });
        }
    }

    /**
     * GET /api/consultations/closed
     * List closed consultations for the owner (to see results and print PDF)
     */
    static async listClosed(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;

            const userProperties = await getUserProperties(tenantId, userId);
            const userBuildingSet = new Set(userProperties.map(p => p.building).filter(b => b));

            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT * FROM Consultations 
                    WHERE tenant_id = @tenant_id 
                    AND status = 'CLOSED' 
                    ORDER BY end_date DESC
                `);

            let consultations = result.recordset;

            // Filter by building eligibility (same as active)
            consultations = consultations.filter(c => {
                if (!c.target_building) return true;
                return userBuildingSet.has(c.target_building);
            });

            res.json({
                success: true,
                data: consultations
            });
        } catch (error) {
            console.error('List Closed Consultations Error:', error);
            res.status(500).json({ error: 'Error al obtener consultas finalizadas' });
        }
    }

    /**
     * GET /api/consultations/:id
     * Get consultation details with eligible properties
     */
    static async getById(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const { id } = req.params;

            console.log(`[DEBUG] getById: tenantId=${tenantId}, userId=${userId}, consultationId=${id}`);

            const consultation = await ConsultationModel.findById(id, tenantId);
            if (!consultation) {
                return res.status(404).json({ error: 'Consulta no encontrada' });
            }

            // Get eligible properties for this user
            const eligibleProperties = await ConsultationModel.getUserEligibleProperties(tenantId, userId, id);
            
            if (eligibleProperties.length === 0) {
                return res.status(403).json({ error: 'No tienes inmuebles elegibles para esta consulta' });
            }

            // Check voting status for each property
            const propertiesWithStatus = await Promise.all(
                eligibleProperties.map(async (p) => {
                    const hasVoted = await ConsultationModel.hasPropertyVoted(tenantId, id, p.id);
                    return { ...p, has_voted: hasVoted };
                })
            );

            consultation.eligible_properties = propertiesWithStatus;
            consultation.has_voted = propertiesWithStatus.some(p => p.has_voted);
            consultation.can_vote = propertiesWithStatus.some(p => !p.has_voted);

            res.json({
                success: true,
                data: consultation
            });
        } catch (error) {
            console.error('Get Consultation Error:', error);
            res.status(500).json({ error: 'Error al obtener consulta' });
        }
    }

    /**
     * POST /api/consultations/:id/vote
     * Submit vote - NOW BY PROPERTY
     */
    static async vote(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const { id } = req.params;
            const { property_id, votes } = req.body;

            if (!property_id || !votes || !Array.isArray(votes) || votes.length === 0) {
                return res.status(400).json({ error: 'Inmueble y votos son requeridos' });
            }

            // 1. Verify Consultation exists and is open
            const consultation = await ConsultationModel.findById(id, tenantId);
            if (!consultation) {
                return res.status(404).json({ error: 'Consulta no encontrada' });
            }

            // Check dates - Must be in Venezuela timezone (GMT-4)
            // start_date is stored as UTC 04:00 which is 00:00 GMT-4
            const now = new Date();
            const startDate = new Date(consultation.start_date);
            const endDate = new Date(consultation.end_date);

            if (now < startDate) {
                return res.status(400).json({ 
                    error: 'La consulta aún no ha iniciado. Inicia el ' + startDate.toLocaleDateString('es-VE', { timeZone: 'America/Caracas' })
                });
            }
            if (now > endDate) {
                return res.status(400).json({ error: 'La consulta ha finalizado' });
            }

            if (consultation.status !== 'OPEN') {
                return res.status(400).json({ error: 'La consulta está cerrada' });
            }

            // 2. Verify property belongs to user and is eligible
            const userProperties = await getUserProperties(tenantId, userId);
            const propertyIds = userProperties.map(p => p.id);
            
            if (!propertyIds.includes(property_id)) {
                return res.status(403).json({ error: 'El inmueble no pertenece al usuario' });
            }

            // Check if property is eligible for this consultation (building filter)
            const eligibleProperties = await ConsultationModel.getUserEligibleProperties(tenantId, userId, id);
            const eligiblePropertyIds = eligibleProperties.map(p => p.id);
            
            if (!eligiblePropertyIds.includes(property_id)) {
                return res.status(403).json({ 
                    error: 'Este inmueble no es elegible para esta consulta (diferente edificio/calle)' 
                });
            }

            // 3. Check if property already voted
            const alreadyVoted = await ConsultationModel.hasPropertyVoted(tenantId, id, property_id);
            if (alreadyVoted) {
                return res.status(400).json({ error: 'Este inmueble ya ha votado' });
            }

            // 4. Validate votes structure
            const questions = consultation.questions;
            for (const q of questions) {
                const vote = votes.find(v => v.question_id === q.id);
                if (!vote) {
                    return res.status(400).json({ 
                        error: `Falta voto para la pregunta: ${q.text}` 
                    });
                }
                // Validate option belongs to question
                const validOption = q.options.find(o => o.id === vote.option_id);
                if (!validOption) {
                    return res.status(400).json({ 
                        error: `Opción inválida para la pregunta: ${q.text}` 
                    });
                }
            }

            // 5. Register Votes
            await ConsultationModel.vote(tenantId, property_id, id, votes);

            res.status(200).json({ 
                success: true,
                message: 'Voto registrado exitosamente'
            });

        } catch (error) {
            console.error('Vote Error:', error);
            if (error.message === 'DUPLICATE_VOTE') {
                return res.status(400).json({ error: 'El inmueble ya ha votado' });
            }
            res.status(500).json({ error: 'Error al registrar voto' });
        }
    }

    /**
     * GET /api/consultations/:id/results
     * Get results - Only for CLOSED consultations for owners
     */
    static async getResults(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const { id } = req.params;

            // Get consultation
            const pool = await connectDB();
            const consultResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT * FROM Consultations WHERE id = @id AND tenant_id = @tenant_id');

            if (consultResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Consulta no encontrada' });
            }

            const consultation = consultResult.recordset[0];

            // Owners can only see results of CLOSED consultations
            if (consultation.status !== 'CLOSED') {
                return res.status(403).json({ 
                    error: 'Los resultados solo están disponibles cuando la consulta ha finalizado' 
                });
            }

            // Get eligible properties count
            const eligibleCount = await ConsultationModel.getEligiblePropertiesCount(id, tenantId);

            // Get results
            const results = await ConsultationModel.getResults(tenantId, id);

            // Organize by question
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

            // Get voting properties
            const votingProperties = await ConsultationModel.getVotingProperties(tenantId, id);

            // Obtener nombre del conjunto para el PDF
            const tenantResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT name FROM Tenants WHERE id = @tenant_id');
            const tenant_name = tenantResult.recordset[0]?.name || 'Condominio';

            res.json({
                success: true,
                data: {
                    consultation: {
                        id: consultation.id,
                        title: consultation.title,
                        description: consultation.description,
                        status: consultation.status,
                        target_building: consultation.target_building,
                        start_date: consultation.start_date,
                        end_date: consultation.end_date,
                        eligible_properties: eligibleCount
                    },
                    results: Object.values(questionsMap),
                    total_votes: votingProperties.length,
                    participation_rate: eligibleCount > 0 ? 
                        Math.round((votingProperties.length / eligibleCount) * 100) : 0,
                    voting_properties: votingProperties,
                    tenant_name
                }
            });
        } catch (error) {
            console.error('Get Results Error:', error);
            res.status(500).json({ error: 'Error al obtener resultados' });
        }
    }
}

module.exports = ConsultationController;
