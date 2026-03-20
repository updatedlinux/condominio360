const NFCModel = require('../models/NFCModel');
const PropertyModel = require('../models/PropertyModel');
const { sql, connectDB } = require('../config/database');

/**
 * NFC Admin Controller
 * Gestión de tarjetas NFC por parte de la Junta de Condominio
 */
class NFCAdminController {

    /**
     * GET /api/tenant-admin/nfc/cards
     * Listar todas las tarjetas del tenant
     */
    static async getCards(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { property_id, is_active, page = 1, limit = 20 } = req.query;

            const pool = await connectDB();
            
            let query = `
                SELECT n.*, p.name as property_name, p.building, p.floor,
                       u.first_name + ' ' + u.last_name as created_by_name
                FROM NFC_Cards n
                INNER JOIN Properties p ON n.property_id = p.id
                LEFT JOIN Users u ON n.created_by = u.id
                WHERE n.tenant_id = @tenant_id
            `;

            if (property_id) {
                query += ` AND n.property_id = @property_id`;
            }

            if (is_active !== undefined) {
                query += ` AND n.is_active = @is_active`;
            }

            query += ` ORDER BY n.created_at DESC
                       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('offset', sql.Int, (page - 1) * limit)
                .input('limit', sql.Int, parseInt(limit));

            if (property_id) {
                request.input('property_id', sql.UniqueIdentifier, property_id);
            }

            if (is_active !== undefined) {
                request.input('is_active', sql.Bit, is_active === 'true' ? 1 : 0);
            }

            const result = await request.query(query);

            // Contar total
            let countQuery = `
                SELECT COUNT(*) as total 
                FROM NFC_Cards 
                WHERE tenant_id = @tenant_id
            `;
            const countRequest = pool.request().input('tenant_id', sql.UniqueIdentifier, tenantId);
            if (property_id) {
                countQuery += ` AND property_id = @property_id`;
                countRequest.input('property_id', sql.UniqueIdentifier, property_id);
            }
            if (is_active !== undefined && is_active !== '') {
                countQuery += ` AND is_active = @is_active`;
                countRequest.input('is_active', sql.Bit, is_active === 'true' ? 1 : 0);
            }
            const countResult = await countRequest.query(countQuery);

            res.json({
                success: true,
                data: result.recordset,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult.recordset[0].total,
                    totalPages: Math.ceil(countResult.recordset[0].total / limit)
                }
            });
        } catch (error) {
            console.error('Get NFC cards error:', error);
            res.status(500).json({ error: 'Error al obtener tarjetas' });
        }
    }

    /**
     * GET /api/tenant-admin/nfc/cards/:id
     * Obtener detalle de una tarjeta
     */
    static async getCardById(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT n.*, p.name as property_name, p.building, p.floor
                    FROM NFC_Cards n
                    INNER JOIN Properties p ON n.property_id = p.id
                    WHERE n.id = @id AND n.tenant_id = @tenant_id
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Tarjeta no encontrada' });
            }

            // Obtener historial de accesos
            const logs = await NFCModel.getAccessLogs(tenantId, { limit: 10 });
            const cardLogs = logs.filter(l => l.nfc_card_id === id);

            res.json({
                success: true,
                data: {
                    ...result.recordset[0],
                    recent_logs: cardLogs
                }
            });
        } catch (error) {
            console.error('Get card error:', error);
            res.status(500).json({ error: 'Error al obtener tarjeta' });
        }
    }

    /**
     * POST /api/tenant-admin/nfc/cards
     * Crear nueva tarjeta NFC
     */
    static async createCard(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const {
                card_uid,
                property_id,
                card_name,
                description,
                expires_at
            } = req.body;

            // Validaciones
            if (!card_uid || !property_id) {
                return res.status(400).json({ 
                    error: 'card_uid y property_id son requeridos' 
                });
            }

            // Verificar que la propiedad existe y pertenece al tenant
            const property = await PropertyModel.findById(property_id, tenantId);
            if (!property) {
                return res.status(404).json({ error: 'Unidad no encontrada' });
            }

            // Idempotencia: si ya existe la tarjeta con este UID, retornar la existente (evita duplicados por doble envío)
            const existing = await NFCModel.findByUid(card_uid, tenantId);
            if (existing) {
                return res.status(200).json({
                    success: true,
                    message: 'Tarjeta ya registrada',
                    data: existing
                });
            }

            let card;
            try {
                card = await NFCModel.create({
                    tenant_id: tenantId,
                    property_id,
                    card_uid: card_uid.toUpperCase().trim(),
                    card_name,
                    description,
                    expires_at,
                    created_by: userId,
                    created_by_type: 'ADMIN'
                });
            } catch (createError) {
                const errNum = createError.number ?? createError.original?.number;
                const isDuplicate = errNum === 2627
                    || createError.message?.includes('UNIQUE')
                    || createError.message?.includes('duplicate')
                    || createError.message?.includes('UID already exists');
                if (isDuplicate) {
                    const existingCard = await NFCModel.findByUid(card_uid, tenantId);
                    if (existingCard) {
                        return res.status(200).json({
                            success: true,
                            message: 'Tarjeta ya registrada',
                            data: existingCard
                        });
                    }
                }
                throw createError;
            }

            res.status(201).json({
                success: true,
                message: 'Tarjeta creada exitosamente',
                data: card
            });
        } catch (error) {
            console.error('Create card error:', error);
            if (error.message?.includes('UID already exists')) {
                const existingCard = await NFCModel.findByUid(req.body.card_uid?.toUpperCase?.()?.trim(), req.user.tenantId);
                if (existingCard) {
                    return res.status(200).json({ success: true, message: 'Tarjeta ya registrada', data: existingCard });
                }
                return res.status(409).json({ error: 'UID ya existe' });
            }
            res.status(500).json({ error: 'Error al crear tarjeta' });
        }
    }

    /**
     * PUT /api/tenant-admin/nfc/cards/:id
     * Actualizar tarjeta
     */
    static async updateCard(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const updateData = req.body;

            // No permitir modificar ciertos campos
            delete updateData.card_uid; // No se puede cambiar el UID
            delete updateData.property_id; // No se puede cambiar la propiedad
            delete updateData.tenant_id;

            const card = await NFCModel.update(id, tenantId, updateData);

            if (!card) {
                return res.status(404).json({ error: 'Tarjeta no encontrada' });
            }

            res.json({
                success: true,
                message: 'Tarjeta actualizada',
                data: card
            });
        } catch (error) {
            console.error('Update card error:', error);
            res.status(500).json({ error: 'Error al actualizar tarjeta' });
        }
    }

    /**
     * DELETE /api/tenant-admin/nfc/cards/:id
     * Eliminar tarjeta
     */
    static async deleteCard(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const card = await NFCModel.delete(id, tenantId);

            if (!card) {
                return res.status(404).json({ error: 'Tarjeta no encontrada' });
            }

            res.json({
                success: true,
                message: 'Tarjeta eliminada'
            });
        } catch (error) {
            console.error('Delete card error:', error);
            res.status(500).json({ error: 'Error al eliminar tarjeta' });
        }
    }

    /**
     * POST /api/tenant-admin/nfc/cards/:id/block
     * Bloquear tarjeta
     */
    static async blockCard(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;
            const { reason } = req.body;

            const card = await NFCModel.update(id, tenantId, {
                is_blocked: true,
                block_reason: reason || 'Bloqueada por administrador'
            });

            if (!card) {
                return res.status(404).json({ error: 'Tarjeta no encontrada' });
            }

            res.json({
                success: true,
                message: 'Tarjeta bloqueada',
                data: card
            });
        } catch (error) {
            console.error('Block card error:', error);
            res.status(500).json({ error: 'Error al bloquear tarjeta' });
        }
    }

    /**
     * POST /api/tenant-admin/nfc/cards/:id/unblock
     * Desbloquear tarjeta
     */
    static async unblockCard(req, res) {
        try {
            const { id } = req.params;
            const tenantId = req.user.tenantId;

            const card = await NFCModel.update(id, tenantId, {
                is_blocked: false,
                block_reason: null
            });

            if (!card) {
                return res.status(404).json({ error: 'Tarjeta no encontrada' });
            }

            res.json({
                success: true,
                message: 'Tarjeta desbloqueada',
                data: card
            });
        } catch (error) {
            console.error('Unblock card error:', error);
            res.status(500).json({ error: 'Error al desbloquear tarjeta' });
        }
    }

    /**
     * GET /api/tenant-admin/nfc/stats
     * Estadísticas de uso de NFC
     */
    static async getStats(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const stats = await NFCModel.getStats(tenantId);

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('Get NFC stats error:', error);
            res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
    }

    /**
     * GET /api/tenant-admin/nfc/access-logs
     * Logs de acceso NFC
     */
    static async getAccessLogs(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { limit = 50, startDate, endDate, status } = req.query;

            const logs = await NFCModel.getAccessLogs(tenantId, {
                limit: parseInt(limit),
                startDate: startDate || null,
                endDate: endDate || null,
                status: status || null
            });

            res.json({
                success: true,
                data: logs
            });
        } catch (error) {
            console.error('Get access logs error:', error);
            res.status(500).json({ error: 'Error al obtener logs' });
        }
    }
}

module.exports = NFCAdminController;
