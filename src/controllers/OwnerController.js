const PropertyModel = require('../models/PropertyModel');
const RequestModel = require('../models/RequestModel');
const RequestTypeModel = require('../models/RequestTypeModel');
const TenantMoveConfigModel = require('../models/TenantMoveConfigModel');
const ConsultationModel = require('../models/ConsultationModel');
const VisitorModel = require('../models/VisitorModel');
const EmailService = require('../services/EmailService');
const BCVService = require('../services/BCVService');
const { sql, connectDB } = require('../config/database');
const { getTodayVenezuela } = require('../utils/dateUtils');

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
 * Owner Controller
 * Panel de control para propietarios
 * Maneja dashboard, solicitudes, consultas, visitas y facturación
 */
class OwnerController {
    
    // ==================== PROPIEDADES (para switch) ====================

    /**
     * GET /api/owner/properties
     * Lista todas las propiedades del propietario (para cambiar de inmueble sin desloguearse)
     */
    static async getProperties(req, res) {
        try {
            const userId = req.user.userId;
            const properties = await PropertyModel.getByOwner(userId);

            const formatted = properties.map(p => ({
                id: p.id,
                name: p.name,
                type: p.type,
                building: p.building_name || p.building,
                floor: p.floor,
                area: p.area_sqm,
                alicuota: p.alicuota,
                tenantId: p.tenant_id,
                tenantName: p.tenant_name,
                tenantSlug: p.tenant_slug,
                isPrimary: p.is_primary_owner,
                percentage: p.percentage_ownership
            }));

            res.json({ success: true, properties: formatted });
        } catch (error) {
            console.error('Get owner properties error:', error);
            res.status(500).json({ error: 'Error al cargar propiedades' });
        }
    }

    // ==================== DASHBOARD ====================

    /**
     * GET /api/owner/dashboard
     * Dashboard del propietario con resumen de su unidad activa
     */
    static async getDashboard(req, res) {
        try {
            const userId = req.user.userId;
            const propertyId = req.propertyId || req.query.propertyId;

            if (!propertyId) {
                return res.status(400).json({ 
                    error: 'Se requiere propertyId. Selecciona una unidad primero.' 
                });
            }

            const pool = await connectDB();

            // Obtener información de la unidad
            const propertyResult = await pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .query(`
                    SELECT p.*, t.name as tenant_name, t.slug as tenant_slug, t.billing_type
                    FROM Properties p
                    INNER JOIN Tenants t ON p.tenant_id = t.id
                    WHERE p.id = @propertyId
                `);

            const property = propertyResult.recordset[0];
            if (!property) {
                return res.status(404).json({ error: 'Unidad no encontrada' });
            }

            // Verificar que el usuario es propietario de esta unidad
            const ownersResult = await pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .query('SELECT user_id FROM PropertyOwners WHERE property_id = @propertyId');
            
            const isOwner = ownersResult.recordset.some(o => o.user_id === userId);
            if (!isOwner) {
                return res.status(403).json({ error: 'No tienes acceso a esta unidad' });
            }

            // Estadísticas del dashboard
            const stats = await OwnerController._getDashboardStats(pool, propertyId, userId, property.tenant_id);

            res.json({
                success: true,
                property: {
                    id: property.id,
                    name: property.name,
                    type: property.type,
                    building: property.building,
                    floor: property.floor,
                    area_sqm: property.area_sqm,
                    alicuota: property.alicuota,
                    tenant: {
                        id: property.tenant_id,
                        name: property.tenant_name,
                        slug: property.tenant_slug,
                        billing_type: property.billing_type
                    }
                },
                stats
            });

        } catch (error) {
            console.error('Dashboard error:', error);
            res.status(500).json({ error: 'Error al cargar dashboard' });
        }
    }

    /**
     * Obtener estadísticas para el dashboard
     */
    static async _getDashboardStats(pool, propertyId, userId, tenantId) {
        // Solicitudes pendientes
        const pendingRequests = await pool.request()
            .input('userId', sql.UniqueIdentifier, userId)
            .input('tenantId', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT COUNT(*) as count FROM Requests 
                WHERE user_id = @userId AND tenant_id = @tenantId 
                AND status IN ('OPEN', 'IN_PROGRESS')
            `);

        // Consultas activas donde puede votar (solo las que aplican a sus edificios)
        const activeConsultations = await pool.request()
            .input('tenantId', sql.UniqueIdentifier, tenantId)
            .input('userId', sql.UniqueIdentifier, userId)
            .query(`
                SELECT COUNT(*) as count FROM Consultations c
                WHERE c.tenant_id = @tenantId 
                AND c.status = 'OPEN' 
                AND c.start_date <= GETUTCDATE()
                AND c.end_date >= GETUTCDATE()
                AND (
                    c.target_building IS NULL
                    OR EXISTS (
                        SELECT 1 FROM Properties p
                        INNER JOIN PropertyOwners po ON p.id = po.property_id
                        LEFT JOIN Buildings b ON p.building_id = b.id
                        WHERE p.tenant_id = @tenantId AND po.user_id = @userId
                        AND (p.building = c.target_building OR b.name = c.target_building)
                    )
                )
            `);

        // Visitas anunciadas para hoy (usando fecha de Venezuela) - SOLO ÚNICAS, NO FRECUENTES
        const today = getTodayVenezuela();
        
        const todayVisits = await pool.request()
            .input('propertyId', sql.UniqueIdentifier, propertyId)
            .input('today', sql.Date, today)
            .query(`
                SELECT COUNT(*) as count FROM VisitorPasses 
                WHERE property_id = @propertyId 
                AND CAST(valid_from AS DATE) = @today
                AND type = 'ONE_TIME'  -- Solo visitas únicas, no frecuentes
                AND status IN ('ACTIVE', 'PENDING')
            `);

        // Facturas pendientes (BillingInvoices: aislamiento por tenant)
        const pendingInvoices = await pool.request()
            .input('propertyId', sql.UniqueIdentifier, propertyId)
            .input('tenantId', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT COUNT(*) as count FROM BillingInvoices i
                WHERE i.property_id = @propertyId 
                AND i.tenant_id = @tenantId
                AND i.status = 'PENDING'
            `).catch(() => ({ recordset: [{ count: 0 }] }));

        return {
            pendingRequests: pendingRequests.recordset[0].count,
            activeConsultations: activeConsultations.recordset[0].count,
            todayVisits: todayVisits.recordset[0].count,
            pendingInvoices: pendingInvoices.recordset[0].count
        };
    }

