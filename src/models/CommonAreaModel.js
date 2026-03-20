const { sql, connectDB } = require('../config/database');

/**
 * Modelo para Áreas Comunes y Reservas
 */
class CommonAreaModel {
    // ==================== COMMON AREAS ====================

    /**
     * Crear área común
     */
    static async createArea(data) {
        const pool = await connectDB();
        const { tenantId, name, description, type, capacity, minHoursAdvance, maxDaysAdvance,
                minDurationHours, maxDurationHours, openingTime, closingTime, 
                requiresApproval, imageUrl, rules } = data;
        
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('name', sql.NVarChar, name)
            .input('description', sql.NVarChar, description)
            .input('type', sql.NVarChar, type)
            .input('capacity', sql.Int, capacity)
            .input('min_hours_advance', sql.Int, minHoursAdvance)
            .input('max_days_advance', sql.Int, maxDaysAdvance)
            .input('min_duration_hours', sql.Int, minDurationHours)
            .input('max_duration_hours', sql.Int, maxDurationHours)
            .input('opening_time', sql.VarChar, openingTime)
            .input('closing_time', sql.VarChar, closingTime)
            .input('requires_approval', sql.Bit, requiresApproval)
            .input('image_url', sql.NVarChar, imageUrl)
            .input('rules', sql.NVarChar, rules)
            .query(`
                INSERT INTO CommonAreas (tenant_id, name, description, type, capacity, min_hours_advance, 
                    max_days_advance, min_duration_hours, max_duration_hours, opening_time, closing_time, 
                    requires_approval, image_url, rules)
                OUTPUT INSERTED.*
                VALUES (@tenant_id, @name, @description, @type, @capacity, @min_hours_advance,
                    @max_days_advance, @min_duration_hours, @max_duration_hours, @opening_time, @closing_time,
                    @requires_approval, @image_url, @rules)
            `);
        
        return result.recordset[0];
    }

    /**
     * Actualizar área común
     */
    static async updateArea(areaId, data) {
        const pool = await connectDB();
        const updates = [];
        const inputs = [];
        
        const fields = {
            name: sql.NVarChar,
            description: sql.NVarChar,
            type: sql.NVarChar,
            capacity: sql.Int,
            min_hours_advance: sql.Int,
            max_days_advance: sql.Int,
            min_duration_hours: sql.Int,
            max_duration_hours: sql.Int,
            opening_time: sql.VarChar,
            closing_time: sql.VarChar,
            requires_approval: sql.Bit,
            is_active: sql.Bit,
            image_url: sql.NVarChar,
            rules: sql.NVarChar
        };
        
        for (const [key, type] of Object.entries(fields)) {
            if (data[key] !== undefined) {
                updates.push(`${key} = @${key}`);
                inputs.push({ name: key, type, value: data[key] });
            }
        }
        
        if (updates.length === 0) return null;
        
        updates.push('updated_at = SYSDATETIME()');
        
        const request = pool.request();
        inputs.forEach(input => request.input(input.name, input.type, input.value));
        request.input('id', sql.UniqueIdentifier, areaId);
        
        const result = await request.query(`
            UPDATE CommonAreas
            SET ${updates.join(', ')}
            OUTPUT INSERTED.*
            WHERE id = @id
        `);
        
        return result.recordset[0];
    }

