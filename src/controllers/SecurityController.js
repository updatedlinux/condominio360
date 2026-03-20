const { sql, connectDB } = require('../config/database');
const AuditService = require('../services/AuditService');
const { getTodayVenezuela } = require('../utils/dateUtils');
const crypto = require('crypto');

/**
 * Security Controller
 * Dashboard y funcionalidades para vigilantes/seguridad
 */
class SecurityController {
    
    /**
     * GET /api/security/dashboard/status
     * Obtener estado del dashboard para polling (con hash para detectar cambios)
     */
    static async getDashboardStatus(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { date } = req.query; // Fecha opcional, default hoy
            
            if (!tenantId) {
                return res.status(400).json({ error: 'Se requiere tenantId' });
            }

            const pool = await connectDB();
            // Si no se especifica fecha, usar fecha actual en zona horaria de Venezuela (GMT-4)
            let queryDate;
            if (date) {
                queryDate = date;
            } else {
                queryDate = getTodayVenezuela();
            }

            // Contar visitas únicas pendientes de hoy
            // Usar CAST a DATE para comparar solo la parte de fecha sin hora
            const uniqueVisitsResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('queryDate', sql.Date, queryDate)
                .query(`
                    SELECT COUNT(*) as count, MAX(updated_at) as last_update
                    FROM VisitorPasses 
                    WHERE tenant_id = @tenantId
                    AND type = 'ONE_TIME'
                    AND status IN ('ACTIVE', 'PENDING')
                    AND CAST(valid_from AS DATE) = @queryDate
                `);

            // Contar visitas frecuentes activas (buscamos en VisitorPasses tipo FREQUENT)
            const frequentVisitsResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT COUNT(DISTINCT v.id) as count, MAX(vp.updated_at) as last_update
                    FROM Visitors v
                    INNER JOIN VisitorPasses vp ON v.id = vp.visitor_id
                    WHERE v.tenant_id = @tenantId
                    AND vp.type = 'FREQUENT'
                    AND vp.status = 'ACTIVE'
                    AND v.is_active = 1
                `);

            // Contar deliveries anunciados de hoy
            const deliveriesResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('date', sql.Date, queryDate)
                .query(`
                    SELECT COUNT(*) as count, MAX(created_at) as last_update
                    FROM DeliveryAnnouncements 
                    WHERE tenant_id = @tenantId
                    AND status = 'ANNOUNCED'
                    AND expected_date = @date
                `);

            // Contar mudanzas aprobadas de hoy
            const movesResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT COUNT(*) as count, MAX(r.updated_at) as last_update
                    FROM Requests r
                    INNER JOIN RequestTypes rt ON r.request_type_id = rt.id
                    WHERE r.tenant_id = @tenantId
                    AND rt.is_move_type = 1
                    AND r.status = 'APPROVED'
                `);

