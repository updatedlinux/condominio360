const { connectDB } = require('../config/database');
const EmailService = require('./EmailService');
const BillingPaymentReminderLogModel = require('../models/BillingPaymentReminderLogModel');
const BillingRateFreezeService = require('./BillingRateFreezeService');
const { OVERDUE_REMINDER_MILESTONES_DAYS } = require('../constants/billingReminders');
const {
    getInvoiceDueDate,
    calendarDaysBetween,
    formatPeriodLabel,
    getIsoWeekKey
} = require('../utils/billingDueDate');
const { formatRateDateDisplay } = require('../utils/bcvFiscalCalendar');

const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';

class BillingReminderService {
    static groupKey(tenantId, userId) {
        return `${tenantId}:${userId}`;
    }

    static async fetchOverdueStandardRows() {
        const pool = await connectDB();
        const r = await pool.request().query(`
            SELECT
                i.id AS invoice_id,
                i.tenant_id,
                i.property_id,
                i.invoice_number,
                i.assigned_amount_usd,
                i.assigned_amount_ves,
                i.current_exchange_rate,
                p.name AS property_name,
                p.building,
                t.name AS tenant_name,
                t.slug AS tenant_slug,
                u.id AS user_id,
                u.email,
                u.first_name,
                pr.billing_month,
                pr.billing_year
            FROM BillingInvoices i
            INNER JOIN Tenants t ON t.id = i.tenant_id AND t.active = 1 AND t.billing_mode = N'FULL'
            INNER JOIN Properties p ON p.id = i.property_id
            INNER JOIN BillingPreliminaries pr ON pr.id = i.preliminary_id
            INNER JOIN PropertyOwners po ON po.property_id = i.property_id
            INNER JOIN Users u ON u.id = po.user_id
                AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''
            WHERE i.invoice_kind = N'STANDARD'
              AND i.status = N'PENDING'
              AND i.sent_to_owners = 1
              AND NOT EXISTS (
                  SELECT 1 FROM BillingPaymentReports r
                  WHERE r.invoice_id = i.id AND r.status = N'PENDING_CONFIRMATION'
              )
        `);
        return r.recordset || [];
    }

    static async fetchPendingLegacyRows() {
        const pool = await connectDB();
        const r = await pool.request().query(`
            SELECT
                i.id AS invoice_id,
                i.tenant_id,
                i.property_id,
                i.invoice_number,
                i.assigned_amount_usd,
                i.assigned_amount_ves,
                i.paid_amount_usd,
                i.current_exchange_rate,
                i.legacy_exchange_rate_usd,
                i.legacy_exchange_rate_date,
                i.legacy_rate_freeze_mode,
                i.legacy_rate_freeze_window_days,
                i.legacy_rate_unpaid_migrate_after_month,
                i.legacy_debt_created_at,
                phd.description AS debt_description,
                p.name AS property_name,
                p.building,
                t.name AS tenant_name,
                t.slug AS tenant_slug,
                u.id AS user_id,
                u.email,
                u.first_name
            FROM BillingInvoices i
            INNER JOIN Tenants t ON t.id = i.tenant_id AND t.active = 1 AND t.billing_mode = N'FULL'
            INNER JOIN Properties p ON p.id = i.property_id
            LEFT JOIN PropertyHistoricalDebts phd ON phd.invoice_id = i.id AND phd.status = N'ACTIVE'
            INNER JOIN PropertyOwners po ON po.property_id = i.property_id
            INNER JOIN Users u ON u.id = po.user_id
                AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) <> N''
            WHERE i.invoice_kind = N'LEGACY_DEBT'
              AND i.status = N'PENDING'
              AND i.sent_to_owners = 1
              AND NOT EXISTS (
                  SELECT 1 FROM BillingPaymentReports r
                  WHERE r.invoice_id = i.id AND r.status = N'PENDING_CONFIRMATION'
              )
        `);
        return r.recordset || [];
    }

    static enrichOverdueRow(row, now = new Date()) {
        const dueDate = getInvoiceDueDate(row.billing_year, row.billing_month);
        if (!dueDate) return null;
        const daysOverdue = calendarDaysBetween(dueDate, now);
        if (daysOverdue < 1) return null;
        return {
            ...row,
            dueDate,
            daysOverdue,
            periodLabel: formatPeriodLabel(row.billing_month, row.billing_year),
            propertyLabel: row.building ? `${row.building} — ${row.property_name}` : row.property_name
        };
    }

    static pickOverdueMilestone(maxDaysOverdue, lastSentMilestone) {
        const eligible = OVERDUE_REMINDER_MILESTONES_DAYS.filter(
            (d) => maxDaysOverdue >= d && d > lastSentMilestone
        );
        if (eligible.length === 0) return null;
        return Math.max(...eligible);
    }

