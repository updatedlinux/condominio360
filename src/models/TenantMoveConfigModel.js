const { sql, connectDB } = require('../config/database');

/**
 * Modelo para configuración de mudanzas por tenant
 * Define días, horarios y restricciones para mudanzas
 */
class TenantMoveConfigModel {
    /**
     * Obtener configuración de mudanzas de un tenant
     * @param {string} tenantId 
     */
    static async getByTenant(tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT * FROM TenantMoveConfig WHERE tenant_id = @tenant_id');

            if (result.recordset.length === 0) return null;

            const config = result.recordset[0];
            // Parsear días permitidos
            config.allowed_days = config.allowed_days ? config.allowed_days.split(',').map(Number) : [];
            return config;
        } catch (error) {
            console.error('Error fetching move config:', error);
            throw error;
        }
    }

    /**
     * Crear configuración inicial para un tenant
     * @param {Object} configData 
     */
    static async create(configData) {
        const {
            tenant_id,
            allowed_days = [6], // Por defecto solo sábados
            start_time = '08:00',
            end_time = '17:00',
            min_notice_days = 7,
            max_moves_per_day = 0,
            require_insurance = false,
            require_elevator_booking = false,
            notify_security = true,
            notify_admin = true,
            additional_instructions = null,
            created_by = null
        } = configData;

        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('allowed_days', sql.NVarChar, Array.isArray(allowed_days) ? allowed_days.join(',') : allowed_days)
                .input('start_time', sql.NVarChar, start_time)
                .input('end_time', sql.NVarChar, end_time)
                .input('min_notice_days', sql.Int, min_notice_days)
                .input('max_moves_per_day', sql.Int, max_moves_per_day)
                .input('require_insurance', sql.Bit, require_insurance ? 1 : 0)
                .input('require_elevator_booking', sql.Bit, require_elevator_booking ? 1 : 0)
                .input('notify_security', sql.Bit, notify_security ? 1 : 0)
                .input('notify_admin', sql.Bit, notify_admin ? 1 : 0)
                .input('additional_instructions', sql.NVarChar, additional_instructions)
                .input('created_by', sql.UniqueIdentifier, created_by)
                .query(`
                    INSERT INTO TenantMoveConfig 
                        (tenant_id, allowed_days, start_time, end_time, min_notice_days,
                         max_moves_per_day, require_insurance, require_elevator_booking,
                         notify_security, notify_admin, additional_instructions, created_by)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @allowed_days, @start_time, @end_time, @min_notice_days,
                         @max_moves_per_day, @require_insurance, @require_elevator_booking,
                         @notify_security, @notify_admin, @additional_instructions, @created_by)
                `);

            const config = result.recordset[0];
            config.allowed_days = config.allowed_days ? config.allowed_days.split(',').map(Number) : [];
            return config;
        } catch (error) {
            console.error('Error creating move config:', error);
            throw error;
        }
    }

    /**
     * Actualizar configuración de mudanzas
     * @param {string} tenantId 
     * @param {Object} data 
     */
    static async update(tenantId, data) {
        const allowedFields = [
            'allowed_days', 'start_time', 'end_time', 'min_notice_days',
            'max_moves_per_day', 'require_insurance', 'require_elevator_booking',
            'notify_security', 'notify_admin', 'additional_instructions', 'is_active'
        ];
        
        const updates = [];
        
        for (const [key, value] of Object.entries(data)) {
            if (allowedFields.includes(key)) {
                updates.push(`${key} = @${key}`);
            }
        }

        if (updates.length === 0) return null;

        try {
            const pool = await connectDB();
            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            // Agregar parámetros
            for (const [key, value] of Object.entries(data)) {
                if (allowedFields.includes(key)) {
                    if (key === 'allowed_days') {
                        request.input(key, sql.NVarChar, Array.isArray(value) ? value.join(',') : value);
                    } else if (['min_notice_days', 'max_moves_per_day'].includes(key)) {
                        request.input(key, sql.Int, value);
                    } else if (['require_insurance', 'require_elevator_booking', 'notify_security', 'notify_admin', 'is_active'].includes(key)) {
                        request.input(key, sql.Bit, value ? 1 : 0);
                    } else {
                        request.input(key, sql.NVarChar, value);
                    }
                }
            }

            const result = await request.query(`
                UPDATE TenantMoveConfig 
                SET ${updates.join(', ')}, updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE tenant_id = @tenant_id
            `);

            if (result.recordset.length === 0) return null;

            const config = result.recordset[0];
            config.allowed_days = config.allowed_days ? config.allowed_days.split(',').map(Number) : [];
            return config;
        } catch (error) {
            console.error('Error updating move config:', error);
            throw error;
        }
    }

    /**
     * Crear o actualizar configuración (upsert)
     * @param {string} tenantId 
     * @param {Object} data 
     * @param {string} userId 
     */
    static async createOrUpdate(tenantId, data, userId) {
        const existing = await this.getByTenant(tenantId);
        
        if (existing) {
            return await this.update(tenantId, data);
        } else {
            return await this.create({
                tenant_id: tenantId,
                ...data,
                created_by: userId
            });
        }
    }

    /**
     * Validar fecha de mudanza según configuración del tenant
     * @param {string} tenantId 
     * @param {Date|string} moveDate 
     * @returns {Object} { valid: boolean, error: string|null }
     */
    static async validateMoveDate(tenantId, moveDate) {
        try {
            const config = await this.getByTenant(tenantId);
            
            // Si no hay configuración, permitir cualquier fecha
            if (!config) {
                return { valid: true, error: null };
            }

            const date = new Date(moveDate);
            const dayOfWeek = date.getDay(); // 0 = Domingo, 6 = Sábado
            
            // Verificar si el día está permitido
            if (!config.allowed_days.includes(dayOfWeek)) {
                const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                const allowedNames = config.allowed_days.map(d => dayNames[d]).join(', ');
                return {
                    valid: false,
                    error: `Las mudanzas solo están permitidas los días: ${allowedNames}`
                };
            }

            // Verificar antelación mínima
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const minDate = new Date(today);
            minDate.setDate(minDate.getDate() + config.min_notice_days);

            if (date < minDate) {
                return {
                    valid: false,
                    error: `Debe solicitar con al menos ${config.min_notice_days} días de anticipación`
                };
            }

            // Verificar máximo de mudanzas por día
            if (config.max_moves_per_day > 0) {
                const pool = await connectDB();
                const movesCount = await pool.request()
                    .input('tenantId', sql.UniqueIdentifier, tenantId)
                    .input('moveDate', sql.DateTime2, date.toISOString().split('T')[0])
                    .query(`
                        SELECT COUNT(*) as count FROM Requests r
                        INNER JOIN RequestTypes rt ON r.request_type_id = rt.id
                        WHERE r.tenant_id = @tenantId
                        AND rt.name LIKE '%Mudanza%'
                        AND CAST(r.created_at AS DATE) = @moveDate
                        AND r.status != 'CLOSED'
                    `);

                if (movesCount.recordset[0].count >= config.max_moves_per_day) {
                    return {
                        valid: false,
                        error: `Ya se alcanzó el máximo de ${config.max_moves_per_day} mudanzas permitidas para ese día`
                    };
                }
            }

            return { valid: true, error: null };
        } catch (error) {
            console.error('Error validating move date:', error);
            return { valid: false, error: 'Error al validar fecha' };
        }
    }

    /**
     * Obtener días disponibles para mudanza (próximos 30 días)
     * @param {string} tenantId 
     * @returns {Array} Lista de fechas disponibles
     */
    static async getAvailableDates(tenantId) {
        try {
            const config = await this.getByTenant(tenantId);
            
            if (!config) {
                // Si no hay config, devolver todos los días
                return [];
            }

            const availableDates = [];
            const today = new Date();
            const minDate = new Date(today);
            minDate.setDate(minDate.getDate() + config.min_notice_days);

            // Generar próximos 60 días
            for (let i = 0; i < 60; i++) {
                const date = new Date(minDate);
                date.setDate(date.getDate() + i);
                
                if (config.allowed_days.includes(date.getDay())) {
                    availableDates.push({
                        date: date.toISOString().split('T')[0],
                        dayOfWeek: date.getDay(),
                        dayName: date.toLocaleDateString('es-ES', { weekday: 'long' })
                    });
                }
            }

            return availableDates;
        } catch (error) {
            console.error('Error getting available dates:', error);
            throw error;
        }
    }
}

module.exports = TenantMoveConfigModel;
