const ExcelJS = require('exceljs');
const { sql, connectDB } = require('../config/database');
const { getTodayVenezuela, venezuelaDateRangeToUtcBounds } = require('../utils/dateUtils');

const MAX_JSON_ROWS = 2500;
const MAX_EXPORT_ROWS = 50000;

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

function resolveVisitDateRange(req) {
    const tenantId = req.user.tenantId;
    if (!tenantId) {
        return { ok: false, status: 400, error: 'Se requiere condominio (tenant)' };
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
        return { ok: false, status: 400, error: 'La fecha desde no puede ser posterior a la fecha hasta' };
    }
    if (daysBetweenInclusive(from, to) > 120) {
        return { ok: false, status: 400, error: 'El rango máximo es 120 días' };
    }

    const { rangeStart, rangeEndExclusive } = venezuelaDateRangeToUtcBounds(from, to);
    return { ok: true, tenantId, from, to, rangeStart, rangeEndExclusive };
}

function resolveDeliveriesDateRange(req) {
    return resolveVisitDateRange(req);
}

function visitAccessLabel(m) {
    if (m === 'VEHICLE') return 'Vehículo';
    return 'Peatonal';
}

function passTypeLabel(t) {
    if (t === 'FREQUENT') return 'Frecuente';
    if (t === 'ONE_TIME') return 'Única';
    return t || '';
}

function passStatusLabel(s) {
    const map = { ACTIVE: 'Activo', USED: 'Usado', PENDING: 'Pendiente', EXPIRED: 'Expirado', REVOKED: 'Revocado' };
    return map[s] || s || '';
}

function deliveryStatusLabel(s) {
    const map = { ANNOUNCED: 'Anunciado', ARRIVED: 'En portería', DELIVERED: 'Entregado', CANCELLED: 'Cancelado' };
    return map[s] || s || '';
}

