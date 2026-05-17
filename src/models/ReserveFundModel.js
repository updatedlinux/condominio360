const { sql, connectDB } = require('../config/database');

class ReserveFundModel {
    static async listByTenant(tenantId, { activeOnly = false } = {}) {
        const pool = await connectDB();
        let q = `
            SELECT rf.*
            FROM BillingReserveFunds rf
            WHERE rf.tenant_id = @tenant_id
        `;
        if (activeOnly) q += ` AND rf.is_active = 1`;
        q += ` ORDER BY rf.display_order, rf.name`;
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(q);
        const funds = result.recordset;
        for (const f of funds) {
            f.contract_ids = await this.getContractIds(f.id);
        }
        return funds;
    }

    static async findById(id, tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT * FROM BillingReserveFunds
                WHERE id = @id AND tenant_id = @tenant_id
            `);
        const fund = result.recordset[0];
        if (!fund) return null;
        fund.contract_ids = await this.getContractIds(id);
        return fund;
    }

    static async getContractIds(reserveFundId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, reserveFundId)
            .query(`
                SELECT vendor_contract_id FROM BillingReserveFundContracts
                WHERE reserve_fund_id = @id
            `);
        return result.recordset.map((r) => String(r.vendor_contract_id));
    }

    static async create(data) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, data.tenant_id)
            .input('name', sql.NVarChar, data.name)
            .input('fund_nature', sql.NVarChar, data.fund_nature || 'ORDINARY_RESERVE')
            .input('percentage', sql.Decimal(7, 4), data.percentage)
            .input('include_extraordinary', sql.Bit, data.include_extraordinary ? 1 : 0)
            .input('notes', sql.NVarChar, data.notes || null)
            .input('display_order', sql.Int, data.display_order ?? 100)
            .query(`
                INSERT INTO BillingReserveFunds (
                    tenant_id, name, fund_nature, percentage, include_extraordinary, notes, display_order
                )
                OUTPUT INSERTED.*
                VALUES (
                    @tenant_id, @name, @fund_nature, @percentage, @include_extraordinary, @notes, @display_order
                )
            `);
        const fund = result.recordset[0];
        await this.setContracts(fund.id, data.contract_ids || []);
        fund.contract_ids = data.contract_ids || [];
        return fund;
    }

    static async update(id, tenantId, data) {
        const pool = await connectDB();
        const updates = [];
        const request = pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('tenant_id', sql.UniqueIdentifier, tenantId);

        if (data.name !== undefined) {
            updates.push('name = @name');
            request.input('name', sql.NVarChar, data.name);
        }
        if (data.fund_nature !== undefined) {
            updates.push('fund_nature = @fund_nature');
            request.input('fund_nature', sql.NVarChar, data.fund_nature);
        }
        if (data.percentage !== undefined) {
            updates.push('percentage = @percentage');
            request.input('percentage', sql.Decimal(7, 4), data.percentage);
        }
        if (data.include_extraordinary !== undefined) {
            updates.push('include_extraordinary = @include_extraordinary');
            request.input('include_extraordinary', sql.Bit, data.include_extraordinary ? 1 : 0);
        }
        if (data.notes !== undefined) {
            updates.push('notes = @notes');
            request.input('notes', sql.NVarChar, data.notes);
        }
        if (data.is_active !== undefined) {
            updates.push('is_active = @is_active');
            request.input('is_active', sql.Bit, data.is_active ? 1 : 0);
        }
        if (data.display_order !== undefined) {
            updates.push('display_order = @display_order');
            request.input('display_order', sql.Int, data.display_order);
        }

        let fund = null;
        if (updates.length > 0) {
            updates.push('updated_at = SYSDATETIME()');
            const result = await request.query(`
                UPDATE BillingReserveFunds SET ${updates.join(', ')}
                OUTPUT INSERTED.*
                WHERE id = @id AND tenant_id = @tenant_id
            `);
            fund = result.recordset[0] || null;
        } else {
            fund = await this.findById(id, tenantId);
        }

        if (data.contract_ids !== undefined) {
            await this.setContracts(id, data.contract_ids);
        }
        if (fund) {
            fund.contract_ids = await this.getContractIds(id);
        }
        return fund;
    }

    static async setContracts(reserveFundId, contractIds) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, reserveFundId)
            .query(`DELETE FROM BillingReserveFundContracts WHERE reserve_fund_id = @id`);

        const unique = [...new Set((contractIds || []).filter(Boolean))];
        for (const cid of unique) {
            await pool.request()
                .input('fund_id', sql.UniqueIdentifier, reserveFundId)
                .input('contract_id', sql.UniqueIdentifier, cid)
                .query(`
                    INSERT INTO BillingReserveFundContracts (reserve_fund_id, vendor_contract_id)
                    VALUES (@fund_id, @contract_id)
                `);
        }
    }

    static async deactivate(id, tenantId) {
        return this.update(id, tenantId, { is_active: false });
    }
}

module.exports = ReserveFundModel;