    /**
     * GET /api/owner/activity
     * Actividad reciente completa del inmueble (visitas, deliveries, solicitudes, consultas)
     */
    static async getActivity(req, res) {
        try {
            const userId = req.user.userId;
            const propertyId = req.propertyId || req.query.propertyId;
            const tenantId = req.user.tenantId;

            if (!propertyId) {
                return res.status(400).json({ error: 'Se requiere propertyId' });
            }

            const pool = await connectDB();
            const activities = [];

            // 1. Último login del usuario (si existe la columna)
            try {
                const userResult = await pool.request()
                    .input('userId', sql.UniqueIdentifier, userId)
                    .query(`
                        SELECT TOP 1 last_login, created_at 
                        FROM Users 
                        WHERE id = @userId
                    `);
                
                if (userResult.recordset[0]?.last_login) {
                    activities.push({
                        type: 'login',
                        icon: 'login',
                        title: 'Inicio de sesión',
                        description: 'Último acceso al sistema',
                        date: userResult.recordset[0].last_login,
                        color: 'blue'
                    });
                }
            } catch (e) {
                // Columna last_login no existe, ignorar
            }

            // 1b. Solicitudes de actualización de datos (user-level)
            try {
                const durResult = await pool.request()
                    .input('userId', sql.UniqueIdentifier, userId)
                    .query(`
                        SELECT TOP 5 id, status, requested_at FROM DataUpdateRequests 
                        WHERE user_id = @userId ORDER BY requested_at DESC
                    `);
                durResult.recordset.forEach(r => {
                    const statusLabel = r.status === 'PENDING' ? 'Pendiente' : r.status === 'APPROVED' ? 'Aprobada' : 'Rechazada';
                    activities.push({
                        type: 'data_update_request',
                        icon: 'edit_note',
                        title: `Solicitud de actualización de datos: ${statusLabel}`,
                        description: 'Actualización de datos personales',
                        date: r.requested_at,
                        color: r.status === 'PENDING' ? 'amber' : r.status === 'APPROVED' ? 'green' : 'red'
                    });
                });
            } catch (e) {
                // Tabla puede no existir
            }

            // 2. Visitas registradas (últimas 20)
            const visitsResult = await pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT TOP 20 vp.created_at, vp.valid_from, vp.type,
                           v.first_name, v.last_name, v.dni,
                           vl.entry_time, vl.exit_time
                    FROM VisitorPasses vp
                    INNER JOIN Visitors v ON vp.visitor_id = v.id
                    LEFT JOIN VisitorLogs vl ON (vp.id = vl.pass_id OR (vl.pass_id IS NULL AND vp.visitor_id = vl.visitor_id AND vl.property_id = vp.property_id))
                    WHERE vp.property_id = @propertyId AND vp.tenant_id = @tenantId
                    ORDER BY COALESCE(vl.exit_time, vl.entry_time, vp.created_at) DESC
                `);

            visitsResult.recordset.forEach(v => {
                let status = 'programada';
                let icon = 'calendar_today';
                let color = 'amber';
                let activityDate = v.created_at;
                
                if (v.exit_time) {
                    status = 'completada (salió)';
                    icon = 'logout';
                    color = 'gray';
                    activityDate = v.exit_time;  // Fecha real de salida
                } else if (v.entry_time) {
                    status = 'en curso (dentro)';
                    icon = 'sensors';
                    color = 'green';
                    activityDate = v.entry_time;  // Fecha real de entrada
                }

                activities.push({
                    type: 'visit',
                    icon: icon,
                    title: `Visita ${v.type === 'ONE_TIME' ? 'única' : 'frecuente'}: ${v.first_name} ${v.last_name}`,
                    description: `DNI: ${v.dni} - ${status}`,
                    date: activityDate,
                    color: color
                });
            });

            // 3. Deliveries anunciados (últimos 20)
            const deliveriesResult = await pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT TOP 20 name, company, status, expected_date, 
                           announced_at, arrival_time, delivered_at
                    FROM DeliveryAnnouncements
                    WHERE property_id = @propertyId AND tenant_id = @tenantId
                    ORDER BY created_at DESC
                `);

            deliveriesResult.recordset.forEach(d => {
                let status = 'anunciado';
                let icon = 'local_shipping';
                let color = 'purple';
                
                if (d.delivered_at) {
                    status = 'entregado';
                    icon = 'check_circle';
                    color = 'green';
                } else if (d.arrival_time) {
                    status = 'llegó a portería';
                    icon = 'warehouse';
                    color = 'amber';
                }

                activities.push({
                    type: 'delivery',
                    icon: icon,
                    title: `Delivery: ${d.name}`,
                    description: `${d.company} - ${status}`,
                    date: d.announced_at,
                    color: color
                });
            });

            // 4. Solicitudes realizadas (últimas 20)
            const requestsResult = await pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .input('userId', sql.UniqueIdentifier, userId)
                .query(`
                    SELECT TOP 20 r.created_at, r.status, r.updated_at,
                           rt.name as type_name, rt.is_move_type
                    FROM Requests r
                    INNER JOIN RequestTypes rt ON r.request_type_id = rt.id
                    WHERE r.property_id = @propertyId AND r.user_id = @userId
                    ORDER BY r.created_at DESC
                `);

            requestsResult.recordset.forEach(r => {
                const isMove = r.is_move_type ? ' (Mudanza)' : '';
                let icon = 'assignment';
                let color = 'blue';
                
                if (r.status === 'APPROVED') {
                    icon = 'check_circle';
                    color = 'green';
                } else if (r.status === 'REJECTED') {
                    icon = 'cancel';
                    color = 'red';
                }

                activities.push({
                    type: 'request',
                    icon: icon,
                    title: `Solicitud: ${r.type_name}${isMove}`,
                    description: `Estado: ${r.status}`,
                    date: r.created_at,
                    color: color
                });
            });

            // 5. Votos en consultas (últimos 20) - de todos los propietarios del inmueble
            try {
                const votesResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT 
                            cv.voted_at as created_at, 
                            c.title as consultation_title,
                            u.first_name + ' ' + u.last_name as voter_name,
                            p.name as property_name,
                            p.building
                        FROM ConsultationVotes cv
                        INNER JOIN Consultations c ON cv.consultation_id = c.id
                        INNER JOIN Users u ON cv.user_id = u.id
                        INNER JOIN Properties p ON cv.property_id = p.id
                        WHERE cv.property_id = @propertyId 
                        AND c.tenant_id = @tenantId
                        ORDER BY cv.voted_at DESC
                    `);

                votesResult.recordset.forEach(v => {
                    const building = v.building ? `${v.building} - ` : '';
                    activities.push({
                        type: 'vote',
                        icon: 'how_to_vote',
                        title: `Voto en: ${v.consultation_title}`,
                        description: `Por: ${v.voter_name} • Inmueble: ${building}${v.property_name}`,
                        date: v.created_at,
                        color: 'indigo'
                    });
                });
            } catch (e) {
                // Ignorar errores de votos
                console.log('No se pudieron cargar votos:', e.message);
            }

            // 6. Lecturas de comunicados por propietarios del inmueble (últimas 20)
            try {
                const communiqueReadsResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT TOP 20 cr.read_at, cr.ip_address,
                               c.title as communique_title,
                               ISNULL(u.first_name + ' ' + u.last_name, 'Propietario') as reader_name
                        FROM CommuniqueReads cr
                        INNER JOIN Communiques c ON cr.communique_id = c.id
                        LEFT JOIN Users u ON cr.user_id = u.id
                        WHERE c.tenant_id = @tenantId
                        AND c.status = 'active'
                        AND cr.user_id IN (
                            SELECT po.user_id 
                            FROM PropertyOwners po 
                            WHERE po.property_id = @propertyId
                        )
                        ORDER BY cr.read_at DESC
                    `);

                communiqueReadsResult.recordset.forEach(cr => {
                    activities.push({
                        type: 'communique_read',
                        icon: 'mark_email_read',
                        title: `Comunicado leído: ${cr.communique_title}`,
                        description: `Por: ${cr.reader_name}`,
                        date: cr.read_at,
                        color: 'teal'
                    });
                });
            } catch (e) {
                // Ignorar errores de lecturas de comunicados
                console.log('No se pudieron cargar lecturas de comunicados:', e.message);
            }

