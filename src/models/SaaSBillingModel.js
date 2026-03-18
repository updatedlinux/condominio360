const { sql, connectDB } = require('../config/database');

const UNIT_PRICE_USD = 0.50;

/**
 * Modelo para facturación SaaS (Condominio360 → Condominios)
 */
class SaaSBillingModel {
    /**
     * Crear factura mensual para un tenant
     */
    static async createInvoice(tenantId, periodMonth, periodYear, extraItems = [], paymentMethod = null, createdBy = null) {
        const pool = await connectDB();

        const propCount = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT COUNT(*) as c FROM Properties WHERE tenant_id = @tenant_id');
        const count = propCount.recordset[0]?.c || 0;

        const baseTotalUsd = count * UNIT_PRICE_USD;
        let extraTotalUsd = 0;
        for (const it of extraItems) {
            extraTotalUsd += (it.amount_usd || 0);
        }
        const totalUsd = baseTotalUsd + extraTotalUsd;

        const SaaSBillingRateService = require('../services/SaaSBillingRateService');
        const { rate: bcvRate, rateDate: bcvRateDate } = await SaaSBillingRateService.getApplicableRate();
        const totalVes = totalUsd * bcvRate;

        const tx = pool.transaction();
        await tx.begin();

        try {
            const invResult = await tx.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('period_month', sql.Int, periodMonth)
                .input('period_year', sql.Int, periodYear)
                .input('total_usd', sql.Decimal(15, 4), totalUsd)
                .input('total_ves', sql.Decimal(18, 2), totalVes)
                .input('bcv_rate', sql.Decimal(12, 4), bcvRate)
                .input('bcv_rate_date', sql.Date, bcvRateDate)
                .input('payment_method', sql.NVarChar, paymentMethod)
                .input('property_count', sql.Int, count)
                .input('created_by', sql.UniqueIdentifier, createdBy)
                .query(`
                    INSERT INTO SaaSInvoices 
                        (tenant_id, period_month, period_year, total_usd, total_ves, bcv_rate, bcv_rate_date, payment_method, property_count, created_by)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @period_month, @period_year, @total_usd, @total_ves, @bcv_rate, @bcv_rate_date, @payment_method, @property_count, @created_by)
                `);

            const invoice = invResult.recordset[0];
            let order = 0;

            await tx.request()
                .input('invoice_id', sql.UniqueIdentifier, invoice.id)
                .input('description', sql.NVarChar, `Plataforma Condominio360 - ${count} unidad(es) × $0.50 USD`)
                .input('quantity', sql.Decimal(10, 2), count)
                .input('unit_price', sql.Decimal(15, 4), UNIT_PRICE_USD)
                .input('total_usd', sql.Decimal(15, 4), baseTotalUsd)
                .input('sort_order', sql.Int, order++)
                .query(`
                    INSERT INTO SaaSInvoiceItems (invoice_id, item_type, description, quantity, unit_price_usd, total_usd, sort_order)
                    VALUES (@invoice_id, 'BASE', @description, @quantity, @unit_price, @total_usd, @sort_order)
                `);

            for (const it of extraItems) {
                const amt = it.amount_usd || 0;
                const desc = it.description || 'Cobro extraordinario';
                await tx.request()
                    .input('invoice_id', sql.UniqueIdentifier, invoice.id)
                    .input('description', sql.NVarChar, desc)
                    .input('quantity', sql.Decimal(10, 2), it.quantity || 1)
                    .input('unit_price', sql.Decimal(15, 4), it.quantity ? amt / (it.quantity || 1) : amt)
                    .input('total_usd', sql.Decimal(15, 4), amt)
                    .input('sort_order', sql.Int, order++)
                    .query(`
                        INSERT INTO SaaSInvoiceItems (invoice_id, item_type, description, quantity, unit_price_usd, total_usd, sort_order)
                        VALUES (@invoice_id, 'EXTRA', @description, @quantity, @unit_price, @total_usd, @sort_order)
                    `);
            }

            await tx.commit();
            return this.getInvoiceWithItems(invoice.id);
        } catch (err) {
            await tx.rollback();
            throw err;
        }
    }

