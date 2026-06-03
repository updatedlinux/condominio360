const { sql, connectDB } = require('../config/database');

class ConsultationModel {

    /**
     * Create a new consultation with questions and options transactionally.
     */
    static async create(data) {
        const { tenant_id, created_by, title, description, footer_note, start_date, end_date, target_building, questions } = data;

        let pool = await connectDB();
        const transaction = new sql.Transaction(pool);

        try {
            await transaction.begin();

            // 1. Insert Consultation
            const request = new sql.Request(transaction);
            const consultResult = await request
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('created_by', sql.UniqueIdentifier, created_by)
                .input('title', sql.NVarChar, title)
                .input('description', sql.NVarChar, description || null)
                .input('footer_note', sql.NVarChar, (footer_note && String(footer_note).trim()) || null)
                .input('start_date', sql.DateTime2, start_date)
                .input('end_date', sql.DateTime2, end_date)
                .input('target_building', sql.NVarChar, target_building || null)
                .query(`
                    INSERT INTO Consultations (tenant_id, created_by, title, description, footer_note, start_date, end_date, target_building)
                    OUTPUT INSERTED.id
                    VALUES (@tenant_id, @created_by, @title, @description, @footer_note, @start_date, @end_date, @target_building)
                `);

            const consultationId = consultResult.recordset[0].id;

            // 2. Insert Questions and Options
            if (questions && questions.length > 0) {
                for (let i = 0; i < questions.length; i++) {
                    const q = questions[i];
                    const qRequest = new sql.Request(transaction);
                    const qResult = await qRequest
                        .input('consultation_id', sql.UniqueIdentifier, consultationId)
                        .input('text', sql.NVarChar, q.text)
                        .input('support_note', sql.NVarChar, (q.support_note && String(q.support_note).trim()) || null)
                        .input('order_index', sql.Int, i)
                        .query(`
                            INSERT INTO ConsultationQuestions (consultation_id, text, support_note, order_index)
                            OUTPUT INSERTED.id
                            VALUES (@consultation_id, @text, @support_note, @order_index)
                        `);

                    const questionId = qResult.recordset[0].id;

                    if (q.options && q.options.length > 0) {
                        for (let j = 0; j < q.options.length; j++) {
                            const opt = q.options[j];
                            const oRequest = new sql.Request(transaction);
                            await oRequest
                                .input('question_id', sql.UniqueIdentifier, questionId)
                                .input('text', sql.NVarChar, opt.text)
                                .input('order_index', sql.Int, j)
                                .query(`
                                    INSERT INTO ConsultationOptions (question_id, text, order_index)
                                    VALUES (@question_id, @text, @order_index)
                                `);
                        }
                    }
                }
            }

            await transaction.commit();
            return { id: consultationId, ...data };

        } catch (error) {
            if (transaction) await transaction.rollback();
            throw error;
        }
    }