    static buildLegacyFreezeNote(row) {
        const mode = BillingRateFreezeService.normalizeMode(
            row.legacy_rate_freeze_mode || 'NONE'
        );
        const rate = row.legacy_exchange_rate_usd != null
            ? parseFloat(row.legacy_exchange_rate_usd) : null;
        const rateDate = row.legacy_exchange_rate_date
            ? formatRateDateDisplay(row.legacy_exchange_rate_date) : null;

        if (mode === 'PERMANENT' && rate) {
            let note = `Tasa BCV congelada en Bs. ${rate.toLocaleString('es-VE')} (referencia del ${rateDate || 'carga'}).`;
            if (row.legacy_rate_unpaid_migrate_after_month) {
                const migrated = row.legacy_debt_created_at
                    ? BillingRateFreezeService.isPermanentMigratedToDaily(
                        { rate_freeze_mode: 'PERMANENT', rate_unpaid_migrate_after_month: true, created_at: row.legacy_debt_created_at }
                    )
                    : false;
                note += migrated
                    ? ' Tras un mes sin pago, el saldo en bolívares se actualiza con la tasa BCV diaria.'
                    : ' Si no se liquida en el mes, el saldo en bolívares pasará a actualizarse con la tasa BCV diaria.';
            }
            return note;
        }
        if (mode === 'WINDOW' && row.legacy_rate_freeze_window_days) {
            return `Tasa congelada durante ${row.legacy_rate_freeze_window_days} día(s) desde la carga; después aplica la tasa BCV vigente.`;
        }
        if (rate && rateDate) {
            return `Saldo calculado con tasa BCV de referencia (${rateDate}): Bs. ${rate.toLocaleString('es-VE')} por USD.`;
        }
        return 'El monto en bolívares puede variar según la tasa BCV publicada.';
    }

    static async processOverdueReminders(now = new Date()) {
        const rows = await this.fetchOverdueStandardRows();
        const groups = new Map();

        for (const row of rows) {
            const enriched = this.enrichOverdueRow(row, now);
            if (!enriched) continue;
            const key = this.groupKey(row.tenant_id, row.user_id);
            if (!groups.has(key)) {
                groups.set(key, {
                    tenant_id: row.tenant_id,
                    user_id: row.user_id,
                    email: row.email,
                    first_name: row.first_name,
                    tenant_name: row.tenant_name,
                    tenant_slug: row.tenant_slug,
                    invoices: []
                });
            }
            const g = groups.get(key);
            if (!g.invoices.find((x) => x.invoice_id === enriched.invoice_id)) {
                g.invoices.push(enriched);
            }
        }

        let sent = 0;
        let skipped = 0;

        for (const g of groups.values()) {
            const maxDays = Math.max(...g.invoices.map((i) => i.daysOverdue));
            const lastSent = await BillingPaymentReminderLogModel.getMaxOverdueMilestoneSent(
                g.tenant_id, g.user_id
            );
            const milestone = this.pickOverdueMilestone(maxDays, lastSent);
            if (!milestone) {
                skipped++;
                continue;
            }

            const milestoneKey = `d${milestone}`;
            if (await BillingPaymentReminderLogModel.wasSent(
                g.tenant_id, g.user_id, 'OVERDUE_STANDARD', milestoneKey
            )) {
                skipped++;
                continue;
            }

            const loginUrl = `${APP_URL()}/owner/billing`;
            await EmailService.sendOverdueInvoicesReminder(
                g.email,
                g.first_name,
                g.tenant_name,
                g.invoices.sort((a, b) => b.daysOverdue - a.daysOverdue),
                loginUrl,
                { tenantId: g.tenant_id, milestoneDays: milestone }
            );

            await BillingPaymentReminderLogModel.logSent(
                g.tenant_id,
                g.user_id,
                'OVERDUE_STANDARD',
                milestoneKey,
                g.invoices.map((i) => i.invoice_id)
            );
            sent++;
        }

        return { sent, skipped, groups: groups.size };
    }

    static async processLegacyWeeklyReminders(now = new Date()) {
        const weekKey = getIsoWeekKey(now);
        const rows = await this.fetchPendingLegacyRows();
        const groups = new Map();

        for (const row of rows) {
            const key = this.groupKey(row.tenant_id, row.user_id);
            if (!groups.has(key)) {
                groups.set(key, {
                    tenant_id: row.tenant_id,
                    user_id: row.user_id,
                    email: row.email,
                    first_name: row.first_name,
                    tenant_name: row.tenant_name,
                    debts: []
                });
            }
            const g = groups.get(key);
            if (!g.debts.find((x) => x.invoice_id === row.invoice_id)) {
                const paidUsd = parseFloat(row.paid_amount_usd) || 0;
                const assignedUsd = parseFloat(row.assigned_amount_usd) || 0;
                g.debts.push({
                    invoice_id: row.invoice_id,
                    invoice_number: row.invoice_number,
                    propertyLabel: row.building ? `${row.building} — ${row.property_name}` : row.property_name,
                    description: row.debt_description || 'Deuda histórica pre-sistema',
                    assigned_amount_usd: assignedUsd,
                    assigned_amount_ves: parseFloat(row.assigned_amount_ves) || 0,
                    paid_amount_usd: paidUsd,
                    hasPartialPayment: paidUsd > 0.000001,
                    freezeNote: this.buildLegacyFreezeNote(row)
                });
            }
        }

        let sent = 0;
        let skipped = 0;

        for (const g of groups.values()) {
            if (await BillingPaymentReminderLogModel.wasSent(
                g.tenant_id, g.user_id, 'LEGACY_DEBT_WEEKLY', weekKey
            )) {
                skipped++;
                continue;
            }

            await EmailService.sendLegacyDebtWeeklyReminder(
                g.email,
                g.first_name,
                g.tenant_name,
                g.debts,
                `${APP_URL()}/owner/billing`,
                { tenantId: g.tenant_id }
            );

            await BillingPaymentReminderLogModel.logSent(
                g.tenant_id,
                g.user_id,
                'LEGACY_DEBT_WEEKLY',
                weekKey,
                g.debts.map((d) => d.invoice_id)
            );
            sent++;
        }

        return { sent, skipped, groups: groups.size, weekKey };
    }
}

module.exports = BillingReminderService;
