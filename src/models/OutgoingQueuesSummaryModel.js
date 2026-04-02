const { sql, connectDB } = require('../config/database');

/**
 * Resumen global de colas de correo masivo (superadmin).
 * Usado para monitoreo antes de cambios que podrían chocar con envíos en curso.
 */
class OutgoingQueuesSummaryModel {
    static async _querySafe(run) {
        try {
            return await run();
        } catch (e) {
            console.warn('[OutgoingQueuesSummary]', e.message);
            return null;
        }
    }

    /**
     * @returns {Promise<object>}
     */
    static async getGlobalSummary() {
        const pool = await connectDB();

        const commQueueAgg = await OutgoingQueuesSummaryModel._querySafe(() =>
            pool.request().query(`
                SELECT
                    SUM(CASE WHEN q.status = N'pending' THEN 1 ELSE 0 END) AS pending_batches,
                    SUM(CASE WHEN q.status = N'processing' THEN 1 ELSE 0 END) AS processing_batches
                FROM CommuniqueEmailQueue q
            `)
        );

        const commTenants = await OutgoingQueuesSummaryModel._querySafe(() =>
            pool.request().query(`
                SELECT COUNT(DISTINCT c.tenant_id) AS n
                FROM CommuniqueEmailQueue q
                INNER JOIN Communiques c ON c.id = q.communique_id
                WHERE q.status IN (N'pending', N'processing')
            `)
        );

        const commPendingEmails = await OutgoingQueuesSummaryModel._querySafe(() =>
            pool.request().query(`
                SELECT COUNT(*) AS n
                FROM CommuniqueNotifications
                WHERE status = N'pending'
            `)
        );

        const commBreakdown = await OutgoingQueuesSummaryModel._querySafe(() =>
            pool.request().query(`
                SELECT TOP 15
                    t.name AS tenant_name,
                    c.title AS communique_title,
                    SUM(CASE WHEN q.status IN (N'pending', N'processing') THEN 1 ELSE 0 END) AS batches_left
                FROM CommuniqueEmailQueue q
                INNER JOIN Communiques c ON c.id = q.communique_id
                INNER JOIN Tenants t ON t.id = c.tenant_id
                WHERE q.status IN (N'pending', N'processing')
                GROUP BY t.name, c.title, c.id
                ORDER BY MIN(q.created_at) ASC
            `)
        );

        const notifQ = await OutgoingQueuesSummaryModel._querySafe(() =>
            pool.request().query(`
                SELECT COUNT(*) AS n FROM NotificationQueue WHERE status = N'PENDING'
            `)
        );

        const emailRecip = await OutgoingQueuesSummaryModel._querySafe(() =>
            pool.request().query(`
                SELECT COUNT(*) AS n
                FROM email_job_recipients r
                INNER JOIN email_jobs j ON j.id = r.job_id
                WHERE r.status IN (N'pending', N'retry')
                  AND j.status <> N'cancelled'
            `)
        );

        const emailJobsOpen = await OutgoingQueuesSummaryModel._querySafe(() =>
            pool.request().query(`
                SELECT COUNT(*) AS n
                FROM email_jobs
                WHERE status IN (N'pending', N'processing')
            `)
        );

        const bulkWelcome = await OutgoingQueuesSummaryModel._querySafe(() =>
            pool.request().query(`
                SELECT
                    SUM(CASE WHEN status IN (N'PENDING_SEND', N'PROCESSING') THEN 1 ELSE 0 END) AS active_batches
                FROM BulkOwnerWelcomeBatches
            `)
        );

        const row = commQueueAgg?.recordset?.[0] || {};
        const pendingBatches = Number(row.pending_batches) || 0;
        const processingBatches = Number(row.processing_batches) || 0;
        const commActiveBatches = pendingBatches + processingBatches;

        const tenantsWithCommQueue = Number(commTenants?.recordset?.[0]?.n) || 0;
        const commPendingNotif = Number(commPendingEmails?.recordset?.[0]?.n) || 0;
        const notificationQueuePending = Number(notifQ?.recordset?.[0]?.n) || 0;
        const emailRecipientsPending = Number(emailRecip?.recordset?.[0]?.n) || 0;
        const emailJobsPending = Number(emailJobsOpen?.recordset?.[0]?.n) || 0;
        const bulkWelcomeActive = Number(bulkWelcome?.recordset?.[0]?.active_batches) || 0;

        const breakdown = (commBreakdown?.recordset || []).map((r) => ({
            tenant_name: r.tenant_name,
            communique_title: r.communique_title,
            batches_left: Number(r.batches_left) || 0
        }));

        const hasActivity =
            commActiveBatches > 0 ||
            commPendingNotif > 0 ||
            notificationQueuePending > 0 ||
            emailRecipientsPending > 0 ||
            emailJobsPending > 0 ||
            bulkWelcomeActive > 0;

        return {
            communiques: {
                pending_batches: pendingBatches,
                processing_batches: processingBatches,
                active_batches: commActiveBatches,
                pending_emails: commPendingNotif,
                tenants_with_queue: tenantsWithCommQueue,
                breakdown
            },
            notification_queue: {
                pending: notificationQueuePending
            },
            mailgun_jobs: {
                recipients_pending: emailRecipientsPending,
                jobs_open: emailJobsPending
            },
            bulk_owner_welcome: {
                active_batches: bulkWelcomeActive
            },
            has_activity: hasActivity,
            updated_at: new Date().toISOString()
        };
    }
}

module.exports = OutgoingQueuesSummaryModel;
