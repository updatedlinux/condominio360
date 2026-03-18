const NFCModel = require('../models/NFCModel');

const TIMEZONE = process.env.TIMEZONE || 'America/Caracas';

function formatAccessTime(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('es-VE', {
        timeZone: 'America/Caracas',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Controlador NFC para Portal de Seguridad
 * Registro de entradas/salidas vehiculares vía escaneo WebNFC
 */
class NFCSecurityController {

    /**
     * POST /api/security/nfc/log
     * Registrar ingreso o salida vehicular
     */
    static async logAccess(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const { card_uid, access_type } = req.body;

            if (!card_uid || !access_type) {
                return res.status(400).json({
                    success: false,
                    error: 'card_uid y access_type son obligatorios'
                });
            }

            const normalizedType = access_type.toUpperCase() === 'INGRESO' || access_type.toUpperCase() === 'ENTRY' 
                ? 'ENTRY' 
                : access_type.toUpperCase() === 'SALIDA' || access_type.toUpperCase() === 'EXIT' 
                    ? 'EXIT' 
                    : null;

            if (!normalizedType) {
                return res.status(400).json({
                    success: false,
                    error: 'access_type debe ser "ingreso" o "salida"'
                });
            }

            const validation = await NFCModel.validateCard(
                card_uid.toString().toUpperCase().trim(),
                tenantId
            );

            if (!validation.valid) {
                await NFCModel.logAccess({
                    tenant_id: tenantId,
                    card_uid: card_uid.toString().toUpperCase().trim(),
                    access_type: normalizedType,
                    status: 'DENIED',
                    denial_reason: validation.message,
                    owner_name: validation.card?.owner_name || null,
                    property_name: validation.card?.property_name || null,
                    registered_by: userId,
                    device_info: 'WebNFC'
                });

                return res.status(403).json({
                    success: false,
                    error: validation.message,
                    reason: validation.reason
                });
            }

            const log = await NFCModel.logAccess({
                tenant_id: tenantId,
                nfc_card_id: validation.card.id,
                card_uid: validation.card.card_uid,
                property_id: validation.card.property_id,
                access_type: normalizedType,
                status: 'GRANTED',
                owner_name: validation.card.owner_name,
                property_name: validation.card.property_name,
                registered_by: userId,
                device_info: 'WebNFC'
            });

            res.status(201).json({
                success: true,
                message: normalizedType === 'ENTRY' ? 'Ingreso registrado' : 'Salida registrada',
                data: {
                    id: log.id,
                    card_uid: log.card_uid,
                    access_type: normalizedType,
                    access_time: formatAccessTime(log.access_time),
                    owner_name: validation.card.owner_name,
                    property_name: validation.card.property_name
                }
            });
        } catch (error) {
            console.error('NFC logAccess error:', error);
            res.status(500).json({
                success: false,
                error: 'Error al registrar acceso'
            });
        }
    }

    /**
     * GET /api/security/nfc/lookup/:card_uid
     * Buscar propietario por UID (antes de confirmar ingreso/salida)
     */
    static async lookupByUid(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { card_uid } = req.params;

            if (!card_uid) {
                return res.status(400).json({
                    success: false,
                    error: 'card_uid es obligatorio'
                });
            }

            const card = await NFCModel.findByUid(
                card_uid.toString().toUpperCase().trim(),
                tenantId
            );

            if (!card) {
                return res.status(404).json({
                    success: false,
                    error: 'Tarjeta no registrada'
                });
            }

            const validation = await NFCModel.validateCard(
                card_uid.toString().toUpperCase().trim(),
                tenantId
            );

            res.json({
                success: true,
                data: {
                    card_uid: card.card_uid,
                    card_name: card.card_name,
                    property_name: card.property_name,
                    owner_name: validation.valid ? validation.card.owner_name : 'Propietario de la unidad',
                    valid: validation.valid,
                    message: validation.message
                }
            });
        } catch (error) {
            console.error('NFC lookup error:', error);
            res.status(500).json({
                success: false,
                error: 'Error al consultar tarjeta'
            });
        }
    }

    /**
     * GET /api/security/nfc/today-logs
     * Logs de acceso vehicular del día (para portal de seguridad)
     */
    static async getTodayLogs(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const today = new Date().toISOString().split('T')[0];

            const logs = await NFCModel.getAccessLogs(tenantId, {
                limit: 50,
                startDate: today + 'T00:00:00',
                endDate: today + 'T23:59:59.999'
            });

            res.json({
                success: true,
                data: logs
            });
        } catch (error) {
            console.error('NFC getTodayLogs error:', error);
            res.status(500).json({
                success: false,
                error: 'Error al obtener logs'
            });
        }
    }
}

module.exports = NFCSecurityController;
