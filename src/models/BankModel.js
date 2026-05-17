const { connectDB, sql } = require('../config/database');

/**
 * Catálogo global de bancos soportados para conciliación.
 * El SuperAdmin activa/desactiva un banco para deshabilitar su uso en todos los tenants.
 */
class BankModel {
    static async listAll() {
        const pool = await connectDB();
        const r = await pool.request().query(`
            SELECT id, code, name, parser_key, supports_pdf, supports_csv, supports_xlsx,
                   is_active, notes, display_order, created_at, updated_at
            FROM Banks
            ORDER BY display_order ASC, name ASC
        `);
        return r.recordset;
    }

    static async listActive() {
        const pool = await connectDB();
        const r = await pool.request().query(`
            SELECT id, code, name, parser_key, supports_pdf, supports_csv, supports_xlsx,
                   display_order
            FROM Banks
            WHERE is_active = 1
            ORDER BY display_order ASC, name ASC
        `);
        return r.recordset;
    }

    static async findById(id) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query('SELECT * FROM Banks WHERE id = @id');
        return r.recordset[0] || null;
    }

    static async findByCode(code) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('code', sql.NVarChar, code)
            .query('SELECT * FROM Banks WHERE code = @code');
        return r.recordset[0] || null;
    }

    static async setActive(id, isActive) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('is_active', sql.Bit, isActive ? 1 : 0)
            .query(`
                UPDATE Banks
                SET is_active = @is_active, updated_at = SYSDATETIME()
                WHERE id = @id
            `);
        return this.findById(id);
    }

    static async updateNotes(id, notes) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('notes', sql.NVarChar, notes || null)
            .query(`
                UPDATE Banks
                SET notes = @notes, updated_at = SYSDATETIME()
                WHERE id = @id
            `);
        return this.findById(id);
    }
}

module.exports = BankModel;
