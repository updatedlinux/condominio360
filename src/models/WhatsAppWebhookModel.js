const { sql, connectDB } = require('../config/database');

class WhatsAppWebhookModel {
    static async insertEvent(data) {
        const pool = await connectDB();
        const {
            tenantId = null,
            sessionId = null,
            eventType,
            openwaMessageId = null,
            queueId = null,
            payload = null
        } = data;
        const payloadStr = payload != null
            ? (typeof payload === 'string' ? payload : JSON.stringify(payload)).slice(0, 4000000)
            : null;
        await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('session_id', sql.NVarChar, sessionId)
            .input('event_type', sql.NVarChar, eventType)
            .input('openwa_message_id', sql.NVarChar, openwaMessageId)
            .input('queue_id', sql.UniqueIdentifier, queueId)
            .input('payload', sql.NVarChar, payloadStr)
            .query(`
                INSERT INTO WhatsAppWebhookEvents
                (tenant_id, session_id, event_type, openwa_message_id, queue_id, payload)
                VALUES (@tenant_id, @session_id, @event_type, @openwa_message_id, @queue_id, @payload)
            `);
    }

    static async findTenantIdBySessionId(sessionId) {
        if (!sessionId) return null;
        const pool = await connectDB();
        const r = await pool.request()
            .input('sid', sql.NVarChar, sessionId)
            .query(`
                SELECT TOP 1 id FROM Tenants
                WHERE whatsapp_openwa_session_id = @sid
            `);
        return r.recordset[0]?.id || null;
    }

    static async findQueueIdByMessageId(openwaMessageId) {
        if (!openwaMessageId) return null;
        const pool = await connectDB();
        const r = await pool.request()
            .input('mid', sql.NVarChar, openwaMessageId)
            .query(`
                SELECT TOP 1 id FROM WhatsAppOutboundQueue WHERE openwa_message_id = @mid
            `);
        if (r.recordset[0]?.id) return r.recordset[0].id;

        const parts = String(openwaMessageId).split('_');
        const suffix = parts.length > 1 ? parts[parts.length - 1] : null;
        if (suffix && suffix.length >= 8) {
            const r2 = await pool.request()
                .input('pat', sql.NVarChar, `%_${suffix}`)
                .query(`
                    SELECT TOP 1 id FROM WhatsAppOutboundQueue
                    WHERE openwa_message_id LIKE @pat
                    ORDER BY created_at DESC
                `);
            return r2.recordset[0]?.id || null;
        }
        return null;
    }

    static async updateQueueDeliveryByMessageId(openwaMessageId, deliveryStatus, deliveredAt = null) {
        if (!openwaMessageId) return;
        const queueId = await WhatsAppWebhookModel.findQueueIdByMessageId(openwaMessageId);
        if (!queueId) return;
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, queueId)
            .input('mid', sql.NVarChar, openwaMessageId)
            .input('ds', sql.NVarChar, deliveryStatus)
            .input('da', sql.DateTime2, deliveredAt)
            .query(`
                UPDATE WhatsAppOutboundQueue
                SET delivery_status = @ds,
                    delivered_at = COALESCE(@da, delivered_at),
                    openwa_message_id = COALESCE(openwa_message_id, @mid)
                WHERE id = @id
            `);
    }

    /**
     * @param {{ page: number, limit: number, days: number, tenantId?: string|null, eventType?: string|null, sessionId?: string|null }}
     */
    static async listEvents(opts) {
        const pool = await connectDB();
        const page = Math.max(1, opts.page || 1);
        const limit = Math.min(100, Math.max(1, opts.limit || 25));
        const offset = (page - 1) * limit;
        const days = Math.min(365, Math.max(1, opts.days || 30));

        let where = 'WHERE e.created_at >= DATEADD(DAY, -@days, SYSUTCDATETIME())';
        const reqCount = pool.request().input('days', sql.Int, days);
        const reqData = pool.request()
            .input('days', sql.Int, days)
            .input('offset', sql.Int, offset)
            .input('lim', sql.Int, limit);

        if (opts.tenantId) {
            where += ' AND e.tenant_id = @tid';
            reqCount.input('tid', sql.UniqueIdentifier, opts.tenantId);
            reqData.input('tid', sql.UniqueIdentifier, opts.tenantId);
        }
        if (opts.eventType) {
            where += ' AND e.event_type = @et';
            reqCount.input('et', sql.NVarChar, opts.eventType);
            reqData.input('et', sql.NVarChar, opts.eventType);
        }
        if (opts.sessionId) {
            where += ' AND e.session_id = @sid';
            reqCount.input('sid', sql.NVarChar, opts.sessionId);
            reqData.input('sid', sql.NVarChar, opts.sessionId);
        }

        const totalR = await reqCount.query(`SELECT COUNT(*) AS n FROM WhatsAppWebhookEvents e ${where}`);
        const total = Number(totalR.recordset[0]?.n) || 0;

        const dataR = await reqData.query(`
            SELECT
                e.id,
                e.tenant_id,
                e.session_id,
                e.event_type,
                e.openwa_message_id,
                e.queue_id,
                e.created_at,
                t.name AS tenant_name,
                q.status AS queue_status,
                q.delivery_status AS queue_delivery_status
            FROM WhatsAppWebhookEvents e
            LEFT JOIN Tenants t ON t.id = e.tenant_id
            LEFT JOIN WhatsAppOutboundQueue q ON q.id = e.queue_id
            ${where}
            ORDER BY e.created_at DESC
            OFFSET @offset ROWS FETCH NEXT @lim ROWS ONLY
        `);

        return {
            rows: dataR.recordset || [],
            pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 }
        };
    }

    static async getEventMetrics(days = 30) {
        const pool = await connectDB();
        const d = Math.min(365, Math.max(1, days));
        const r = await pool.request()
            .input('days', sql.Int, d)
            .query(`
                SELECT
                    SUM(CASE WHEN event_type = N'message.sent' THEN 1 ELSE 0 END) AS sent_events,
                    SUM(CASE WHEN event_type = N'message.ack' THEN 1 ELSE 0 END) AS ack_events,
                    SUM(CASE WHEN event_type LIKE N'session.%' THEN 1 ELSE 0 END) AS session_events,
                    COUNT(*) AS total_events
                FROM WhatsAppWebhookEvents
                WHERE created_at >= DATEADD(DAY, -@days, SYSUTCDATETIME())
            `);
        const row = r.recordset[0] || {};
        return {
            sent_events: Number(row.sent_events) || 0,
            ack_events: Number(row.ack_events) || 0,
            session_events: Number(row.session_events) || 0,
            total_events: Number(row.total_events) || 0
        };
    }
}

module.exports = WhatsAppWebhookModel;
