const { sql, connectDB } = require('../config/database');

const WINDOW_SECONDS = 120;
const MAX_SENDS_PER_WINDOW = 30;

class WhatsAppDeliveryModel {
    static async getMetricsSnapshot() {
        const pool = await connectDB();
        try {
            const pendingR = await pool.request().query(`
                SELECT COUNT(*) AS n FROM WhatsAppOutboundQueue WHERE status = N'PENDING'
            `);
            const rateR = await pool.request().query(`
                SELECT COUNT(*) AS n FROM WhatsAppGlobalSendLog
                WHERE sent_at >= DATEADD(SECOND, -${WINDOW_SECONDS}, SYSUTCDATETIME())
            `);
            const thirtyR = await pool.request().query(`
                SELECT
                    SUM(CASE WHEN status = N'SENT' THEN 1 ELSE 0 END) AS sent_n,
                    SUM(CASE WHEN status = N'FAILED' THEN 1 ELSE 0 END) AS failed_n
                FROM WhatsAppOutboundQueue
                WHERE created_at >= DATEADD(DAY, -30, SYSUTCDATETIME())
            `);
            const row = thirtyR.recordset[0] || {};
            return {
                pending_queue: Number(pendingR.recordset[0]?.n) || 0,
                sends_in_rate_window: Number(rateR.recordset[0]?.n) || 0,
                rate_window_seconds: WINDOW_SECONDS,
                rate_max_per_window: MAX_SENDS_PER_WINDOW,
                sent_last_30d: Number(row.sent_n) || 0,
                failed_last_30d: Number(row.failed_n) || 0
            };
        } catch (e) {
            console.warn('[WhatsAppDeliveryModel.getMetricsSnapshot]', e.message);
            return {
                pending_queue: 0,
                sends_in_rate_window: 0,
                rate_window_seconds: WINDOW_SECONDS,
                rate_max_per_window: MAX_SENDS_PER_WINDOW,
                sent_last_30d: 0,
                failed_last_30d: 0
            };
        }
    }

    /**
     * @param {{ page: number, limit: number, days: number, status?: string|null, tenantId?: string|null }}
     */
    static async listDeliveries(opts) {
        const pool = await connectDB();
        const page = Math.max(1, opts.page || 1);
        const limit = Math.min(100, Math.max(1, opts.limit || 25));
        const offset = (page - 1) * limit;
        const days = Math.min(365, Math.max(1, opts.days || 30));

        let where = 'WHERE q.created_at >= DATEADD(DAY, -@days, SYSUTCDATETIME())';
        const reqCount = pool.request().input('days', sql.Int, days);
        const reqData = pool.request()
            .input('days', sql.Int, days)
            .input('offset', sql.Int, offset)
            .input('lim', sql.Int, limit);

        if (opts.status) {
            where += ' AND q.status = @st';
            reqCount.input('st', sql.NVarChar, opts.status);
            reqData.input('st', sql.NVarChar, opts.status);
        }
        if (opts.tenantId) {
            where += ' AND q.tenant_id = @tid';
            reqCount.input('tid', sql.UniqueIdentifier, opts.tenantId);
            reqData.input('tid', sql.UniqueIdentifier, opts.tenantId);
        }

        const totalR = await reqCount.query(`
            SELECT COUNT(*) AS n FROM WhatsAppOutboundQueue q ${where}
        `);
        const total = Number(totalR.recordset[0]?.n) || 0;

        const dataR = await reqData.query(`
            SELECT
                q.id,
                q.tenant_id,
                q.in_app_notification_id,
                q.user_id,
                q.phone_national,
                q.message_body,
                q.status,
                q.error_message,
                q.created_at,
                q.sent_at,
                t.name AS tenant_name,
                t.slug AS tenant_slug,
                u.first_name,
                u.last_name,
                u.email AS owner_email,
                u.phone AS owner_phone_raw,
                n.message AS notification_message,
                n.sent_at AS notification_sent_at
            FROM WhatsAppOutboundQueue q
            INNER JOIN Tenants t ON t.id = q.tenant_id
            INNER JOIN Users u ON u.id = q.user_id
            LEFT JOIN InAppNotifications n ON n.id = q.in_app_notification_id
            ${where}
            ORDER BY q.created_at DESC
            OFFSET @offset ROWS FETCH NEXT @lim ROWS ONLY
        `);

        return {
            rows: dataR.recordset || [],
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit) || 1
            }
        };
    }
}

module.exports = WhatsAppDeliveryModel;
