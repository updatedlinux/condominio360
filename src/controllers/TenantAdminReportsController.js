const { sql, connectDB } = require('../config/database');
const { getTodayVenezuela, venezuelaDateRangeToUtcBounds } = require('../utils/dateUtils');

const MAX_ROWS = 2500;

function parseYmd(s) {
    if (!s || typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return s.trim();
}

function daysBetweenInclusive(fromYmd, toYmd) {
    const a = new Date(fromYmd + 'T12:00:00Z');
    const b = new Date(toYmd + 'T12:00:00Z');
    return Math.floor((b - a) / (86400000)) + 1;
}

/**
 * Reportes de visitas y deliveries para la junta (tenant admin).
 */
class TenantAdminReportsController {
    static async visitLogs(req, res) {
        try {
            const tenantId = req.user.tenantId;
            if (!tenantId) {
                return res.status(400).json({ success: false, error: 'Se requiere condominio (tenant)' });
            }

            let from = parseYmd(req.query.from);
            let to = parseYmd(req.query.to);
            const today = getTodayVenezuela();
            if (!to) to = today;
            if (!from) {
                const t = new Date(to + 'T12:00:00Z');
                t.setUTCDate(t.getUTCDate() - 29);
                from = t.toISOString().slice(0, 10);
            }

            if (from > to) {
                return res.status(400).json({ success: false, error: 'La fecha desde no puede ser posterior a la fecha hasta' });
            }
            if (daysBetweenInclusive(from, to) > 120) {
                return res.status(400).json({ success: false, error: 'El rango máximo es 120 días' });
            }

            const { rangeStart, rangeEndExclusive } = venezuelaDateRangeToUtcBounds(from, to);
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('rangeStart', sql.DateTime2, rangeStart)
                .input('rangeEndExclusive', sql.DateTime2, rangeEndExclusive)
                .query(`
                    SELECT TOP (${MAX_ROWS + 1})
                        vl.id AS log_id,
                        vl.entry_time,
                        vl.exit_time,
                        vl.access_method,
                        vl.vehicle_plate,
                        vl.notes AS log_notes,
                        vp.id AS pass_id,
                        vp.type AS pass_type,
                        vp.status AS pass_status,
                        vp.alias AS pass_alias,
                        vp.valid_from AS pass_valid_from,
                        vp.valid_until AS pass_valid_until,
                        v.first_name AS visitor_first_name,
                        v.last_name AS visitor_last_name,
                        v.dni AS visitor_dni,
                        v.phone AS visitor_phone,
                        own.first_name AS owner_first_name,
                        own.last_name AS owner_last_name,
                        own.email AS owner_email,
                        own.dni AS owner_dni,
                        own.phone AS owner_phone,
                        p.name AS property_name,
                        b.name AS building_name
                    FROM VisitorLogs vl
                    INNER JOIN Visitors v ON vl.visitor_id = v.id
                    LEFT JOIN VisitorPasses vp ON vl.pass_id = vp.id
                    LEFT JOIN Properties p ON COALESCE(vl.property_id, vp.property_id) = p.id
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    LEFT JOIN Users own ON own.id = COALESCE(vp.user_id, vl.user_id)
                    WHERE vl.tenant_id = @tenantId
                      AND vl.entry_time >= @rangeStart
                      AND vl.entry_time < @rangeEndExclusive
                    ORDER BY vl.entry_time DESC
                `);

            const rows = result.recordset;
            const truncated = rows.length > MAX_ROWS;
            const data = truncated ? rows.slice(0, MAX_ROWS) : rows;

            res.json({
                success: true,
                from,
                to,
                truncated,
                maxRows: MAX_ROWS,
                data
            });
        } catch (error) {
            console.error('TenantAdminReportsController.visitLogs:', error);
            res.status(500).json({ success: false, error: 'Error al cargar visitas' });
        }
    }

    static async deliveries(req, res) {
        try {
            const tenantId = req.user.tenantId;
            if (!tenantId) {
                return res.status(400).json({ success: false, error: 'Se requiere condominio (tenant)' });
            }

            let from = parseYmd(req.query.from);
            let to = parseYmd(req.query.to);
            const today = getTodayVenezuela();
            if (!to) to = today;
            if (!from) {
                const t = new Date(to + 'T12:00:00Z');
                t.setUTCDate(t.getUTCDate() - 29);
                from = t.toISOString().slice(0, 10);
            }

            if (from > to) {
                return res.status(400).json({ success: false, error: 'La fecha desde no puede ser posterior a la fecha hasta' });
            }
            if (daysBetweenInclusive(from, to) > 120) {
                return res.status(400).json({ success: false, error: 'El rango máximo es 120 días' });
            }

            const { rangeStart, rangeEndExclusive } = venezuelaDateRangeToUtcBounds(from, to);
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('fromDate', sql.Date, from)
                .input('toDate', sql.Date, to)
                .input('rangeStart', sql.DateTime2, rangeStart)
                .input('rangeEndExclusive', sql.DateTime2, rangeEndExclusive)
                .query(`
                    SELECT TOP (${MAX_ROWS + 1})
                        da.id,
                        da.name AS delivery_name,
                        da.company,
                        da.tracking_number,
                        da.expected_date,
                        da.announced_at,
                        da.status,
                        da.arrival_time,
                        da.delivered_at,
                        da.notes,
                        da.created_at,
                        da.updated_at,
                        p.name AS property_name,
                        b.name AS building_name,
                        u.first_name AS owner_first_name,
                        u.last_name AS owner_last_name,
                        u.email AS owner_email,
                        u.dni AS owner_dni,
                        u.phone AS owner_phone,
                        recv.first_name AS received_by_first_name,
                        recv.last_name AS received_by_last_name
                    FROM DeliveryAnnouncements da
                    INNER JOIN Properties p ON da.property_id = p.id
                    INNER JOIN Users u ON da.user_id = u.id
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    LEFT JOIN Users recv ON da.received_by = recv.id
                    WHERE da.tenant_id = @tenantId
                      AND (
                        (da.expected_date >= @fromDate AND da.expected_date <= @toDate)
                        OR (da.arrival_time IS NOT NULL AND da.arrival_time >= @rangeStart AND da.arrival_time < @rangeEndExclusive)
                        OR (da.delivered_at IS NOT NULL AND da.delivered_at >= @rangeStart AND da.delivered_at < @rangeEndExclusive)
                      )
                    ORDER BY COALESCE(da.arrival_time, da.delivered_at, da.created_at) DESC
                `);

            const rows = result.recordset;
            const truncated = rows.length > MAX_ROWS;
            const data = truncated ? rows.slice(0, MAX_ROWS) : rows;

            res.json({
                success: true,
                from,
                to,
                truncated,
                maxRows: MAX_ROWS,
                data
            });
        } catch (error) {
            console.error('TenantAdminReportsController.deliveries:', error);
            res.status(500).json({ success: false, error: 'Error al cargar deliveries' });
        }
    }
}

module.exports = TenantAdminReportsController;
