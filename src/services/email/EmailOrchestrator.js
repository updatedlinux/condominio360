const crypto = require('crypto');
const { connectDB, sql } = require('../../config/database');
const TenantModel = require('../../models/TenantModel');
const EmailJobModel = require('../../models/EmailJobModel');
const MailgunMailProvider = require('./MailgunMailProvider');

function sha256(s) {
    return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function envInt(name, def) {
    const v = parseInt(process.env[name] || String(def), 10);
    return Number.isFinite(v) && v > 0 ? v : def;
}

/**
 * Orquestador único de envío (Mailgun API). transactional = envío inmediato; bulk = cola + worker.
 */
class EmailOrchestrator {
    constructor() {
        this._pauseUntil = 0;
        this._maxConcurrent = envInt('MAX_CONCURRENT_JOBS', 50);
        this._retryMax = envInt('RETRY_MAX_ATTEMPTS', 5);
        this._retryInitialMs = envInt('RETRY_INITIAL_DELAY_MS', 2000);
    }

    isPaused() {
        return Date.now() < this._pauseUntil;
    }

    pauseOnRejection(ms) {
        this._pauseUntil = Date.now() + ms;
        console.warn(`[EmailOrchestrator] Pausa hasta ${new Date(this._pauseUntil).toISOString()} (${ms}ms)`);
    }

    buildIdempotencyKey(tenantId, messageType, to, subject, extra = '') {
        return sha256([tenantId || 'global', messageType, to, subject, extra].join('|')).slice(0, 64);
    }

    /**
     * Punto único de entrada desde EmailService.send
     */
    async dispatchMail({
        to,
        subject,
        html,
        text = null,
        tenantId = null,
        messageType = 'generic',
        pipeline = 'transactional',
        createdBy = null,
        idempotencyKey = null,
        sourceBatchId = null,
        metadata = null
    }) {
        const idem = idempotencyKey || this.buildIdempotencyKey(tenantId, messageType, to, subject);

        const existing = await EmailJobModel.findRecipientByIdempotencyKey(idem);
        if (existing && existing.status === 'sent' && existing.provider_message_id) {
            return { messageId: existing.provider_message_id, duplicate: true };
        }

        if (!MailgunMailProvider.isConfigured()) {
            console.log('\n📧 =============== EMAIL (MODO DESARROLLO / sin MAILGUN_API_KEY) ===============');
            console.log('Para:', to);
            console.log('Asunto:', subject);
            console.log('Pipeline:', pipeline);
            console.log('=====================================================\n');
            return { messageId: 'dev-mode', preview: true };
        }

        if (pipeline === 'bulk') {
            return this._enqueueBulk({
                to,
                subject,
                html,
                text,
                tenantId,
                messageType,
                createdBy,
                idempotencyKey: idem,
                sourceBatchId,
                metadata
            });
        }

        return this._sendTransactionalNow({
            to,
            subject,
            html,
            text,
            tenantId,
            messageType,
            createdBy,
            idempotencyKey: idem,
            sourceBatchId,
            metadata
        });
    }

    async _enqueueBulk(opts) {
        const job = await EmailJobModel.createJob({
            tenant_id: opts.tenantId,
            message_type: opts.messageType,
            pipeline: 'bulk',
            priority: 0,
            created_by: opts.createdBy,
            status: 'pending',
            total_recipients: 1,
            source_batch_id: opts.sourceBatchId,
            metadata: opts.metadata
        });
        await EmailJobModel.createRecipient({
            job_id: job.id,
            tenant_id: opts.tenantId,
            recipient_email: opts.to,
            subject: opts.subject,
            html_body: opts.html,
            text_body: opts.text,
            status: 'pending',
            idempotency_key: opts.idempotencyKey
        });
        return { messageId: job.id, queued: true };
    }

    async _sendTransactionalNow(opts) {
        const tenant = opts.tenantId ? await TenantModel.findById(opts.tenantId) : null;
        const domain = MailgunMailProvider.resolveSendingDomain(tenant);

        const job = await EmailJobModel.createJob({
            tenant_id: opts.tenantId,
            message_type: opts.messageType,
            pipeline: 'transactional',
            priority: 10,
            created_by: opts.createdBy,
            status: 'processing',
            total_recipients: 1,
            source_batch_id: opts.sourceBatchId,
            metadata: opts.metadata
        });

        let recipient;
        try {
            recipient = await EmailJobModel.createRecipient({
                job_id: job.id,
                tenant_id: opts.tenantId,
                recipient_email: opts.to,
                subject: opts.subject,
                html_body: opts.html,
                text_body: opts.text,
                status: 'processing',
                idempotency_key: opts.idempotencyKey
            });
        } catch (e) {
            if (e.number === 2627 || String(e.message).includes('UQ_email_job_recipients_idem')) {
                const ex = await EmailJobModel.findRecipientByIdempotencyKey(opts.idempotencyKey);
                if (ex?.provider_message_id) {
                    return { messageId: ex.provider_message_id, duplicate: true };
                }
            }
            throw e;
        }

        try {
            const result = await MailgunMailProvider.send({
                domain,
                to: opts.to,
                subject: opts.subject,
                html: opts.html,
                text: opts.text || undefined
            });

            await EmailJobModel.updateRecipient(recipient.id, {
                status: 'sent',
                provider_message_id: result.id,
                attempt_count: 1,
                last_attempt_at: new Date(),
                error_message: null
            });
            await EmailJobModel.updateJobCounts(job.id, 1, 0, 'sent');
            await EmailJobModel.insertLog({
                recipient_id: recipient.id,
                job_id: job.id,
                tenant_id: opts.tenantId,
                event_type: 'sent',
                provider_response: result.raw
            });

            console.log(`✅ Email enviado a ${opts.to}: ${result.id}`);
            return { messageId: result.id };
        } catch (err) {
            const msg = err.message || String(err);
            await EmailJobModel.updateRecipient(recipient.id, {
                status: 'failed',
                attempt_count: 1,
                last_attempt_at: new Date(),
                error_message: msg
            });
            await EmailJobModel.updateJobCounts(job.id, 0, 1, 'failed');
            await EmailJobModel.insertLog({
                recipient_id: recipient.id,
                job_id: job.id,
                tenant_id: opts.tenantId,
                event_type: 'failed',
                provider_response: { error: msg }
            });

            const code = err.status || err.statusCode;
            if (code === 429 || (code >= 500 && code < 600)) {
                this.pauseOnRejection(this._retryInitialMs * 2);
            }
            console.error(`❌ Error enviando email a ${opts.to}:`, err);
            throw err;
        }
    }

    /**
     * Procesa un lote de correos bulk pendientes (llamado por worker).
     */
    async processBulkBatch(limit) {
        if (!MailgunMailProvider.isConfigured() || this.isPaused()) {
            return { processed: 0 };
        }

        const batchSize = envInt('EMAIL_BATCH_SIZE', 100);
        const take = Math.min(limit || batchSize, batchSize);
        const rows = await EmailJobModel.getPendingRecipients(take, 'bulk');
        let processed = 0;

        const concurrency = Math.min(this._maxConcurrent, rows.length);
        const chunks = [];
        for (let i = 0; i < rows.length; i += concurrency) {
            chunks.push(rows.slice(i, i + concurrency));
        }

        for (const group of chunks) {
            await Promise.all(
                group.map((row) => this._processOneBulkRecipient(row).catch((e) => console.error('[bulk]', e)))
            );
            processed += group.length;
        }

        return { processed };
    }

    async _processOneBulkRecipient(row) {
        const tenantId = row.tenant_id;
        const tenant = tenantId ? await TenantModel.findById(tenantId) : null;
        const domain = MailgunMailProvider.resolveSendingDomain(tenant);

        await EmailJobModel.updateRecipient(row.id, {
            status: 'processing',
            attempt_count: (row.attempt_count || 0) + 1,
            last_attempt_at: new Date()
        });

        try {
            const result = await MailgunMailProvider.send({
                domain,
                to: row.recipient_email,
                subject: row.subject,
                html: row.html_body,
                text: row.text_body || undefined
            });
            await EmailJobModel.updateRecipient(row.id, {
                status: 'sent',
                provider_message_id: result.id,
                error_message: null
            });
            await EmailJobModel.updateJobCounts(row.job_id, 1, 0, 'sent');
            await EmailJobModel.insertLog({
                recipient_id: row.id,
                job_id: row.job_id,
                tenant_id: tenantId,
                event_type: 'sent',
                provider_response: result.raw
            });
        } catch (err) {
            const msg = err.message || String(err);
            const attempts = (row.attempt_count || 0) + 1;
            const fail = attempts >= this._retryMax;
            await EmailJobModel.updateRecipient(row.id, {
                status: fail ? 'failed' : 'retry',
                error_message: msg,
                attempt_count: attempts
            });
            if (fail) {
                await EmailJobModel.updateJobCounts(row.job_id, 0, 1, 'partial');
            }
            const code = err.status || err.statusCode;
            if (code === 429 || (code >= 500 && code < 600)) {
                this.pauseOnRejection(this._retryInitialMs * Math.min(attempts, 6));
            }
        }
    }

    async purgeOldLogs() {
        const days = envInt('EMAIL_LOG_RETENTION_DAYS', 30);
        return EmailJobModel.deleteLogsOlderThan(days);
    }

    /**
     * Reintento manual desde panel: bulk → vuelve a cola; transaccional → reenvío inmediato por API.
     */
    async retryRecipient(recipientId, { tenantId = null, isSuperAdmin = false } = {}) {
        if (!MailgunMailProvider.isConfigured()) {
            const err = new Error('Mailgun no configurado');
            err.code = 'MAILGUN_DISABLED';
            throw err;
        }
        const row = await EmailJobModel.findRecipientWithJob(recipientId);
        if (!row) {
            const err = new Error('Destinatario no encontrado');
            err.code = 'NOT_FOUND';
            throw err;
        }
        if (!isSuperAdmin) {
            if (!tenantId || String(row.tenant_id || '') !== String(tenantId)) {
                const err = new Error('No autorizado');
                err.code = 'FORBIDDEN';
                throw err;
            }
        }
        if (row.status === 'sent') {
            return { ok: true, duplicate: true, message: 'Ya enviado' };
        }

        if (row.job_pipeline === 'bulk') {
            if (!['failed', 'retry'].includes(row.status)) {
                const err = new Error('Solo se reintenta destinatario en fallo o reintento automático');
                err.code = 'CANNOT_RETRY';
                throw err;
            }
            await EmailJobModel.updateRecipient(recipientId, {
                status: 'pending',
                error_message: null,
                attempt_count: 0
            });
            return { ok: true, mode: 'queued' };
        }

        if (row.status !== 'failed') {
            const err = new Error('Solo se reintenta envíos transaccionales fallidos');
            err.code = 'CANNOT_RETRY';
            throw err;
        }

        const tenant = row.tenant_id ? await TenantModel.findById(row.tenant_id) : null;
        const domain = MailgunMailProvider.resolveSendingDomain(tenant);
        const attempt = (row.attempt_count || 0) + 1;

        await EmailJobModel.updateRecipient(recipientId, {
            status: 'processing',
            attempt_count: attempt,
            last_attempt_at: new Date()
        });

        try {
            const result = await MailgunMailProvider.send({
                domain,
                to: row.recipient_email,
                subject: row.subject,
                html: row.html_body,
                text: row.text_body || undefined
            });
            await EmailJobModel.updateRecipient(recipientId, {
                status: 'sent',
                provider_message_id: result.id,
                error_message: null,
                last_attempt_at: new Date()
            });
            await EmailJobModel.updateJobCounts(row.job_id, 1, -1, 'sent');
            await EmailJobModel.insertLog({
                recipient_id: recipientId,
                job_id: row.job_id,
                tenant_id: row.tenant_id,
                event_type: 'manual_retry_sent',
                provider_response: result.raw
            });
            return { ok: true, mode: 'sent', messageId: result.id };
        } catch (err) {
            const msg = err.message || String(err);
            await EmailJobModel.updateRecipient(recipientId, {
                status: 'failed',
                error_message: msg
            });
            await EmailJobModel.insertLog({
                recipient_id: recipientId,
                job_id: row.job_id,
                tenant_id: row.tenant_id,
                event_type: 'manual_retry_failed',
                provider_response: { error: msg }
            });
            throw err;
        }
    }
}

module.exports = new EmailOrchestrator();