    static async getInvoiceWithItems(invoiceId) {
        const pool = await connectDB();
        const inv = await pool.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .query(`
                SELECT i.*, t.name as tenant_name
                FROM SaaSInvoices i
                INNER JOIN Tenants t ON i.tenant_id = t.id
                WHERE i.id = @id
            `);
        if (!inv.recordset[0]) return null;

        const items = await pool.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .query('SELECT * FROM SaaSInvoiceItems WHERE invoice_id = @id ORDER BY sort_order');
        inv.recordset[0].items = items.recordset || [];
        return inv.recordset[0];
    }

    static async getByTenant(tenantId, options = {}) {
        const pool = await connectDB();
        const { limit = 50, offset = 0, status } = options;
        let q = `
            SELECT i.*, t.name as tenant_name
            FROM SaaSInvoices i
            INNER JOIN Tenants t ON i.tenant_id = t.id
            WHERE i.tenant_id = @tenant_id
        `;
        const req = pool.request().input('tenant_id', sql.UniqueIdentifier, tenantId);
        if (status) {
            q += ' AND i.status = @status';
            req.input('status', sql.NVarChar, status);
        }
        q += ' ORDER BY i.period_year DESC, i.period_month DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        req.input('offset', sql.Int, offset).input('limit', sql.Int, limit);

        const result = await req.query(q);
        return result.recordset;
    }

    static async getAllInvoices(options = {}) {
        const pool = await connectDB();
        const { limit = 100, offset = 0, tenantId, periodMonth, periodYear } = options;
        let q = `
            SELECT i.*, t.name as tenant_name
            FROM SaaSInvoices i
            INNER JOIN Tenants t ON i.tenant_id = t.id
            WHERE 1=1
        `;
        const req = pool.request();
        if (tenantId) {
            q += ' AND i.tenant_id = @tenant_id';
            req.input('tenant_id', sql.UniqueIdentifier, tenantId);
        }
        if (periodMonth) {
            q += ' AND i.period_month = @period_month';
            req.input('period_month', sql.Int, periodMonth);
        }
        if (periodYear) {
            q += ' AND i.period_year = @period_year';
            req.input('period_year', sql.Int, periodYear);
        }
        q += ' ORDER BY i.period_year DESC, i.period_month DESC, t.name OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        req.input('offset', sql.Int, offset).input('limit', sql.Int, limit);

        const result = await req.query(q);
        return result.recordset;
    }

