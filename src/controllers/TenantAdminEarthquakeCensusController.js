const EarthquakeCensusModel = require('../models/EarthquakeCensusModel');
const EarthquakeCensusPdfService = require('../services/EarthquakeCensusPdfService');
const EarthquakeCensusPhotoZipService = require('../services/EarthquakeCensusPhotoZipService');
const TenantModel = require('../models/TenantModel');

function resolveTenantId(req, res) {
    const tenantId = req.user?.tenantId || req.user?.tenant_id;
    if (!tenantId) {
        res.status(400).json({
            success: false,
            error: 'No hay condominio en la sesión. Si entró como superadmin, abra el panel de junta desde el detalle del condominio (suplantar). Si es junta, cierre sesión y vuelva a entrar.'
        });
        return null;
    }
    return tenantId;
}

class TenantAdminEarthquakeCensusController {
    static async getStats(req, res) {
        try {
            const tenantId = resolveTenantId(req, res);
            if (!tenantId) return;
            const stats = await EarthquakeCensusModel.getStats(tenantId);
            res.json({ success: true, data: stats });
        } catch (error) {
            console.error('tenant-admin earthquake-census stats error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar estadísticas' });
        }
    }

    static async list(req, res) {
        try {
            const tenantId = resolveTenantId(req, res);
            if (!tenantId) return;
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
            const tenantId = resolveTenantId(req, res);
            if (!tenantId) return;
            let submission = await EarthquakeCensusModel.getSubmissionFull(req.params.id);
            if (!submission || String(submission.tenant_id) !== String(tenantId)) {
                return res.status(404).json({ success: false, error: 'Registro no encontrado' });
            }
            if ((submission.photos || []).length && !submission.photos_zip_token) {
                try {
                    await EarthquakeCensusPhotoZipService.rebuildForSubmission(submission.id);
                    submission = await EarthquakeCensusModel.getSubmissionFull(req.params.id);
                } catch (zipErr) {
                    console.error('tenant-admin earthquake-census zip rebuild error:', zipErr);
                }
            }
            const data = {
                ...submission,
                photos_zip_url: submission.photos_zip_token
                    ? EarthquakeCensusPhotoZipService.getPublicUrl(submission.photos_zip_token)
                    : null
            };
            res.json({ success: true, data });
        } catch (error) {
            console.error('tenant-admin earthquake-census detail error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar detalle' });
        }
    }

    static async downloadPdf(req, res) {
        try {
            const tenantId = resolveTenantId(req, res);
            if (!tenantId) return;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            try {
                await EarthquakeCensusPhotoZipService.ensureZipsForTenant(tenantId);
            } catch (zipErr) {
                console.error('tenant-admin earthquake-census ensureZipsForTenant error:', zipErr);
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
