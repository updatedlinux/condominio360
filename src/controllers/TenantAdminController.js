const RequestModel = require('../models/RequestModel');
const VisitorModel = require('../models/VisitorModel');
const ConsultationModel = require('../models/ConsultationModel');
const { sql, connectDB } = require('../config/database');

class TenantAdminController {
    /**
     * Get dashboard stats for a specific tenant
     */
    static async getStats(req, res) {
        try {
            const tenantId = req.user.tenantId; // From tenant-scoped token
            const pool = await connectDB();

            // Pending Requests (OPEN or IN_PROGRESS)
            const requestsResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT COUNT(*) as count 
                    FROM Requests 
                    WHERE tenant_id = @tenantId 
                    AND status IN ('OPEN', 'IN_PROGRESS')
                `);

            // Active Consultations (currently open for voting)
            const consultationsResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT COUNT(*) as count 
                    FROM Consultations 
                    WHERE tenant_id = @tenantId 
                    AND status = 'OPEN'
                    AND start_date <= GETUTCDATE()
                    AND end_date >= GETUTCDATE()
                `);
            const consultationsCount = consultationsResult.recordset[0].count;

            // Expected Visitors (visitas activas para hoy - usando VisitorPasses)
            const visitorsResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT COUNT(*) as count 
                    FROM VisitorPasses 
                    WHERE tenant_id = @tenantId 
                    AND CAST(valid_from AS DATE) = CAST(GETDATE() AS DATE)
                    AND status IN ('ACTIVE', 'PENDING')
                `);

            res.json({
                pendingRequests: requestsResult.recordset[0].count,
                activeConsultations: consultationsCount,
                expectedVisitors: visitorsResult.recordset[0].count
            });

        } catch (error) {
            console.error('Error fetching tenant admin stats:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    /**
     * GET /api/tenant-admin/activity
     * Actividad reciente: solicitudes + acciones sobre reservas de áreas comunes
     */
    static async getActivity(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const limit = parseInt(req.query.limit) || 10;
            const pool = await connectDB();

            const activities = [];

            // 1. Últimas solicitudes
            const requestsResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT TOP (@limit) r.id, r.created_at, r.status,
                           rt.name as request_type_name, rt.icon, rt.color,
                           u.first_name + ' ' + ISNULL(u.last_name, '') as owner_name
                    FROM Requests r
                    LEFT JOIN RequestTypes rt ON r.request_type_id = rt.id
                    LEFT JOIN Users u ON r.user_id = u.id
                    WHERE r.tenant_id = @tenant_id
                    ORDER BY r.created_at DESC
                `);

            requestsResult.recordset.forEach(r => {
                activities.push({
                    type: 'request',
                    id: r.id,
                    date: r.created_at,
                    request_type_name: r.request_type_name,
                    owner_name: r.owner_name,
                    status: r.status,
                    icon: r.icon || 'description',
                    color: r.color || '#6B7280',
                    link: '/tenant-admin/requests'
                });
            });

