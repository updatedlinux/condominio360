const { sql, connectDB } = require('../config/database');

class BulkOwnerWelcomeBatchModel {
    static async create({ id, tenant_id, created_by, items_json, total_items }) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('tenant_id', sql.UniqueIdentifier, tenant_id)
            .input('created_by', sql.UniqueIdentifier, created_by || null)
            .input('items_json', sql.NVarChar(sql.MAX), items_json)
            .input('total_items', sql.Int, total_items)
            .query(`
                INSERT INTO BulkOwnerWelcomeBatches (id, tenant_id, created_by, items_json, total_items, status)
                VALUES (@id, @tenant_id, @created_by, @items_json, @total_items, 'PENDING_SEND')
            `);
    }

    static async findById(id) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query('SELECT * FROM BulkOwnerWelcomeBatches WHERE id = @id');
        return r.recordset[0] || null;
    }

    /**
     * Marca PROCESSING solo si sigue PENDING_SEND (evita doble envío).
     * @returns {Promise<boolean>} true si tomó el bloqueo
     */
    static async claimForProcessing(id) {
        const pool = await connectDB();
        const r = await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query(`
                UPDATE BulkOwnerWelcomeBatches
                SET status = 'PROCESSING', started_at = SYSDATETIME()
                OUTPUT INSERTED.id
                WHERE id = @id AND status = 'PENDING_SEND'
            `);
        return !!(r.recordset && r.recordset.length > 0);
    }

    static async setCompleted(id) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .query(`
                UPDATE BulkOwnerWelcomeBatches
                SET status = 'COMPLETED', completed_at = SYSDATETIME()
                WHERE id = @id
            `);
    }

    /** Cierre con errores parciales (algunos correos sí se enviaron) */
    static async setCompletedWithNotes(id, errorSummary) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('error_summary', sql.NVarChar(sql.MAX), errorSummary || null)
            .query(`
                UPDATE BulkOwnerWelcomeBatches
                SET status = 'COMPLETED', completed_at = SYSDATETIME(), error_summary = @error_summary
                WHERE id = @id
            `);
    }

    static async setFailed(id, errorSummary) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, id)
            .input('error_summary', sql.NVarChar(sql.MAX), errorSummary || null)
            .query(`
                UPDATE BulkOwnerWelcomeBatches
                SET status = 'FAILED', completed_at = SYSDATETIME(), error_summary = @error_summary
                WHERE id = @id
            `);
    }
}

module.exports = BulkOwnerWelcomeBatchModel;