    static async getPendingCountByTenant(tenantId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT COUNT(*) as c FROM SaaSInvoices WHERE tenant_id = @tenant_id AND status = \'PENDING\'');
        return r.recordset[0]?.c || 0;
    }

    static async getTotalPendingByTenant(tenantId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT ISNULL(SUM(total_ves), 0) as total FROM SaaSInvoices WHERE tenant_id = @tenant_id AND status = \'PENDING\'');
        return r.recordset[0]?.total || 0;
    }

    static async recalculateVes(invoiceId) {
        const SaaSBillingRateService = require('../services/SaaSBillingRateService');
        const { rate, rateDate } = await SaaSBillingRateService.getApplicableRate();

        const pool = await connectDB();
        const inv = await pool.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .query('SELECT total_usd FROM SaaSInvoices WHERE id = @id');
        if (!inv.recordset[0]) return null;

        const totalVes = inv.recordset[0].total_usd * rate;
        await pool.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .input('total_ves', sql.Decimal(18, 2), totalVes)
            .input('bcv_rate', sql.Decimal(12, 4), rate)
            .input('bcv_rate_date', sql.Date, rateDate)
            .query('UPDATE SaaSInvoices SET total_ves = @total_ves, bcv_rate = @bcv_rate, bcv_rate_date = @bcv_rate_date, updated_at = SYSDATETIME() WHERE id = @id');

        return this.getInvoiceWithItems(invoiceId);
    }

    static async createPaymentReport(data) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('invoice_id', sql.UniqueIdentifier, data.invoice_id)
            .input('submitted_by', sql.UniqueIdentifier, data.submitted_by)
            .input('banco_emisor', sql.NVarChar, data.banco_emisor)
            .input('fecha_transferencia', sql.NVarChar, data.fecha_transferencia)
            .input('ref_transferencia', sql.NVarChar, data.ref_transferencia)
            .input('monto_abonado_ves', sql.Decimal(15, 2), data.monto_abonado_ves)
            .input('comentario', sql.NVarChar, data.comentario || null)
            .input('attachment_path', sql.NVarChar, data.attachment_path || null)
            .query(`
                INSERT INTO SaaSPaymentReports (invoice_id, submitted_by, banco_emisor, fecha_transferencia, ref_transferencia, monto_abonado_ves, comentario, attachment_path)
                OUTPUT INSERTED.*
                VALUES (@invoice_id, @submitted_by, @banco_emisor, @fecha_transferencia, @ref_transferencia, @monto_abonado_ves, @comentario, @attachment_path)
            `);
        return result.recordset[0];
    }

    static async getLatestPaymentReport(invoiceId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('invoice_id', sql.UniqueIdentifier, invoiceId)
            .query(`
                SELECT TOP 1 r.*, ta.first_name + ' ' + ta.last_name as submitted_by_name
                FROM SaaSPaymentReports r
                LEFT JOIN TenantAdmins ta ON r.submitted_by = ta.id
                WHERE r.invoice_id = @invoice_id
                ORDER BY r.created_at DESC
            `);
        return r.recordset[0] || null;
    }

    static async confirmPaymentReport(reportId, invoiceId, adminId) {
        const pool = await connectDB();
        const report = await this.getLatestPaymentReport(invoiceId);
        if (!report || report.id !== reportId || report.status !== 'PENDING_CONFIRMATION') return null;

        await pool.request()
            .input('report_id', sql.UniqueIdentifier, reportId)
            .input('admin_id', sql.UniqueIdentifier, adminId)
            .query(`
                UPDATE SaaSPaymentReports SET status = 'CONFIRMED', confirmed_by = @admin_id, confirmed_at = SYSDATETIME(), updated_at = SYSDATETIME()
                WHERE id = @report_id
            `);

        await pool.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .input('paid_ves', sql.Decimal(15, 2), report.monto_abonado_ves)
            .query(`
                UPDATE SaaSInvoices SET status = 'PAID', paid_amount_ves = @paid_ves, paid_at = SYSDATETIME(), updated_at = SYSDATETIME()
                WHERE id = @id
            `);

        return this.getInvoiceWithItems(invoiceId);
    }

    static async rejectPaymentReport(reportId, invoiceId, rejectionReason) {
        const pool = await connectDB();
        const report = await this.getLatestPaymentReport(invoiceId);
        if (!report || report.id !== reportId || report.status !== 'PENDING_CONFIRMATION') return null;

        const r = await pool.request()
            .input('report_id', sql.UniqueIdentifier, reportId)
            .input('reason', sql.NVarChar, rejectionReason || 'Sin especificar')
            .query(`
                UPDATE SaaSPaymentReports SET status = 'REJECTED', rejection_reason = @reason, rejected_at = SYSDATETIME(), updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE id = @report_id
            `);
        return r.recordset[0] || null;
    }

    static async existsForPeriod(tenantId, month, year) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('month', sql.Int, month)
            .input('year', sql.Int, year)
            .query('SELECT 1 FROM SaaSInvoices WHERE tenant_id = @tenant_id AND period_month = @month AND period_year = @year');
        return r.recordset.length > 0;
    }
}

module.exports = SaaSBillingModel;