    /**
     * Get eligible properties count for a consultation
     * Returns number of properties that can vote based on target_building
     */
    static async getEligiblePropertiesCount(consultationId, tenantId) {
        try {
            const pool = await connectDB();
            
            // Get consultation target_building
            const consultResult = await pool.request()
                .input('id', sql.UniqueIdentifier, consultationId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT target_building FROM Consultations WHERE id = @id AND tenant_id = @tenant_id');
            
            if (consultResult.recordset.length === 0) return 0;
            
            const targetBuilding = consultResult.recordset[0].target_building;
            
            // Count eligible properties: usar Buildings.name (building_id) o building (legacy)
            let query = `
                SELECT COUNT(*) as count 
                FROM Properties p
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.tenant_id = @tenant_id
            `;
            
            if (targetBuilding) {
                query += ` AND (p.building = @target_building OR b.name = @target_building)`;
            }
            
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('target_building', sql.NVarChar, targetBuilding)
                .query(query);
                
            return result.recordset[0].count;
        } catch (error) {
            console.error('Error getting eligible properties count:', error);
            return 0;
        }
    }

    /**
     * Get user's eligible properties for voting
     * Returns properties that the user owns and are eligible for this consultation
     */
    static async getUserEligibleProperties(tenantId, userId, consultationId) {
        try {
            const pool = await connectDB();
            
            // Get consultation target_building
            const consultResult = await pool.request()
                .input('id', sql.UniqueIdentifier, consultationId)
                .query('SELECT target_building FROM Consultations WHERE id = @id');
            
            if (consultResult.recordset.length === 0) return [];
            
            const targetBuilding = consultResult.recordset[0].target_building;
            
            // Get user's properties that are eligible: usar Buildings.name (building_id) o building (legacy)
            let query = `
                SELECT DISTINCT p.id, p.name, COALESCE(b.name, p.building) as building
                FROM Properties p
                INNER JOIN PropertyOwners po ON p.id = po.property_id
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.tenant_id = @tenant_id 
                AND po.user_id = @user_id
            `;
            
            if (targetBuilding) {
                query += ` AND (p.building = @target_building OR b.name = @target_building)`;
            }
            
            query += ` ORDER BY COALESCE(b.name, p.building), p.name`;
            
            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('user_id', sql.UniqueIdentifier, userId);
            
            // Only add target_building parameter if it's used in the query
            if (targetBuilding) {
                request.input('target_building', sql.NVarChar, targetBuilding);
            }
            
            const result = await request.query(query);
            
            console.log(`[DEBUG] getUserEligibleProperties: tenant=${tenantId}, user=${userId}, targetBuilding=${targetBuilding}, found=${result.recordset.length} properties`);
            
            return result.recordset;
        } catch (error) {
            console.error('Error getting user eligible properties:', error);
            return [];
        }
    }

    /**
     * Get active consultations visible to specific buildings.
     */
    static async findActive(tenantId, userBuildings = []) {
        try {
            const pool = await connectDB();

            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT * FROM Consultations 
                    WHERE tenant_id = @tenant_id 
                    AND status = 'OPEN' 
                    AND end_date >= GETUTCDATE()
                    ORDER BY start_date DESC
                `);

            const allConsultations = result.recordset;

            // Filter in memory for simplicity and safety against array injection
            return allConsultations.filter(c => {
                if (!c.target_building) return true; // Global
                return userBuildings.includes(c.target_building);
            });

        } catch (error) {
            throw error;
        }
    }

    /**
     * Get full details of a consultation (Questions + Options)
     */
    static async findById(id, tenantId) {
        try {
            const pool = await connectDB();

            const consult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT * FROM Consultations WHERE id = @id AND tenant_id = @tenant_id');

            if (consult.recordset.length === 0) return null;
            const consultation = consult.recordset[0];

            // Fetch Questions
            const questionsRes = await pool.request()
                .input('consultation_id', sql.UniqueIdentifier, id)
                .query('SELECT * FROM ConsultationQuestions WHERE consultation_id = @consultation_id ORDER BY order_index');

            const questions = questionsRes.recordset;

            // Fetch Options for all questions
            if (questions.length > 0) {
                for (let q of questions) {
                    const optRes = await pool.request()
                        .input('question_id', sql.UniqueIdentifier, q.id)
                        .query('SELECT * FROM ConsultationOptions WHERE question_id = @question_id ORDER BY order_index');
                    q.options = optRes.recordset;
                }
            }

            consultation.questions = questions;
            return consultation;

        } catch (error) {
            throw error;
        }
    }

    /**
     * Record a vote - NOW BY PROPERTY
     */
    static async vote(tenantId, propertyId, consultationId, votes) {
        // votes: [{ question_id, option_id }]
        const pool = await connectDB();
        const transaction = new sql.Transaction(pool);

        try {
            await transaction.begin();

            // Get user_id from PropertyOwners (for reference)
            const userResult = await pool.request()
                .input('property_id', sql.UniqueIdentifier, propertyId)
                .query('SELECT TOP 1 user_id FROM PropertyOwners WHERE property_id = @property_id');
            
            const userId = userResult.recordset.length > 0 ? userResult.recordset[0].user_id : null;

            for (const v of votes) {
                const request = new sql.Request(transaction);
                await request
                    .input('tenant_id', sql.UniqueIdentifier, tenantId)
                    .input('consultation_id', sql.UniqueIdentifier, consultationId)
                    .input('question_id', sql.UniqueIdentifier, v.question_id)
                    .input('option_id', sql.UniqueIdentifier, v.option_id)
                    .input('property_id', sql.UniqueIdentifier, propertyId)
                    .input('user_id', sql.UniqueIdentifier, userId)
                    .query(`
                        INSERT INTO ConsultationVotes (tenant_id, consultation_id, question_id, option_id, property_id, user_id)
                        VALUES (@tenant_id, @consultation_id, @question_id, @option_id, @property_id, @user_id)
                    `);
            }

            await transaction.commit();
            return { success: true };
        } catch (error) {
            if (transaction) await transaction.rollback();
            // Handle unique constraint error (Duplicate vote)
            if (error.number === 2627 || error.number === 2601) {
                throw new Error('DUPLICATE_VOTE');
            }
            throw error;
        }
    }

    /**
     * Check if a property has already voted in this consultation
     */
    static async hasPropertyVoted(tenantId, consultationId, propertyId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('consultation_id', sql.UniqueIdentifier, consultationId)
                .input('property_id', sql.UniqueIdentifier, propertyId)
                .query('SELECT TOP 1 1 FROM ConsultationVotes WHERE tenant_id = @tenant_id AND consultation_id = @consultation_id AND property_id = @property_id');
            return result.recordset.length > 0;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Legacy method - Check if user has already voted (checks any of their properties)
     */
    static async hasUserVoted(tenantId, consultationId, userId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('consultation_id', sql.UniqueIdentifier, consultationId)
                .input('user_id', sql.UniqueIdentifier, userId)
                .query(`
                    SELECT TOP 1 1 
                    FROM ConsultationVotes v
                    INNER JOIN PropertyOwners po ON v.property_id = po.property_id
                    WHERE v.tenant_id = @tenant_id 
                    AND v.consultation_id = @consultation_id 
                    AND po.user_id = @user_id
                `);
            return result.recordset.length > 0;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get voting properties list for a consultation
     */
    static async getVotingProperties(tenantId, consultationId) {
        try {
            const pool = await connectDB();
            console.log(`[DEBUG] getVotingProperties: tenantId=${tenantId}, consultationId=${consultationId}`);
            
            // Usar voted_at - SQL Server almacena en local time, enviar tal cual
            const votesResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('consultation_id', sql.UniqueIdentifier, consultationId)
                .query(`
                    SELECT 
                        v.property_id,
                        MAX(v.voted_at) as voted_at
                    FROM ConsultationVotes v
                    WHERE v.tenant_id = @tenant_id AND v.consultation_id = @consultation_id
                    GROUP BY v.property_id
                    ORDER BY MAX(v.voted_at) DESC
                `);
            
            console.log(`[DEBUG] getVotingProperties: found ${votesResult.recordset.length} raw votes`);
            
            if (votesResult.recordset.length === 0) {
                return [];
            }
            
            // Obtener los detalles de cada propiedad
            const properties = [];
            for (const vote of votesResult.recordset) {
                const propResult = await pool.request()
                    .input('property_id', sql.UniqueIdentifier, vote.property_id)
                    .query(`
                        SELECT p.id, p.name, 
                            ISNULL(b.name, p.building) as building,
                            (SELECT TOP 1 u.first_name + ' ' + u.last_name 
                             FROM PropertyOwners po 
                             INNER JOIN Users u ON po.user_id = u.id 
                             WHERE po.property_id = p.id) as owner_name
                        FROM Properties p
                        LEFT JOIN Buildings b ON p.building_id = b.id
                        WHERE p.id = @property_id
                    `);
                
                if (propResult.recordset.length > 0) {
                    properties.push({
                        ...propResult.recordset[0],
                        voted_at: vote.voted_at
                    });
                }
            }
            
            console.log(`[DEBUG] getVotingProperties: returning ${properties.length} properties with details`);
            return properties;
        } catch (error) {
            console.error('Error getting voting properties:', error);
            return [];
        }
    }

    static async getResults(tenantId, consultationId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('consultation_id', sql.UniqueIdentifier, consultationId)
                .query(`
                    SELECT 
                        q.id as question_id, q.text as question_text, q.support_note as question_support_note,
                        o.id as option_id, o.text as option_text,
                        COUNT(v.id) as vote_count
                    FROM ConsultationQuestions q
                    JOIN ConsultationOptions o ON o.question_id = q.id
                    LEFT JOIN ConsultationVotes v ON v.option_id = o.id
                    WHERE q.consultation_id = @consultation_id
                    GROUP BY q.id, q.text, q.support_note, q.order_index, o.id, o.text, o.order_index
                    ORDER BY q.order_index, o.order_index
                `);
            return result.recordset;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get total votes count for a consultation (by unique properties)
     */
    static async getTotalVotes(consultationId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('consultation_id', sql.UniqueIdentifier, consultationId)
                .query(`
                    SELECT COUNT(DISTINCT property_id) as total
                    FROM ConsultationVotes 
                    WHERE consultation_id = @consultation_id
                `);
            return result.recordset[0].total;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Mark consultation as activation notified
     */
    static async markAsNotified(consultationId) {
        try {
            const pool = await connectDB();
            await pool.request()
                .input('id', sql.UniqueIdentifier, consultationId)
                .query(`UPDATE Consultations SET activation_notified = 1 WHERE id = @id`);
            return true;
        } catch (error) {
            console.error('Error marking as notified:', error);
            return false;
        }
    }

    /**
     * Get consultations pending activation notification
     * (Start date is today and not yet notified)
     */
    static async getPendingActivationNotifications(tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT * FROM Consultations
                    WHERE tenant_id = @tenant_id
                    AND status = 'OPEN'
                    AND activation_notified = 0
                    AND start_date <= GETUTCDATE()
                    AND end_date >= GETUTCDATE()
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error getting pending notifications:', error);
            return [];
        }
    }
}

module.exports = ConsultationModel;