            // 2. Últimas acciones sobre reservas (aprobadas/rechazadas)
            const reservationsResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT TOP (@limit) r.id, r.approved_at as date, r.status,
                           ca.name as area_name,
                           u.first_name + ' ' + ISNULL(u.last_name, '') as owner_name
                    FROM CommonAreaReservations r
                    INNER JOIN CommonAreas ca ON r.common_area_id = ca.id
                    INNER JOIN Users u ON r.user_id = u.id
                    WHERE r.tenant_id = @tenant_id
                    AND r.status IN ('CONFIRMED', 'REJECTED')
                    AND r.approved_at IS NOT NULL
                    ORDER BY r.approved_at DESC
                `);

            reservationsResult.recordset.forEach(r => {
                activities.push({
                    type: 'reservation_action',
                    id: r.id,
                    date: r.date,
                    area_name: r.area_name,
                    owner_name: r.owner_name,
                    status: r.status,
                    icon: r.status === 'CONFIRMED' ? 'check_circle' : 'cancel',
                    color: r.status === 'CONFIRMED' ? '#10b981' : '#dc2626',
                    link: '/tenant-admin/common-areas'
                });
            });

            // Ordenar por fecha descendente y limitar
            activities.sort((a, b) => new Date(b.date) - new Date(a.date));
            const limited = activities.slice(0, limit);

            res.json({ success: true, data: limited });
        } catch (error) {
            console.error('Get tenant-admin activity error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar actividad' });
        }
    }

    /**
     * Get buildings for dropdown selection
     */
    static async getBuildings(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const pool = await connectDB();
            
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT building, COUNT(*) as unit_count
                    FROM Properties
                    WHERE tenant_id = @tenant_id
                    GROUP BY building
                    ORDER BY building
                `);
            
            res.json({ success: true, buildings: result.recordset });
        } catch (error) {
            console.error('Error fetching buildings:', error);
            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }

    /**
     * GET /api/tenant-admin/properties/:id/audit
     * Obtener datos completos de auditoría de un inmueble
     */
    static async getPropertyAudit(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id: propertyId } = req.params;

            if (!propertyId || !tenantId) {
                return res.status(400).json({ error: 'Se requiere propertyId y tenantId' });
            }

            const pool = await connectDB();
            const results = {};

            // 1. Información del inmueble
            try {
                const propertyResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT p.*, b.name as building_name
                        FROM Properties p
                        LEFT JOIN Buildings b ON p.building_id = b.id
                        WHERE p.id = @propertyId AND p.tenant_id = @tenantId
                    `);
                
                if (propertyResult.recordset.length === 0) {
                    return res.status(404).json({ error: 'Inmueble no encontrado' });
                }
                results.property = propertyResult.recordset[0];
            } catch (e) {
                console.error('Error loading property:', e);
                results.property = {};
            }

            // 2. Propietarios
            try {
                const ownersResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .query(`
                        SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.dni,
                               po.percentage_ownership, po.is_primary_owner
                        FROM PropertyOwners po
                        INNER JOIN Users u ON po.user_id = u.id
                        WHERE po.property_id = @propertyId
                    `);
                results.owners = ownersResult.recordset;
            } catch (e) {
                console.error('Error loading owners:', e);
                results.owners = [];
            }

            // 3. Consultas votadas por este inmueble
            try {
                const consultationsResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT c.id, c.title, c.status, c.created_at, c.end_date,
                               MAX(cv.voted_at) as voted_at
                        FROM Consultations c
                        INNER JOIN ConsultationVotes cv ON c.id = cv.consultation_id AND cv.tenant_id = c.tenant_id
                        WHERE c.tenant_id = @tenantId AND cv.property_id = @propertyId
                        GROUP BY c.id, c.title, c.status, c.created_at, c.end_date
                        ORDER BY MAX(cv.voted_at) DESC
                    `);
                results.consultations = consultationsResult.recordset;
            } catch (e) {
                console.error('Error loading consultations:', e);
                results.consultations = [];
            }

            // 4. Solicitudes
            try {
                const requestsResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT r.id, r.status, r.created_at, r.updated_at,
                               rt.name as request_type_name, rt.is_move_type
                        FROM Requests r
                        INNER JOIN RequestTypes rt ON r.request_type_id = rt.id
                        WHERE r.property_id = @propertyId AND r.tenant_id = @tenantId
                        ORDER BY r.created_at DESC
                    `);
                results.requests = requestsResult.recordset;
            } catch (e) {
                console.error('Error loading requests:', e);
                results.requests = [];
            }

            // 5. Visitas
            try {
                const visitsResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT vp.id, vp.type, vp.status as pass_status, vp.valid_from, vp.created_at,
                               v.first_name, v.last_name, v.dni as visitor_dni,
                               vl.entry_time, vl.exit_time, vl.access_method
                        FROM VisitorPasses vp
                        INNER JOIN Visitors v ON vp.visitor_id = v.id
                        LEFT JOIN VisitorLogs vl ON vp.id = vl.pass_id
                        WHERE vp.property_id = @propertyId AND vp.tenant_id = @tenantId
                        ORDER BY vp.created_at DESC
                    `);
                results.visits = visitsResult.recordset;
            } catch (e) {
                console.error('Error loading visits:', e);
                results.visits = [];
            }

            // 6. Deliveries
            try {
                const deliveriesResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT id, name, company, status, expected_date, 
                               announced_at, arrival_time, delivered_at
                        FROM DeliveryAnnouncements
                        WHERE property_id = @propertyId AND tenant_id = @tenantId
                        ORDER BY created_at DESC
                    `);
                results.deliveries = deliveriesResult.recordset;
            } catch (e) {
                console.error('Error loading deliveries:', e);
                results.deliveries = [];
            }

            // 7. Comunicados y lecturas
            try {
                // Obtener IDs de propietarios del inmueble
                const ownersResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .query(`SELECT user_id FROM PropertyOwners WHERE property_id = @propertyId`);
                
                const ownerIds = ownersResult.recordset.map(o => o.user_id);
                
                if (ownerIds.length > 0) {
                    // Obtener comunicados del tenant
                    const communiquesResult = await pool.request()
                        .input('tenantId', sql.UniqueIdentifier, tenantId)
                        .query(`
                            SELECT id, title, description, file_type, created_at, 
                                   ISNULL((SELECT first_name + ' ' + last_name FROM Users WHERE id = c.created_by), 'Administrador') as author_name
                            FROM Communiques c
                            WHERE tenant_id = @tenantId AND status = 'active'
                            ORDER BY created_at DESC
                        `);
                    
                    results.communiques = communiquesResult.recordset;
                    
                    // Obtener lecturas de los propietarios de este inmueble
                    const readsResult = await pool.request()
                        .input('tenantId', sql.UniqueIdentifier, tenantId)
                        .query(`
                            SELECT cr.communique_id, cr.read_at, cr.ip_address,
                                   ISNULL(u.first_name + ' ' + u.last_name, 'Propietario') as reader_name
                            FROM CommuniqueReads cr
                            LEFT JOIN Users u ON cr.user_id = u.id
                            WHERE cr.communique_id IN (
                                SELECT id FROM Communiques WHERE tenant_id = @tenantId AND status = 'active'
                            )
                        `);
                    
                    results.communiqueReads = readsResult.recordset;
                } else {
                    results.communiques = [];
                    results.communiqueReads = [];
                }
            } catch (e) {
                console.error('Error loading communiques:', e);
                results.communiques = [];
                results.communiqueReads = [];
            }

            // 8. Conteo de recibos de facturación (para badge)
            try {
                const billingCountResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT COUNT(*) as count FROM BillingInvoices 
                        WHERE property_id = @propertyId AND tenant_id = @tenantId
                    `);
                results.billing_invoices_count = billingCountResult.recordset[0]?.count ?? 0;
            } catch (e) {
                console.error('Error loading billing count:', e);
                results.billing_invoices_count = 0;
            }

            // 9. Conteo de tarjetas NFC (para badge)
            try {
                const nfcCountResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT COUNT(*) as count FROM NFC_Cards 
                        WHERE property_id = @propertyId AND tenant_id = @tenantId
                    `);
                results.nfc_cards_count = nfcCountResult.recordset[0]?.count ?? 0;
            } catch (e) {
                console.error('Error loading NFC count:', e);
                results.nfc_cards_count = 0;
            }

            res.json({
                success: true,
                ...results
            });

        } catch (error) {
            console.error('Get property audit error:', error);
            res.status(500).json({ error: 'Error al obtener auditoría del inmueble' });
        }
    }
}

module.exports = TenantAdminController;
