const EarthquakeCensusModel = require('../models/EarthquakeCensusModel');
const EarthquakeCensusPdfService = require('../services/EarthquakeCensusPdfService');
const TenantModel = require('../models/TenantModel');

class TenantAdminEarthquakeCensusController {
    static async getStats(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const stats = await EarthquakeCensusModel.getStats(tenantId);
            res.json({ success: true, data: stats });
        } catch (error) {
            console.error('tenant-admin earthquake-census stats error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar estadísticas' });
        }
    }

    static async list(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { building, search } = req.query;
            const submissions = await EarthquakeCensusModel.listByTenant(tenantId, {
                buildingLabel: building || null,
                search: search || ''
            });
            res.json({ success: true, data: submissions });
        } catch (error) {
            console.error('tenant-admin earthquake-census list error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar registros' });
        }
    }

    static async getDetail(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const submission = await EarthquakeCensusModel.getSubmissionFull(req.params.id);
            if (!submission || String(submission.tenant_id) !== String(tenantId)) {
                return res.status(404).json({ success: false, error: 'Registro no encontrado' });
            }
            res.json({ success: true, data: submission });
        } catch (error) {
            console.error('tenant-admin earthquake-census detail error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar detalle' });
        }
    }

    static async downloadPdf(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            const submissions = await EarthquakeCensusModel.getAllForPdf(tenantId);
            const buffer = await EarthquakeCensusPdfService.generate({
                tenantName: tenant.name,
                submissions
            });
            const filename = EarthquakeCensusPdfService.buildFilename(tenant.name);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(buffer);
        } catch (error) {
            console.error('tenant-admin earthquake-census pdf error:', error);
            res.status(500).json({ success: false, error: 'Error al generar el PDF' });
        }
    }
}

module.exports = TenantAdminEarthquakeCensusController;
