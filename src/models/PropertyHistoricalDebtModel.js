const { sql, connectDB } = require('../config/database');

class PropertyHistoricalDebtModel {
    static async listByTenant(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT d.*,
                    p.name AS property_name,
                    p.slug AS property_slug,
                    COALESCE(b.name, p.building) AS building_label,
                    i.invoice_number,
                    i.status AS invoice_status,
                    i.assigned_amount_usd AS balance_usd,
                    i.assigned_amount_ves AS balance_ves,
                    i.paid_amount_usd,
                    i.paid_amount_ves,
                    i.current_exchange_rate
                FROM PropertyHistoricalDebts d
                INNER JOIN Properties p ON d.property_id = p.id
                LEFT JOIN Buildings b ON b.id = p.building_id
                INNER JOIN BillingInvoices i ON d.invoice_id = i.id
                WHERE d.tenant_id = @tenant_id
                ORDER BY d.created_at DESC
            `);
        return result.recordset;
    }

    static async findActiveByProperty(propertyId, tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT d.*, i.status AS invoice_status
                FROM PropertyHistoricalDebts d
                INNER JOIN BillingInvoices i ON d.invoice_id = i.id
                WHERE d.property_id = @property_id
                  AND d.tenant_id = @tenant_id
                  AND d.status = N'ACTIVE'
            `);
        return result.recordset[0] || null;
    }

    static async findById(id, tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT d.*, i.*
                FROM PropertyHistoricalDebts d
                INNER JOIN BillingInvoices i ON d.invoice_id = i.id
                WHERE d.id = @id AND d.tenant_id = @tenant_id
            `);
        return result.recordset[0] || null;
    }

    static async insertInTransaction(transaction, data) {
        const req = transaction.request()
            .input('tenant_id', sql.UniqueIdentifier, data.tenant_id)
            .input('property_id', sql.UniqueIdentifier, data.property_id)
            .input('invoice_id', sql.UniqueIdentifier, data.invoice_id)
            .input('description', sql.NVarChar, data.description || null)
            .input('input_amount', sql.Decimal(18, 6), data.input_amount)
            .input('input_currency', sql.NVarChar, data.input_currency)
            .input('principal_usd', sql.Decimal(18, 6), data.principal_usd)
            .input('exchange_rate_at_creation', sql.Decimal(18, 6), data.exchange_rate_at_creation)
            .input('exchange_rate_date', sql.Date, data.exchange_rate_date || null)
            .input('rate_freeze_mode', sql.NVarChar, data.rate_freeze_mode || 'NONE')
            .input('rate_freeze_window_days', sql.Int, data.rate_freeze_window_days ?? null)
            .input('rate_unpaid_migrate_after_month', sql.Bit, data.rate_unpaid_migrate_after_month ? 1 : 0)
            .input('created_by', sql.UniqueIdentifier, data.created_by || null);
        if (data.id) {
            req.input('id', sql.UniqueIdentifier, data.id);
        }
        const idCol = data.id ? 'id, ' : '';
        const idVal = data.id ? '@id, ' : '';
        const result = await req.query(`
                INSERT INTO PropertyHistoricalDebts (
                    ${idCol}tenant_id, property_id, invoice_id, description,
                    input_amount, input_currency, principal_usd,
                    exchange_rate_at_creation, exchange_rate_date,
                    rate_freeze_mode, rate_freeze_window_days, rate_unpaid_migrate_after_month,
                    created_by
                )
                OUTPUT INSERTED.*
                VALUES (
                    ${idVal}@tenant_id, @property_id, @invoice_id, @description,
                    @input_amount, @input_currency, @principal_usd,
                    @exchange_rate_at_creation, @exchange_rate_date,
                    @rate_freeze_mode, @rate_freeze_window_days, @rate_unpaid_migrate_after_month,
                    @created_by
                )
            `);
        return result.recordset[0];
    }

    static async updateDebt(transaction, id, tenantId, fields) {
        const req = transaction.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('tenant_id', sql.UniqueIdentifier, tenantId);
        const sets = ['updated_at = SYSDATETIME()'];
        if (fields.description !== undefined) {
            req.input('description', sql.NVarChar, fields.description);
            sets.push('description = @description');
        }
        if (fields.rate_freeze_mode !== undefined) {
            req.input('rate_freeze_mode', sql.NVarChar, fields.rate_freeze_mode);
            sets.push('rate_freeze_mode = @rate_freeze_mode');
        }
        if (fields.rate_freeze_window_days !== undefined) {
            req.input('rate_freeze_window_days', sql.Int, fields.rate_freeze_window_days);
            sets.push('rate_freeze_window_days = @rate_freeze_window_days');
        }
        if (fields.rate_unpaid_migrate_after_month !== undefined) {
            req.input('rate_unpaid_migrate_after_month', sql.Bit, fields.rate_unpaid_migrate_after_month ? 1 : 0);
            sets.push('rate_unpaid_migrate_after_month = @rate_unpaid_migrate_after_month');
        }
        const result = await req.query(`
            UPDATE PropertyHistoricalDebts
            SET ${sets.join(', ')}
            OUTPUT INSERTED.*
            WHERE id = @id AND tenant_id = @tenant_id AND status = N'ACTIVE'
        `);
        return result.recordset[0] || null;
    }

    static async cancel(transaction, id, tenantId, cancelledBy, reason) {
        const result = await transaction.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('cancelled_by', sql.UniqueIdentifier, cancelledBy)
            .input('cancel_reason', sql.NVarChar, reason || null)
            .query(`
                UPDATE PropertyHistoricalDebts
                SET status = N'CANCELLED',
                    cancelled_at = SYSDATETIME(),
                    cancelled_by = @cancelled_by,
                    cancel_reason = @cancel_reason,
                    updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE id = @id AND tenant_id = @tenant_id AND status = N'ACTIVE'
            `);
        return result.recordset[0] || null;
    }
}

module.exports = PropertyHistoricalDebtModel;
