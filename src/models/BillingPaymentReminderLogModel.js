const { sql, connectDB } = require('../config/database');

class BillingPaymentReminderLogModel {
    static async wasSent(tenantId, userId, reminderType, milestoneKey) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('reminder_type', sql.NVarChar, reminderType)
            .input('milestone_key', sql.NVarChar, milestoneKey)
            .query(`
                SELECT TOP 1 1 AS ok FROM BillingPaymentReminderLog
                WHERE tenant_id = @tenant_id AND user_id = @user_id
                  AND reminder_type = @reminder_type AND milestone_key = @milestone_key
            `);
        return r.recordset.length > 0;
    }

    static async getMaxOverdueMilestoneSent(tenantId, userId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('user_id', sql.UniqueIdentifier, userId)
            .query(`
                SELECT milestone_key FROM BillingPaymentReminderLog
                WHERE tenant_id = @tenant_id AND user_id = @user_id
                  AND reminder_type = N'OVERDUE_STANDARD'
                  AND milestone_key LIKE N'd%'
            `);
        let max = 0;
        for (const row of r.recordset) {
            const m = parseInt(String(row.milestone_key).replace(/^d/, ''), 10);
            if (!Number.isNaN(m) && m > max) max = m;
        }
        return max;
    }

    static async logSent(tenantId, userId, reminderType, milestoneKey, invoiceIds = []) {
        const pool = await connectDB();
        await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('reminder_type', sql.NVarChar, reminderType)
            .input('milestone_key', sql.NVarChar, milestoneKey)
            .input('invoice_ids', sql.NVarChar, JSON.stringify(invoiceIds))
            .query(`
                INSERT INTO BillingPaymentReminderLog
                    (tenant_id, user_id, reminder_type, milestone_key, invoice_ids, sent_at)
                VALUES
                    (@tenant_id, @user_id, @reminder_type, @milestone_key, @invoice_ids, SYSDATETIME())
            `);
    }
}

module.exports = BillingPaymentReminderLogModel;
