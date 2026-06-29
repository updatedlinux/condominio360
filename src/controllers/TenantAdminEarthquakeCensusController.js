const EarthquakeCensusModel = require('../models/EarthquakeCensusModel');
const EarthquakeCensusExcelService = require('../services/EarthquakeCensusExcelService');
const EarthquakeCensusPhotoZipService = require('../services/EarthquakeCensusPhotoZipService');
const TenantModel = require('../models/TenantModel');
const { normalizeDamageTypes } = require('../constants/earthquakeCensusDamages');

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

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

function normalizeAdminMember(raw, index) {
    const first_name = String(raw.first_name || raw.firstName || '').trim();
    const last_name = String(raw.last_name || raw.lastName || '').trim();
    const no_cedula = !!(raw.no_cedula || raw.noCedula);
    const cedula = no_cedula ? null : String(raw.cedula || '').trim().replace(/\s/g, '');
    const occupation_education = String(raw.occupation_education || raw.occupation || '').trim() || null;
    const has_disability = !!(raw.has_disability || raw.hasDisability);
    const disability_notes = String(raw.disability_notes || raw.disabilityNotes || '').trim();

    let age = raw.age != null && raw.age !== '' ? parseInt(raw.age, 10) : null;
    if (age != null && (Number.isNaN(age) || age < 0 || age > 130)) age = null;

    let birth_date = raw.birth_date || raw.birthDate || null;
    if (birth_date) {
        birth_date = String(birth_date).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(birth_date)) birth_date = null;
    }

    if (!first_name || !last_name) {
        throw new Error(`Integrante ${index + 1}: nombres y apellidos son obligatorios`);
    }
    if (!no_cedula && !cedula) {
        throw new Error(`Integrante ${index + 1}: indique la cédula o marque sin CI`);
    }
    if (!age && !birth_date) {
        throw new Error(`Integrante ${index + 1}: indique edad o fecha de nacimiento`);
    }

    return {
        first_name,
        last_name,
        cedula,
        no_cedula,
        age,
        birth_date,
        occupation_education,
        has_disability,
        disability_notes: has_disability ? (disability_notes || null) : null
    };
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

    static async listBuildings(req, res) {
        try {
            const tenantId = resolveTenantId(req, res);
            if (!tenantId) return;
            const buildings = await EarthquakeCensusModel.listBuildings(tenantId);
            res.json({ success: true, data: buildings });
        } catch (error) {
            console.error('tenant-admin earthquake-census listBuildings error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar edificios' });
        }
    }

    static async listProperties(req, res) {
        try {
            const tenantId = resolveTenantId(req, res);
            if (!tenantId) return;
            const buildingId = req.query.buildingId || null;
            const search = req.query.search || '';
            const properties = await EarthquakeCensusModel.listProperties(tenantId, { buildingId, search });
            res.json({
                success: true,
                data: properties.map((p) => ({
                    id: p.id,
                    name: p.name,
                    floor: p.floor,
                    building_id: p.building_id,
                    building_name: p.building_name,
                    label: [p.building_name, p.name].filter(Boolean).join(' — ')
                }))
            });
        } catch (error) {
            console.error('tenant-admin earthquake-census listProperties error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar inmuebles' });
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

    static async updateSubmission(req, res) {
        try {
            const tenantId = resolveTenantId(req, res);
            if (!tenantId) return;

            const submissionId = req.params.id;
            const existing = await EarthquakeCensusModel.getSubmissionFull(submissionId);
            if (!existing || String(existing.tenant_id) !== String(tenantId)) {
                return res.status(404).json({ success: false, error: 'Registro no encontrado' });
            }

            const body = req.body || {};
            const contactPhone = String(body.contact_phone ?? body.contactPhone ?? existing.contact_phone ?? '').trim();
            const contactEmail = String(body.contact_email ?? body.contactEmail ?? existing.contact_email ?? '').trim().toLowerCase();

            if (!contactPhone || contactPhone.length < 7) {
                return res.status(400).json({ success: false, error: 'Indique un teléfono de contacto válido' });
            }
            if (!contactEmail || !isValidEmail(contactEmail)) {
                return res.status(400).json({ success: false, error: 'Indique un correo electrónico válido' });
            }

            const propertyId = body.property_id ?? body.propertyId ?? existing.property_id ?? null;

            let members = null;
            if (Array.isArray(body.members)) {
                if (!body.members.length) {
                    return res.status(400).json({ success: false, error: 'Debe haber al menos un integrante' });
                }
                members = body.members.map((m, i) => normalizeAdminMember(m, i));
            }

            const updated = await EarthquakeCensusModel.adminUpdateSubmission(
                submissionId,
                tenantId,
                {
                    property_id: propertyId,
                    building_label: body.building_label ?? body.buildingLabel,
                    apartment_label: body.apartment_label ?? body.apartmentLabel,
                    contact_phone: contactPhone,
                    contact_email: contactEmail,
                    notes: body.notes,
                    damage_notes: body.damage_notes ?? body.damageNotes,
                    damage_types: body.damage_types !== undefined || body.damageTypes !== undefined
                        ? normalizeDamageTypes(body.damage_types || body.damageTypes || [])
                        : undefined,
                    currently_inhabiting: body.currently_inhabiting ?? body.currentlyInhabiting
                },
                members
            );

            if (!updated) {
                return res.status(404).json({ success: false, error: 'Registro no encontrado' });
            }

            if ((updated.photos || []).length) {
                EarthquakeCensusPhotoZipService.rebuildForSubmission(updated.id).catch((zipErr) => {
                    console.error('tenant-admin earthquake-census zip rebuild after update error:', zipErr);
                });
            }

            res.json({
                success: true,
                data: {
                    ...updated,
                    photos_zip_url: updated.photos_zip_token
                        ? EarthquakeCensusPhotoZipService.getPublicUrl(updated.photos_zip_token)
                        : null
                },
                message: 'Registro actualizado'
            });
        } catch (error) {
            if (error.code === 'PROPERTY_TAKEN' || error.code === 'PROPERTY_INVALID' || error.code === 'VALIDATION') {
                return res.status(400).json({ success: false, error: error.message });
            }
            if (error.message && error.message.startsWith('Integrante')) {
                return res.status(400).json({ success: false, error: error.message });
            }
            console.error('tenant-admin earthquake-census update error:', error);
            res.status(500).json({ success: false, error: 'Error al actualizar el registro' });
        }
    }

    static async downloadExcel(req, res) {
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
            const buffer = await EarthquakeCensusExcelService.generateBuffer({
                tenantName: tenant.name,
                submissions
            });
            const filename = EarthquakeCensusExcelService.buildFilename(tenant.name);

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            res.send(buffer);
        } catch (error) {
            console.error('tenant-admin earthquake-census excel error:', error);
            res.status(500).json({ success: false, error: 'Error al generar el Excel' });
        }
    }
}

module.exports = TenantAdminEarthquakeCensusController;
