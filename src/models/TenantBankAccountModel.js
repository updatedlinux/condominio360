const { connectDB, sql } = require('../config/database');

/**
 * Cuentas bancarias reales de un tenant (junta de condominio) hacia donde los
 * propietarios depositan sus pagos. Solo se usan en el módulo de conciliación.
 * (Los datos legacy de `Tenants.payment_info` siguen funcionando para mostrar
 * info de pago al propietario.)
 */
class TenantBankAccountModel {
    static async listByTenant(tenantId, includeInactive = false) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT a.id, a.tenant_id, a.bank_id, a.account_holder, a.account_holder_dni,
                       a.account_type, a.account_number, a.mobile_phone, a.is_default,
                       a.is_active, a.created_at, a.updated_at,
                       b.code AS bank_code, b.name AS bank_name, b.parser_key AS bank_parser_key,
                       b.is_active AS bank_is_active
                FROM TenantBankAccounts a
                INNER JOIN Banks b ON b.id = a.bank_id
                WHERE a.tenant_id = @tenant_id
                  ${includeInactive ? '' : 'AND a.is_active = 1'}
                ORDER BY a.is_default DESC, b.display_order ASC, a.created_at DESC
            `);
        return r.recordset;
    }

    static async findById(id) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query(`
                SELECT a.*, b.code AS bank_code, b.name AS bank_name, b.parser_key AS bank_parser_key,
                       b.is_active AS bank_is_active
                FROM TenantBankAccounts a
                INNER JOIN Banks b ON b.id = a.bank_id
                WHERE a.id = @id
            `);
        return r.recordset[0] || null;
    }

    static async create(tenantId, data) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('bank_id', sql.UniqueIdentifier, data.bank_id)
            .input('account_holder', sql.NVarChar, data.account_holder)
            .input('account_holder_dni', sql.NVarChar, data.account_holder_dni || null)
            .input('account_type', sql.NVarChar, data.account_type)
            .input('account_number', sql.NVarChar, data.account_number || null)
            .input('mobile_phone', sql.NVarChar, data.mobile_phone || null)
            .input('is_default', sql.Bit, data.is_default ? 1 : 0)
            .query(`
                INSERT INTO TenantBankAccounts
                    (tenant_id, bank_id, account_holder, account_holder_dni,
                     account_type, account_number, mobile_phone, is_default)
                OUTPUT INSERTED.id
                VALUES
                    (@tenant_id, @bank_id, @account_holder, @account_holder_dni,
                     @account_type, @account_number, @mobile_phone, @is_default)
            `);
        const id = r.recordset[0].id;
        if (data.is_default) await this._ensureSingleDefault(tenantId, id);
        return this.findById(id);
    }

    static async update(id, data) {
        const pool = await connectDB();
        const account = await this.findById(id);
        if (!account) return null;
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('bank_id', sql.UniqueIdentifier, data.bank_id || account.bank_id)
            .input('account_holder', sql.NVarChar, data.account_holder ?? account.account_holder)
            .input('account_holder_dni', sql.NVarChar, data.account_holder_dni ?? account.account_holder_dni)
            .input('account_type', sql.NVarChar, data.account_type ?? account.account_type)
            .input('account_number', sql.NVarChar, data.account_number ?? account.account_number)
            .input('mobile_phone', sql.NVarChar, data.mobile_phone ?? account.mobile_phone)
            .input('is_active', sql.Bit, data.is_active != null ? (data.is_active ? 1 : 0) : account.is_active)
            .input('is_default', sql.Bit, data.is_default != null ? (data.is_default ? 1 : 0) : account.is_default)
            .query(`
                UPDATE TenantBankAccounts
                SET bank_id = @bank_id,
                    account_holder = @account_holder,
                    account_holder_dni = @account_holder_dni,
                    account_type = @account_type,
                    account_number = @account_number,
                    mobile_phone = @mobile_phone,
                    is_active = @is_active,
                    is_default = @is_default,
                    updated_at = SYSDATETIME()
                WHERE id = @id
            `);
        if (data.is_default) await this._ensureSingleDefault(account.tenant_id, id);
        return this.findById(id);
    }

    static async _ensureSingleDefault(tenantId, keepId) {
        const pool = await connectDB();
        await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('keep_id', sql.UniqueIdentifier, keepId)
            .query(`
                UPDATE TenantBankAccounts
                SET is_default = 0, updated_at = SYSDATETIME()
                WHERE tenant_id = @tenant_id AND id <> @keep_id AND is_default = 1
            `);
    }

    static async deactivate(id) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query(`
                UPDATE TenantBankAccounts
                SET is_active = 0, is_default = 0, updated_at = SYSDATETIME()
                WHERE id = @id
            `);
        return this.findById(id);
    }
}

module.exports = TenantBankAccountModel;
