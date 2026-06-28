const EarthquakeCensusModel = require('../models/EarthquakeCensusModel');
const TenantModel = require('../models/TenantModel');
const PropertyModel = require('../models/PropertyModel');
const BuildingModel = require('../models/BuildingModel');
const { EARTHQUAKE_DAMAGE_TYPES, normalizeDamageTypes } = require('../constants/earthquakeCensusDamages');

function normalizeMember(raw, index) {
    const first_name = String(raw.first_name || raw.firstName || '').trim();
    const last_name = String(raw.last_name || raw.lastName || '').trim();
    const cedula = String(raw.cedula || '').trim().replace(/\s/g, '');
    const occupation_education = String(raw.occupation_education || raw.occupation || '').trim();
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
    if (!cedula) {
        throw new Error(`Integrante ${index + 1}: número de cédula es obligatorio`);
    }
    if (!occupation_education) {
        throw new Error(`Integrante ${index + 1}: ocupación o grado de instrucción es obligatorio`);
    }
    if (!age && !birth_date) {
        throw new Error(`Integrante ${index + 1}: indique edad o fecha de nacimiento`);
    }

    return {
        first_name,
        last_name,
        cedula,
        age,
        birth_date,
        occupation_education,
        has_disability,
        disability_notes: has_disability ? disability_notes : null
    };
}

class EarthquakeCensusController {
    static async listDamageTypes(_req, res) {
        res.json({ success: true, data: EARTHQUAKE_DAMAGE_TYPES });
    }

    static async listTenants(_req, res) {
        try {
            const tenants = await EarthquakeCensusModel.listActiveTenants();
            res.json({
                success: true,
                data: tenants.map((t) => ({
                    id: t.id,
                    name: t.name,
                    building_type: t.building_type || t.BUILDING_TYPE || 'SINGLE',
                    building_count: Number(t.building_count) || 0
                }))
            });
        } catch (error) {
            console.error('terremotove listTenants error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar conjuntos residenciales' });
        }
    }

    static async listBuildings(req, res) {
        try {
            const tenantId = req.params.tenantId;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant || !tenant.active) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }
            const buildings = await EarthquakeCensusModel.listBuildings(tenantId);
            res.json({ success: true, data: buildings });
        } catch (error) {
            console.error('terremotove listBuildings error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar edificios' });
        }
    }

    static async listProperties(req, res) {
        try {
            const tenantId = req.params.tenantId;
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant || !tenant.active) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }
            const buildingId = req.query.buildingId || null;
            const search = req.query.search || '';
            const properties = await EarthquakeCensusModel.listProperties(tenantId, { buildingId, search });
            res.json({
                success: true,
                data: properties.map((p) => ({
                    id: p.id,
                    name: p.name,
                    floor: p.floor,
                    type: p.type,
                    building_id: p.building_id,
                    building_name: p.building_name,
                    building_code: p.building_code,
                    label: [p.building_name, p.name].filter(Boolean).join(' — ')
                }))
            });
        } catch (error) {
            console.error('terremotove listProperties error:', error);
            res.status(500).json({ success: false, error: 'Error al cargar inmuebles' });
        }
    }

    static async getExistingSubmission(req, res) {
        try {
            const { tenantId, propertyId } = req.params;
            const submission = await EarthquakeCensusModel.findSubmissionByProperty(tenantId, propertyId);
            if (!submission) {
                return res.json({ success: true, data: null });
            }
            const full = await EarthquakeCensusModel.getSubmissionFull(submission.id);
            res.json({ success: true, data: full });
        } catch (error) {
            console.error('terremotove getExistingSubmission error:', error);
            res.status(500).json({ success: false, error: 'Error al consultar registro previo' });
        }
    }

    static async submit(req, res) {
        try {
            let body = req.body;
            if (typeof body.data === 'string') {
                try {
                    body = JSON.parse(body.data);
                } catch {
                    return res.status(400).json({ success: false, error: 'Datos del formulario inválidos' });
                }
            }

            const tenantId = body.tenant_id || body.tenantId;
            const propertyId = body.property_id || body.propertyId || null;
            let buildingLabel = String(body.building_label || body.buildingLabel || '').trim();
            let apartmentLabel = String(body.apartment_label || body.apartmentLabel || '').trim();
            const contactPhone = String(body.contact_phone || body.contactPhone || '').trim();
            const notes = String(body.notes || '').trim();
            const damageTypes = normalizeDamageTypes(body.damage_types || body.damageTypes || []);
            const damageNotes = String(body.damage_notes || body.damageNotes || '').trim();
            const membersRaw = Array.isArray(body.members) ? body.members : [];

            if (!tenantId) {
                return res.status(400).json({ success: false, error: 'Seleccione el conjunto residencial' });
            }
            const tenant = await TenantModel.findById(tenantId);
            if (!tenant || !tenant.active) {
                return res.status(404).json({ success: false, error: 'Condominio no encontrado' });
            }

            if (propertyId) {
                const property = await PropertyModel.findById(propertyId);
                if (!property || String(property.tenant_id) !== String(tenantId)) {
                    return res.status(400).json({ success: false, error: 'Inmueble no válido para este condominio' });
                }
                if (!buildingLabel) {
                    if (property.building_id) {
                        const building = await BuildingModel.findById(property.building_id);
                        buildingLabel = building?.name || 'Edificio';
                    } else {
                        buildingLabel = tenant.name;
                    }
                }
                if (!apartmentLabel) {
                    apartmentLabel = property.name;
                }
            }

            if (!buildingLabel || !apartmentLabel) {
                return res.status(400).json({ success: false, error: 'Indique edificio/calle y número de apartamento' });
            }
            if (!contactPhone || contactPhone.length < 7) {
                return res.status(400).json({ success: false, error: 'Indique un teléfono de contacto válido' });
            }
            if (!membersRaw.length) {
                return res.status(400).json({ success: false, error: 'Agregue al menos un integrante del grupo familiar' });
            }

            const members = membersRaw.map((m, i) => normalizeMember(m, i));

            const submission = await EarthquakeCensusModel.upsertSubmission({
                tenant_id: tenantId,
                property_id: propertyId,
                building_label: buildingLabel,
                apartment_label: apartmentLabel,
                contact_phone: contactPhone,
                notes: notes || null,
                damage_types: damageTypes,
                damage_notes: damageNotes || null
            }, members);

            if (req.files && req.files.length) {
                const photos = req.files.map((f) => ({
                    file_path: `earthquake-census/${f.filename}`,
                    original_name: f.originalname
                }));
                await EarthquakeCensusModel.addPhotos(submission.id, photos);
            }

            const full = await EarthquakeCensusModel.getSubmissionFull(submission.id);
            res.json({
                success: true,
                message: 'Censo registrado correctamente. Gracias por colaborar con Protección Civil.',
                data: full
            });
        } catch (error) {
            if (error.message && error.message.startsWith('Integrante')) {
                return res.status(400).json({ success: false, error: error.message });
            }
            console.error('terremotove submit error:', error);
            res.status(500).json({ success: false, error: 'Error al guardar el censo' });
        }
    }
}

module.exports = EarthquakeCensusController;
