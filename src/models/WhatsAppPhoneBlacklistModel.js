const { sql, connectDB } = require('../config/database');

const DEFAULT_FAILURE_THRESHOLD = 3;

function parseFailureThreshold() {
    const n = parseInt(process.env.WHATSAPP_BLACKLIST_FAILURE_THRESHOLD || String(DEFAULT_FAILURE_THRESHOLD), 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_FAILURE_THRESHOLD;
}

class WhatsAppPhoneBlacklistModel {
    static get failureThreshold() {
        return parseFailureThreshold();
    }

    static async isBlocked(tenantId, chatId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('chat_id', sql.NVarChar, chatId)
            .query(`
                SELECT TOP 1 is_blocked FROM WhatsAppPhoneBlacklist
                WHERE tenant_id = @tenant_id AND chat_id = @chat_id AND is_blocked = 1
            `);
        return !!r.recordset[0];
    }

    static async getBlockedChatIds(tenantId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT chat_id FROM WhatsAppPhoneBlacklist
                WHERE tenant_id = @tenant_id AND is_blocked = 1
            `);
        return new Set((r.recordset || []).map((row) => row.chat_id));
    }

    static async recordSuccess(tenantId, chatId) {
        const pool = await connectDB();
        await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('chat_id', sql.NVarChar, chatId)
            .query(`
                UPDATE WhatsAppPhoneBlacklist
                SET
                    consecutive_failures = 0,
                    is_blocked = 0,
                    blocked_at = NULL,
                    owner_notified_at = NULL,
                    last_success_at = SYSUTCDATETIME(),
                    updated_at = SYSUTCDATETIME()
                WHERE tenant_id = @tenant_id AND chat_id = @chat_id
            `);
    }

    /**
     * Registra fallo HTTP 500. Tras N consecutivos, bloquea el chatId para ese tenant.
     */
    static async recordServerFailure(tenantId, chatId, userId, errorMessage) {
        const pool = await connectDB();
        const threshold = parseFailureThreshold();
        const err = (errorMessage || '').slice(0, 500);

        const beforeRow = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('chat_id', sql.NVarChar, chatId)
            .query(`
                SELECT is_blocked, owner_notified_at
                FROM WhatsAppPhoneBlacklist
                WHERE tenant_id = @tenant_id AND chat_id = @chat_id
            `);
        const wasBlocked = !!beforeRow.recordset[0]?.is_blocked;

        await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('chat_id', sql.NVarChar, chatId)
            .input('user_id', sql.UniqueIdentifier, userId || null)
            .input('err', sql.NVarChar, err)
            .input('threshold', sql.Int, threshold)
            .query(`
                MERGE WhatsAppPhoneBlacklist AS t
                USING (SELECT @tenant_id AS tenant_id, @chat_id AS chat_id) AS s
                ON t.tenant_id = s.tenant_id AND t.chat_id = s.chat_id
                WHEN MATCHED THEN
                    UPDATE SET
                        user_id = COALESCE(@user_id, t.user_id),
                        consecutive_failures = t.consecutive_failures + 1,
                        last_error = @err,
                        last_failure_at = SYSUTCDATETIME(),
                        is_blocked = CASE WHEN t.consecutive_failures + 1 >= @threshold THEN 1 ELSE t.is_blocked END,
                        blocked_at = CASE
                            WHEN t.consecutive_failures + 1 >= @threshold AND t.blocked_at IS NULL
                            THEN SYSUTCDATETIME() ELSE t.blocked_at END,
                        updated_at = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN
                    INSERT (tenant_id, chat_id, user_id, consecutive_failures, last_error, last_failure_at, is_blocked, blocked_at)
                    VALUES (
                        @tenant_id, @chat_id, @user_id, 1, @err, SYSUTCDATETIME(),
                        CASE WHEN 1 >= @threshold THEN 1 ELSE 0 END,
                        CASE WHEN 1 >= @threshold THEN SYSUTCDATETIME() ELSE NULL END
                    );
            `);

        const row = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('chat_id', sql.NVarChar, chatId)
            .query(`
                SELECT consecutive_failures, is_blocked, blocked_at, owner_notified_at
                FROM WhatsAppPhoneBlacklist
                WHERE tenant_id = @tenant_id AND chat_id = @chat_id
            `);

        const stats = row.recordset[0] || { consecutive_failures: 1, is_blocked: false };
        const isBlocked = !!stats.is_blocked;
        return {
            failureCount: stats.consecutive_failures,
            blocked: isBlocked,
            blockedAt: stats.blocked_at || null,
            threshold,
            newlyBlocked: isBlocked && !wasBlocked,
            ownerNotified: !!stats.owner_notified_at
        };
    }

    static async markOwnerNotified(tenantId, chatId) {
        const pool = await connectDB();
        await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('chat_id', sql.NVarChar, chatId)
            .query(`
                UPDATE WhatsAppPhoneBlacklist
                SET owner_notified_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
                WHERE tenant_id = @tenant_id AND chat_id = @chat_id
            `);
    }

    static _selectListFields() {
        return `
            b.id,
            b.tenant_id,
            b.chat_id,
            b.user_id,
            b.consecutive_failures,
            b.is_blocked,
            b.last_error,
            b.last_failure_at,
            b.blocked_at,
            b.owner_notified_at,
            b.last_success_at,
            b.created_at,
            b.updated_at,
            t.name AS block_tenant_name,
            t.slug AS block_tenant_slug,
            u.first_name,
            u.last_name,
            u.email,
            u.phone,
            u.dni,
            (
                SELECT STRING_AGG(x.tenant_name, N'; ') WITHIN GROUP (ORDER BY x.tenant_name)
                FROM (
                    SELECT DISTINCT ten.name AS tenant_name
                    FROM PropertyOwners po
                    INNER JOIN Properties p ON p.id = po.property_id
                    INNER JOIN Tenants ten ON ten.id = p.tenant_id
                    WHERE po.user_id = b.user_id
                ) x
            ) AS owner_tenants,
            (
                SELECT STRING_AGG(x.prop_label, N'; ') WITHIN GROUP (ORDER BY x.prop_label)
                FROM (
                    SELECT DISTINCT CONCAT(ten.name, N' · ', p.name) AS prop_label
                    FROM PropertyOwners po
                    INNER JOIN Properties p ON p.id = po.property_id
                    INNER JOIN Tenants ten ON ten.id = p.tenant_id
                    WHERE po.user_id = b.user_id
                ) x
            ) AS owner_properties
        `;
    }

    /**
     * @param {{ page?: number, limit?: number, tenantId?: string|null, blockedOnly?: boolean }}
     */
    static async listEntries(opts = {}) {
        const pool = await connectDB();
        const page = Math.max(1, opts.page || 1);
        const limit = Math.min(100, Math.max(1, opts.limit || 25));
        const offset = (page - 1) * limit;

        const countReq = pool.request();
        let where = 'WHERE 1=1';
        const dataR = pool.request()
            .input('offset', sql.Int, offset)
            .input('lim', sql.Int, limit);

        const blockedOnly = opts.blockedOnly !== false;
        if (blockedOnly) {
            where += ' AND b.is_blocked = 1';
        } else {
            where += ' AND (b.is_blocked = 1 OR b.consecutive_failures > 0)';
        }
        if (opts.tenantId) {
            where += ' AND b.tenant_id = @tid';
            countReq.input('tid', sql.UniqueIdentifier, opts.tenantId);
            dataR.input('tid', sql.UniqueIdentifier, opts.tenantId);
        }

        const totalR = await countReq.query(`
            SELECT COUNT(*) AS n FROM WhatsAppPhoneBlacklist b ${where}
        `);
        const total = Number(totalR.recordset[0]?.n) || 0;

        const dataResult = await dataR.query(`
            SELECT ${WhatsAppPhoneBlacklistModel._selectListFields()}
            FROM WhatsAppPhoneBlacklist b
            INNER JOIN Tenants t ON t.id = b.tenant_id
            LEFT JOIN Users u ON u.id = b.user_id
            ${where}
            ORDER BY
                CASE WHEN b.is_blocked = 1 THEN 0 ELSE 1 END,
                b.blocked_at DESC,
                b.updated_at DESC
            OFFSET @offset ROWS FETCH NEXT @lim ROWS ONLY
        `);

        return {
            rows: dataResult.recordset || [],
            pagination: {
                page,
                limit,
                total,
                pages: Math.max(1, Math.ceil(total / limit))
            }
        };
    }

    /**
     * @param {{ tenantId?: string|null, blockedOnly?: boolean }}
     */
    static async listExportRows(opts = {}) {
        const pool = await connectDB();
        const req = pool.request();

        let where = 'WHERE 1=1';
        const blockedOnly = opts.blockedOnly !== false;
        if (blockedOnly) {
            where += ' AND b.is_blocked = 1';
        } else {
            where += ' AND (b.is_blocked = 1 OR b.consecutive_failures > 0)';
        }
        if (opts.tenantId) {
            where += ' AND b.tenant_id = @tid';
            req.input('tid', sql.UniqueIdentifier, opts.tenantId);
        }

        const r = await req.query(`
            SELECT ${WhatsAppPhoneBlacklistModel._selectListFields()}
            FROM WhatsAppPhoneBlacklist b
            INNER JOIN Tenants t ON t.id = b.tenant_id
            LEFT JOIN Users u ON u.id = b.user_id
            ${where}
            ORDER BY
                CASE WHEN b.is_blocked = 1 THEN 0 ELSE 1 END,
                b.blocked_at DESC,
                b.updated_at DESC
        `);
        return r.recordset || [];
    }

    /**
     * @param {{ tenantId?: string|null }}
     */
    static async getMetrics(opts = {}) {
        const pool = await connectDB();
        const req = pool.request();
        let where = '';
        if (opts.tenantId) {
            where = 'WHERE tenant_id = @tid';
            req.input('tid', sql.UniqueIdentifier, opts.tenantId);
        }
        const r = await req.query(`
            SELECT
                SUM(CASE WHEN is_blocked = 1 THEN 1 ELSE 0 END) AS blocked_count,
                SUM(CASE WHEN is_blocked = 0 AND consecutive_failures > 0 THEN 1 ELSE 0 END) AS at_risk_count,
                COUNT(*) AS total_entries
            FROM WhatsAppPhoneBlacklist
            ${where}
        `);
        const row = r.recordset[0] || {};
        return {
            blocked_count: Number(row.blocked_count) || 0,
            at_risk_count: Number(row.at_risk_count) || 0,
            total_entries: Number(row.total_entries) || 0,
            failure_threshold: parseFailureThreshold()
        };
    }
}

module.exports = WhatsAppPhoneBlacklistModel;
