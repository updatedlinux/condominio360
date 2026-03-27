const { sql, connectDB } = require('../config/database');

/**
 * Configuración global singleton (fila id = 1)
 */
class SystemSettingsModel {
    static async getRow() {
        const pool = await connectDB();
        const result = await pool.request().query(`
            SELECT id, bcv_dolarvzla_api_key, bcv_api_key_updated_at, updated_by
            FROM SystemSettings WHERE id = 1
        `);
        return result.recordset[0] || null;
    }

    /**
     * Clave API DolarVzla (puede ser null si no se guardó en BD)
     */
    static async getBcvApiKey() {
        const row = await this.getRow();
        const k = row?.bcv_dolarvzla_api_key;
        return k && String(k).trim() ? String(k).trim() : null;
    }

    static maskKey(key) {
        if (!key || typeof key !== 'string') return null;
        const t = key.trim();
        if (t.length <= 8) return '••••••••';
        return `${t.slice(0, 4)}…${t.slice(-4)} (${t.length} caracteres)`;
    }

    /**
     * Actualiza clave BCV y marca fecha (superadmin)
     */
    static async updateBcvApiKey(apiKey, userId) {
        const pool = await connectDB();
        await pool.request()
            .input('key', sql.NVarChar, apiKey.trim())
            .input('user_id', sql.UniqueIdentifier, userId)
            .query(`
                UPDATE SystemSettings
                SET bcv_dolarvzla_api_key = @key,
                    bcv_api_key_updated_at = SYSDATETIME(),
                    updated_by = @user_id
                WHERE id = 1
            `);
        return this.getRow();
    }
}

module.exports = SystemSettingsModel;