            // 6.5 Accesos vehiculares NFC (entradas y salidas)
            try {
                const nfcLogsResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT TOP 20 l.access_time as created_at, l.access_type, l.card_uid
                        FROM NFC_AccessLogs l
                        WHERE l.property_id = @propertyId 
                        AND l.tenant_id = @tenantId 
                        AND l.status = 'GRANTED'
                        ORDER BY l.access_time DESC
                    `);

                nfcLogsResult.recordset.forEach(n => {
                    const isEntry = n.access_type === 'ENTRY';
                    activities.push({
                        type: 'vehicle_access',
                        icon: isEntry ? 'login' : 'logout',
                        title: isEntry ? 'Ingreso vehicular' : 'Salida vehicular',
                        description: `Tarjeta: ${n.card_uid || '-'}`,
                        date: n.created_at,
                        color: isEntry ? 'green' : 'red'
                    });
                });
            } catch (e) {
                console.log('No se pudieron cargar accesos NFC:', e.message);
            }

            // 7. Reservas de áreas comunes (del inmueble)
            try {
                const reservationsResult = await pool.request()
                    .input('propertyId', sql.UniqueIdentifier, propertyId)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT TOP 20 r.created_at, r.updated_at, r.status,
                               ca.name as area_name,
                               r.reservation_date, r.start_time, r.end_time
                        FROM CommonAreaReservations r
                        INNER JOIN CommonAreas ca ON r.common_area_id = ca.id
                        WHERE r.property_id = @propertyId AND r.tenant_id = @tenantId
                        ORDER BY COALESCE(r.updated_at, r.created_at) DESC
                    `);

