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
        damage_notes: row.damage_notes || null,
        currently_inhabiting: row.currently_inhabiting === true
            || row.currently_inhabiting === 1
            || row.currently_inhabiting === '1'
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

    static async countPropertiesByTenant(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT COUNT(*) AS cnt FROM Properties WHERE tenant_id = @tenant_id');
        return Number(result.recordset[0]?.cnt) || 0;
    }

    /**
     * Resuelve inmueble del censo desde el catálogo (ignora etiquetas enviadas por el cliente).
     * @returns {Promise<{ property_id: string, building_label: string, apartment_label: string } | null>}
     */
    static async resolveCensusProperty(tenantId, propertyId, tenantName = '') {
        if (!propertyId) return null;
        const pool = await connectDB();
        const result = await pool.request()
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT p.id, p.name, b.name AS building_name
                FROM Properties p
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.id = @property_id AND p.tenant_id = @tenant_id
            `);
        const row = result.recordset[0];
        if (!row) return null;
        return {
            property_id: row.id,
            building_label: (row.building_name || tenantName || 'Condominio').trim(),
            apartment_label: String(row.name || '').trim()
        };
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

    static async findSubmissionByPropertyExcluding(submissionId, tenantId, propertyId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .input('exclude_id', sql.UniqueIdentifier, submissionId)
            .query(`
                SELECT TOP 1 id, apartment_label, building_label
                FROM EarthquakeCensusSubmissions
                WHERE tenant_id = @tenant_id AND property_id = @property_id AND id <> @exclude_id
            `);
        return result.recordset[0] || null;
    }

    /**
     * Actualización administrativa de un registro de censo (junta).
     */
    static async adminUpdateSubmission(submissionId, tenantId, data, members = null) {
        const pool = await connectDB();
        const existing = enrichSubmission(await this.findSubmissionById(submissionId));
        if (!existing || String(existing.tenant_id) !== String(tenantId)) {
            return null;
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            let propertyId = data.property_id !== undefined ? (data.property_id || null) : existing.property_id;
            let buildingLabel = String(data.building_label ?? existing.building_label ?? '').trim();
            let apartmentLabel = String(data.apartment_label ?? existing.apartment_label ?? '').trim();

            if (propertyId) {
                const resolved = await this.resolveCensusProperty(tenantId, propertyId);
                if (!resolved) {
                    const err = new Error('Inmueble no válido para este condominio');
                    err.code = 'PROPERTY_INVALID';
                    throw err;
                }
                const conflict = await this.findSubmissionByPropertyExcluding(
                    submissionId, tenantId, propertyId
                );
                if (conflict) {
                    const err = new Error(
                        `Ese apartamento ya tiene un censo (${conflict.building_label} — ${conflict.apartment_label})`
                    );
                    err.code = 'PROPERTY_TAKEN';
                    throw err;
                }
                propertyId = resolved.property_id;
                buildingLabel = resolved.building_label;
                apartmentLabel = resolved.apartment_label;
            }

            if (!buildingLabel || !apartmentLabel) {
                const err = new Error('Indique edificio y apartamento');
                err.code = 'VALIDATION';
                throw err;
            }

            const contactPhone = String(data.contact_phone ?? existing.contact_phone ?? '').trim();
            const contactEmail = String(data.contact_email ?? existing.contact_email ?? '').trim().toLowerCase();
            const notes = data.notes !== undefined
                ? (String(data.notes || '').trim() || null)
                : existing.notes;
            const damageNotes = data.damage_notes !== undefined
                ? (String(data.damage_notes || '').trim() || null)
                : existing.damage_notes;
            const damageTypesJson = data.damage_types !== undefined
                ? JSON.stringify(normalizeDamageTypes(data.damage_types || []))
                : (existing.damage_types ? JSON.stringify(normalizeDamageTypes(existing.damage_types)) : '[]');

            const inhabitingRaw = data.currently_inhabiting ?? existing.currently_inhabiting;
            const inhabitingBit = inhabitingRaw === true
                || inhabitingRaw === 1
                || inhabitingRaw === '1'
                ? 1
                : 0;

            await new sql.Request(transaction)
                .input('id', sql.UniqueIdentifier, submissionId)
                .input('property_id', sql.UniqueIdentifier, propertyId)
                .input('building_label', sql.NVarChar, buildingLabel)
                .input('apartment_label', sql.NVarChar, apartmentLabel)
                .input('contact_phone', sql.NVarChar, contactPhone)
                .input('contact_email', sql.NVarChar, contactEmail || null)
                .input('notes', sql.NVarChar, notes)
                .input('damage_types', sql.NVarChar, damageTypesJson)
                .input('damage_notes', sql.NVarChar, damageNotes)
                .input('currently_inhabiting', sql.Bit, inhabitingBit)
                .query(`
                    UPDATE EarthquakeCensusSubmissions
                    SET property_id = @property_id,
                        building_label = @building_label,
                        apartment_label = @apartment_label,
                        contact_phone = @contact_phone,
                        contact_email = @contact_email,
                        notes = @notes,
                        damage_types = @damage_types,
                        damage_notes = @damage_notes,
                        currently_inhabiting = @currently_inhabiting,
                        updated_at = SYSDATETIME()
                    WHERE id = @id
                `);

            if (Array.isArray(members)) {
                await new sql.Request(transaction)
                    .input('submission_id', sql.UniqueIdentifier, submissionId)
                    .query('DELETE FROM EarthquakeCensusMembers WHERE submission_id = @submission_id');

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
            }

            await transaction.commit();
            return this.getSubmissionFull(submissionId);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
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
                contact_phone, contact_email, notes, damage_types, damage_notes,
                currently_inhabiting
            } = data;

            const inhabitingBit = currently_inhabiting ? 1 : 0;

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
                    .input('currently_inhabiting', sql.Bit, inhabitingBit)
                    .query(`
                        UPDATE EarthquakeCensusSubmissions
                        SET building_label = @building_label,
                            apartment_label = @apartment_label,
                            contact_phone = @contact_phone,
                            contact_email = @contact_email,
                            notes = @notes,
                            damage_types = @damage_types,
                            damage_notes = @damage_notes,
                            currently_inhabiting = @currently_inhabiting,
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
                    .input('currently_inhabiting', sql.Bit, inhabitingBit)
                    .query(`
                        INSERT INTO EarthquakeCensusSubmissions
                            (tenant_id, property_id, building_label, apartment_label, contact_phone, contact_email, notes, damage_types, damage_notes, currently_inhabiting)
                        OUTPUT INSERTED.id
                        VALUES (@tenant_id, @property_id, @building_label, @apartment_label, @contact_phone, @contact_email, @notes, @damage_types, @damage_notes, @currently_inhabiting)
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

    static async countPhotos(submissionId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('submission_id', sql.UniqueIdentifier, submissionId)
            .query(`
                SELECT COUNT(*) AS total FROM EarthquakeCensusPhotos
                WHERE submission_id = @submission_id
            `);
        return Number(result.recordset[0]?.total) || 0;
    }

    static async removePhotos(submissionId, photoIds) {
        if (!photoIds?.length) return 0;

        const pool = await connectDB();
        const fs = require('fs');
        const path = require('path');
        const uploadsRoot = path.join(process.cwd(), 'uploads');

        const uniqueIds = [...new Set(photoIds.filter(Boolean))];
        let removed = 0;

        for (const photoId of uniqueIds) {
            const found = await pool.request()
                .input('id', sql.UniqueIdentifier, photoId)
                .input('submission_id', sql.UniqueIdentifier, submissionId)
                .query(`
                    SELECT id, file_path FROM EarthquakeCensusPhotos
                    WHERE id = @id AND submission_id = @submission_id
                `);
            const row = found.recordset[0];
            if (!row) continue;

            await pool.request()
                .input('id', sql.UniqueIdentifier, photoId)
                .query('DELETE FROM EarthquakeCensusPhotos WHERE id = @id');

            if (row.file_path) {
                const abs = path.join(uploadsRoot, row.file_path);
                fs.unlink(abs, () => {});
            }
            removed += 1;
        }

        return removed;
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
