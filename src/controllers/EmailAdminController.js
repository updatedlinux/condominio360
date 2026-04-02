const EmailJobModel = require('../models/EmailJobModel');
const OutgoingQueuesSummaryModel = require('../models/OutgoingQueuesSummaryModel');
const EmailOrchestrator = require('../services/email/EmailOrchestrator');

function isUuid(s) {
    return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function parseDays(v, def = 30) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1) return def;
    return Math.min(n, 365);
}

function parsePage(v) {
    const n = parseInt(v, 10);
    return !Number.isFinite(n) || n < 1 ? 1 : n;
}

function parseLimit(v, def = 20) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1) return def;
    return Math.min(n, 100);
}

function truncateStr(val, max) {
    if (val == null) return null;
    const s = String(val);
    return s.length > max ? `${s.slice(0, max)}…` : s;
}

function truncateRecipients(recipients) {
    if (!Array.isArray(recipients)) return [];
    return recipients.map((r) => ({
        ...r,
        html_body: truncateStr(r.html_body, 3000),
        text_body: truncateStr(r.text_body, 1500)
    }));
}

/**
 * Auditoría de correo (métricas, jobs, logs, reintento). Solo Super Admin; filtro opcional tenantId.
 */
class EmailAdminController {
    static _scopeSuper(req) {
        if (!req.user?.isSuperAdmin) {
            return { error: { status: 403, body: { success: false, error: 'Solo Super Admin' } } };
        }
        const raw = (req.query.tenantId || '').trim();
        const tenantId = raw && isUuid(raw) ? raw : null;
        return { tenantId };
    }

    static async getMetrics(req, res) {
        const s = EmailAdminController._scopeSuper(req);
        if (s.error) return res.status(s.error.status).json(s.error.body);
        const days = parseDays(req.query.days, 30);
        const data = await EmailJobModel.getMetricsSummary({ tenantId: s.tenantId, days });
        res.json({ success: true, data });
    }

    static async listJobs(req, res) {
        const s = EmailAdminController._scopeSuper(req);
        if (s.error) return res.status(s.error.status).json(s.error.body);
        const days = parseDays(req.query.days, 90);
        const page = parsePage(req.query.page);
        const limit = parseLimit(req.query.limit, 20);
        const pipeline = (req.query.pipeline || '').trim() || null;
        const status = (req.query.status || '').trim() || null;

        const total = await EmailJobModel.countJobsFiltered({
            tenantId: s.tenantId,
            days,
            pipeline,
            status
        });
        const rows = await EmailJobModel.listJobsFiltered({
            tenantId: s.tenantId,
            page,
            limit,
            days,
            pipeline,
            status
        });
        res.json({
            success: true,
            data: rows,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 }
        });
    }

    static async getJob(req, res) {
        const s = EmailAdminController._scopeSuper(req);
        if (s.error) return res.status(s.error.status).json(s.error.body);
        const { id } = req.params;
        if (!isUuid(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }
        const job = await EmailJobModel.findJobById(id);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job no encontrado' });
        }
        if (s.tenantId && String(job.tenant_id || '') !== String(s.tenantId)) {
            return res.status(404).json({ success: false, error: 'Job no encontrado' });
        }
        const recipients = truncateRecipients(await EmailJobModel.listRecipientsByJob(id));
        res.json({ success: true, data: { job, recipients } });
    }

    static async getRecipientLogs(req, res) {
        const s = EmailAdminController._scopeSuper(req);
        if (s.error) return res.status(s.error.status).json(s.error.body);
        const { recipientId } = req.params;
        if (!isUuid(recipientId)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }
        const row = await EmailJobModel.findRecipientWithJob(recipientId);
        if (!row) {
            return res.status(404).json({ success: false, error: 'Destinatario no encontrado' });
        }
        if (s.tenantId && String(row.tenant_id || '') !== String(s.tenantId)) {
            return res.status(404).json({ success: false, error: 'Destinatario no encontrado' });
        }
        const logs = await EmailJobModel.listLogsForRecipient(recipientId, parseLimit(req.query.limit, 50));
        res.json({ success: true, data: logs });
    }

    static async retryRecipient(req, res) {
        const s = EmailAdminController._scopeSuper(req);
        if (s.error) return res.status(s.error.status).json(s.error.body);
        const { recipientId } = req.params;
        if (!isUuid(recipientId)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }
        const row = await EmailJobModel.findRecipientWithJob(recipientId);
        if (!row) {
            return res.status(404).json({ success: false, error: 'Destinatario no encontrado' });
        }
        if (s.tenantId && String(row.tenant_id || '') !== String(s.tenantId)) {
            return res.status(403).json({ success: false, error: 'No autorizado' });
        }
        try {
            const result = await EmailOrchestrator.retryRecipient(recipientId, {
                tenantId: row.tenant_id,
                isSuperAdmin: true
            });
            res.json({ success: true, data: result });
        } catch (e) {
            if (e.code === 'FORBIDDEN') {
                return res.status(403).json({ success: false, error: e.message });
            }
            if (e.code === 'CANNOT_RETRY' || e.code === 'NOT_FOUND') {
                return res.status(400).json({ success: false, error: e.message });
            }
            if (e.code === 'MAILGUN_DISABLED') {
                return res.status(503).json({ success: false, error: e.message });
            }
            console.error('[EmailAdminController.retryRecipient]', e);
            res.status(500).json({ success: false, error: e.message || 'Error al reintentar' });
        }
    }

    /**
     * GET /api/admin/outgoing-queues-summary
     * Colas masivas (comunicados, Mailgun, notificaciones internas, bienvenidas) — monitoreo superadmin.
     */
    static async getOutgoingQueuesSummary(req, res) {
        const s = EmailAdminController._scopeSuper(req);
        if (s.error) return res.status(s.error.status).json(s.error.body);
        try {
            const data = await OutgoingQueuesSummaryModel.getGlobalSummary();
            res.json({ success: true, data });
        } catch (e) {
            console.error('[EmailAdminController.getOutgoingQueuesSummary]', e);
            res.status(500).json({ success: false, error: 'Error al leer colas de envío' });
        }
    }
}

module.exports = EmailAdminController;
