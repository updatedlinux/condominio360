const MailgunBounceReportService = require('../services/MailgunBounceReportService');
const TenantModel = require('../models/TenantModel');

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
            const result = await MailgunBounceReportService.analyzeCsvForTenant(tenantId, csvText);

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
}

module.exports = AdminMailgunBounceController;
