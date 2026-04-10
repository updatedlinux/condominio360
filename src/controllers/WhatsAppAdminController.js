const WhatsAppDeliveryModel = require('../models/WhatsAppDeliveryModel');

function isUuid(s) {
    return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function parsePage(v) {
    const n = parseInt(v, 10);
    return !Number.isFinite(n) || n < 1 ? 1 : n;
}

function parseLimit(v, def = 25) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1) return def;
    return Math.min(n, 100);
}

function parseDays(v, def = 30) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1) return def;
    return Math.min(n, 365);
}

/**
 * Super Admin: auditoría de envíos WhatsApp (mensajes in-app masivos).
 */
class WhatsAppAdminController {
    static _scopeSuper(req) {
        if (!req.user?.isSuperAdmin) {
            return { error: { status: 403, body: { success: false, error: 'Solo Super Admin' } } };
        }
        const raw = (req.query.tenantId || '').trim();
        const tenantId = raw && isUuid(raw) ? raw : null;
        return { tenantId };
    }

    /**
     * GET /api/admin/whatsapp-deliveries
     * Query: page, limit, days, status (PENDING|SENT|FAILED), tenantId
     */
    static async listDeliveries(req, res) {
        const s = WhatsAppAdminController._scopeSuper(req);
        if (s.error) return res.status(s.error.status).json(s.error.body);
        try {
            const page = parsePage(req.query.page);
            const limit = parseLimit(req.query.limit, 25);
            const days = parseDays(req.query.days, 30);
            const status = (req.query.status || '').trim().toUpperCase();
            const st =
                status && ['PENDING', 'SENT', 'FAILED'].includes(status) ? status : null;

            const metrics = await WhatsAppDeliveryModel.getMetricsSnapshot();
            const { rows, pagination } = await WhatsAppDeliveryModel.listDeliveries({
                page,
                limit,
                days,
                status: st,
                tenantId: s.tenantId
            });

            res.json({
                success: true,
                data: {
                    metrics,
                    rows,
                    pagination
                }
            });
        } catch (e) {
            console.error('[WhatsAppAdminController.listDeliveries]', e);
            res.status(500).json({ success: false, error: 'Error al listar envíos WhatsApp' });
        }
    }
}

module.exports = WhatsAppAdminController;
