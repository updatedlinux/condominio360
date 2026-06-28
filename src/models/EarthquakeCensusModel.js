const { sql, connectDB } = require('../config/database');
const { normalizeDamageTypes } = require('../constants/earthquakeCensusDamages');

function parseDamageTypesFromRow(row) {
    const raw = row?.damage_types;
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return normalizeDamageTypes(parsed);
    } catch {
        return [];
    }
}

function enrichSubmission(row) {
    if (!row) return row;
    return {
        ...row,
        damage_types: parseDamageTypesFromRow(row),
        damage_notes: row.damage_notes || null
    };
}

class EarthquakeCensusModel {
    static async listActiveTenants() {
        const pool = await connectDB();
        const result = await pool.request().query(`
            SELECT t.id, t.name, t.slug, t.building_type,
                (SELECT COUNT(*) FROM Buildings b WHERE b.tenant_id = t.id AND b.is_active = 1) AS building_count
            FROM Tenants t
            WHERE t.active = 1
            ORDER BY t.name
        `);
        return result.recordset;
    }

    static async listBuildings(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT id, name, code, address_suffix
                FROM Buildings
                WHERE tenant_id = @tenant_id AND is_active = 1
                ORDER BY name
            `);
        return result.recordset;
    }

    static async listProperties(tenantId, { buildingId = null, search = '' } = {}) {
        const pool = await connectDB();
        let whereClause = 'WHERE p.tenant_id = @tenant_id';
        if (buildingId) whereClause += ' AND p.building_id = @building_id';
        if (search && search.trim()) {
            whereClause += ' AND (p.name LIKE @search OR b.name LIKE @search OR p.floor LIKE @search)';
        }

        const request = pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('building_id', sql.UniqueIdentifier, buildingId);
        if (search && search.trim()) {
            request.input('search', sql.NVarChar, `%${search.trim()}%`);
        }

        const result = await request.query(`
            SELECT p.id, p.name, p.floor, p.type, p.building_id,
                b.name AS building_name, b.code AS building_code
            FROM Properties p
            LEFT JOIN Buildings b ON p.building_id = b.id
            ${whereClause}
            ORDER BY b.name, p.name
        `);
        return result.recordset;
    }

    static async findSubmissionByProperty(tenantId, propertyId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .query(`
                SELECT TOP 1 * FROM EarthquakeCensusSubmissions
                WHERE tenant_id = @tenant_id AND property_id = @property_id
            `);
        return enrichSubmission(result.recordset[0] || null);
    }

    static async findSubmissionByManualUnit(tenantId, buildingLabel, apartmentLabel) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('building_label', sql.NVarChar, buildingLabel)
            .input('apartment_label', sql.NVarChar, apartmentLabel)
            .query(`
                SELECT TOP 1 * FROM EarthquakeCensusSubmissions
                WHERE tenant_id = @tenant_id AND property_id IS NULL
                  AND building_label = @building_label AND apartment_label = @apartment_label
            `);
        return enrichSubmission(result.recordset[0] || null);
    }

    static async findSubmissionById(id) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query('SELECT * FROM EarthquakeCensusSubmissions WHERE id = @id');
        return result.recordset[0] || null;
    }

    static async getMembers(submissionId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('submission_id', sql.UniqueIdentifier, submissionId)
            .query(`
                SELECT * FROM EarthquakeCensusMembers
                WHERE submission_id = @submission_id
                ORDER BY sort_order, first_name
            `);
        return result.recordset;
    }

    static async getPhotos(submissionId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('submission_id', sql.UniqueIdentifier, submissionId)
            .query(`
                SELECT id, file_path, original_name, uploaded_at
                FROM EarthquakeCensusPhotos
                WHERE submission_id = @submission_id
                ORDER BY uploaded_at
            `);
        return result.recordset;
    }

    static async upsertSubmission(data, members) {
        const pool = await connectDB();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const {
                tenant_id, property_id, building_label, apartment_label,
                contact_phone, contact_email, notes, damage_types, damage_notes
            } = data;

            const damageTypesJson = JSON.stringify(normalizeDamageTypes(damage_types || []));
            const emailNorm = contact_email ? String(contact_email).trim().toLowerCase() : null;

            let submissionId;
            let isUpdate = false;
            const existing = property_id
                ? await this._findSubmissionInTx(transaction, tenant_id, property_id)
                : await this._findManualSubmissionInTx(transaction, tenant_id, building_label, apartment_label);

            if (existing) {
                isUpdate = true;
                submissionId = existing.id;
                await new sql.Request(transaction)
                    .input('id', sql.UniqueIdentifier, submissionId)
                    .input('building_label', sql.NVarChar, building_label)
                    .input('apartment_label', sql.NVarChar, apartment_label)
                    .input('contact_phone', sql.NVarChar, contact_phone)
                    .input('contact_email', sql.NVarChar, emailNorm)
                    .input('notes', sql.NVarChar, notes || null)
                    .input('damage_types', sql.NVarChar, damageTypesJson)
                    .input('damage_notes', sql.NVarChar, damage_notes || null)
                    .query(`
                        UPDATE EarthquakeCensusSubmissions
                        SET building_label = @building_label,
                            apartment_label = @apartment_label,
                            contact_phone = @contact_phone,
                            contact_email = @contact_email,
                            notes = @notes,
                            damage_types = @damage_types,
                            damage_notes = @damage_notes,
                            updated_at = SYSDATETIME()
                        WHERE id = @id
                    `);

                await new sql.Request(transaction)
                    .input('submission_id', sql.UniqueIdentifier, submissionId)
                    .query('DELETE FROM EarthquakeCensusMembers WHERE submission_id = @submission_id');
            } else {
                const insertResult = await new sql.Request(transaction)
                    .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                    .input('property_id', sql.UniqueIdentifier, property_id || null)
                    .input('building_label', sql.NVarChar, building_label)
                    .input('apartment_label', sql.NVarChar, apartment_label)
                    .input('contact_phone', sql.NVarChar, contact_phone)
                    .input('contact_email', sql.NVarChar, emailNorm)
                    .input('notes', sql.NVarChar, notes || null)
                    .input('damage_types', sql.NVarChar, damageTypesJson)
                    .input('damage_notes', sql.NVarChar, damage_notes || null)
                    .query(`
                        INSERT INTO EarthquakeCensusSubmissions
                            (tenant_id, property_id, building_label, apartment_label, contact_phone, contact_email, notes, damage_types, damage_notes)
                        OUTPUT INSERTED.id
                        VALUES (@tenant_id, @property_id, @building_label, @apartment_label, @contact_phone, @contact_email, @notes, @damage_types, @damage_notes)
                    `);
                submissionId = insertResult.recordset[0].id;
            }

            for (let i = 0; i < members.length; i++) {
                const m = members[i];
                await new sql.Request(transaction)
                    .input('submission_id', sql.UniqueIdentifier, submissionId)
                    .input('first_name', sql.NVarChar, m.first_name)
                    .input('last_name', sql.NVarChar, m.last_name)
                    .input('cedula', sql.NVarChar, m.cedula || null)
                    .input('no_cedula', sql.Bit, m.no_cedula ? 1 : 0)
                    .input('age', sql.Int, m.age ?? null)
                    .input('birth_date', sql.Date, m.birth_date || null)
                    .input('occupation_education', sql.NVarChar, m.occupation_education || null)
                    .input('has_disability', sql.Bit, m.has_disability ? 1 : 0)
                    .input('disability_notes', sql.NVarChar, m.disability_notes || null)
                    .input('sort_order', sql.Int, i)
                    .query(`
                        INSERT INTO EarthquakeCensusMembers
                            (submission_id, first_name, last_name, cedula, no_cedula, age, birth_date,
                             occupation_education, has_disability, disability_notes, sort_order)
                        VALUES
                            (@submission_id, @first_name, @last_name, @cedula, @no_cedula, @age, @birth_date,
                             @occupation_education, @has_disability, @disability_notes, @sort_order)
                    `);
            }

            await transaction.commit();
            const full = await this.getSubmissionFull(submissionId);
            return { ...full, is_update: isUpdate };
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }

    static async _findManualSubmissionInTx(transaction, tenantId, buildingLabel, apartmentLabel) {
        const result = await new sql.Request(transaction)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('building_label', sql.NVarChar, buildingLabel)
            .input('apartment_label', sql.NVarChar, apartmentLabel)
            .query(`
                SELECT TOP 1 id FROM EarthquakeCensusSubmissions
                WHERE tenant_id = @tenant_id AND property_id IS NULL
                  AND building_label = @building_label AND apartment_label = @apartment_label
            `);
        return result.recordset[0] || null;
    }

    static async _findSubmissionInTx(transaction, tenantId, propertyId) {
        const result = await new sql.Request(transaction)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .query(`
                SELECT TOP 1 id FROM EarthquakeCensusSubmissions
                WHERE tenant_id = @tenant_id AND property_id = @property_id
            `);
        return result.recordset[0] || null;
    }

    static async addPhotos(submissionId, photos) {
        const pool = await connectDB();
        const inserted = [];
        for (const photo of photos) {
            const result = await pool.request()
                .input('submission_id', sql.UniqueIdentifier, submissionId)
                .input('file_path', sql.NVarChar, photo.file_path)
                .input('original_name', sql.NVarChar, photo.original_name || null)
                .query(`
                    INSERT INTO EarthquakeCensusPhotos (submission_id, file_path, original_name)
                    OUTPUT INSERTED.*
                    VALUES (@submission_id, @file_path, @original_name)
                `);
            inserted.push(result.recordset[0]);
        }
        return inserted;
    }

    static async getSubmissionFull(submissionId) {
        const submission = enrichSubmission(await this.findSubmissionById(submissionId));
        if (!submission) return null;
        const members = await this.getMembers(submissionId);
        const photos = await this.getPhotos(submissionId);
        return { ...submission, members, photos };
    }

    static async listByTenant(tenantId, { buildingLabel = null, search = '' } = {}) {
        const pool = await connectDB();
        let whereClause = 'WHERE s.tenant_id = @tenant_id';
        if (buildingLabel) {
            whereClause += ' AND s.building_label = @building_label';
        }
        if (search && search.trim()) {
            whereClause += ' AND (s.apartment_label LIKE @search OR s.building_label LIKE @search OR s.contact_phone LIKE @search)';
        }

        const request = pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId);
        if (buildingLabel) {
            request.input('building_label', sql.NVarChar, buildingLabel);
        }
        if (search && search.trim()) {
            request.input('search', sql.NVarChar, `%${search.trim()}%`);
        }

        const result = await request.query(`
            SELECT s.*,
                (SELECT COUNT(*) FROM EarthquakeCensusMembers m WHERE m.submission_id = s.id) AS member_count,
                (SELECT COUNT(*) FROM EarthquakeCensusPhotos ph WHERE ph.submission_id = s.id) AS photo_count
            FROM EarthquakeCensusSubmissions s
            ${whereClause}
            ORDER BY s.building_label, s.apartment_label
        `);
        return result.recordset.map(enrichSubmission);
    }

    static async getStats(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT
                    (SELECT COUNT(*) FROM EarthquakeCensusSubmissions WHERE tenant_id = @tenant_id) AS submissions,
                    (SELECT COUNT(*) FROM EarthquakeCensusMembers m
                        INNER JOIN EarthquakeCensusSubmissions s ON s.id = m.submission_id
                        WHERE s.tenant_id = @tenant_id) AS members,
                    (SELECT COUNT(*) FROM EarthquakeCensusMembers m
                        INNER JOIN EarthquakeCensusSubmissions s ON s.id = m.submission_id
                        WHERE s.tenant_id = @tenant_id AND m.has_disability = 1) AS with_disability,
                    (SELECT COUNT(*) FROM EarthquakeCensusPhotos ph
                        INNER JOIN EarthquakeCensusSubmissions s ON s.id = ph.submission_id
                        WHERE s.tenant_id = @tenant_id) AS photos
            `);
        return result.recordset[0] || { submissions: 0, members: 0, with_disability: 0, photos: 0 };
    }

    static async getAllForPdf(tenantId) {
        const submissions = await this.listByTenant(tenantId);
        const full = [];
        for (const s of submissions) {
            const members = await this.getMembers(s.id);
            const photos = await this.getPhotos(s.id);
            full.push({ ...s, members, photos, photo_count: photos.length });
        }
        return full;
    }

    static async listSubmissionsWithPhotos(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT s.id, s.building_label, s.apartment_label, s.photos_zip_token, s.photos_zip_path,
                    (SELECT COUNT(*) FROM EarthquakeCensusPhotos ph WHERE ph.submission_id = s.id) AS photo_count
                FROM EarthquakeCensusSubmissions s
                WHERE s.tenant_id = @tenant_id
                  AND EXISTS (SELECT 1 FROM EarthquakeCensusPhotos ph WHERE ph.submission_id = s.id)
                ORDER BY s.building_label, s.apartment_label
            `);
        return result.recordset;
    }

    static async updatePhotoZipMeta(submissionId, token, zipPath) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, submissionId)
            .input('token', sql.NVarChar, token)
            .input('path', sql.NVarChar, zipPath)
            .query(`
                UPDATE EarthquakeCensusSubmissions
                SET photos_zip_token = @token,
                    photos_zip_path = @path,
                    photos_zip_updated_at = SYSDATETIME()
                WHERE id = @id
            `);
    }

    static async findSubmissionByPhotoToken(token) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('token', sql.NVarChar, token)
            .query(`
                SELECT TOP 1 * FROM EarthquakeCensusSubmissions
                WHERE photos_zip_token = @token
            `);
        return enrichSubmission(result.recordset[0] || null);
    }
}

module.exports = EarthquakeCensusModel;
