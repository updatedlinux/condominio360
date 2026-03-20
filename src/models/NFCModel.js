const { sql, connectDB } = require('../config/database');

const TIMEZONE = process.env.TIMEZONE || 'America/Caracas';

/** Obtiene la fecha/hora actual en Venezuela (America/Caracas) para registros NFC */
function getCaracasDateTime() {
    return new Date().toLocaleString('sv-SE', { timeZone: TIMEZONE });
    // Formato: 'YYYY-MM-DD HH:mm:ss' compatible con MSSQL DateTime2
}

/**
 * Modelo para gestión de Tarjetas NFC
 * Relación: 1 NFC Card = 1 Inmueble (Property)
 */
class NFCModel {
    
    /**
     * Buscar tarjeta por UID dentro de un tenant
     * @param {string} cardUid - UID de la tarjeta escaneada
     * @param {string} tenantId - ID del conjunto residencial
     */
    static async findByUid(cardUid, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('card_uid', sql.NVarChar, cardUid.toUpperCase().trim())
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT n.*, p.name as property_name, p.building, p.floor
                    FROM NFC_Cards n
                    INNER JOIN Properties p ON n.property_id = p.id
                    WHERE n.card_uid = @card_uid 
                    AND n.tenant_id = @tenant_id
                `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding NFC card by UID:', error);
            throw error;
        }
    }

    /**
     * Obtener todas las tarjetas de una unidad inmobiliaria
     * @param {string} propertyId 
     * @param {string} tenantId 
     */
    static async getByProperty(propertyId, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('property_id', sql.UniqueIdentifier, propertyId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT n.*, p.name as property_name
                    FROM NFC_Cards n
                    INNER JOIN Properties p ON n.property_id = p.id
                    WHERE n.property_id = @property_id 
                    AND n.tenant_id = @tenant_id
                    ORDER BY n.created_at DESC
                `);

