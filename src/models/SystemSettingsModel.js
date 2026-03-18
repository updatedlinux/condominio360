const { sql, connectDB } = require('../config/database');

/**
 * Configuración global del sistema (key-value)
 */
class SystemSettingsModel {
    static async get(key) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('key', sql.NVarChar, key)
            .query('SELECT setting_value FROM SystemSettings WHERE setting_key = @key');
        const val = r.recordset[0]?.setting_value;
        if (!val) return null;
        try {
            return JSON.parse(val);
        } catch {
            return val;
        }
    }

    static async set(key, value) {
        const pool = await connectDB();
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        await pool.request()
            .input('key', sql.NVarChar, key)
            .input('val', sql.NVarChar, str)
            .query(`
                IF EXISTS (SELECT 1 FROM SystemSettings WHERE setting_key = @key)
                    UPDATE SystemSettings SET setting_value = @val, updated_at = SYSDATETIME() WHERE setting_key = @key
                ELSE
                    INSERT INTO SystemSettings (setting_key, setting_value) VALUES (@key, @val)
            `);
    }
}

module.exports = SystemSettingsModel;
