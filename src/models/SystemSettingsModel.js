const { sql, connectDB } = require('../config/database');

const BCV_SETTING_KEY = 'bcv_dolarvzla_api_key';

/**
 * Configuración global key-value (tabla SystemSettings de migración SaaS).
 * Claves: saas_payment_info, bcv_dolarvzla_api_key, etc.
 */
class SystemSettingsModel {
    static async get(key) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('k', sql.NVarChar, key)
            .query(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`);
        if (!result.recordset.length) return null;
        const raw = result.recordset[0].setting_value;
        if (raw == null || raw === '') return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    static async set(key, value) {
        const pool = await connectDB();
        const json = JSON.stringify(value);
        await pool.request()
            .input('k', sql.NVarChar, key)
            .input('v', sql.NVarChar(sql.MAX), json)
            .query(`
                IF EXISTS (SELECT 1 FROM SystemSettings WHERE setting_key = @k)
                    UPDATE SystemSettings SET setting_value = @v, updated_at = SYSDATETIME() WHERE setting_key = @k
                ELSE
                    INSERT INTO SystemSettings (setting_key, setting_value, updated_at) VALUES (@k, @v, SYSDATETIME())
            `);
    }

    /**
     * Fila para panel Super Admin (compatibilidad con AdminController.getBcvSettings)
     */
    static async getRow() {
        const pool = await connectDB();
        const r = await pool.request()
            .input('k', sql.NVarChar, BCV_SETTING_KEY)
            .query(`SELECT setting_value, updated_at FROM SystemSettings WHERE setting_key = @k`);
        const row = r.recordset[0];
        if (!row) {
            return {
                bcv_dolarvzla_api_key: null,
                bcv_api_key_updated_at: null,
                updated_by: null
            };
        }
        let parsed = null;
        try {
            parsed = JSON.parse(row.setting_value || 'null');
        } catch {
            parsed = null;
        }
        const dbKey = parsed && typeof parsed.api_key === 'string' ? parsed.api_key.trim() : null;
        const updatedBy = parsed && parsed.updated_by ? parsed.updated_by : null;
        return {
            bcv_dolarvzla_api_key: dbKey,
            bcv_api_key_updated_at: row.updated_at,
            updated_by: updatedBy
        };
    }

    static async getBcvApiKey() {
        const row = await this.getRow();
        return row.bcv_dolarvzla_api_key || null;
    }

    static maskKey(key) {
        if (!key || typeof key !== 'string') return null;
        const t = key.trim();
        if (t.length <= 8) return '••••••••';
        return `${t.slice(0, 4)}…${t.slice(-4)} (${t.length} caracteres)`;
    }

    static async updateBcvApiKey(apiKey, userId) {
        await this.set(BCV_SETTING_KEY, {
            api_key: apiKey.trim(),
            updated_by: userId
        });
        return this.getRow();
    }
}

module.exports = SystemSettingsModel;