async function fetchVisitLogRows(tenantId, rangeStart, rangeEndExclusive, topN) {
    const pool = await connectDB();
    const result = await pool.request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('rangeStart', sql.DateTime2, rangeStart)
        .input('rangeEndExclusive', sql.DateTime2, rangeEndExclusive)
        .query(`
            SELECT TOP (${topN})
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
    return result.recordset;
}

async function fetchDeliveryRows(tenantId, from, to, rangeStart, rangeEndExclusive, topN) {
    const pool = await connectDB();
    const result = await pool.request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('fromDate', sql.Date, from)
        .input('toDate', sql.Date, to)
        .input('rangeStart', sql.DateTime2, rangeStart)
        .input('rangeEndExclusive', sql.DateTime2, rangeEndExclusive)
        .query(`
            SELECT TOP (${topN})
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
    return result.recordset;
}

/**
 * Reportes de visitas y deliveries para la junta (tenant admin).
 */
class TenantAdminReportsController {
    static async visitLogs(req, res) {
        try {
            const r = resolveVisitDateRange(req);
            if (!r.ok) {
                return res.status(r.status).json({ success: false, error: r.error });
            }

            const rows = await fetchVisitLogRows(r.tenantId, r.rangeStart, r.rangeEndExclusive, MAX_JSON_ROWS + 1);
            const truncated = rows.length > MAX_JSON_ROWS;
            const data = truncated ? rows.slice(0, MAX_JSON_ROWS) : rows;

            res.json({
                success: true,
                from: r.from,
                to: r.to,
                truncated,
                maxRows: MAX_JSON_ROWS,
                data
            });
        } catch (error) {
            console.error('TenantAdminReportsController.visitLogs:', error);
            res.status(500).json({ success: false, error: 'Error al cargar visitas' });
        }
    }

    static async deliveries(req, res) {
        try {
            const r = resolveDeliveriesDateRange(req);
            if (!r.ok) {
                return res.status(r.status).json({ success: false, error: r.error });
            }

            const rows = await fetchDeliveryRows(
                r.tenantId,
                r.from,
                r.to,
                r.rangeStart,
                r.rangeEndExclusive,
                MAX_JSON_ROWS + 1
            );
            const truncated = rows.length > MAX_JSON_ROWS;
            const data = truncated ? rows.slice(0, MAX_JSON_ROWS) : rows;

            res.json({
                success: true,
                from: r.from,
                to: r.to,
                truncated,
                maxRows: MAX_JSON_ROWS,
                data
            });
        } catch (error) {
            console.error('TenantAdminReportsController.deliveries:', error);
            res.status(500).json({ success: false, error: 'Error al cargar deliveries' });
        }
    }

    static async visitLogsExportExcel(req, res) {
        try {
            const r = resolveVisitDateRange(req);
            if (!r.ok) {
                return res.status(r.status).json({ success: false, error: r.error });
            }

            const rows = await fetchVisitLogRows(r.tenantId, r.rangeStart, r.rangeEndExclusive, MAX_EXPORT_ROWS);
            const capped = rows.length >= MAX_EXPORT_ROWS;

            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Condominio360';
            const sheet = workbook.addWorksheet('Visitas');
            sheet.columns = [
                { header: 'Entrada', key: 'entry_time', width: 20 },
                { header: 'Salida', key: 'exit_time', width: 20 },
                { header: 'Estado visita', key: 'visit_state', width: 14 },
                { header: 'Acceso', key: 'access', width: 12 },
                { header: 'Placa', key: 'vehicle_plate', width: 12 },
                { header: 'Visitante (nombre)', key: 'visitor_first_name', width: 16 },
                { header: 'Visitante (apellido)', key: 'visitor_last_name', width: 16 },
                { header: 'Visitante DNI', key: 'visitor_dni', width: 14 },
                { header: 'Visitante teléfono', key: 'visitor_phone', width: 16 },
                { header: 'Edificio/Calle', key: 'building_name', width: 18 },
                { header: 'Inmueble', key: 'property_name', width: 18 },
                { header: 'Propietario (nombre)', key: 'owner_first_name', width: 16 },
                { header: 'Propietario (apellido)', key: 'owner_last_name', width: 16 },
                { header: 'Propietario email', key: 'owner_email', width: 28 },
                { header: 'Propietario teléfono', key: 'owner_phone', width: 16 },
                { header: 'Propietario DNI', key: 'owner_dni', width: 14 },
                { header: 'Tipo de pase', key: 'pass_type', width: 14 },
                { header: 'Estado del pase', key: 'pass_status', width: 14 },
                { header: 'Alias (frecuente)', key: 'pass_alias', width: 18 },
                { header: 'Pase válido desde', key: 'pass_valid_from', width: 20 },
                { header: 'Pase válido hasta', key: 'pass_valid_until', width: 20 },
                { header: 'Notas (bitácora)', key: 'log_notes', width: 36 },
                { header: 'ID registro', key: 'log_id', width: 38 }
            ];
            sheet.getRow(1).font = { bold: true };

            rows.forEach((row) => {
                sheet.addRow({
                    entry_time: row.entry_time || null,
                    exit_time: row.exit_time || null,
                    visit_state: row.exit_time ? 'Salió' : 'Dentro',
                    access: visitAccessLabel(row.access_method),
                    vehicle_plate: row.vehicle_plate || '',
                    visitor_first_name: row.visitor_first_name || '',
                    visitor_last_name: row.visitor_last_name || '',
                    visitor_dni: row.visitor_dni || '',
                    visitor_phone: row.visitor_phone || '',
                    building_name: row.building_name || '',
                    property_name: row.property_name || '',
                    owner_first_name: row.owner_first_name || '',
                    owner_last_name: row.owner_last_name || '',
                    owner_email: row.owner_email || '',
                    owner_phone: row.owner_phone || '',
                    owner_dni: row.owner_dni || '',
                    pass_type: passTypeLabel(row.pass_type),
                    pass_status: passStatusLabel(row.pass_status),
                    pass_alias: row.pass_alias || '',
                    pass_valid_from: row.pass_valid_from || null,
                    pass_valid_until: row.pass_valid_until || null,
                    log_notes: row.log_notes || '',
                    log_id: row.log_id ? String(row.log_id) : ''
                });
            });

            if (capped) {
                const noteRow = sheet.addRow([]);
                noteRow.getCell(1).value =
                    `NOTA: La exportación incluye como máximo ${MAX_EXPORT_ROWS} filas. Acorte el rango de fechas si necesita el historial completo.`;
                sheet.mergeCells(noteRow.number, 1, noteRow.number, sheet.columns.length);
                noteRow.font = { italic: true, color: { argb: 'FF92400E' } };
            }

            const filename = `visitas_${r.from}_a_${r.to}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            await workbook.xlsx.write(res);
        } catch (error) {
            console.error('TenantAdminReportsController.visitLogsExportExcel:', error);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Error al exportar visitas' });
            }
        }
    }

    static async deliveriesExportExcel(req, res) {
        try {
            const r = resolveDeliveriesDateRange(req);
            if (!r.ok) {
                return res.status(r.status).json({ success: false, error: r.error });
            }

            const rows = await fetchDeliveryRows(
                r.tenantId,
                r.from,
                r.to,
                r.rangeStart,
                r.rangeEndExclusive,
                MAX_EXPORT_ROWS
            );
            const capped = rows.length >= MAX_EXPORT_ROWS;

            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Condominio360';
            const sheet = workbook.addWorksheet('Deliveries');
            sheet.columns = [
                { header: 'Nombre paquete / descripción', key: 'delivery_name', width: 28 },
                { header: 'Empresa', key: 'company', width: 20 },
                { header: 'Tracking', key: 'tracking_number', width: 18 },
                { header: 'Fecha esperada', key: 'expected_date', width: 14 },
                { header: 'Estado', key: 'status', width: 14 },
                { header: 'Anunciado', key: 'announced_at', width: 20 },
                { header: 'Llegada (portería)', key: 'arrival_time', width: 20 },
                { header: 'Entregado', key: 'delivered_at', width: 20 },
                { header: 'Edificio/Calle', key: 'building_name', width: 18 },
                { header: 'Inmueble', key: 'property_name', width: 18 },
                { header: 'Propietario (nombre)', key: 'owner_first_name', width: 16 },
                { header: 'Propietario (apellido)', key: 'owner_last_name', width: 16 },
                { header: 'Propietario email', key: 'owner_email', width: 28 },
                { header: 'Propietario teléfono', key: 'owner_phone', width: 16 },
                { header: 'Propietario DNI', key: 'owner_dni', width: 14 },
                { header: 'Recibió (vigilancia) nombre', key: 'received_by_first_name', width: 18 },
                { header: 'Recibió (vigilancia) apellido', key: 'received_by_last_name', width: 18 },
                { header: 'Notas', key: 'notes', width: 36 },
                { header: 'Creado', key: 'created_at', width: 20 },
                { header: 'ID', key: 'id', width: 38 }
            ];
            sheet.getRow(1).font = { bold: true };

            rows.forEach((row) => {
                sheet.addRow({
                    delivery_name: row.delivery_name || '',
                    company: row.company || '',
                    tracking_number: row.tracking_number || '',
                    expected_date: row.expected_date || null,
                    status: deliveryStatusLabel(row.status),
                    announced_at: row.announced_at || null,
                    arrival_time: row.arrival_time || null,
                    delivered_at: row.delivered_at || null,
                    building_name: row.building_name || '',
                    property_name: row.property_name || '',
                    owner_first_name: row.owner_first_name || '',
                    owner_last_name: row.owner_last_name || '',
                    owner_email: row.owner_email || '',
                    owner_phone: row.owner_phone || '',
                    owner_dni: row.owner_dni || '',
                    received_by_first_name: row.received_by_first_name || '',
                    received_by_last_name: row.received_by_last_name || '',
                    notes: row.notes || '',
                    created_at: row.created_at || null,
                    id: row.id ? String(row.id) : ''
                });
            });

            if (capped) {
                const noteRow = sheet.addRow([]);
                noteRow.getCell(1).value =
                    `NOTA: La exportación incluye como máximo ${MAX_EXPORT_ROWS} filas. Acorte el rango de fechas si necesita el historial completo.`;
                sheet.mergeCells(noteRow.number, 1, noteRow.number, sheet.columns.length);
                noteRow.font = { italic: true, color: { argb: 'FF92400E' } };
            }

            const filename = `deliveries_${r.from}_a_${r.to}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            await workbook.xlsx.write(res);
        } catch (error) {
            console.error('TenantAdminReportsController.deliveriesExportExcel:', error);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Error al exportar deliveries' });
            }
        }
    }
}

module.exports = TenantAdminReportsController;