            return result.recordset;
        } catch (error) {
            console.error('Error getting NFC cards by property:', error);
            throw error;
        }
    }

    /**
     * Crear nueva tarjeta NFC asociada a un inmueble
     * @param {Object} data 
     */
    static async create(data) {
        const {
            tenant_id,
            property_id,
            card_uid,
            card_name = null,
            description = null,
            expires_at = null,
            created_by,
            created_by_type = 'ADMIN'
        } = data;

        try {
            const pool = await connectDB();
            
            // Verificar que no exista el UID en este tenant
            const existing = await this.findByUid(card_uid, tenant_id);
            if (existing) {
                throw new Error('UID already exists in this tenant');
            }

            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('property_id', sql.UniqueIdentifier, property_id)
                .input('card_uid', sql.NVarChar, card_uid.toUpperCase().trim())
                .input('card_name', sql.NVarChar, card_name)
                .input('description', sql.NVarChar, description)
                .input('expires_at', sql.DateTime2, expires_at)
                .input('created_by', sql.UniqueIdentifier, created_by)
                .input('created_by_type', sql.NVarChar, created_by_type)
                .query(`
                    INSERT INTO NFC_Cards 
                        (tenant_id, property_id, card_uid, card_name, description, 
                         expires_at, created_by, created_by_type)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @property_id, @card_uid, @card_name, @description,
                         @expires_at, @created_by, @created_by_type)
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error creating NFC card:', error);
            throw error;
        }
    }

    /**
     * Actualizar tarjeta NFC
     * @param {string} id 
     * @param {string} tenantId 
     * @param {Object} data 
     */
    static async update(id, tenantId, data) {
        const allowedFields = ['card_name', 'description', 'is_active', 'is_blocked', 'block_reason', 'expires_at'];
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
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            for (const [key, value] of Object.entries(data)) {
                if (allowedFields.includes(key)) {
                    if (key === 'is_active' || key === 'is_blocked') {
                        request.input(key, sql.Bit, value ? 1 : 0);
                    } else if (key === 'expires_at') {
                        request.input(key, sql.DateTime2, value);
                    } else {
                        request.input(key, sql.NVarChar, value);
                    }
                }
            }

            const result = await request.query(`
                UPDATE NFC_Cards 
                SET ${updates.join(', ')}, updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE id = @id AND tenant_id = @tenant_id
            `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error updating NFC card:', error);
            throw error;
        }
    }

    /**
     * Eliminar tarjeta NFC
     * @param {string} id 
     * @param {string} tenantId 
     */
    static async delete(id, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    DELETE FROM NFC_Cards 
                    OUTPUT DELETED.*
                    WHERE id = @id AND tenant_id = @tenant_id
                `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error deleting NFC card:', error);
            throw error;
        }
    }

    /**
     * Validar tarjeta NFC para acceso
     * @param {string} cardUid 
     * @param {string} tenantId 
     * @returns {Object} { valid: boolean, card: object|null, reason: string|null }
     */
    static async validateCard(cardUid, tenantId) {
        try {
            const card = await this.findByUid(cardUid, tenantId);

            if (!card) {
                return {
                    valid: false,
                    card: null,
                    reason: 'CARD_NOT_FOUND',
                    message: 'Tarjeta no registrada'
                };
            }

            if (!card.is_active) {
                return {
                    valid: false,
                    card,
                    reason: 'CARD_INACTIVE',
                    message: 'Tarjeta inactiva'
                };
            }

            if (card.is_blocked) {
                return {
                    valid: false,
                    card,
                    reason: 'CARD_BLOCKED',
                    message: card.block_reason || 'Tarjeta bloqueada'
                };
            }

            if (card.expires_at && new Date(card.expires_at) < new Date()) {
                return {
                    valid: false,
                    card,
                    reason: 'CARD_EXPIRED',
                    message: 'Tarjeta expirada'
                };
            }

            // Verificar que el propietario de la unidad esté activo
            const pool = await connectDB();
            const ownerResult = await pool.request()
                .input('property_id', sql.UniqueIdentifier, card.property_id)
                .query(`
                    SELECT TOP 1 u.first_name, u.last_name, u.is_active
                    FROM Users u
                    INNER JOIN PropertyOwners po ON u.id = po.user_id
                    WHERE po.property_id = @property_id AND po.is_primary_owner = 1
                `);

            if (ownerResult.recordset.length === 0) {
                return {
                    valid: false,
                    card,
                    reason: 'NO_OWNER',
                    message: 'Unidad sin propietario registrado'
                };
            }

            const owner = ownerResult.recordset[0];
            if (!owner.is_active) {
                return {
                    valid: false,
                    card,
                    reason: 'OWNER_INACTIVE',
                    message: 'Propietario inactivo'
                };
            }

            return {
                valid: true,
                card: {
                    ...card,
                    owner_name: `${owner.first_name} ${owner.last_name}`
                },
                reason: null,
                message: 'Acceso permitido'
            };
        } catch (error) {
            console.error('Error validating NFC card:', error);
            throw error;
        }
    }

    /**
     * Registrar acceso (entrada/salida)
     * @param {Object} logData 
     */
    static async logAccess(logData) {
        const {
            tenant_id,
            nfc_card_id = null,
            card_uid,
            property_id = null,
            access_type, // 'ENTRY' o 'EXIT'
            status, // 'GRANTED', 'DENIED', 'ERROR'
            denial_reason = null,
            owner_name = null,
            property_name = null,
            registered_by = null,
            device_info = null
        } = logData;

        try {
            const pool = await connectDB();
            const accessTime = getCaracasDateTime();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('nfc_card_id', sql.UniqueIdentifier, nfc_card_id)
                .input('card_uid', sql.NVarChar, card_uid)
                .input('property_id', sql.UniqueIdentifier, property_id)
                .input('access_type', sql.NVarChar, access_type)
                .input('status', sql.NVarChar, status)
                .input('denial_reason', sql.NVarChar, denial_reason)
                .input('owner_name', sql.NVarChar, owner_name)
                .input('property_name', sql.NVarChar, property_name)
                .input('registered_by', sql.UniqueIdentifier, registered_by)
                .input('device_info', sql.NVarChar, device_info)
                .input('access_time', sql.DateTime2, accessTime)
                .query(`
                    INSERT INTO NFC_AccessLogs 
                        (tenant_id, nfc_card_id, card_uid, property_id, access_type,
                         status, denial_reason, owner_name, property_name,
                         registered_by, device_info, access_time)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @nfc_card_id, @card_uid, @property_id, @access_type,
                         @status, @denial_reason, @owner_name, @property_name,
                         @registered_by, @device_info, @access_time)
                `);

            // Si fue exitoso, actualizar last_used_at de la tarjeta
            if (status === 'GRANTED' && nfc_card_id) {
                await pool.request()
                    .input('id', sql.UniqueIdentifier, nfc_card_id)
                    .input('access_time', sql.DateTime2, accessTime)
                    .query(`
                        UPDATE NFC_Cards 
                        SET last_used_at = @access_time 
                        WHERE id = @id
                    `);
            }

            return result.recordset[0];
        } catch (error) {
            console.error('Error logging NFC access:', error);
            throw error;
        }
    }

    /**
     * Obtener logs de acceso de un tenant
     * @param {string} tenantId 
     * @param {Object} options - { limit, offset, startDate, endDate, status }
     */
    static async getAccessLogs(tenantId, options = {}) {
        const { limit = 50, offset = 0, startDate = null, endDate = null, status = null } = options;

        try {
            const pool = await connectDB();
            let query = `
                SELECT l.id, l.tenant_id, l.nfc_card_id, l.card_uid, l.access_type, l.status, l.access_time,
                       l.owner_name, l.property_name, l.denial_reason, l.registered_by, l.device_info,
                       c.card_name,
                       u.first_name + ' ' + ISNULL(u.last_name, '') as registered_by_name
                FROM NFC_AccessLogs l
                LEFT JOIN NFC_Cards c ON l.nfc_card_id = c.id
                LEFT JOIN Users u ON l.registered_by = u.id
                WHERE l.tenant_id = @tenant_id
            `;

            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('limit', sql.Int, limit)
                .input('offset', sql.Int, offset);

            if (startDate) {
                query += ` AND l.access_time >= @startDate`;
                request.input('startDate', sql.DateTime2, startDate);
            }

            if (endDate) {
                query += ` AND l.access_time <= @endDate`;
                request.input('endDate', sql.DateTime2, endDate);
            }

            if (status) {
                query += ` AND l.status = @status`;
                request.input('status', sql.NVarChar, status);
            }

            query += ` ORDER BY l.access_time DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

            const result = await request.query(query);

            return result.recordset;
        } catch (error) {
            console.error('Error getting access logs:', error);
            throw error;
        }
    }

    /**
     * Obtener logs con conteo total (para paginación)
     * @returns {Promise<[Array, number]>} [logs, total]
     */
    static async getAccessLogsWithCount(tenantId, options = {}) {
        const { limit = 10, offset = 0, startDate = null, endDate = null, status = null } = options;

        try {
            const pool = await connectDB();
            let whereClause = 'WHERE l.tenant_id = @tenant_id';
            const countRequest = pool.request().input('tenant_id', sql.UniqueIdentifier, tenantId);
            if (startDate) {
                whereClause += ' AND l.access_time >= @startDate';
                countRequest.input('startDate', sql.DateTime2, startDate);
            }
            if (endDate) {
                whereClause += ' AND l.access_time <= @endDate';
                countRequest.input('endDate', sql.DateTime2, endDate);
            }
            if (status) {
                whereClause += ' AND l.status = @status';
                countRequest.input('status', sql.NVarChar, status);
            }
            const countResult = await countRequest.query(`
                SELECT COUNT(*) as total FROM NFC_AccessLogs l ${whereClause}
            `);
            const total = countResult.recordset[0]?.total ?? 0;

            const logs = await this.getAccessLogs(tenantId, { limit, offset, startDate, endDate, status });
            return [logs, total];
        } catch (error) {
            console.error('Error getting access logs with count:', error);
            throw error;
        }
    }

    /**
     * Obtener logs de acceso por propiedad (para panel de propietario)
     * @param {string} propertyId 
     * @param {string} tenantId 
     * @param {Object} options - { limit, offset, startDate, endDate }
     */
    static async getAccessLogsByProperty(propertyId, tenantId, options = {}) {
        const { limit = 50, offset = 0, startDate = null, endDate = null } = options;

        try {
            const pool = await connectDB();
            let query = `
                SELECT l.id, l.card_uid, l.access_type, l.access_time, l.status,
                       l.owner_name, l.property_name, c.card_name as card_label
                FROM NFC_AccessLogs l
                LEFT JOIN NFC_Cards c ON l.nfc_card_id = c.id
                WHERE l.property_id = @property_id 
                AND l.tenant_id = @tenant_id
                AND l.status = 'GRANTED'
            `;

            const request = pool.request()
                .input('property_id', sql.UniqueIdentifier, propertyId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('limit', sql.Int, parseInt(limit) || 50)
                .input('offset', sql.Int, parseInt(offset) || 0);

            if (startDate) {
                query += ` AND l.access_time >= @startDate`;
                request.input('startDate', sql.DateTime2, startDate);
            }

            if (endDate) {
                query += ` AND l.access_time <= @endDate`;
                request.input('endDate', sql.DateTime2, endDate);
            }

            query += ` ORDER BY l.access_time DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            console.error('Error getting access logs by property:', error);
            throw error;
        }
    }

    /**
     * Obtener estadísticas de uso de tarjetas
     * @param {string} tenantId 
     */
    static async getStats(tenantId) {
        try {
            const pool = await connectDB();
            
            // Total de tarjetas
            const cardsResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN is_active = 1 AND is_blocked = 0 THEN 1 ELSE 0 END) as active,
                        SUM(CASE WHEN is_blocked = 1 THEN 1 ELSE 0 END) as blocked
                    FROM NFC_Cards
                    WHERE tenant_id = @tenant_id
                `);

            // Accesos de hoy
            const today = new Date().toISOString().split('T')[0];
            const accessResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('today', sql.Date, today)
                .query(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'GRANTED' THEN 1 ELSE 0 END) as granted,
                        SUM(CASE WHEN status = 'DENIED' THEN 1 ELSE 0 END) as denied
                    FROM NFC_AccessLogs
                    WHERE tenant_id = @tenant_id AND CAST(access_time AS DATE) = @today
                `);

            return {
                cards: cardsResult.recordset[0],
                todayAccess: accessResult.recordset[0]
            };
        } catch (error) {
            console.error('Error getting NFC stats:', error);
            throw error;
        }
    }
}

module.exports = NFCModel;