                reservationsResult.recordset.forEach(r => {
                    // Formatear fecha: SQL Server DATE puede venir como Date o string
                    let datePart = '';
                    if (r.reservation_date instanceof Date) {
                        const d = r.reservation_date;
                        if (!isNaN(d.getTime())) datePart = d.toISOString().split('T')[0];
                    } else if (typeof r.reservation_date === 'string') {
                        datePart = r.reservation_date.split('T')[0].split(' ')[0];
                    } else if (r.reservation_date) {
                        datePart = String(r.reservation_date).split('T')[0].split(' ')[0];
                    }
                    const dateObj = datePart ? new Date(datePart + 'T12:00:00') : null;
                    const dateStr = dateObj && !isNaN(dateObj.getTime())
                        ? dateObj.toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric', month: 'short' })
                        : '—';
                    // Formatear tiempo: SQL Server TIME viene como Date (epoch+time) o string "HH:mm:ss"
                    const fmtTime = (t) => {
                        if (!t) return '--:--';
                        if (t instanceof Date) return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
                        const s = String(t);
                        const m = s.match(/(\d{1,2}):(\d{2})/);
                        return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s.slice(0, 5) || '--:--';
                    };
                    const timeRange = `${fmtTime(r.start_time)} - ${fmtTime(r.end_time)}`;
                    let icon = 'event_available';
                    let color = 'amber';
                    let desc = `${dateStr} • ${timeRange}`;
                    if (r.status === 'CONFIRMED') {
                        icon = 'check_circle';
                        color = 'green';
                        desc = `Aprobada • ${dateStr} • ${timeRange}`;
                    } else if (r.status === 'REJECTED') {
                        icon = 'cancel';
                        color = 'red';
                        desc = `No aprobada • ${dateStr}`;
                    } else if (r.status === 'CANCELLED') {
                        icon = 'event_busy';
                        color = 'gray';
                        desc = `Cancelada • ${dateStr}`;
                    }
                    const activityDate = r.updated_at || r.created_at;
                    activities.push({
                        type: 'reservation',
                        icon,
                        title: `Reserva: ${r.area_name}`,
                        description: desc,
                        date: activityDate,
                        color
                    });
                });
            } catch (e) {
                console.log('No se pudieron cargar reservas de áreas:', e.message);
            }

            // Ordenar por fecha (más reciente primero) y limitar a 50
            activities.sort((a, b) => new Date(b.date) - new Date(a.date));
            const limitedActivities = activities.slice(0, 50);

            res.json({
                success: true,
                data: limitedActivities,
                total: limitedActivities.length
            });

        } catch (error) {
            console.error('Get activity error:', error);
            res.status(500).json({ error: 'Error al cargar actividad reciente' });
        }
    }

    /**
     * GET /api/owner/vehicle-access
     * Historial de entradas y salidas vehiculares (NFC) del inmueble
     */
    static async getVehicleAccess(req, res) {
        try {
            const userId = req.user.userId;
            const propertyId = req.propertyId || req.query.propertyId;
            const tenantId = req.user.tenantId;

            if (!propertyId) {
                return res.status(400).json({ error: 'Se requiere propertyId' });
            }

            // Verificar que el usuario es propietario del inmueble
            const pool = await connectDB();
            const propCheck = await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .query(`
                    SELECT 1 FROM PropertyOwners 
                    WHERE user_id = @userId AND property_id = @propertyId
                `);

            if (propCheck.recordset.length === 0) {
                return res.status(403).json({ error: 'No tiene acceso a este inmueble' });
            }

            const NFCModel = require('../models/NFCModel');
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;
            const startDate = req.query.startDate || null;
            const endDate = req.query.endDate || null;

            const logs = await NFCModel.getAccessLogsByProperty(propertyId, tenantId, {
                limit,
                offset,
                startDate,
                endDate
            });

            res.json({
                success: true,
                data: logs,
                total: logs.length
            });
        } catch (error) {
            console.error('Get vehicle access error:', error);
            res.status(500).json({ error: 'Error al cargar accesos vehiculares' });
        }
    }

    // ==================== SOLICITUDES (REQUESTS) ====================

    /**
     * GET /api/owner/requests/types
     * Obtener tipos de solicitud disponibles para el tenant
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
     * GET /api/owner/requests
     * Listar solicitudes del propietario
     */
    static async getRequests(req, res) {
        try {
            const userId = req.user.userId;
            const tenantId = req.user.tenantId || req.query.tenantId;
            const { status, page = 1, limit = 10 } = req.query;

            if (!tenantId) {
                return res.status(400).json({ error: 'Se requiere tenantId' });
            }

            const pool = await connectDB();
            
            let query = `
                SELECT r.*, rt.name as request_type_name, rt.icon, rt.color, 
                       p.name as property_name
                FROM Requests r
                LEFT JOIN RequestTypes rt ON r.request_type_id = rt.id
                LEFT JOIN Properties p ON r.property_id = p.id
                WHERE r.user_id = @userId AND r.tenant_id = @tenantId
            `;

            if (status) {
                query += ` AND r.status = @status`;
            }

            query += ` ORDER BY r.created_at DESC
                       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

            const result = await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('status', sql.NVarChar, status)
                .input('offset', sql.Int, (page - 1) * limit)
                .input('limit', sql.Int, parseInt(limit))
                .query(query);

            // Contar total
            const countResult = await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('status', sql.NVarChar, status)
                .query(`
                    SELECT COUNT(*) as total FROM Requests 
                    WHERE user_id = @userId AND tenant_id = @tenantId
                    ${status ? 'AND status = @status' : ''}
                `);

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
            console.error('Get requests error:', error);
            res.status(500).json({ error: 'Error al obtener solicitudes' });
        }
    }

    /**
     * POST /api/owner/requests
     * Crear nueva solicitud con validación dinámica según tipo
     */
    static async createRequest(req, res) {
        try {
            const userId = req.user.userId;
            const tenantId = req.user.tenantId;
            const propertyId = req.propertyId || req.body.propertyId;

            const { request_type_id, title, description, data: requestData, priority = 'MEDIUM' } = req.body;

            if (!tenantId || !propertyId || !request_type_id) {
                return res.status(400).json({ 
                    error: 'tenantId, propertyId y request_type_id son requeridos' 
                });
            }

            // Obtener el tipo de solicitud para validación
            const requestType = await RequestTypeModel.findById(request_type_id, tenantId);
            
            if (!requestType) {
                return res.status(404).json({ error: 'Tipo de solicitud no encontrado' });
            }

            // Validar datos del formulario si hay schema
            if (requestType.form_schema && requestData) {
                const validation = RequestTypeModel.validateFormData(
                    requestType.form_schema, 
                    requestData
                );

                if (!validation.valid) {
                    return res.status(400).json({
                        error: 'Datos del formulario inválidos',
                        details: validation.errors
                    });
                }

                // Validación especial para mudanzas
                if (requestType.name.toLowerCase().includes('mudanza') && requestData.move_date) {
                    const moveValidation = await TenantMoveConfigModel.validateMoveDate(
                        tenantId, 
                        requestData.move_date
                    );

                    if (!moveValidation.valid) {
                        return res.status(400).json({
                            error: moveValidation.error
                        });
                    }
                }
            }

            // Crear la solicitud
            const request = await RequestModel.create({
                tenant_id: tenantId,
                user_id: userId,
                property_id: propertyId,
                request_type_id,
                title: title || requestType.name,
                description,
                data: requestData,
                priority,
                status: requestType.requires_approval ? 'PENDING' : 'OPEN'
            });

            // Obtener datos para notificaciones
            const pool = await connectDB();
            
            const userResult = await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .query('SELECT email, first_name, last_name FROM Users WHERE id = @userId');
            
            const tenantResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query('SELECT name FROM Tenants WHERE id = @tenantId');
            
            const ownerEmail = userResult.recordset[0]?.email;
            const ownerName = userResult.recordset[0]?.first_name || 'Propietario';
            const tenantName = tenantResult.recordset[0]?.name || 'Condominio';
            
            // Enviar confirmación al propietario (no bloqueante)
            if (ownerEmail) {
                EmailService.sendRequestCreatedNotification(request, requestType, ownerEmail, ownerName)
                    .catch(err => console.error('Error enviando email de confirmación:', err));
            }
            
            // Notificar a la junta (no bloqueante)
            EmailService.notifyNewRequest(request, requestType, tenantName, ownerName)
                .catch(err => console.error('Error notificando a admins:', err));

            res.status(201).json({
                success: true,
                message: 'Solicitud creada exitosamente',
                data: request
            });

        } catch (error) {
            console.error('Create request error:', error);
            res.status(500).json({ error: 'Error al crear solicitud' });
        }
    }

    /**
     * GET /api/owner/requests/:id
     * Ver detalle de una solicitud
     */
    static async getRequestById(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.userId;

            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('userId', sql.UniqueIdentifier, userId)
                .query(`
                    SELECT r.*, rt.name as request_type_name, rt.form_schema, rt.icon, rt.color,
                           p.name as property_name,
                           u.first_name + ' ' + u.last_name as created_by_name
                    FROM Requests r
                    LEFT JOIN RequestTypes rt ON r.request_type_id = rt.id
                    LEFT JOIN Properties p ON r.property_id = p.id
                    LEFT JOIN Users u ON r.user_id = u.id
                    WHERE r.id = @id AND r.user_id = @userId
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
     * GET /api/owner/requests/move-config
     * Obtener configuración de mudanzas para mostrar al crear solicitud
     */
    static async getMoveConfig(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const config = await TenantMoveConfigModel.getByTenant(tenantId);
            const availableDates = await TenantMoveConfigModel.getAvailableDates(tenantId);

            res.json({
                success: true,
                data: {
                    config: config || {
                        allowed_days: [6],
                        start_time: '08:00',
                        end_time: '17:00',
                        min_notice_days: 7,
                        require_insurance: false,
                        require_elevator_booking: false
                    },
                    availableDates
                }
            });
        } catch (error) {
            console.error('Get move config error:', error);
            res.status(500).json({ error: 'Error al obtener configuración' });
        }
    }

    // ==================== CONSULTAS (VOTACIONES) ====================

    /**
     * GET /api/owner/consultations
     * Listar consultas activas donde puede votar
     */
    static async getConsultations(req, res) {
        try {
            const userId = req.user.userId;
            const tenantId = req.user.tenantId;
            const propertyId = req.propertyId;

            if (!tenantId || !propertyId) {
                return res.status(400).json({ 
                    error: 'Se requiere tenantId y propertyId' 
                });
            }

            // Obtener edificio de la propiedad para filtrar consultas
            const pool = await connectDB();
            const propertyResult = await pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .query('SELECT building FROM Properties WHERE id = @propertyId');

            const building = propertyResult.recordset[0]?.building;

            // Consultas visibles para este propietario (tanto abiertas como cerradas)
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('userId', sql.UniqueIdentifier, userId)
                .input('building', sql.NVarChar, building)
                .query(`
                    SELECT c.*, 
                           (SELECT COUNT(*) FROM ConsultationVotes 
                            WHERE consultation_id = c.id AND user_id = @userId) as has_voted
                    FROM Consultations c
                    WHERE c.tenant_id = @tenantId
                    AND (
                        -- Activas: status OPEN y en fecha válida
                        (c.status = 'OPEN' AND c.start_date <= GETUTCDATE() AND c.end_date >= GETUTCDATE())
                        OR
                        -- Cerradas: status CLOSED (incluye las que se cerraron por fecha o manualmente)
                        (c.status = 'CLOSED')
                    )
                    AND (c.target_building IS NULL OR c.target_building = @building)
                    ORDER BY c.start_date DESC
                `);

            res.json({
                success: true,
                data: result.recordset
            });

        } catch (error) {
            console.error('Get consultations error:', error);
            res.status(500).json({ error: 'Error al obtener consultas' });
        }
    }

    /**
     * GET /api/owner/consultations/:id
     * Ver detalle de consulta con preguntas
     */
    static async getConsultationById(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.userId;
            const tenantId = req.user.tenantId;
            const propertyId = req.propertyId;

            const consultation = await ConsultationModel.findById(id, tenantId);
            
            if (!consultation) {
                return res.status(404).json({ error: 'Consulta no encontrada' });
            }

            // Verificar si ya votó
            const hasVoted = await ConsultationModel.hasUserVoted(tenantId, id, userId);
            
            // Verificar si puede votar (su unidad no ha votado aún)
            const canVote = !hasVoted && consultation.status === 'OPEN';

            res.json({
                success: true,
                data: {
                    ...consultation,
                    has_voted: hasVoted,
                    can_vote: canVote
                }
            });

        } catch (error) {
            console.error('Get consultation error:', error);
            res.status(500).json({ error: 'Error al obtener consulta' });
        }
    }

    /**
     * POST /api/owner/consultations/:id/vote
     * Votar en una consulta
     */
    static async vote(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.userId;
            const tenantId = req.user.tenantId;
            const propertyId = req.propertyId;
            const { votes } = req.body;

            if (!votes || !Array.isArray(votes)) {
                return res.status(400).json({ error: 'Formato de votos inválido' });
            }

            // Verificar que la consulta esté abierta
            const consultation = await ConsultationModel.findById(id, tenantId);
            if (!consultation) {
                return res.status(404).json({ error: 'Consulta no encontrada' });
            }

            if (consultation.status !== 'OPEN') {
                return res.status(400).json({ error: 'La consulta está cerrada' });
            }

            if (new Date(consultation.end_date) < new Date()) {
                return res.status(400).json({ error: 'La consulta ha expirado' });
            }

            // Verificar que no haya votado ya
            const hasVoted = await ConsultationModel.hasUserVoted(tenantId, id, userId);
            if (hasVoted) {
                return res.status(400).json({ error: 'Ya has votado en esta consulta' });
            }

            // Registrar votos
            await ConsultationModel.vote(tenantId, userId, id, votes);

            res.json({
                success: true,
                message: 'Voto registrado exitosamente'
            });

        } catch (error) {
            console.error('Vote error:', error);
            if (error.message === 'DUPLICATE_VOTE') {
                return res.status(400).json({ error: 'Voto duplicado' });
            }
            res.status(500).json({ error: 'Error al registrar voto' });
        }
    }

    // ==================== VISITAS ====================

    /**
     * GET /api/owner/visitors
     * Listar visitantes frecuentes de la propiedad
     */
    static async getVisitors(req, res) {
        try {
            const propertyId = req.propertyId || req.query.propertyId;
            const tenantId = req.user.tenantId;

            if (!propertyId || !tenantId) {
                return res.status(400).json({ error: 'Se requiere propertyId y tenantId' });
            }

            const pool = await connectDB();
            const result = await pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT v.*, vp.id as pass_id, vp.type as pass_type, vp.alias as pass_alias, 
                           vp.status as pass_status, vp.valid_from, vp.valid_until
                    FROM Visitors v
                    INNER JOIN VisitorPasses vp ON v.id = vp.visitor_id
                    WHERE vp.property_id = @propertyId 
                    AND vp.tenant_id = @tenantId
                    AND vp.type = 'FREQUENT'
                    AND vp.status = 'ACTIVE'
                    AND v.is_active = 1
                    ORDER BY vp.created_at DESC
                `);

            res.json({
                success: true,
                data: result.recordset
            });

        } catch (error) {
            console.error('Get visitors error:', error);
            res.status(500).json({ error: 'Error al obtener visitantes' });
        }
    }

    /**
     * PATCH /api/owner/visitors/:passId/toggle
     * Deshabilitar o habilitar visitante frecuente (actualiza pass y visitor)
     */
    static async toggleFrequentVisitor(req, res) {
        try {
            const { passId } = req.params;
            const propertyId = req.propertyId || req.query.propertyId;
            const tenantId = req.user.tenantId;
            const { action } = req.body; // 'enable' | 'disable'

            if (!propertyId || !tenantId || !passId) {
                return res.status(400).json({ error: 'Se requiere propertyId, tenantId y passId' });
            }

            const pool = await connectDB();

            const passResult = await pool.request()
                .input('passId', sql.UniqueIdentifier, passId)
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT vp.id, vp.visitor_id, vp.status, v.first_name, v.last_name
                    FROM VisitorPasses vp
                    INNER JOIN Visitors v ON vp.visitor_id = v.id
                    WHERE vp.id = @passId 
                    AND vp.property_id = @propertyId 
                    AND vp.tenant_id = @tenantId
                    AND vp.type = 'FREQUENT'
                `);

            if (passResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Visitante frecuente no encontrado o no pertenece a esta propiedad' });
            }

            const pass = passResult.recordset[0];
            const newStatus = action === 'enable' ? 'ACTIVE' : 'INACTIVE';
            const isActive = action === 'enable' ? 1 : 0;

            await pool.request()
                .input('passId', sql.UniqueIdentifier, passId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('newStatus', sql.NVarChar, newStatus)
                .query(`
                    UPDATE VisitorPasses 
                    SET status = @newStatus, updated_at = SYSDATETIME()
                    WHERE id = @passId AND tenant_id = @tenantId
                `);

            await pool.request()
                .input('visitorId', sql.UniqueIdentifier, pass.visitor_id)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('isActive', sql.Bit, isActive)
                .query(`
                    UPDATE Visitors 
                    SET is_active = @isActive
                    WHERE id = @visitorId AND tenant_id = @tenantId
                `);

            res.json({
                success: true,
                message: action === 'enable' 
                    ? 'Visitante frecuente habilitado' 
                    : 'Visitante frecuente deshabilitado y eliminado de la lista'
            });

        } catch (error) {
            console.error('Toggle frequent visitor error:', error);
            res.status(500).json({ error: 'Error al actualizar visitante frecuente' });
        }
    }

    /**
     * POST /api/owner/visitors
     * Crear visitante y pase (frecuente o único)
     */
    static async createVisitor(req, res) {
        try {
            const userId = req.user.userId;
            const propertyId = req.propertyId || req.body.property_id;
            const tenantId = req.user.tenantId;

            const {
                first_name,
                last_name,
                dni,
                phone,
                type, // 'ONE_TIME' o 'FREQUENT'
                alias, // solo para frecuentes
                valid_from,
                valid_until
            } = req.body;

            if (!tenantId || !propertyId || !first_name || !last_name || !dni) {
                return res.status(400).json({ 
                    error: 'Datos incompletos. Se requiere: first_name, last_name, dni, property_id' 
                });
            }

            const dniTrimmed = String(dni).trim();
            if (!/^\d{1,15}$/.test(dniTrimmed)) {
                return res.status(400).json({ 
                    error: 'El DNI/Cédula debe contener solo números y máximo 15 dígitos' 
                });
            }
            const phoneTrimmed = phone ? String(phone).trim().replace(/\D/g, '') : null;
            if (phoneTrimmed && !/^\d{1,15}$/.test(phoneTrimmed)) {
                return res.status(400).json({ 
                    error: 'El teléfono del visitante debe contener solo números (máx. 15 dígitos)' 
                });
            }

            // Crear o encontrar visitante
            const visitor = await VisitorModel.findOrCreate({
                tenant_id: tenantId,
                first_name,
                last_name,
                dni: dniTrimmed,
                phone: phoneTrimmed || null
            });

            // Crear pase
            // Para visitas ONE_TIME, establecer hora inicio/fin del día para cubrir todo el día
            let passValidFrom = valid_from;
            let passValidUntil = valid_until;
            
            if (type === 'ONE_TIME' && valid_from) {
                // valid_from viene como YYYY-MM-DD - usar horario Venezuela (GMT-4)
                // Inicio: 00:00 Venezuela = 04:00 UTC | Fin: 23:59:59 Venezuela = 03:59:59 UTC del día siguiente
                const visitDate = valid_from; // YYYY-MM-DD
                passValidFrom = new Date(visitDate + 'T04:00:00.000Z');
                const [y, m, d] = visitDate.split('-').map(Number);
                const endOfDayVE = new Date(Date.UTC(y, m - 1, d + 1, 3, 59, 59, 999));
                passValidUntil = endOfDayVE;
            }
            
            const pass = await VisitorModel.createPass({
                tenant_id: tenantId,
                visitor_id: visitor.id,
                user_id: userId,
                property_id: propertyId,
                type: type || 'ONE_TIME',
                alias,
                valid_from: passValidFrom || new Date(),
                valid_until: passValidUntil || null
            });

            res.status(201).json({
                success: true,
                message: 'Visitante registrado exitosamente',
                data: {
                    visitor,
                    pass
                }
            });

        } catch (error) {
            console.error('Create visitor error:', error);
            res.status(500).json({ error: 'Error al registrar visitante' });
        }
    }

    /**
     * GET /api/owner/visits/upcoming
     * Visitas programadas para los próximos días
     */
    static async getUpcomingVisits(req, res) {
        try {
            const propertyId = req.propertyId;
            const tenantId = req.user.tenantId;
            const days = parseInt(req.query.days) || 7;

            if (!propertyId || !tenantId) {
                return res.status(400).json({ error: 'Se requiere propertyId y tenantId' });
            }

            const pool = await connectDB();
            const result = await pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('days', sql.Int, days)
                .query(`
                    SELECT v.first_name, v.last_name, v.dni, v.phone,
                           vp.type, vp.alias, vp.valid_from, vp.valid_until,
                           CASE 
                               WHEN vp.type = 'ONE_TIME' THEN 'Única'
                               WHEN vp.type = 'FREQUENT' THEN 'Frecuente'
                           END as type_label
                    FROM VisitorPasses vp
                    INNER JOIN Visitors v ON vp.visitor_id = v.id
                    WHERE vp.property_id = @propertyId
                    AND vp.tenant_id = @tenantId
                    AND vp.status IN ('ACTIVE', 'PENDING')
                    AND (
                        (vp.type = 'ONE_TIME' AND CAST(vp.valid_from AS DATE) <= DATEADD(day, @days, CAST(GETDATE() AS DATE)))
                        OR vp.type = 'FREQUENT'
                    )
                    ORDER BY vp.valid_from ASC
                `);

            res.json({
                success: true,
                data: result.recordset
            });

        } catch (error) {
            console.error('Get upcoming visits error:', error);
            res.status(500).json({ error: 'Error al obtener visitas' });
        }
    }

    /**
     * GET /api/owner/visits/history
     * Historial completo de visitas con logs de entrada/salida
     */
    static async getVisitsHistory(req, res) {
        try {
            const propertyId = req.propertyId || req.query.property_id;
            const tenantId = req.user.tenantId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            if (!propertyId || !tenantId) {
                return res.status(400).json({ error: 'Se requiere propertyId y tenantId' });
            }

            const pool = await connectDB();
            
            // Obtener total de registros
            const countResult = await pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT COUNT(*) as total
                    FROM VisitorPasses vp
                    INNER JOIN Visitors v ON vp.visitor_id = v.id
                    WHERE vp.property_id = @propertyId
                    AND vp.tenant_id = @tenantId
                `);
            
            const total = countResult.recordset[0].total;
            
            // Obtener historial con logs
            const result = await pool.request()
                .input('propertyId', sql.UniqueIdentifier, propertyId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('offset', sql.Int, offset)
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT 
                        vp.id as pass_id,
                        vp.type,
                        vp.alias,
                        vp.status as pass_status,
                        vp.valid_from,
                        vp.valid_until,
                        vp.created_at as registered_at,
                        v.id as visitor_id,
                        v.first_name,
                        v.last_name,
                        v.dni as visitor_dni,
                        v.phone as visitor_phone,
                        vl.id as log_id,
                        vl.entry_time,
                        vl.exit_time,
                        vl.access_method,
                        vl.vehicle_plate,
                        CASE 
                            WHEN vl.entry_time IS NULL THEN 'PENDING'
                            WHEN vl.exit_time IS NULL THEN 'INSIDE'
                            ELSE 'COMPLETED'
                        END as visit_status
                    FROM VisitorPasses vp
                    INNER JOIN Visitors v ON vp.visitor_id = v.id
                    LEFT JOIN VisitorLogs vl ON vp.id = vl.pass_id
                    WHERE vp.property_id = @propertyId
                    AND vp.tenant_id = @tenantId
                    ORDER BY vp.created_at DESC
                    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
                `);

            res.json({
                success: true,
                data: result.recordset,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });

        } catch (error) {
            console.error('Get visits history error:', error);
            res.status(500).json({ error: 'Error al obtener historial de visitas' });
        }
    }

    // ==================== FACTURACIÓN (VISUALIZACIÓN) ====================

    /**
     * GET /api/owner/invoices
     * Listar facturas de la propiedad
     */
    static async getInvoices(req, res) {
        try {
            const propertyId = req.propertyId;
            const { status, page = 1, limit = 10 } = req.query;

            if (!propertyId) {
                return res.status(400).json({ error: 'Se requiere propertyId' });
            }

            // Por ahora retornar placeholder - módulo de facturación se implementará en Capítulo 8
            res.json({
                success: true,
                message: 'Módulo de facturación en desarrollo',
                data: [],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: 0,
                    totalPages: 0
                }
            });

        } catch (error) {
            console.error('Get invoices error:', error);
            res.status(500).json({ error: 'Error al obtener facturas' });
        }
    }

    /**
     * GET /api/owner/invoices/:id
     * Ver detalle de factura
     */
    static async getInvoiceById(req, res) {
        try {
            const { id } = req.params;
            const propertyId = req.propertyId;

            // Placeholder
            res.status(404).json({ 
                error: 'Módulo de facturación en desarrollo',
                message: 'Esta funcionalidad estará disponible próximamente'
            });

        } catch (error) {
            console.error('Get invoice error:', error);
            res.status(500).json({ error: 'Error al obtener factura' });
        }
    }

    // ==================== TASAS BCV ====================

    /**
     * GET /api/owner/exchange-rates
     * Obtener tasas de cambio BCV paginadas
     */
    static async getExchangeRates(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 4;

            const result = await BCVService.getPaginatedRates(page, limit);

            res.json({
                success: true,
                data: result.rates.map(rate => ({
                    date: rate.rate_date,
                    usd: rate.usd_rate,
                    eur: rate.eur_rate,
                    changeUsd: rate.change_percentage_usd,
                    changeEur: rate.change_percentage_eur
                })),
                pagination: result.pagination
            });

        } catch (error) {
            console.error('Get exchange rates error:', error);
            res.status(500).json({ error: 'Error al obtener tasas de cambio' });
        }
    }

    /**
     * POST /api/owner/exchange-rates/update
     * Forzar actualización de tasa BCV (solo para testing/admin)
     */
    static async forceUpdateExchangeRate(req, res) {
        try {
            const result = await BCVService.fetchAndSave();

            if (result) {
                res.json({
                    success: true,
                    message: 'Tasa actualizada exitosamente',
                    data: result
                });
            } else {
                res.status(500).json({ 
                    error: 'No se pudo actualizar la tasa',
                    message: 'Error al consultar la API BCV'
                });
            }

        } catch (error) {
            console.error('Force update exchange rate error:', error);
            res.status(500).json({ error: 'Error al actualizar tasa de cambio' });
        }
    }
}

module.exports = OwnerController;
