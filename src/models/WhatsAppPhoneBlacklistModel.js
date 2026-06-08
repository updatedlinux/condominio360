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
}

module.exports = WhatsAppPhoneBlacklistModel;
