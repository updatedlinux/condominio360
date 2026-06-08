const { sql, connectDB } = require('../config/database');

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

class TenantJuntaEmailContactModel {
    static normalizeEmail(email) {
        return normalizeEmail(email);
    }

    static isValidEmail(email) {
        const e = normalizeEmail(email);
        return e.length >= 5 && e.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    }

    static async listByTenant(tenantId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT id, tenant_id, email, display_name, notes, created_at, updated_at
                FROM TenantJuntaEmailContacts
                WHERE tenant_id = @tenant_id
                ORDER BY display_name, email
            `);
        return r.recordset || [];
    }

    static async findByIds(tenantId, ids) {
        if (!ids || !ids.length) return [];
        const pool = await connectDB();
        const placeholders = ids.map((_, i) => `@id${i}`).join(', ');
        const req = pool.request().input('tenant_id', sql.UniqueIdentifier, tenantId);
        ids.forEach((id, i) => req.input(`id${i}`, sql.UniqueIdentifier, id));
        const r = await req.query(`
            SELECT id, tenant_id, email, display_name, notes
            FROM TenantJuntaEmailContacts
            WHERE tenant_id = @tenant_id AND id IN (${placeholders})
        `);
        return r.recordset || [];
    }

    static async create(tenantId, data, createdBy = null) {
        const email = normalizeEmail(data.email);
        if (!TenantJuntaEmailContactModel.isValidEmail(email)) {
            const err = new Error('Correo electrónico inválido');
            err.code = 'VALIDATION';
            throw err;
        }
        const displayName = String(data.display_name || '').trim() || null;
        const notes = String(data.notes || '').trim().slice(0, 500) || null;

        const pool = await connectDB();
        try {
            const r = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('email', sql.NVarChar, email)
                .input('display_name', sql.NVarChar, displayName)
                .input('notes', sql.NVarChar, notes)
                .input('created_by', sql.UniqueIdentifier, createdBy || null)
                .query(`
                    INSERT INTO TenantJuntaEmailContacts (tenant_id, email, display_name, notes, created_by)
                    OUTPUT INSERTED.*
                    VALUES (@tenant_id, @email, @display_name, @notes, @created_by)
                `);
            return r.recordset[0];
        } catch (e) {
            if (e.number === 2627 || e.number === 2601) {
                const err = new Error('Ese correo ya está guardado como contacto frecuente');
                err.code = 'DUPLICATE';
                throw err;
            }
            throw e;
        }
    }

    /**
     * Crea o actualiza nombre/notas si el email ya existe en el tenant.
     */
    static async upsert(tenantId, data, createdBy = null) {
        const email = normalizeEmail(data.email);
        if (!TenantJuntaEmailContactModel.isValidEmail(email)) {
            const err = new Error('Correo electrónico inválido');
            err.code = 'VALIDATION';
            throw err;
        }
        const displayName = String(data.display_name || '').trim() || null;
        const notes = String(data.notes || '').trim().slice(0, 500) || null;

        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('email', sql.NVarChar, email)
            .input('display_name', sql.NVarChar, displayName)
            .input('notes', sql.NVarChar, notes)
            .input('created_by', sql.UniqueIdentifier, createdBy || null)
            .query(`
                MERGE TenantJuntaEmailContacts AS t
                USING (SELECT @tenant_id AS tenant_id, @email AS email) AS s
                ON t.tenant_id = s.tenant_id AND t.email = s.email
                WHEN MATCHED THEN
                    UPDATE SET
                        display_name = COALESCE(@display_name, t.display_name),
                        notes = COALESCE(@notes, t.notes),
                        updated_at = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN
                    INSERT (tenant_id, email, display_name, notes, created_by)
                    VALUES (@tenant_id, @email, @display_name, @notes, @created_by)
                OUTPUT INSERTED.*;
            `);
        return r.recordset[0];
    }

    static async delete(tenantId, contactId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('id', sql.UniqueIdentifier, contactId)
            .query(`
                DELETE FROM TenantJuntaEmailContacts
                OUTPUT DELETED.id
                WHERE tenant_id = @tenant_id AND id = @id
            `);
        return !!r.recordset[0];
    }
}

module.exports = TenantJuntaEmailContactModel;
