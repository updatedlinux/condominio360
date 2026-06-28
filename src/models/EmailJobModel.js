const { sql, connectDB } = require('../config/database');

function asOptionalGuid(val) {
    if (!val) return null;
    const s = String(val).trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

class EmailJobModel {
    static async findRecipientByProviderMessageId(providerMessageId) {
        if (!providerMessageId) return null;
        const norm = String(providerMessageId).replace(/[<>]/g, '').trim();
        const pool = await connectDB();
        const r = await pool.request()
            .input('norm', sql.NVarChar(500), norm)
            .query(`
                SELECT TOP 1 r.* FROM email_job_recipients r
                WHERE REPLACE(REPLACE(ISNULL(r.provider_message_id, ''), '<', ''), '>', '') = @norm
                   OR r.provider_message_id = @norm
            `);
        return r.recordset[0] || null;
    }

    static async findRecipientByIdempotencyKey(idempotencyKey) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('k', sql.NVarChar(500), idempotencyKey)
            .query(`
                SELECT TOP 1 * FROM email_job_recipients WHERE idempotency_key = @k
            `);
        return r.recordset[0] || null;
    }

    static async createJob(data) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, data.tenant_id || null)
            .input('message_type', sql.NVarChar(80), data.message_type)
            .input('pipeline', sql.NVarChar(20), data.pipeline)
            .input('priority', sql.Int, data.priority ?? 0)
            .input('template_id', sql.UniqueIdentifier, data.template_id || null)
            .input('created_by', sql.UniqueIdentifier, data.created_by || null)
            .input('status', sql.NVarChar(20), data.status)
            .input('total_recipients', sql.Int, data.total_recipients ?? 1)
            .input('source_batch_id', sql.UniqueIdentifier, asOptionalGuid(data.source_batch_id))
            .input('idempotency_key', sql.NVarChar(500), data.idempotency_key || null)
            .input('metadata', sql.NVarChar(sql.MAX), data.metadata ? JSON.stringify(data.metadata) : null)
            .query(`
                INSERT INTO email_jobs (
                    tenant_id, message_type, pipeline, template_id, created_by, status,
                    total_recipients, source_batch_id, idempotency_key, metadata
                )
                OUTPUT INSERTED.*
                VALUES (
                    @tenant_id, @message_type, @pipeline, @template_id, @created_by, @status,
                    @total_recipients, @source_batch_id, @idempotency_key, @metadata
                )
            `);
        return r.recordset[0];
    }

    static async createRecipient(data) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('job_id', sql.UniqueIdentifier, data.job_id)
            .input('tenant_id', sql.UniqueIdentifier, data.tenant_id || null)
            .input('recipient_email', sql.NVarChar(320), data.recipient_email)
            .input('recipient_name', sql.NVarChar(255), data.recipient_name || null)
            .input('subject', sql.NVarChar(998), data.subject || null)
            .input('html_body', sql.NVarChar(sql.MAX), data.html_body || null)
            .input('text_body', sql.NVarChar(sql.MAX), data.text_body || null)
            .input('payload', sql.NVarChar(sql.MAX), data.payload ? JSON.stringify(data.payload) : null)
            .input('status', sql.NVarChar(20), data.status)
            .input('idempotency_key', sql.NVarChar(500), data.idempotency_key)
            .query(`
                INSERT INTO email_job_recipients (
                    job_id, tenant_id, recipient_email, recipient_name, subject, html_body, text_body,
                    payload, status, idempotency_key
                )
                OUTPUT INSERTED.*
                VALUES (
                    @job_id, @tenant_id, @recipient_email, @recipient_name, @subject, @html_body, @text_body,
                    @payload, @status, @idempotency_key
                )
            `);
        return r.recordset[0];
    }

    static async updateRecipient(id, fields) {
        const pool = await connectDB();
        const sets = [];
        const req = pool.request().input('id', sql.UniqueIdentifier, id);
        if (fields.status !== undefined) {
            sets.push('status = @status');
            req.input('status', sql.NVarChar(20), fields.status);
        }
        if (fields.provider_message_id !== undefined) {
            sets.push('provider_message_id = @provider_message_id');
            req.input('provider_message_id', sql.NVarChar(255), fields.provider_message_id);
        }
        if (fields.attempt_count !== undefined) {
            sets.push('attempt_count = @attempt_count');
            req.input('attempt_count', sql.Int, fields.attempt_count);
        }
        if (fields.last_attempt_at !== undefined) {
            sets.push('last_attempt_at = @last_attempt_at');
            req.input('last_attempt_at', sql.DateTime2, fields.last_attempt_at);
        }
        if (fields.error_message !== undefined) {
            sets.push('error_message = @error_message');
            req.input('error_message', sql.NVarChar(sql.MAX), fields.error_message);
        }
        sets.push('updated_at = SYSDATETIME()');
        if (!sets.length) return;
        await req.query(`
            UPDATE email_job_recipients SET ${sets.join(', ')} WHERE id = @id
        `);
    }

    static async updateJobCounts(jobId, sentDelta, failedDelta, status) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, jobId)
            .input('sd', sql.Int, sentDelta)
            .input('fd', sql.Int, failedDelta)
            .input('st', sql.NVarChar(20), status)
            .query(`
                UPDATE email_jobs
                SET sent_count = sent_count + @sd,
                    failed_count = failed_count + @fd,
                    status = @st,
                    updated_at = SYSDATETIME()
                WHERE id = @id
            `);
    }

    static async insertLog({ recipient_id, job_id, tenant_id, event_type, provider_response }) {
        const pool = await connectDB();
        await pool.request()
            .input('recipient_id', sql.UniqueIdentifier, recipient_id || null)
            .input('job_id', sql.UniqueIdentifier, job_id)
            .input('tenant_id', sql.UniqueIdentifier, tenant_id || null)
            .input('event_type', sql.NVarChar(40), event_type)
            .input('provider_response', sql.NVarChar(sql.MAX), provider_response ? JSON.stringify(provider_response) : null)
            .query(`
                INSERT INTO email_logs (recipient_id, job_id, tenant_id, event_type, provider_response)
                VALUES (@recipient_id, @job_id, @tenant_id, @event_type, @provider_response)
            `);
    }

    static async getPendingRecipients(limit, pipeline = 'bulk') {
        const pool = await connectDB();
        const r = await pool.request()
            .input('lim', sql.Int, limit)
            .input('pipe', sql.NVarChar(20), pipeline)
            .query(`
                SELECT TOP (@lim) r.*, j.message_type AS job_message_type, j.pipeline AS job_pipeline
                FROM email_job_recipients r
                INNER JOIN email_jobs j ON r.job_id = j.id
                WHERE r.status IN ('pending', 'retry')
                  AND j.pipeline = @pipe
                  AND j.status NOT IN ('cancelled')
                ORDER BY j.priority DESC, r.created_at ASC
            `);
        return r.recordset || [];
    }

    static async deleteLogsOlderThan(days) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('days', sql.Int, days)
            .query(`
                DELETE FROM email_logs WHERE created_at < DATEADD(DAY, -@days, SYSDATETIME())
            `);
        return r.rowsAffected?.[0] ?? 0;
    }

    static async listJobs({ tenantId = null, page = 1, limit = 20 }) {
        const pool = await connectDB();
        const offset = (page - 1) * limit;
        const req = pool.request()
            .input('off', sql.Int, offset)
            .input('lim', sql.Int, limit);
        let where = '1=1';
        if (tenantId) {
            where += ' AND tenant_id = @tid';
            req.input('tid', sql.UniqueIdentifier, tenantId);
        }
        const data = await req.query(`
            SELECT * FROM email_jobs WHERE ${where}
            ORDER BY created_at DESC
            OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY
        `);
        return data.recordset || [];
    }

    static async findRecipientWithJob(recipientId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('id', sql.UniqueIdentifier, recipientId)
            .query(`
                SELECT r.*, j.pipeline AS job_pipeline, j.message_type AS job_message_type, j.status AS job_status
                FROM email_job_recipients r
                INNER JOIN email_jobs j ON r.job_id = j.id
                WHERE r.id = @id
            `);
        return r.recordset[0] || null;
    }

    static async findJobById(jobId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('id', sql.UniqueIdentifier, jobId)
            .query(`
                SELECT j.*, t.name AS tenant_name, t.slug AS tenant_slug
                FROM email_jobs j
                LEFT JOIN Tenants t ON j.tenant_id = t.id
                WHERE j.id = @id
            `);
        return r.recordset[0] || null;
    }

    static async listRecipientsByJob(jobId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('jid', sql.UniqueIdentifier, jobId)
            .query(`
                SELECT * FROM email_job_recipients WHERE job_id = @jid ORDER BY created_at ASC
            `);
        return r.recordset || [];
    }

    static async listLogsForRecipient(recipientId, limit = 50) {
        const pool = await connectDB();
        const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
        const r = await pool.request()
            .input('rid', sql.UniqueIdentifier, recipientId)
            .input('lim', sql.Int, lim)
            .query(`
                SELECT TOP (@lim) * FROM email_logs
                WHERE recipient_id = @rid
                ORDER BY created_at DESC
            `);
        return r.recordset || [];
    }

    /**
     * Métricas agregadas en ventana de días (destinatarios, jobs, eventos webhook).
     */
    static async getMetricsSummary({ tenantId = null, days = 30 }) {
        const pool = await connectDB();

        const reqJ = pool.request().input('days', sql.Int, days);
        let jWhere = '';
        if (tenantId) {
            jWhere = ' AND j.tenant_id = @tid';
            reqJ.input('tid', sql.UniqueIdentifier, tenantId);
        }
        const jobsAgg = await reqJ.query(`
            SELECT j.status, COUNT(*) AS cnt
            FROM email_jobs j
            WHERE j.created_at >= DATEADD(DAY, -@days, SYSDATETIME()) ${jWhere}
            GROUP BY j.status
        `);

        const reqR = pool.request().input('days', sql.Int, days);
        let rWhere = '';
        if (tenantId) {
            rWhere = ' AND r.tenant_id = @tid';
            reqR.input('tid', sql.UniqueIdentifier, tenantId);
        }
        const recAgg = await reqR.query(`
            SELECT r.status, COUNT(*) AS cnt
            FROM email_job_recipients r
            WHERE r.created_at >= DATEADD(DAY, -@days, SYSDATETIME()) ${rWhere}
            GROUP BY r.status
        `);

        const reqL = pool.request().input('days', sql.Int, days);
        let lWhere = '';
        if (tenantId) {
            lWhere = ' AND l.tenant_id = @tid';
            reqL.input('tid', sql.UniqueIdentifier, tenantId);
        }
        const webhookRow = await reqL.query(`
            SELECT COUNT(*) AS cnt
            FROM email_logs l
            WHERE l.created_at >= DATEADD(DAY, -@days, SYSDATETIME())
              AND l.event_type LIKE N'webhook_%' ${lWhere}
        `);

        const jobsByStatus = {};
        for (const row of jobsAgg.recordset || []) {
            jobsByStatus[row.status] = row.cnt;
        }
        const recipientsByStatus = {};
        for (const row of recAgg.recordset || []) {
            recipientsByStatus[row.status] = row.cnt;
        }
        return {
            days,
            jobsByStatus,
            recipientsByStatus,
            webhookEvents: webhookRow.recordset?.[0]?.cnt || 0
        };
    }

    static async countJobsFiltered({ tenantId = null, days = 90, pipeline = null, status = null }) {
        const pool = await connectDB();
        const req = pool.request().input('days', sql.Int, days);
        let where = `j.created_at >= DATEADD(DAY, -@days, SYSDATETIME())`;
        if (tenantId) {
            where += ' AND j.tenant_id = @tid';
            req.input('tid', sql.UniqueIdentifier, tenantId);
        }
        if (pipeline) {
            where += ' AND j.pipeline = @pipe';
            req.input('pipe', sql.NVarChar(20), pipeline);
        }
        if (status) {
            where += ' AND j.status = @st';
            req.input('st', sql.NVarChar(20), status);
        }
        const r = await req.query(`SELECT COUNT(*) AS c FROM email_jobs j WHERE ${where}`);
        return r.recordset?.[0]?.c ?? 0;
    }

    static async listJobsFiltered({ tenantId = null, page = 1, limit = 20, days = 90, pipeline = null, status = null }) {
        const pool = await connectDB();
        const offset = (page - 1) * limit;
        const req = pool.request()
            .input('days', sql.Int, days)
            .input('off', sql.Int, offset)
            .input('lim', sql.Int, limit);
        let where = `j.created_at >= DATEADD(DAY, -@days, SYSDATETIME())`;
        if (tenantId) {
            where += ' AND j.tenant_id = @tid';
            req.input('tid', sql.UniqueIdentifier, tenantId);
        }
        if (pipeline) {
            where += ' AND j.pipeline = @pipe';
            req.input('pipe', sql.NVarChar(20), pipeline);
        }
        if (status) {
            where += ' AND j.status = @st';
            req.input('st', sql.NVarChar(20), status);
        }
        const data = await req.query(`
            SELECT j.*, t.name AS tenant_name, t.slug AS tenant_slug
            FROM email_jobs j
            LEFT JOIN Tenants t ON j.tenant_id = t.id
            WHERE ${where}
            ORDER BY j.created_at DESC
            OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY
        `);
        return data.recordset || [];
    }
}

module.exports = EmailJobModel;