    /**
     * Eliminar área común
     */
    static async deleteArea(areaId) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, areaId)
            .query('DELETE FROM CommonAreas WHERE id = @id');
        return true;
    }

    /**
     * Obtener área por ID
     */
    static async findAreaById(areaId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, areaId)
            .query('SELECT * FROM CommonAreas WHERE id = @id');
        return result.recordset[0];
    }

    /**
     * Listar áreas por tenant
     */
    static async findAreasByTenant(tenantId, options = {}) {
        const pool = await connectDB();
        const { onlyActive = true } = options;
        
        let whereClause = 'WHERE tenant_id = @tenant_id';
        if (onlyActive) whereClause += ' AND is_active = 1';
        
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT *, 
                    (SELECT COUNT(*) FROM CommonAreaReservations 
                     WHERE common_area_id = CommonAreas.id 
                     AND reservation_date >= CAST(GETDATE() AS DATE)
                     AND status IN ('PENDING', 'CONFIRMED')) as upcoming_reservations
                FROM CommonAreas
                ${whereClause}
                ORDER BY name
            `);
        
        return result.recordset;
    }

    // ==================== RESERVATIONS ====================

    /**
     * Crear reserva
     */
    static async createReservation(data) {
        const pool = await connectDB();
        const { tenantId, commonAreaId, propertyId, userId, reservationDate, 
                startTime, endTime, numGuests, notes } = data;
        
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('common_area_id', sql.UniqueIdentifier, commonAreaId)
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('reservation_date', sql.Date, reservationDate)
            .input('start_time', sql.VarChar, startTime)
            .input('end_time', sql.VarChar, endTime)
            .input('num_guests', sql.Int, numGuests)
            .input('notes', sql.NVarChar, notes)
            .query(`
                INSERT INTO CommonAreaReservations (tenant_id, common_area_id, property_id, user_id,
                    reservation_date, start_time, end_time, num_guests, notes, status)
                OUTPUT INSERTED.*
                VALUES (@tenant_id, @common_area_id, @property_id, @user_id,
                    @reservation_date, @start_time, @end_time, @num_guests, @notes, 'PENDING')
            `);
        
        return result.recordset[0];
    }

    /**
     * Actualizar estado de reserva
     */
    static async updateReservationStatus(reservationId, status, approverId = null, rejectionReason = null) {
        const pool = await connectDB();
        const request = pool.request()
            .input('id', sql.UniqueIdentifier, reservationId)
            .input('status', sql.NVarChar, status);
        
        let updates = ['status = @status', 'updated_at = SYSDATETIME()'];
        
        if (approverId) {
            request.input('approved_by', sql.UniqueIdentifier, approverId);
            updates.push('approved_by = @approved_by');
            updates.push('approved_at = SYSDATETIME()');
        }
        
        if (rejectionReason) {
            request.input('rejection_reason', sql.NVarChar, rejectionReason);
            updates.push('rejection_reason = @rejection_reason');
        }
        
        const result = await request.query(`
            UPDATE CommonAreaReservations
            SET ${updates.join(', ')}
            OUTPUT INSERTED.*
            WHERE id = @id
        `);
        
        return result.recordset[0];
    }

    /**
     * Cancelar reserva
     */
    static async cancelReservation(reservationId, userId) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, reservationId)
            .input('user_id', sql.UniqueIdentifier, userId)
            .query(`
                UPDATE CommonAreaReservations
                SET status = 'CANCELLED', updated_at = SYSDATETIME()
                WHERE id = @id AND user_id = @user_id
            `);
        return true;
    }

    /**
     * Obtener reserva por ID
     */
    static async findReservationById(reservationId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, reservationId)
            .query(`
                SELECT r.*, ca.name as area_name, ca.type as area_type,
                       p.building, p.name as unit_number,
                       (u.first_name + ' ' + ISNULL(u.last_name, '')) as user_name,
                       u.email as user_email,
                       (approver.first_name + ' ' + ISNULL(approver.last_name, '')) as approver_name
                FROM CommonAreaReservations r
                JOIN CommonAreas ca ON r.common_area_id = ca.id
                JOIN Properties p ON r.property_id = p.id
                JOIN Users u ON r.user_id = u.id
                LEFT JOIN Users approver ON r.approved_by = approver.id
                WHERE r.id = @id
            `);
        return result.recordset[0];
    }

    /**
     * Listar reservas por tenant (para admin)
     */
    static async findReservationsByTenant(tenantId, options = {}) {
        const pool = await connectDB();
        const { status, areaId, date, page = 1, limit = 20 } = options;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE r.tenant_id = @tenant_id';
        if (status) whereClause += ' AND r.status = @status';
        if (areaId) whereClause += ' AND r.common_area_id = @area_id';
        if (date) whereClause += ' AND r.reservation_date = @date';
        
        const countResult = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('status', sql.NVarChar, status || null)
            .input('area_id', sql.UniqueIdentifier, areaId || null)
            .input('date', sql.Date, date || null)
            .query(`SELECT COUNT(*) as total FROM CommonAreaReservations r ${whereClause}`);
        
        const total = countResult.recordset[0].total;
        
        const dataResult = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('status', sql.NVarChar, status || null)
            .input('area_id', sql.UniqueIdentifier, areaId || null)
            .input('date', sql.Date, date || null)
            .input('offset', sql.Int, offset)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT r.*, ca.name as area_name, ca.type as area_type,
                       p.building, p.name as unit_number,
                       (u.first_name + ' ' + ISNULL(u.last_name, '')) as user_name
                FROM CommonAreaReservations r
                JOIN CommonAreas ca ON r.common_area_id = ca.id
                JOIN Properties p ON r.property_id = p.id
                JOIN Users u ON r.user_id = u.id
                ${whereClause}
                ORDER BY r.reservation_date DESC, r.start_time DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);
        
        return {
            reservations: dataResult.recordset,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) }
        };
    }

    /**
     * Listar reservas por usuario
     */
    static async findReservationsByUser(userId, options = {}) {
        const pool = await connectDB();
        const { status, upcoming = false, page = 1, limit = 20 } = options;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE r.user_id = @user_id';
        if (status) whereClause += ' AND r.status = @status';
        if (upcoming) whereClause += " AND r.reservation_date >= CAST(GETDATE() AS DATE) AND r.status NOT IN ('CANCELLED', 'COMPLETED')";
        
        const result = await pool.request()
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('status', sql.NVarChar, status || null)
            .input('offset', sql.Int, offset)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT r.*, ca.name as area_name, ca.type as area_type,
                       p.building, p.name as unit_number
                FROM CommonAreaReservations r
                JOIN CommonAreas ca ON r.common_area_id = ca.id
                JOIN Properties p ON r.property_id = p.id
                ${whereClause}
                ORDER BY r.reservation_date DESC, r.start_time DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);
        
        return result.recordset;
    }

    /**
     * Verificar disponibilidad
     */
    static async checkAvailability(areaId, date, startTime, endTime, excludeReservationId = null) {
        const pool = await connectDB();
        const request = pool.request()
            .input('common_area_id', sql.UniqueIdentifier, areaId)
            .input('reservation_date', sql.Date, date)
            .input('start_time', sql.VarChar, startTime)
            .input('end_time', sql.VarChar, endTime);
        
        let excludeClause = '';
        if (excludeReservationId) {
            request.input('exclude_id', sql.UniqueIdentifier, excludeReservationId);
            excludeClause = 'AND id != @exclude_id';
        }
        
        // Verificar si hay overlap con reservas existentes
        const conflictResult = await request.query(`
            SELECT COUNT(*) as count
            FROM CommonAreaReservations
            WHERE common_area_id = @common_area_id
                AND reservation_date = @reservation_date
                AND status IN ('PENDING', 'CONFIRMED')
                ${excludeClause}
                AND (
                    (start_time < @end_time AND end_time > @start_time)
                )
        `);
        
        return conflictResult.recordset[0].count === 0;
    }

    /**
     * Obtener slots disponibles para un día
     */
    static async getAvailableSlots(areaId, date, durationHours = 1) {
        const pool = await connectDB();
        
        // Obtener configuración del área
        const areaResult = await pool.request()
            .input('id', sql.UniqueIdentifier, areaId)
            .query('SELECT opening_time, closing_time FROM CommonAreas WHERE id = @id');
        
        if (areaResult.recordset.length === 0) return [];
        
        const area = areaResult.recordset[0];
        
        // Obtener reservas existentes
        const reservationsResult = await pool.request()
            .input('common_area_id', sql.UniqueIdentifier, areaId)
            .input('reservation_date', sql.Date, date)
            .query(`
                SELECT start_time, end_time
                FROM CommonAreaReservations
                WHERE common_area_id = @common_area_id
                    AND reservation_date = @reservation_date
                    AND status IN ('PENDING', 'CONFIRMED')
                ORDER BY start_time
            `);
        
        const reservations = reservationsResult.recordset;
        // Convertir tiempo a minutos desde medianoche (maneja Date, TIME, string "09:00", "09:00:00", etc.)
        // SQL Server TIME se devuelve como Date en UTC; getUTCHours evita desfase en servidores con zona horaria (ej. Venezuela)
        const timeToMinutes = (t) => {
            if (!t) return 0;
            if (t instanceof Date) return t.getUTCHours() * 60 + t.getUTCMinutes();
            const s = String(t);
            const m = s.match(/(\d{1,2}):(\d{0,2})/);
            if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2] || '0', 10);
            return 0;
        };
        
        const slots = [];
        const openHour = Math.floor(timeToMinutes(area.opening_time) / 60) || 8;
        const closeHour = Math.floor(timeToMinutes(area.closing_time) / 60) || 20;
        
        for (let hour = openHour; hour + durationHours <= closeHour; hour++) {
            const startTime = `${hour.toString().padStart(2, '0')}:00`;
            const endTime = `${(hour + durationHours).toString().padStart(2, '0')}:00`;
            const slotStartMin = hour * 60;
            const slotEndMin = (hour + durationHours) * 60;
            
            // Verificar overlap: (slotStart < resEnd) AND (slotEnd > resStart)
            const hasConflict = reservations.some(r => {
                const rStart = timeToMinutes(r.start_time);
                const rEnd = timeToMinutes(r.end_time);
                return slotStartMin < rEnd && slotEndMin > rStart;
            });
            
            if (!hasConflict) {
                slots.push({ start_time: startTime, end_time: endTime });
            }
        }
        
        return slots;
    }

    /**
     * Obtener reservas existentes de un área en una fecha (para mostrar ocupación)
     */
    static async getReservationsForAreaDate(areaId, date) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('common_area_id', sql.UniqueIdentifier, areaId)
            .input('reservation_date', sql.Date, date)
            .query(`
                SELECT r.start_time, r.end_time, p.name as unit_number, p.building
                FROM CommonAreaReservations r
                JOIN Properties p ON r.property_id = p.id
                WHERE r.common_area_id = @common_area_id
                    AND r.reservation_date = @reservation_date
                    AND r.status IN ('PENDING', 'CONFIRMED')
                ORDER BY r.start_time
            `);
        return result.recordset;
    }

    /**
     * Obtener reservas del día (para dashboard)
     */
    static async getTodayReservations(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT r.*, ca.name as area_name, ca.type as area_type,
                       p.building, p.name as unit_number,
                       (u.first_name + ' ' + ISNULL(u.last_name, '')) as user_name
                FROM CommonAreaReservations r
                JOIN CommonAreas ca ON r.common_area_id = ca.id
                JOIN Properties p ON r.property_id = p.id
                JOIN Users u ON r.user_id = u.id
                WHERE r.tenant_id = @tenant_id
                    AND r.reservation_date = CAST(GETDATE() AS DATE)
                    AND r.status IN ('PENDING', 'CONFIRMED')
                ORDER BY r.start_time
            `);
        return result.recordset;
    }
}

module.exports = CommonAreaModel;
