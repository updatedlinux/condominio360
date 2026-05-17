const { connectDB, sql } = require('../config/database');

class BankStatementMovementModel {
    static async listByImport(importId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('import_id', sql.UniqueIdentifier, importId)
            .query(`
                SELECT id, import_id, movement_date, reference, description, amount_ves,
                       direction, balance_ves, raw_line,
                       match_status, match_score, matched_payment_report_id,
                       matched_by, matched_at, notes, created_at
                FROM BankStatementMovements
                WHERE import_id = @import_id
                ORDER BY movement_date ASC, created_at ASC
            `);
        return r.recordset;
    }

    static async findById(id) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query('SELECT * FROM BankStatementMovements WHERE id = @id');
        return r.recordset[0] || null;
    }

    static async setMatch(movementId, paymentReportId, { matchStatus, matchScore, matchedBy }) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, movementId)
            .input('payment_report_id', sql.UniqueIdentifier, paymentReportId || null)
            .input('match_status', sql.NVarChar, matchStatus)
            .input('match_score', sql.Decimal(5, 2), matchScore != null ? matchScore : null)
            .input('matched_by', sql.UniqueIdentifier, matchedBy || null)
            .query(`
                UPDATE BankStatementMovements
                SET matched_payment_report_id = @payment_report_id,
                    match_status = @match_status,
                    match_score = @match_score,
                    matched_by = @matched_by,
                    matched_at = SYSDATETIME()
                WHERE id = @id
            `);
        return this.findById(movementId);
    }

    static async clearMatch(movementId) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, movementId)
            .query(`
                UPDATE BankStatementMovements
                SET matched_payment_report_id = NULL,
                    match_status = N'UNMATCHED',
                    match_score = NULL,
                    matched_by = NULL,
                    matched_at = NULL
                WHERE id = @id
            `);
        return this.findById(movementId);
    }

    /**
     * Trae los movimientos del import con datos del payment report enlazado (si hay)
     * y datos del propietario que originó ese reporte.
     */
    static async listWithMatchDetails(importId) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('import_id', sql.UniqueIdentifier, importId)
            .query(`
                SELECT m.id, m.movement_date, m.reference, m.description, m.amount_ves,
                       m.direction, m.balance_ves, m.match_status, m.match_score,
                       m.matched_payment_report_id, m.matched_at, m.notes,
                       bpr.id AS payment_report_id,
                       bpr.ref_transferencia, bpr.banco_emisor, bpr.fecha_transferencia,
                       bpr.monto_abonado_ves, bpr.status AS payment_report_status,
                       bpr.invoice_id,
                       u.id AS owner_user_id, u.first_name AS owner_first_name,
                       u.last_name AS owner_last_name, u.dni AS owner_dni,
                       u.phone AS owner_phone, u.email AS owner_email,
                       bi.preliminary_id, bi.property_id, p.name AS property_name,
                       b.name AS building_name
                FROM BankStatementMovements m
                LEFT JOIN BillingPaymentReports bpr ON bpr.id = m.matched_payment_report_id
                LEFT JOIN Users u ON u.id = bpr.submitted_by
                LEFT JOIN BillingInvoices bi ON bi.id = bpr.invoice_id
                LEFT JOIN Properties p ON p.id = bi.property_id
                LEFT JOIN Buildings b ON b.id = p.building_id
                WHERE m.import_id = @import_id
                ORDER BY m.movement_date ASC, m.created_at ASC
            `);
        return r.recordset;
    }

    /**
     * Trae los reportes de pago de un tenant que aún están pendientes de
     * confirmación y que NO han sido vinculados a ningún movimiento.
     * Se usa para listar los "reportes sin conciliar" en la UI.
     */
    static async listPendingPaymentReportsWithoutMatch(tenantId, importId = null) {
        const pool = await connectDB();
        const req = pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId);
        if (importId) req.input('import_id', sql.UniqueIdentifier, importId);
        const r = await req.query(`
            SELECT bpr.id AS payment_report_id,
                   bpr.ref_transferencia, bpr.banco_emisor, bpr.fecha_transferencia,
                   bpr.monto_abonado_ves, bpr.status,
                   bpr.invoice_id,
                   u.id AS owner_user_id, u.first_name AS owner_first_name,
                   u.last_name AS owner_last_name, u.dni AS owner_dni,
                   u.phone AS owner_phone,
                   bi.preliminary_id, bi.property_id, p.name AS property_name,
                   b.name AS building_name
            FROM BillingPaymentReports bpr
            INNER JOIN BillingInvoices bi ON bi.id = bpr.invoice_id
            INNER JOIN Users u ON u.id = bpr.submitted_by
            LEFT JOIN Properties p ON p.id = bi.property_id
            LEFT JOIN Buildings b ON b.id = p.building_id
            WHERE bi.tenant_id = @tenant_id
              AND bpr.status = N'PENDING_CONFIRMATION'
              AND NOT EXISTS (
                  SELECT 1 FROM BankStatementMovements bm
                  WHERE bm.matched_payment_report_id = bpr.id
                    ${importId ? 'AND bm.import_id <> @import_id' : ''}
              )
            ORDER BY bpr.created_at DESC
        `);
        return r.recordset;
    }
}

module.exports = BankStatementMovementModel;
