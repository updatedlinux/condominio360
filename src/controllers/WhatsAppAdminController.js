const ExcelJS = require('exceljs');
const WhatsAppDeliveryModel = require('../models/WhatsAppDeliveryModel');
const WhatsAppPhoneBlacklistModel = require('../models/WhatsAppPhoneBlacklistModel');
const OpenWAWhatsAppService = require('../services/OpenWAWhatsAppService');

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

function parseBlockedOnly(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'all' || s === '0' || s === 'false') return false;
    return true;
}

/**
 * Super Admin: auditoría OpenWA (cola + lista negra).
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
                status && ['PENDING', 'SENT', 'FAILED', 'SKIPPED'].includes(status) ? status : null;

            const metrics = await WhatsAppDeliveryModel.getMetricsSnapshot();
            const blacklistMetrics = await WhatsAppPhoneBlacklistModel.getMetrics({ tenantId: s.tenantId });
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
                    blacklistMetrics,
                    openwa: {
                        configured: !!OpenWAWhatsAppService.getPlatformConfig(),
                        webhookUrl: OpenWAWhatsAppService.getWebhookUrl()
                    },
                    rows,
                    pagination
                }
            });
        } catch (e) {
            console.error('[WhatsAppAdminController.listDeliveries]', e);
            res.status(500).json({ success: false, error: 'Error al listar envíos WhatsApp' });
        }
    }

    /**
     * GET /api/admin/whatsapp-blacklist
     */
    static async listBlacklist(req, res) {
        const s = WhatsAppAdminController._scopeSuper(req);
        if (s.error) return res.status(s.error.status).json(s.error.body);
        try {
            const page = parsePage(req.query.page);
            const limit = parseLimit(req.query.limit, 25);
            const blockedOnly = parseBlockedOnly(req.query.mode);

            const { rows, pagination } = await WhatsAppPhoneBlacklistModel.listEntries({
                page,
                limit,
                tenantId: s.tenantId,
                blockedOnly
            });
            const blacklistMetrics = await WhatsAppPhoneBlacklistModel.getMetrics({ tenantId: s.tenantId });

            res.json({
                success: true,
                data: { rows, pagination, blacklistMetrics }
            });
        } catch (e) {
            console.error('[WhatsAppAdminController.listBlacklist]', e);
            res.status(500).json({ success: false, error: 'Error al listar lista negra WhatsApp' });
        }
    }

    /**
     * GET /api/admin/whatsapp-blacklist/export
     */
    static async exportBlacklistExcel(req, res) {
        const s = WhatsAppAdminController._scopeSuper(req);
        if (s.error) return res.status(s.error.status).json(s.error.body);
        try {
            const blockedOnly = parseBlockedOnly(req.query.mode);
            const rows = await WhatsAppPhoneBlacklistModel.listExportRows({
                tenantId: s.tenantId,
                blockedOnly
            });
            const threshold = WhatsAppPhoneBlacklistModel.failureThreshold;

            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Condominio360';
            const sheet = workbook.addWorksheet('Lista negra WhatsApp');
            sheet.columns = [
                { header: 'Fecha bloqueo', key: 'blocked_at', width: 20 },
                { header: 'Estado', key: 'status', width: 14 },
                { header: 'Chat ID WhatsApp', key: 'chat_id', width: 22 },
                { header: 'Teléfono registro', key: 'phone', width: 16 },
                { header: 'Nombre', key: 'first_name', width: 16 },
                { header: 'Apellido', key: 'last_name', width: 16 },
                { header: 'Email', key: 'email', width: 28 },
                { header: 'DNI', key: 'dni', width: 14 },
                { header: 'Condominio (bloqueo)', key: 'block_tenant_name', width: 24 },
                { header: 'Condominios del propietario', key: 'owner_tenants', width: 36 },
                { header: 'Inmuebles', key: 'owner_properties', width: 40 },
                { header: 'Fallos consecutivos', key: 'consecutive_failures', width: 18 },
                { header: 'Umbral bloqueo', key: 'threshold', width: 14 },
                { header: 'Último error', key: 'last_error', width: 44 },
                { header: 'Último fallo', key: 'last_failure_at', width: 20 },
                { header: 'Correo aviso enviado', key: 'owner_notified_at', width: 20 },
                { header: 'Último éxito', key: 'last_success_at', width: 20 },
                { header: 'ID usuario', key: 'user_id', width: 38 },
                { header: 'ID registro', key: 'id', width: 38 }
            ];
            sheet.getRow(1).font = { bold: true };

            rows.forEach((r) => {
                sheet.addRow({
                    blocked_at: r.blocked_at ? new Date(r.blocked_at) : '',
                    status: r.is_blocked ? 'Bloqueado' : 'En riesgo / desbloqueado',
                    chat_id: r.chat_id || '',
                    phone: r.phone || '',
                    first_name: r.first_name || '',
                    last_name: r.last_name || '',
                    email: r.email || '',
                    dni: r.dni || '',
                    block_tenant_name: r.block_tenant_name || '',
                    owner_tenants: r.owner_tenants || '',
                    owner_properties: r.owner_properties || '',
                    consecutive_failures: r.consecutive_failures ?? 0,
                    threshold,
                    last_error: r.last_error || '',
                    last_failure_at: r.last_failure_at ? new Date(r.last_failure_at) : '',
                    owner_notified_at: r.owner_notified_at ? new Date(r.owner_notified_at) : '',
                    last_success_at: r.last_success_at ? new Date(r.last_success_at) : '',
                    user_id: r.user_id || '',
                    id: r.id || ''
                });
            });

            const suffix = blockedOnly ? 'bloqueados' : 'historial';
            const filename = `whatsapp-lista-negra-${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            await workbook.xlsx.write(res);
            res.end();
        } catch (e) {
            console.error('[WhatsAppAdminController.exportBlacklistExcel]', e);
            res.status(500).json({ success: false, error: 'Error al exportar lista negra WhatsApp' });
        }
    }
}

module.exports = WhatsAppAdminController;
