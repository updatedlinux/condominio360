const { sql, connectDB } = require('../config/database');

const UNIT_PRICE_USD = 0.50;
const FISCAL_SHIPPING_USD = 10;
const IVA_RATE = 0.16;

/**
 * Modelo para facturación SaaS (Condominio360 → Condominios)
 */
class SaaSBillingModel {
    /**
     * Crear factura mensual para un tenant
     * @param {object} [options]
     * @param {'FISCAL'|'VOUCHER'} [options.billingDocumentType] - FISCAL: IVA 16% + envío US$10; VOUCHER: sin recargos
     * @param {string} [options.fiscalAttachmentPath] - URL pública del PDF/imagen (requerido si FISCAL)
     * @param {string} [options.fiscalAttachmentMime]
     */
    static async createInvoice(tenantId, periodMonth, periodYear, extraItems = [], paymentMethod = null, createdBy = null, options = {}) {
        const pool = await connectDB();

        let billingDocumentType = options.billingDocumentType || 'VOUCHER';
        if (billingDocumentType !== 'FISCAL' && billingDocumentType !== 'VOUCHER') {
            billingDocumentType = 'VOUCHER';
        }

        const propCount = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT COUNT(*) as c FROM Properties WHERE tenant_id = @tenant_id');
        const count = propCount.recordset[0]?.c || 0;

        const baseTotalUsd = count * UNIT_PRICE_USD;
        let extraTotalUsd = 0;
        for (const it of extraItems) {
            extraTotalUsd += (it.amount_usd || 0);
        }
        const subtotalUsd = baseTotalUsd + extraTotalUsd;

        const SaaSBillingRateService = require('../services/SaaSBillingRateService');
        const { rate: bcvRate, rateDate: bcvRateDate } = await SaaSBillingRateService.getApplicableRate();
        const subtotalVes = subtotalUsd * bcvRate;

        let ivaUsd = 0;
        let shippingUsd = 0;
        let totalUsd = subtotalUsd;
        let totalVes = subtotalVes;
        let fiscalAttachmentPath = null;
        let fiscalAttachmentMime = null;

        if (billingDocumentType === 'FISCAL') {
            ivaUsd = subtotalUsd * IVA_RATE;
            shippingUsd = FISCAL_SHIPPING_USD;
            totalUsd = subtotalUsd + ivaUsd + shippingUsd;
            const ivaVes = subtotalVes * IVA_RATE;
            const shippingVes = FISCAL_SHIPPING_USD * bcvRate;
            totalVes = subtotalVes + ivaVes + shippingVes;
            fiscalAttachmentPath = options.fiscalAttachmentPath || null;
            fiscalAttachmentMime = options.fiscalAttachmentMime || null;
        }

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
                .input('billing_document_type', sql.NVarChar, billingDocumentType)
                .input('fiscal_invoice_attachment_path', sql.NVarChar, fiscalAttachmentPath)
                .input('fiscal_invoice_attachment_mime', sql.NVarChar, fiscalAttachmentMime)
                .query(`
                    INSERT INTO SaaSInvoices 
                        (tenant_id, period_month, period_year, total_usd, total_ves, bcv_rate, bcv_rate_date, payment_method, property_count, created_by,
                         billing_document_type, fiscal_invoice_attachment_path, fiscal_invoice_attachment_mime)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @period_month, @period_year, @total_usd, @total_ves, @bcv_rate, @bcv_rate_date, @payment_method, @property_count, @created_by,
                         @billing_document_type, @fiscal_invoice_attachment_path, @fiscal_invoice_attachment_mime)
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

            if (billingDocumentType === 'FISCAL') {
                await tx.request()
                    .input('invoice_id', sql.UniqueIdentifier, invoice.id)
                    .input('description', sql.NVarChar, 'Impuesto al valor agregado (IVA 16% sobre subtotal en Bs.)')
                    .input('quantity', sql.Decimal(10, 2), 1)
                    .input('unit_price', sql.Decimal(15, 4), ivaUsd)
                    .input('total_usd', sql.Decimal(15, 4), ivaUsd)
                    .input('sort_order', sql.Int, order++)
                    .query(`
                        INSERT INTO SaaSInvoiceItems (invoice_id, item_type, description, quantity, unit_price_usd, total_usd, sort_order)
                        VALUES (@invoice_id, 'FISCAL_IVA', @description, @quantity, @unit_price, @total_usd, @sort_order)
                    `);
                await tx.request()
                    .input('invoice_id', sql.UniqueIdentifier, invoice.id)
                    .input('description', sql.NVarChar, 'Envío de factura fiscal (envío físico al domicilio del conjunto; incluye costos operativos)')
                    .input('quantity', sql.Decimal(10, 2), 1)
                    .input('unit_price', sql.Decimal(15, 4), FISCAL_SHIPPING_USD)
                    .input('total_usd', sql.Decimal(15, 4), FISCAL_SHIPPING_USD)
                    .input('sort_order', sql.Int, order++)
                    .query(`
                        INSERT INTO SaaSInvoiceItems (invoice_id, item_type, description, quantity, unit_price_usd, total_usd, sort_order)
                        VALUES (@invoice_id, 'FISCAL_SHIPPING', @description, @quantity, @unit_price, @total_usd, @sort_order)
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
            SELECT i.*, t.name as tenant_name,
                CASE WHEN EXISTS (
                    SELECT 1 FROM SaaSPaymentReports r
                    WHERE r.invoice_id = i.id AND r.status = N'PENDING_CONFIRMATION'
                ) THEN 1 ELSE 0 END AS payment_report_pending
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
        const pending = await this.getLatestPaymentReport(invoiceId);
        if (pending && pending.status === 'PENDING_CONFIRMATION') {
            return null;
        }

        const SaaSBillingRateService = require('../services/SaaSBillingRateService');
        const { rate, rateDate } = await SaaSBillingRateService.getApplicableRate();

        const pool = await connectDB();
        const inv = await pool.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .query('SELECT total_usd FROM SaaSInvoices WHERE id = @id AND status = N\'PENDING\'');
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

    /**
     * Recalcula total VES con la tasa BCV vigente (tras rechazo de reporte de pago).
     */
    static async refreshInvoiceVesToLatestRate(invoiceId) {
        const SaaSBillingRateService = require('../services/SaaSBillingRateService');
        const { rate, rateDate } = await SaaSBillingRateService.getApplicableRate();
        if (!rate) return null;

        const pool = await connectDB();
        const inv = await pool.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .query('SELECT total_usd FROM SaaSInvoices WHERE id = @id AND status = N\'PENDING\'');
        if (!inv.recordset[0]) return null;

        const totalVes = parseFloat(inv.recordset[0].total_usd) * rate;
        await pool.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .input('total_ves', sql.Decimal(18, 2), totalVes)
            .input('bcv_rate', sql.Decimal(12, 4), rate)
            .input('bcv_rate_date', sql.Date, rateDate)
            .query(`
                UPDATE SaaSInvoices
                SET total_ves = @total_ves, bcv_rate = @bcv_rate, bcv_rate_date = @bcv_rate_date, updated_at = SYSDATETIME()
                WHERE id = @id AND status = N'PENDING'
            `);

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
        const out = r.recordset[0] || null;
        if (out) {
            await SaaSBillingModel.refreshInvoiceVesToLatestRate(invoiceId);
        }
        return out;
    }

    /**
     * Ajustar la tasa BCV y el monto en bolívares de una factura ya PAGADA,
     * usando la tasa registrada en ExchangeRates para una fecha específica.
     * Útil cuando el superadmin confirmó el cobro con una fecha incorrecta
     * y el condominio pagó a la tasa de otro día.
     *
     * @param {string} invoiceId
     * @param {string} rateDate - YYYY-MM-DD
     * @returns {Promise<{invoice: Object|null, previous: Object|null, applied: Object|null, reason?: string}>}
     */
    static async adjustPaidInvoiceRate(invoiceId, rateDate) {
        const pool = await connectDB();

        const ExchangeRateModel = require('./ExchangeRateModel');
        const rateRow = await ExchangeRateModel.getByDate(rateDate);
        if (!rateRow || !rateRow.usd_rate) {
            return { invoice: null, previous: null, applied: null, reason: 'NO_RATE_FOR_DATE' };
        }

        const cur = await pool.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .query(`
                SELECT id, status, total_usd, total_ves, bcv_rate, bcv_rate_date, paid_amount_ves
                FROM SaaSInvoices
                WHERE id = @id
            `);
        const invoice = cur.recordset[0];
        if (!invoice) {
            return { invoice: null, previous: null, applied: null, reason: 'NOT_FOUND' };
        }
        if (invoice.status !== 'PAID') {
            return { invoice: null, previous: invoice, applied: null, reason: 'NOT_PAID' };
        }

        const usd = parseFloat(invoice.total_usd) || 0;
        const newRate = parseFloat(rateRow.usd_rate);
        const newTotalVes = Math.round(usd * newRate * 100) / 100;
        const normalizedRateDate = rateRow.rate_date
            ? new Date(rateRow.rate_date).toISOString().split('T')[0]
            : rateDate;

        await pool.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .input('total_ves', sql.Decimal(18, 2), newTotalVes)
            .input('paid_amount_ves', sql.Decimal(18, 2), newTotalVes)
            .input('bcv_rate', sql.Decimal(12, 4), newRate)
            .input('bcv_rate_date', sql.Date, normalizedRateDate)
            .query(`
                UPDATE SaaSInvoices
                SET total_ves = @total_ves,
                    paid_amount_ves = @paid_amount_ves,
                    bcv_rate = @bcv_rate,
                    bcv_rate_date = @bcv_rate_date,
                    updated_at = SYSDATETIME()
                WHERE id = @id AND status = N'PAID'
            `);

        const updated = await this.getInvoiceWithItems(invoiceId);
        return {
            invoice: updated,
            previous: {
                bcv_rate: parseFloat(invoice.bcv_rate),
                bcv_rate_date: invoice.bcv_rate_date,
                total_ves: parseFloat(invoice.total_ves),
                paid_amount_ves: parseFloat(invoice.paid_amount_ves)
            },
            applied: {
                bcv_rate: newRate,
                bcv_rate_date: normalizedRateDate,
                total_ves: newTotalVes,
                paid_amount_ves: newTotalVes
            }
        };
    }

    /**
     * Permite al superadmin editar datos de una factura ya PAGADA:
     *  - total_usd (recalcula total_ves y paid_amount_ves usando la tasa BCV actual de la factura)
     *  - actualiza la descripción del item BASE para reflejar el ajuste manual
     *  - datos del último SaaSPaymentReport (banco, fecha, referencia, monto abonado, comentario)
     *
     * @param {string} invoiceId
     * @param {Object} payload
     * @param {number} [payload.total_usd]
     * @param {Object} [payload.payment_report]
     * @returns {Promise<{invoice: Object|null, reason?: string}>}
     */
    static async updatePaidInvoiceDetails(invoiceId, payload = {}) {
        const pool = await connectDB();
        const inv = await this.getInvoiceWithItems(invoiceId);
        if (!inv) return { invoice: null, reason: 'NOT_FOUND' };
        if (inv.status !== 'PAID') return { invoice: null, reason: 'NOT_PAID' };

        let newMonth = null;
        let newYear = null;
        if (payload.period_month != null && payload.period_month !== '') {
            newMonth = parseInt(payload.period_month, 10);
            if (!Number.isInteger(newMonth) || newMonth < 1 || newMonth > 12) {
                return { invoice: null, reason: 'INVALID_MONTH' };
            }
        }
        if (payload.period_year != null && payload.period_year !== '') {
            newYear = parseInt(payload.period_year, 10);
            if (!Number.isInteger(newYear) || newYear < 2000 || newYear > 2100) {
                return { invoice: null, reason: 'INVALID_YEAR' };
            }
        }
        const finalMonth = newMonth != null ? newMonth : inv.period_month;
        const finalYear = newYear != null ? newYear : inv.period_year;
        const periodChanged = finalMonth !== inv.period_month || finalYear !== inv.period_year;
        if (periodChanged) {
            const dup = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, inv.tenant_id)
                .input('month', sql.Int, finalMonth)
                .input('year', sql.Int, finalYear)
                .input('id', sql.UniqueIdentifier, invoiceId)
                .query(`
                    SELECT TOP 1 id FROM SaaSInvoices
                    WHERE tenant_id = @tenant_id
                      AND period_month = @month
                      AND period_year = @year
                      AND id <> @id
                `);
            if (dup.recordset.length > 0) {
                return { invoice: null, reason: 'PERIOD_DUPLICATE' };
            }
        }

        const updates = [];
        const tx = pool.transaction();
        await tx.begin();
        try {
            if (periodChanged) {
                await tx.request()
                    .input('id', sql.UniqueIdentifier, invoiceId)
                    .input('period_month', sql.Int, finalMonth)
                    .input('period_year', sql.Int, finalYear)
                    .query(`
                        UPDATE SaaSInvoices
                        SET period_month = @period_month,
                            period_year = @period_year,
                            updated_at = SYSDATETIME()
                        WHERE id = @id AND status = N'PAID'
                    `);
                updates.push(`período: ${inv.period_month}/${inv.period_year} → ${finalMonth}/${finalYear}`);
            }

            if (payload.total_usd != null && Number.isFinite(parseFloat(payload.total_usd))) {
                const newTotalUsd = parseFloat(payload.total_usd);
                if (newTotalUsd < 0) throw new Error('total_usd no puede ser negativo');
                const bcvRate = parseFloat(inv.bcv_rate) || 0;
                const newTotalVes = Math.round(newTotalUsd * bcvRate * 100) / 100;
                await tx.request()
                    .input('id', sql.UniqueIdentifier, invoiceId)
                    .input('total_usd', sql.Decimal(15, 4), newTotalUsd)
                    .input('total_ves', sql.Decimal(18, 2), newTotalVes)
                    .input('paid_amount_ves', sql.Decimal(18, 2), newTotalVes)
                    .query(`
                        UPDATE SaaSInvoices
                        SET total_usd = @total_usd,
                            total_ves = @total_ves,
                            paid_amount_ves = @paid_amount_ves,
                            updated_at = SYSDATETIME()
                        WHERE id = @id AND status = N'PAID'
                    `);

                const baseItem = (inv.items || []).find(it => String(it.item_type).toUpperCase() === 'BASE');
                if (baseItem) {
                    const qty = parseFloat(baseItem.quantity) || 1;
                    const unit = qty > 0 ? (newTotalUsd / qty) : newTotalUsd;
                    const desc = `Plataforma Condominio360 - ${qty} unidad(es) × $${unit.toFixed(2)} USD (ajuste manual)`;
                    await tx.request()
                        .input('id', sql.UniqueIdentifier, baseItem.id)
                        .input('description', sql.NVarChar, desc)
                        .input('unit_price', sql.Decimal(15, 4), unit)
                        .input('total_usd', sql.Decimal(15, 4), newTotalUsd)
                        .query(`
                            UPDATE SaaSInvoiceItems
                            SET description = @description,
                                unit_price_usd = @unit_price,
                                total_usd = @total_usd
                            WHERE id = @id
                        `);
                }
                updates.push(`total USD: ${parseFloat(inv.total_usd)} → ${newTotalUsd}`);
            }

            const r = payload.payment_report || null;
            if (r && typeof r === 'object') {
                const latest = await this.getLatestPaymentReport(invoiceId);
                if (latest && latest.status === 'CONFIRMED') {
                    const sets = [];
                    const req = tx.request().input('id', sql.UniqueIdentifier, latest.id);
                    if (typeof r.banco_emisor === 'string') {
                        sets.push('banco_emisor = @banco_emisor');
                        req.input('banco_emisor', sql.NVarChar, r.banco_emisor.trim());
                    }
                    if (typeof r.fecha_transferencia === 'string') {
                        sets.push('fecha_transferencia = @fecha_transferencia');
                        req.input('fecha_transferencia', sql.NVarChar, r.fecha_transferencia.trim());
                    }
                    if (typeof r.ref_transferencia === 'string') {
                        sets.push('ref_transferencia = @ref_transferencia');
                        req.input('ref_transferencia', sql.NVarChar, r.ref_transferencia.trim());
                    }
                    if (r.monto_abonado_ves != null && Number.isFinite(parseFloat(r.monto_abonado_ves))) {
                        sets.push('monto_abonado_ves = @monto_abonado_ves');
                        req.input('monto_abonado_ves', sql.Decimal(15, 2), parseFloat(r.monto_abonado_ves));
                    }
                    if (r.comentario !== undefined) {
                        sets.push('comentario = @comentario');
                        req.input('comentario', sql.NVarChar, r.comentario ? String(r.comentario).trim() : null);
                    }
                    if (sets.length > 0) {
                        sets.push('updated_at = SYSDATETIME()');
                        await req.query(`UPDATE SaaSPaymentReports SET ${sets.join(', ')} WHERE id = @id`);
                        updates.push('datos del reporte de pago');
                    }
                    if (r.monto_abonado_ves != null && Number.isFinite(parseFloat(r.monto_abonado_ves))) {
                        await tx.request()
                            .input('id', sql.UniqueIdentifier, invoiceId)
                            .input('paid_amount_ves', sql.Decimal(18, 2), parseFloat(r.monto_abonado_ves))
                            .query(`UPDATE SaaSInvoices SET paid_amount_ves = @paid_amount_ves, updated_at = SYSDATETIME() WHERE id = @id AND status = N'PAID'`);
                    }
                }
            }

            await tx.commit();
        } catch (err) {
            try { await tx.rollback(); } catch (_) { /* noop */ }
            throw err;
        }

        const updated = await this.getInvoiceWithItems(invoiceId);
        return { invoice: updated, changes: updates };
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
