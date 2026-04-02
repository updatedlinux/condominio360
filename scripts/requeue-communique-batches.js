#!/usr/bin/env node
/**
 * Vuelve a poner en cola lotes de CommuniqueEmailQueue marcados completed/failed
 * por el bug de OFFSET (lotes vacíos) para que el worker los reprocese con el código corregido.
 *
 * Uso:
 *   node scripts/requeue-communique-batches.js --communique-id=<UUID> --from-batch=9
 *   node scripts/requeue-communique-batches.js --title="Ingreso a Condominio360" --from-batch=9
 *   node scripts/requeue-communique-batches.js --communique-id=<UUID> --from-batch=9 --dry-run
 *
 * Equivalente SQL (ajusta GUID y números):
 *   UPDATE CommuniqueEmailQueue
 *   SET status = 'pending', processed_at = NULL, error_message = NULL
 *   WHERE communique_id = '...' AND batch_number >= 9
 *     AND status IN ('completed', 'failed', 'processing');
 */

require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');

function parseArgs() {
    const out = { dryRun: false, fromBatch: null, communiqueId: null, title: null };
    for (const a of process.argv.slice(2)) {
        if (a === '--dry-run') out.dryRun = true;
        else if (a.startsWith('--communique-id=')) out.communiqueId = a.slice('--communique-id='.length).trim();
        else if (a.startsWith('--from-batch=')) out.fromBatch = parseInt(a.slice('--from-batch='.length), 10);
        else if (a.startsWith('--title=')) out.title = a.slice('--title='.length).trim();
    }
    return out;
}

async function resolveCommuniqueId(pool, communiqueId, title) {
    if (communiqueId) return communiqueId;
    if (!title) return null;
    const result = await pool.request()
        .input('title', sql.NVarChar(500), title)
        .query(`
            SELECT TOP (5) id, title, created_at
            FROM Communiques
            WHERE title LIKE '%' + @title + '%'
            ORDER BY created_at DESC
        `);
    const rows = result.recordset;
    if (rows.length === 0) {
        console.error('❌ No hay comunicados cuyo título contenga:', title);
        return null;
    }
    if (rows.length > 1) {
        console.log('⚠️ Varios comunicados coinciden; usa --communique-id con el id correcto:\n');
        rows.forEach((r) => console.log(`   ${r.id}  |  ${r.title}`));
        return null;
    }
    console.log(`✅ Comunicado único: ${rows[0].title} (${rows[0].id})`);
    return rows[0].id;
}

async function main() {
    const args = parseArgs();
    if (args.fromBatch == null || Number.isNaN(args.fromBatch) || args.fromBatch < 1) {
        console.error('❌ Indica --from-batch=N (entero ≥ 1), p. ej. el primer lote mal enviado (9).');
        process.exit(1);
    }
    if (!args.communiqueId && !args.title) {
        console.error('❌ Indica --communique-id=... o --title="..."');
        process.exit(1);
    }

    try {
        const pool = await connectDB();
        const communiqueId = await resolveCommuniqueId(pool, args.communiqueId, args.title);
        if (!communiqueId) process.exit(1);

        const preview = await pool.request()
            .input('communiqueId', sql.UniqueIdentifier, communiqueId)
            .input('fromBatch', sql.Int, args.fromBatch)
            .query(`
                SELECT id, batch_number, total_batches, recipients_count, status, processed_at
                FROM CommuniqueEmailQueue
                WHERE communique_id = @communiqueId AND batch_number >= @fromBatch
                  AND status IN ('completed', 'failed', 'processing')
                ORDER BY batch_number
            `);

        const rows = preview.recordset;
        if (rows.length === 0) {
            console.log('ℹ️ No hay filas que actualizar (ya pending o from-batch demasiado alto).');
            process.exit(0);
        }

        console.log(`\n📋 Lotes a volver a pending (${rows.length}):\n`);
        rows.forEach((r) => {
            console.log(`   lote ${r.batch_number}/${r.total_batches}  recipients=${r.recipients_count}  was=${r.status}`);
        });

        if (args.dryRun) {
            console.log('\n(dry-run: no se ejecutó UPDATE)');
            process.exit(0);
        }

        const upd = await pool.request()
            .input('communiqueId', sql.UniqueIdentifier, communiqueId)
            .input('fromBatch', sql.Int, args.fromBatch)
            .query(`
                UPDATE CommuniqueEmailQueue
                SET status = 'pending',
                    processed_at = NULL,
                    error_message = NULL
                WHERE communique_id = @communiqueId AND batch_number >= @fromBatch
                  AND status IN ('completed', 'failed', 'processing')
            `);

        const n = upd.rowsAffected[0] ?? 0;
        console.log(`\n✅ Actualizados ${n} lotes a pending. El cron procesará de nuevo (código sin OFFSET por lote).`);
        process.exit(0);
    } catch (e) {
        console.error('❌', e.message);
        process.exit(1);
    }
}

main();
