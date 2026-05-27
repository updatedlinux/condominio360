const { connectDB, sql } = require('../config/database');

/**
 * Importaciones de estados de cuenta bancarios + sus movimientos normalizados.
 * Una importación agrupa N movimientos. Cada movimiento puede tener un match
 * con un BillingPaymentReport.
 */
class BankStatementImportModel {
    /**
     * Crea una importación + sus movimientos en una sola transacción.
     */
    static async createWithMovements({
        tenantId,
        bankId,
        tenantBankAccountId,
        sourceFilePath,
        sourceFileName,
        sourceMime,
        sourceSizeBytes,
        importedBy,
        periodFrom,
        periodTo,
        movements
    }) {
        const pool = await connectDB();
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            const credits = (movements || []).filter(m => m.direction === 'CREDIT');
            const debits = (movements || []).filter(m => m.direction === 'DEBIT');
            const totalCredits = credits.reduce((s, m) => s + Number(m.amount_ves || 0), 0);
            const totalDebits = debits.reduce((s, m) => s + Number(m.amount_ves || 0), 0);

            const headerRes = await tx.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('bank_id', sql.UniqueIdentifier, bankId)
                .input('tenant_bank_account_id', sql.UniqueIdentifier, tenantBankAccountId || null)
                .input('source_file_path', sql.NVarChar, sourceFilePath)
                .input('source_file_name', sql.NVarChar, sourceFileName)
                .input('source_mime', sql.NVarChar, sourceMime || null)
                .input('source_size_bytes', sql.Int, sourceSizeBytes || null)
                .input('period_from', sql.Date, periodFrom || null)
                .input('period_to', sql.Date, periodTo || null)
                .input('total_credits_count', sql.Int, credits.length)
                .input('total_debits_count', sql.Int, debits.length)
                .input('total_credits_ves', sql.Decimal(18, 2), totalCredits)
                .input('total_debits_ves', sql.Decimal(18, 2), totalDebits)
                .input('imported_by', sql.UniqueIdentifier, importedBy)
                .query(`
                    INSERT INTO BankStatementImports
                        (tenant_id, bank_id, tenant_bank_account_id,
                         source_file_path, source_file_name, source_mime, source_size_bytes,
                         period_from, period_to,
                         total_credits_count, total_debits_count,
                         total_credits_ves, total_debits_ves,
                         imported_by)
                    OUTPUT INSERTED.id
                    VALUES
                        (@tenant_id, @bank_id, @tenant_bank_account_id,
                         @source_file_path, @source_file_name, @source_mime, @source_size_bytes,
                         @period_from, @period_to,
                         @total_credits_count, @total_debits_count,
                         @total_credits_ves, @total_debits_ves,
                         @imported_by)
                `);
            const importId = headerRes.recordset[0].id;

            for (const m of (movements || [])) {
                await tx.request()
                    .input('import_id', sql.UniqueIdentifier, importId)
                    .input('movement_date', sql.Date, m.movement_date || null)
                    .input('reference', sql.NVarChar, m.reference || null)
                    .input('description', sql.NVarChar, (m.description || '').slice(0, 500))
                    .input('amount_ves', sql.Decimal(18, 2), Number(m.amount_ves || 0))
                    .input('direction', sql.NVarChar, m.direction)
                    .input('balance_ves', sql.Decimal(18, 2), m.balance_ves != null ? Number(m.balance_ves) : null)
                    .input('raw_line', sql.NVarChar, m.raw_line || null)
                    .input('payer_document', sql.NVarChar, m.payer_document || null)
                    .input('payer_phone', sql.NVarChar, m.payer_phone || null)
                    .input('payment_method', sql.NVarChar, m.payment_method || null)
                    .input('counterparty_bank_code', sql.NVarChar, m.counterparty_bank_code || null)
                    .query(`
                        INSERT INTO BankStatementMovements
                            (import_id, movement_date, reference, description,
                             amount_ves, direction, balance_ves, raw_line,
                             payer_document, payer_phone, payment_method, counterparty_bank_code)
                        VALUES
                            (@import_id, @movement_date, @reference, @description,
                             @amount_ves, @direction, @balance_ves, @raw_line,
                             @payer_document, @payer_phone, @payment_method, @counterparty_bank_code)
                    `);
            }

            await tx.commit();
            return importId;
        } catch (err) {
            try { await tx.rollback(); } catch (_) { /* noop */ }
            throw err;
        }
    }

    static async updateStats(importId, { matched, suggested, unmatched }) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, importId)
            .input('matched_count', sql.Int, matched)
            .input('suggested_count', sql.Int, suggested)
            .input('unmatched_count', sql.Int, unmatched)
            .query(`
                UPDATE BankStatementImports
                SET matched_count = @matched_count,
                    suggested_count = @suggested_count,
                    unmatched_count = @unmatched_count
                WHERE id = @id
            `);
    }

    static async findById(id) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query(`
                SELECT si.*, b.code AS bank_code, b.name AS bank_name, b.parser_key AS bank_parser_key,
                       a.account_holder, a.account_number, a.account_type
                FROM BankStatementImports si
                INNER JOIN Banks b ON b.id = si.bank_id
                LEFT JOIN TenantBankAccounts a ON a.id = si.tenant_bank_account_id
                WHERE si.id = @id
            `);
        return r.recordset[0] || null;
    }

    static async listByTenant(tenantId, { limit = 30 } = {}) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT TOP (@limit) si.id, si.bank_id, si.tenant_bank_account_id,
                       si.source_file_name, si.period_from, si.period_to,
                       si.total_credits_count, si.total_debits_count,
                       si.total_credits_ves, si.total_debits_ves,
                       si.matched_count, si.suggested_count, si.unmatched_count,
                       si.status, si.imported_at, si.imported_by,
                       b.code AS bank_code, b.name AS bank_name,
                       u.first_name + N' ' + u.last_name AS imported_by_name
                FROM BankStatementImports si
                INNER JOIN Banks b ON b.id = si.bank_id
                LEFT JOIN Users u ON u.id = si.imported_by
                WHERE si.tenant_id = @tenant_id
                ORDER BY si.imported_at DESC
            `);
        return r.recordset;
    }

    static async delete(id) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query('DELETE FROM BankStatementImports WHERE id = @id');
    }
}

module.exports = BankStatementImportModel;
