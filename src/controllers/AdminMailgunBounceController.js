const MailgunBounceReportService = require('../services/MailgunBounceReportService');
const MailgunBouncePdfService = require('../services/MailgunBouncePdfService');
const MailgunBounceExcelService = require('../services/MailgunBounceExcelService');
const TenantModel = require('../models/TenantModel');

function resolveMailgunExportPayload(body) {
    const includeUnmatched = !!body?.include_unmatched;
    const tenantRows = Array.isArray(body?.tenant_rows) ? body.tenant_rows : [];
    const otherRows = Array.isArray(body?.other_rows) ? body.other_rows : [];
    const rows = includeUnmatched ? [...tenantRows, ...otherRows] : [...tenantRows];
    const summary = body?.summary || {
        total_csv_rows: tenantRows.length + otherRows.length,
        unique_failed_emails: tenantRows.length + otherRows.length,
        matched_in_tenant: tenantRows.length,
        not_in_tenant: otherRows.length
    };
    return { rows, summary, includeUnmatched };
}

class AdminMailgunBounceController {
    /**
     * POST /api/admin/tenants/:id/mailgun-bounces/analyze
     * Body: multipart file field "csv"
     */
    static async analyze(req, res) {
        try {
            const tenantId = req.params.id;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            if (!req.file || !req.file.buffer) {
                return res.status(400).json({ success: false, error: 'Sube un archivo CSV exportado desde Mailgun' });
            }

            const csvText = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
            const result = await MailgunBounceReportService.analyzeCsvForTenant(tenantId, csvText, {
                originalFilename: req.file.originalname
            });

            if (!result.success) {
                return res.status(400).json({ success: false, error: result.error });
            }

            res.json({
                success: true,
                tenant: { id: tenant.id, name: tenant.name },
                ...result.data
            });
        } catch (error) {
            console.error('Mailgun bounce analyze error:', error);
            res.status(500).json({ success: false, error: 'Error al analizar el archivo de Mailgun' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/mailgun-bounces/pdf
     * Body JSON: { summary, tenant_rows, other_rows, include_unmatched }
     */
    static async downloadPdf(req, res) {
        try {
            const tenantId = req.params.id;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            const { rows, summary, includeUnmatched } = resolveMailgunExportPayload(req.body);

            if (!rows.length) {
                return res.status(400).json({
                    success: false,
                    error: 'No hay datos para generar el reporte. Analiza un CSV primero.'
                });
            }

            MailgunBouncePdfService.streamReport(res, {
                tenantName: tenant.name,
                summary,
                rows,
                includeUnmatched
            });
        } catch (error) {
            console.error('Mailgun bounce PDF error:', error);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Error al generar el PDF del reporte' });
            }
        }
    }

    /**
     * POST /api/admin/tenants/:id/mailgun-bounces/excel
     * Body JSON: { summary, tenant_rows, other_rows, include_unmatched }
     */
    static async downloadExcel(req, res) {
        try {
            const tenantId = req.params.id;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            const { rows, summary, includeUnmatched } = resolveMailgunExportPayload(req.body);

            if (!rows.length) {
                return res.status(400).json({
                    success: false,
                    error: 'No hay datos para exportar. Analiza un CSV primero.'
                });
            }

            await MailgunBounceExcelService.streamReport(res, {
                tenantName: tenant.name,
                summary,
                rows,
                includeUnmatched
            });
        } catch (error) {
            console.error('Mailgun bounce Excel error:', error);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Error al generar el Excel del reporte' });
            }
        }
    }
}

module.exports = AdminMailgunBounceController;