            // Visitas activas (dentro sin salir)
            const activeVisitsResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT COUNT(*) as count, MAX(entry_time) as last_entry
                    FROM VisitorLogs 
                    WHERE tenant_id = @tenantId
                    AND exit_time IS NULL
                `);

            const uniqueVisits = uniqueVisitsResult.recordset[0];
            const frequentVisits = frequentVisitsResult.recordset[0];
            const deliveries = deliveriesResult.recordset[0];
            const moves = movesResult.recordset[0];
            const activeVisits = activeVisitsResult.recordset[0];

            // Crear hash de los datos para detectar cambios
            const hashData = `${uniqueVisits.count}-${uniqueVisits.last_update?.getTime() || 0}-${
                frequentVisits.count}-${frequentVisits.last_update?.getTime() || 0}-${
                deliveries.count}-${deliveries.last_update?.getTime() || 0}-${
                moves.count}-${moves.last_update?.getTime() || 0}-${
                activeVisits.count}-${activeVisits.last_entry?.getTime() || 0}`;
            
            const dataHash = crypto.createHash('md5').update(hashData).digest('hex');

            res.json({
                success: true,
                data: {
                    timestamp: new Date().toISOString(),
                    hash: dataHash,
                    counts: {
                        uniqueVisits: uniqueVisits.count,
                        frequentVisits: frequentVisits.count,
                        deliveries: deliveries.count,
                        moves: moves.count,
                        activeVisits: activeVisits.count
                    },
                    lastUpdates: {
                        uniqueVisits: uniqueVisits.last_update,
                        frequentVisits: frequentVisits.last_update,
                        deliveries: deliveries.last_update,
                        moves: moves.last_update,
                        activeVisits: activeVisits.last_entry
                    }
                }
            });

        } catch (error) {
            console.error('Get dashboard status error:', error);
            res.status(500).json({ error: 'Error al obtener estado del dashboard' });
        }
    }
    
    /**
     * GET /api/security/visits
     * Listar visitas (únicas o frecuentes) del día actual
     */
    static async getVisits(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { type = 'unique', date } = req.query;
            // Si no se especifica fecha, usar fecha actual en zona horaria de Venezuela
            let queryDate;
            if (date) {
                queryDate = date;
            } else {
                queryDate = getTodayVenezuela();
            }

            if (!tenantId) {
                return res.status(400).json({ error: 'Se requiere tenantId' });
            }

            const pool = await connectDB();
            
            if (type === 'frequent') {
                // Visitas frecuentes activas con info de último acceso
                // Los visitantes frecuentes se identifican por pases (VisitorPasses) de tipo FREQUENT
                const result = await pool.request()
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT v.*, 
                               vp.id as pass_id,
                               vp.alias,
                               vp.status as pass_status,
                               p.name as property_name, p.building_id,
                               b.name as building_name,
                               u.first_name + ' ' + u.last_name as owner_name,
                               u.dni as owner_dni,
                               u.phone as owner_phone,
                               (SELECT TOP 1 vl.entry_time 
                                FROM VisitorLogs vl 
                                WHERE vl.visitor_id = v.id 
                                AND vl.exit_time IS NULL
                                ORDER BY vl.entry_time DESC) as current_entry,
                               (SELECT TOP 1 vl.entry_time 
                                FROM VisitorLogs vl 
                                WHERE vl.visitor_id = v.id 
                                ORDER BY vl.entry_time DESC) as last_entry
                        FROM VisitorPasses vp
                        INNER JOIN Visitors v ON vp.visitor_id = v.id
                        INNER JOIN Properties p ON vp.property_id = p.id
                        INNER JOIN Users u ON vp.user_id = u.id
                        LEFT JOIN Buildings b ON p.building_id = b.id
                        WHERE vp.tenant_id = @tenantId
                        AND vp.type = 'FREQUENT'
                        AND vp.status = 'ACTIVE'
                        AND v.is_active = 1
                        ORDER BY vp.created_at DESC
                    `);
                
                console.log(`[DEBUG] searchVisits frequent: found ${result.recordset.length} results`);
                return res.json({ success: true, data: result.recordset });
            } else {
                // Visitas únicas del día especificado
                const result = await pool.request()
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .input('queryDate', sql.Date, queryDate)
                    .query(`
                        SELECT vp.*, 
                               v.first_name, v.last_name, v.dni as visitor_dni,
                               p.name as property_name, p.building_id,
                               b.name as building_name,
                               u.first_name + ' ' + u.last_name as owner_name,
                               u.email as owner_email,
                               u.dni as owner_dni,
                               u.phone as owner_phone,
                               vl.id as log_id,
                               vl.entry_time,
                               vl.exit_time,
                               vl.access_method,
                               vl.vehicle_plate
                        FROM VisitorPasses vp
                        INNER JOIN Visitors v ON vp.visitor_id = v.id
                        INNER JOIN Properties p ON vp.property_id = p.id
                        INNER JOIN Users u ON vp.user_id = u.id
                        LEFT JOIN Buildings b ON p.building_id = b.id
                        LEFT JOIN VisitorLogs vl ON vp.visitor_id = vl.visitor_id 
                            AND vl.pass_id = vp.id
                            AND CAST(vl.entry_time AS DATE) = @queryDate
                        WHERE vp.tenant_id = @tenantId
                        AND vp.type = 'ONE_TIME'
                        AND vp.status IN ('ACTIVE', 'PENDING', 'USED')
                        AND CAST(vp.valid_from AS DATE) = @queryDate
                        ORDER BY vp.valid_from
                    `);
                
                return res.json({ success: true, data: result.recordset });
            }

        } catch (error) {
            console.error('Get visits error:', error);
            res.status(500).json({ error: 'Error al obtener visitas' });
        }
    }

    /**
     * GET /api/security/owners/search?q=DNI
     * Buscar propietarios por DNI (para validar en modales de visita/delivery manual)
     * Usa PropertyOwners + Properties (schema correcto)
     */
    static async searchOwnersByDni(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { q } = req.query;

            if (!q || q.trim().length < 5) {
                return res.status(400).json({ 
                    error: 'Ingrese al menos 5 caracteres (ej: DNI completo)' 
                });
            }
            const dniClean = q.trim().replace(/\D/g, '');
            if (!dniClean || dniClean.length > 15) {
                return res.status(400).json({ 
                    error: 'El DNI debe contener solo números (máx. 15 dígitos)' 
                });
            }

            const pool = await connectDB();
            const dni = dniClean;

            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('dni', sql.NVarChar, dni)
                .query(`
                    SELECT u.id, u.first_name, u.last_name, u.dni, u.email, u.phone,
                           p.id as property_id, p.name as property_name, p.building
                    FROM Users u
                    INNER JOIN PropertyOwners po ON u.id = po.user_id
                    INNER JOIN Properties p ON po.property_id = p.id
                    WHERE p.tenant_id = @tenantId
                    AND u.dni = @dni
                    ORDER BY po.is_primary_owner DESC
                `);

            return res.json({ 
                success: true, 
                data: result.recordset 
            });
        } catch (error) {
            console.error('Search owners by DNI error:', error);
            res.status(500).json({ success: false, error: 'Error al buscar propietario' });
        }
    }

    /**
     * GET /api/security/visits/search
     * Buscar visitas por DNI del visitante o datos del propietario
     */
    static async searchVisits(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { q, type = 'unique' } = req.query;

            if (!tenantId) {
                return res.status(400).json({ error: 'Se requiere tenantId' });
            }

            if (!q || q.trim().length < 2) {
                return res.status(400).json({ 
                    error: 'Término de búsqueda debe tener al menos 2 caracteres' 
                });
            }

            console.log(`[DEBUG] searchVisits: type=${type}, query="${q.trim()}"`);

            const pool = await connectDB();
            const searchTerm = `%${q.trim()}%`;

            if (type === 'frequent') {
                const result = await pool.request()
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .input('search', sql.NVarChar, searchTerm)
                    .query(`
                        SELECT v.*, 
                               vp.id as pass_id,
                               vp.alias,
                               p.name as property_name,
                               b.name as building_name,
                               u.first_name + ' ' + u.last_name as owner_name,
                               u.email as owner_email,
                               u.dni as owner_dni,
                               (SELECT TOP 1 vl.entry_time 
                                FROM VisitorLogs vl 
                                WHERE vl.pass_id = vp.id 
                                AND vl.exit_time IS NULL
                                ORDER BY vl.entry_time DESC) as current_entry,
                               (SELECT TOP 1 vl.id 
                                FROM VisitorLogs vl 
                                WHERE vl.pass_id = vp.id 
                                AND vl.exit_time IS NULL
                                ORDER BY vl.entry_time DESC) as active_log_id
                        FROM VisitorPasses vp
                        INNER JOIN Visitors v ON vp.visitor_id = v.id
                        INNER JOIN Properties p ON vp.property_id = p.id
                        INNER JOIN Users u ON vp.user_id = u.id
                        LEFT JOIN Buildings b ON p.building_id = b.id
                        WHERE vp.tenant_id = @tenantId
                        AND vp.type = 'FREQUENT'
                        AND vp.status = 'ACTIVE'
                        AND v.is_active = 1
                        AND (
                            v.dni LIKE @search
                            OR v.first_name LIKE @search
                            OR v.last_name LIKE @search
                            OR u.first_name LIKE @search
                            OR u.last_name LIKE @search
                            OR u.email LIKE @search
                            OR u.dni LIKE @search
                        )
                        ORDER BY vp.created_at DESC
                    `);
                
                return res.json({ success: true, data: result.recordset });
            } else {
                const result = await pool.request()
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .input('search', sql.NVarChar, searchTerm)
                    .query(`
                        SELECT vp.*, 
                               v.first_name, v.last_name, v.dni as visitor_dni,
                               p.name as property_name,
                               b.name as building_name,
                               u.first_name + ' ' + u.last_name as owner_name,
                               u.email as owner_email,
                               u.dni as owner_dni,
                               vl.id as log_id,
                               vl.entry_time,
                               vl.exit_time,
                               vl.access_method,
                               vl.vehicle_plate
                        FROM VisitorPasses vp
                        INNER JOIN Visitors v ON vp.visitor_id = v.id
                        INNER JOIN Properties p ON vp.property_id = p.id
                        INNER JOIN Users u ON vp.user_id = u.id
                        LEFT JOIN Buildings b ON p.building_id = b.id
                        LEFT JOIN VisitorLogs vl ON vp.visitor_id = vl.visitor_id 
                            AND vl.pass_id = vp.id
                        WHERE vp.tenant_id = @tenantId
                        AND vp.type = 'ONE_TIME'
                        AND vp.status IN ('ACTIVE', 'PENDING', 'USED')
                        AND (
                            v.dni LIKE @search
                            OR v.first_name LIKE @search
                            OR v.last_name LIKE @search
                            OR u.dni LIKE @search
                            OR u.first_name LIKE @search
                            OR u.last_name LIKE @search
                            OR u.email LIKE @search
                            OR p.name LIKE @search
                        )
                        ORDER BY vp.valid_from DESC
                    `);
                
                return res.json({ success: true, data: result.recordset });
            }

        } catch (error) {
            console.error('Search visits error:', error);
            res.status(500).json({ error: 'Error al buscar visitas' });
        }
    }

    /**
     * POST /api/security/visits/:id/entry
     * Registrar entrada de visita
     */
    static async registerVisitEntry(req, res) {
        try {
            const { id } = req.params;
            const securityUserId = req.user.userId;
            const tenantId = req.user.tenantId;
            const { access_method = 'PEDESTRIAN', vehicle_plate } = req.body;

            const pool = await connectDB();
            
            // Obtener información del pase (validar que pertenezca al tenant)
            const passResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT vp.id, vp.tenant_id, vp.property_id, vp.user_id, vp.status, vp.type,
                           v.id as visitor_id, v.first_name, v.last_name, v.dni
                    FROM VisitorPasses vp
                    INNER JOIN Visitors v ON vp.visitor_id = v.id
                    WHERE vp.id = @id AND vp.tenant_id = @tenantId
                `);

            if (passResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Pase no encontrado o no pertenece a este condominio' });
            }

            const pass = passResult.recordset[0];

            // Verificar si ya tiene entrada activa
            const existingEntry = await pool.request()
                .input('passId', sql.UniqueIdentifier, id)
                .query(`
                    SELECT TOP 1 * FROM VisitorLogs 
                    WHERE pass_id = @passId AND exit_time IS NULL
                    ORDER BY entry_time DESC
                `);

            if (existingEntry.recordset.length > 0) {
                return res.status(400).json({ 
                    error: 'Esta visita ya tiene una entrada activa',
                    entry: existingEntry.recordset[0]
                });
            }

            // Registrar entrada en VisitorLogs
            // Usar hora actual UTC correcta (el servidor SQL tiene hora mal configurada)
            const now = new Date();
            
            const logResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('visitor_id', sql.UniqueIdentifier, pass.visitor_id)
                .input('pass_id', sql.UniqueIdentifier, id)
                .input('property_id', sql.UniqueIdentifier, pass.property_id)
                .input('user_id', sql.UniqueIdentifier, pass.user_id)
                .input('access_method', sql.NVarChar, access_method)
                .input('vehicle_plate', sql.NVarChar, vehicle_plate || null)
                .input('entry_time', sql.DateTime2, now)
                .query(`
                    INSERT INTO VisitorLogs 
                        (tenant_id, visitor_id, pass_id, property_id, user_id, access_method, vehicle_plate, entry_time)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @visitor_id, @pass_id, @property_id, @user_id, @access_method, @vehicle_plate, @entry_time)
                `);

            // Actualizar estado del pase (solo si pertenece al tenant)
            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    UPDATE VisitorPasses 
                    SET status = 'USED', 
                        updated_at = SYSDATETIME()
                    WHERE id = @id AND tenant_id = @tenantId
                `);

            await AuditService.log({
                tenantId,
                actorId: securityUserId,
                action: 'VISIT_ENTRY_REGISTERED',
                entityType: 'VISITOR_PASS',
                entityId: id,
                metadata: { 
                    visitor_name: `${pass.first_name} ${pass.last_name}`,
                    access_method,
                    vehicle_plate
                }
            });

            res.json({ 
                success: true, 
                message: 'Entrada registrada exitosamente',
                log: logResult.recordset[0]
            });

        } catch (error) {
            console.error('Register entry error:', error);
            res.status(500).json({ error: 'Error al registrar entrada' });
        }
    }

    /**
     * POST /api/security/visits/:id/exit
     * Registrar salida de visita
     */
    static async registerVisitExit(req, res) {
        try {
            const { id } = req.params; // Puede ser log_id o pass_id
            const securityUserId = req.user.userId;
            const tenantId = req.user.tenantId;

            const pool = await connectDB();
            
            // Buscar entrada activa por pass_id
            let logResult = await pool.request()
                .input('passId', sql.UniqueIdentifier, id)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT vl.*, v.first_name, v.last_name
                    FROM VisitorLogs vl
                    INNER JOIN Visitors v ON vl.visitor_id = v.id
                    WHERE vl.pass_id = @passId 
                    AND vl.tenant_id = @tenantId
                    AND vl.exit_time IS NULL
                    ORDER BY vl.entry_time DESC
                `);

            // Si no se encuentra por pass_id, buscar por log_id directamente
            if (logResult.recordset.length === 0) {
                logResult = await pool.request()
                    .input('logId', sql.UniqueIdentifier, id)
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT vl.*, v.first_name, v.last_name
                        FROM VisitorLogs vl
                        INNER JOIN Visitors v ON vl.visitor_id = v.id
                        WHERE vl.id = @logId 
                        AND vl.tenant_id = @tenantId
                        AND vl.exit_time IS NULL
                    `);
            }

            if (logResult.recordset.length === 0) {
                return res.status(404).json({ 
                    error: 'No se encontró entrada activa para esta visita' 
                });
            }

            const log = logResult.recordset[0];

            // Registrar salida
            const now = new Date();
            
            const updateResult = await pool.request()
                .input('id', sql.UniqueIdentifier, log.id)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('exit_time', sql.DateTime2, now)
                .query(`
                    UPDATE VisitorLogs 
                    SET exit_time = @exit_time
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenantId
                `);

            await AuditService.log({
                tenantId,
                actorId: securityUserId,
                action: 'VISIT_EXIT_REGISTERED',
                entityType: 'VISITOR_LOG',
                entityId: log.id,
                metadata: { 
                    visitor_name: `${log.first_name} ${log.last_name}`,
                    entry_time: log.entry_time,
                    duration_minutes: Math.round((new Date() - new Date(log.entry_time)) / 60000)
                }
            });

            res.json({ 
                success: true, 
                message: 'Salida registrada exitosamente',
                log: updateResult.recordset[0]
            });

        } catch (error) {
            console.error('Register exit error:', error);
            res.status(500).json({ error: 'Error al registrar salida' });
        }
    }

    /**
     * POST /api/security/frequent-visits/:id/entry
     * Registrar entrada de visita frecuente (acceso directo sin pase previo)
     */
    static async registerFrequentVisitEntry(req, res) {
        try {
            const { id } = req.params; // visitor_id
            const securityUserId = req.user.userId;
            const tenantId = req.user.tenantId;
            const { access_method = 'PEDESTRIAN', vehicle_plate } = req.body;

            const pool = await connectDB();
            
            // Obtener información del visitante frecuente
            // El id es el visitor_id, buscamos el pase FREQUENT activo
            const visitorResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT v.*, vp.id as pass_id, vp.user_id, vp.property_id
                    FROM Visitors v
                    INNER JOIN VisitorPasses vp ON v.id = vp.visitor_id
                    WHERE v.id = @id 
                    AND vp.tenant_id = @tenantId
                    AND vp.type = 'FREQUENT'
                    AND vp.status = 'ACTIVE'
                    AND v.is_active = 1
                `);

            if (visitorResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Visitante frecuente no encontrado o inactivo' });
            }

            const visitor = visitorResult.recordset[0];

            // Verificar si ya tiene entrada activa
            const existingEntry = await pool.request()
                .input('visitorId', sql.UniqueIdentifier, id)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT TOP 1 * FROM VisitorLogs 
                    WHERE visitor_id = @visitorId 
                    AND tenant_id = @tenantId
                    AND exit_time IS NULL
                    ORDER BY entry_time DESC
                `);

            if (existingEntry.recordset.length > 0) {
                return res.status(400).json({ 
                    error: 'Este visitante ya tiene una entrada activa',
                    entry: existingEntry.recordset[0]
                });
            }

            // Registrar entrada en VisitorLogs (con pass_id para vincular con el historial del propietario)
            const now = new Date();
            
            const logResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('visitor_id', sql.UniqueIdentifier, id)
                .input('pass_id', sql.UniqueIdentifier, visitor.pass_id)
                .input('property_id', sql.UniqueIdentifier, visitor.property_id)
                .input('user_id', sql.UniqueIdentifier, visitor.user_id)
                .input('access_method', sql.NVarChar, access_method)
                .input('vehicle_plate', sql.NVarChar, vehicle_plate || null)
                .input('entry_time', sql.DateTime2, now)
                .query(`
                    INSERT INTO VisitorLogs 
                        (tenant_id, visitor_id, pass_id, property_id, user_id, access_method, vehicle_plate, entry_time)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @visitor_id, @pass_id, @property_id, @user_id, @access_method, @vehicle_plate, @entry_time)
                `);

            await AuditService.log({
                tenantId,
                actorId: securityUserId,
                action: 'FREQUENT_VISIT_ENTRY',
                entityType: 'VISITOR_LOG',
                entityId: logResult.recordset[0].id,
                metadata: { 
                    visitor_name: `${visitor.first_name} ${visitor.last_name}`,
                    visitor_dni: visitor.dni,
                    access_method,
                    vehicle_plate
                }
            });

            res.json({ 
                success: true, 
                message: 'Entrada de visita frecuente registrada',
                log: logResult.recordset[0]
            });

        } catch (error) {
            console.error('Register frequent visit entry error:', error);
            res.status(500).json({ error: 'Error al registrar entrada' });
        }
    }

    /**
     * POST /api/security/visits/manual
     * Crear visita única manualmente (para tercera edad que llama por teléfono)
     */
    static async createManualVisit(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const securityUserId = req.user.userId;
            const { 
                owner_dni, 
                property_id: propertyIdParam,
                visitor_first_name, 
                visitor_last_name, 
                visitor_dni, 
                visitor_phone,
                visit_date,
                visit_time,
                vehicle_plate,
                notes 
            } = req.body;

            // Validaciones
            if (!owner_dni || !visitor_first_name || !visitor_last_name || !visitor_dni || !visit_date) {
                return res.status(400).json({ 
                    error: 'Faltan campos requeridos: owner_dni, visitor_first_name, visitor_last_name, visitor_dni, visit_date' 
                });
            }
            const ownerDniTrimmed = String(owner_dni).trim().replace(/\D/g, '');
            const visitorDniTrimmed = String(visitor_dni).trim().replace(/\D/g, '');
            if (!/^\d{1,15}$/.test(ownerDniTrimmed) || !/^\d{1,15}$/.test(visitorDniTrimmed)) {
                return res.status(400).json({ 
                    error: 'El DNI del propietario y del visitante deben contener solo números (máx. 15 dígitos)' 
                });
            }
            const visitorPhoneTrimmed = visitor_phone ? String(visitor_phone).trim().replace(/\D/g, '') : null;
            if (visitorPhoneTrimmed && !/^\d{1,15}$/.test(visitorPhoneTrimmed)) {
                return res.status(400).json({ 
                    error: 'El teléfono del visitante debe contener solo números (máx. 15 dígitos)' 
                });
            }

            const pool = await connectDB();

            // Buscar propietario por DNI (schema: PropertyOwners + Properties)
            const ownerResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('dni', sql.NVarChar, ownerDniTrimmed)
                .query(`
                    SELECT u.id, u.first_name, u.last_name, u.dni, u.email, u.phone,
                           p.id as property_id, p.name as property_name
                    FROM Users u
                    INNER JOIN PropertyOwners po ON u.id = po.user_id
                    INNER JOIN Properties p ON po.property_id = p.id
                    WHERE p.tenant_id = @tenantId
                    AND u.dni = @dni
                    ORDER BY po.is_primary_owner DESC
                `);

            if (ownerResult.recordset.length === 0) {
                return res.status(404).json({ 
                    error: 'No se encontró propietario con ese DNI' 
                });
            }

            let owner = ownerResult.recordset[0];
            const properties = ownerResult.recordset;
            if (propertyIdParam) {
                const matched = properties.find(p => String(p.property_id) === String(propertyIdParam));
                if (!matched) {
                    return res.status(400).json({ error: 'El inmueble seleccionado no pertenece al propietario' });
                }
                owner = matched;
            } else if (properties.length > 1) {
                return res.status(400).json({ 
                    error: 'El propietario tiene varios inmuebles. Seleccione el inmueble correspondiente.' 
                });
            }

            // Crear o buscar visitante
            let visitorResult = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('dni', sql.NVarChar, visitorDniTrimmed)
                .query(`
                    SELECT * FROM Visitors 
                    WHERE tenant_id = @tenantId AND dni = @dni
                `);

            let visitorId;
            if (visitorResult.recordset.length === 0) {
                // Crear nuevo visitante (solo datos básicos)
                const newVisitor = await pool.request()
                    .input('tenant_id', sql.UniqueIdentifier, tenantId)
                    .input('first_name', sql.NVarChar, visitor_first_name)
                    .input('last_name', sql.NVarChar, visitor_last_name)
                    .input('dni', sql.NVarChar, visitorDniTrimmed)
                    .input('phone', sql.NVarChar, visitorPhoneTrimmed || null)
                    .query(`
                        INSERT INTO Visitors (tenant_id, first_name, last_name, dni, phone)
                        OUTPUT INSERTED.*
                        VALUES (@tenant_id, @first_name, @last_name, @dni, @phone)
                    `);
                visitorId = newVisitor.recordset[0].id;
            } else {
                visitorId = visitorResult.recordset[0].id;
            }

            // Crear pase de visita - usar horario Venezuela (GMT-4)
            // visit_date viene como YYYY-MM-DD
            const validFrom = new Date(visit_date + 'T04:00:00.000Z'); // 00:00 Venezuela
            if (visit_time) {
                const [hours, minutes] = visit_time.split(':');
                validFrom.setUTCHours(validFrom.getUTCHours() + parseInt(hours || 0), parseInt(minutes || 0), 0, 0);
            }
            const [y, m, d] = visit_date.split('-').map(Number);
            const validUntil = visit_time
                ? new Date(validFrom.getTime() + 24 * 60 * 60 * 1000) // 24h desde hora estimada
                : new Date(Date.UTC(y, m - 1, d + 1, 3, 59, 59, 999)); // 23:59:59 Venezuela (fin del día)

            const passResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('visitor_id', sql.UniqueIdentifier, visitorId)
                .input('user_id', sql.UniqueIdentifier, owner.id)
                .input('property_id', sql.UniqueIdentifier, owner.property_id)
                .input('type', sql.NVarChar, 'ONE_TIME')
                .input('valid_from', sql.DateTime2, validFrom)
                .input('valid_until', sql.DateTime2, validUntil)
                .query(`
                    INSERT INTO VisitorPasses 
                        (tenant_id, visitor_id, user_id, property_id, type, valid_from, valid_until, status)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @visitor_id, @user_id, @property_id, @type, @valid_from, @valid_until, 'PENDING')
                `);

            // Registrar en auditoría
            await AuditService.log({
                tenantId,
                actorId: securityUserId,
                action: 'MANUAL_VISIT_CREATED',
                entityType: 'VISITOR_PASS',
                entityId: passResult.recordset[0].id,
                metadata: { 
                    visitor_name: `${visitor_first_name} ${visitor_last_name}`,
                    owner_dni,
                    visit_date,
                    visit_time,
                    created_by: 'security_guard'
                }
            });

            res.status(201).json({
                success: true,
                message: 'Visita registrada exitosamente',
                data: {
                    pass: passResult.recordset[0],
                    owner: {
                        name: `${owner.first_name} ${owner.last_name}`,
                        dni: owner.dni,
                        property: owner.property_name
                    }
                }
            });

        } catch (error) {
            console.error('Create manual visit error:', error);
            res.status(500).json({ error: 'Error al registrar visita manual' });
        }
    }

    /**
     * GET /api/security/moves
     * Listar mudanzas autorizadas
     */
    static async getApprovedMoves(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { status = 'APPROVED', date } = req.query;

            if (!tenantId) {
                return res.status(400).json({ error: 'Se requiere tenantId' });
            }

            const pool = await connectDB();
            
            let dateFilter = '';
            if (date) {
                dateFilter = `AND CAST(JSON_VALUE(r.data, '$.move_date') AS DATE) = @date`;
            }
            
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('status', sql.NVarChar, status)
                .input('date', sql.Date, date || null)
                .query(`
                    SELECT r.id, r.tenant_id, r.user_id, r.property_id, r.request_type_id, 
                           r.status, r.data, r.resolution_notes, r.created_at, r.updated_at,
                           p.name as property_name, p.building_id,
                           b.name as building_name,
                           u.first_name + ' ' + u.last_name as owner_name,
                           u.phone as owner_phone, u.dni as owner_dni,
                           rt.name as request_type_name, rt.form_schema
                    FROM Requests r
                    INNER JOIN Properties p ON r.property_id = p.id
                    INNER JOIN Users u ON r.user_id = u.id
                    INNER JOIN RequestTypes rt ON r.request_type_id = rt.id
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    WHERE r.tenant_id = @tenantId
                    AND rt.is_move_type = 1
                    AND r.status = @status
                    ${date ? dateFilter : ''}
                    ORDER BY r.created_at DESC
                `);

            // Parsear data y form_schema
            const moves = result.recordset.map(m => ({
                ...m,
                data: m.data ? JSON.parse(m.data) : null,
                form_schema: m.form_schema ? JSON.parse(m.form_schema) : null
            }));

            res.json({ success: true, data: moves });

        } catch (error) {
            console.error('Get moves error:', error);
            res.status(500).json({ error: 'Error al obtener mudanzas' });
        }
    }

    /**
     * GET /api/security/moves/search
     * Buscar mudanzas por DNI del propietario
     */
    static async searchMoves(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { q } = req.query;

            if (!tenantId) {
                return res.status(400).json({ error: 'Se requiere tenantId' });
            }

            if (!q || q.trim().length < 2) {
                return res.status(400).json({ 
                    error: 'Término de búsqueda debe tener al menos 2 caracteres' 
                });
            }

            const pool = await connectDB();
            const searchTerm = `%${q.trim()}%`;

            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('search', sql.NVarChar, searchTerm)
                .query(`
                    SELECT r.id, r.tenant_id, r.user_id, r.property_id, r.request_type_id, 
                           r.status, r.data, r.resolution_notes, r.created_at, r.updated_at,
                           p.name as property_name, p.building_id,
                           b.name as building_name,
                           u.first_name + ' ' + u.last_name as owner_name,
                           u.phone as owner_phone, u.dni as owner_dni,
                           rt.name as request_type_name, rt.form_schema
                    FROM Requests r
                    INNER JOIN Properties p ON r.property_id = p.id
                    INNER JOIN Users u ON r.user_id = u.id
                    INNER JOIN RequestTypes rt ON r.request_type_id = rt.id
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    WHERE r.tenant_id = @tenantId
                    AND rt.is_move_type = 1
                    AND (
                        u.dni LIKE @search
                        OR u.first_name LIKE @search
                        OR u.last_name LIKE @search
                        OR u.phone LIKE @search
                        OR p.name LIKE @search
                    )
                    ORDER BY r.created_at DESC
                `);

            // Parsear data y form_schema
            const moves = result.recordset.map(m => ({
                ...m,
                data: m.data ? JSON.parse(m.data) : null,
                form_schema: m.form_schema ? JSON.parse(m.form_schema) : null
            }));

            res.json({ success: true, data: moves });

        } catch (error) {
            console.error('Search moves error:', error);
            res.status(500).json({ error: 'Error al buscar mudanzas' });
        }
    }

    /**
     * GET /api/security/active-visits
     * Listar visitas activas (dentro sin salir)
     */
    static async getActiveVisits(req, res) {
        try {
            const tenantId = req.user.tenantId;

            if (!tenantId) {
                return res.status(400).json({ error: 'Se requiere tenantId' });
            }

            const pool = await connectDB();
            
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT vl.*, 
                           v.first_name, v.last_name, v.dni,
                           p.name as property_name,
                           b.name as building_name,
                           u.first_name + ' ' + u.last_name as owner_name
                    FROM VisitorLogs vl
                    INNER JOIN Visitors v ON vl.visitor_id = v.id
                    LEFT JOIN Properties p ON vl.property_id = p.id
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    LEFT JOIN Users u ON vl.user_id = u.id
                    WHERE vl.tenant_id = @tenantId
                    AND vl.exit_time IS NULL
                    ORDER BY vl.entry_time DESC
                `);

            res.json({ success: true, data: result.recordset });

        } catch (error) {
            console.error('Get active visits error:', error);
            res.status(500).json({ error: 'Error al obtener visitas activas' });
        }
    }
}

module.exports = SecurityController;
