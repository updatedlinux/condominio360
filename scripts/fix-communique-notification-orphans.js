#!/usr/bin/env node
/**
 * Marca como enviadas (sent) las filas de CommuniqueNotifications que siguen en pending
 * cuando ya no hay lotes activos en CommuniqueEmailQueue (huérfanos tras lotes mal cerrados
 * o reenvíos ya completados en Mailgun pero sin actualizar la BD).
 *
 * Por defecto (--strict) solo toca notificaciones cuyo comunicado tiene al menos un lote
 * "completed" y ningún lote "failed" (cola ya cerrada sin errores de lote).
 *
 * Uso:
 *   node scripts/fix-communique-notification-orphans.js --dry-run
 *   node scripts/fix-communique-notification-orphans.js
 *   node scripts/fix-communique-notification-orphans.js --communique-id=<UUID> --dry-run
 *   node scripts/fix-communique-notification-orphans.js --relaxed
 *
 * --relaxed: mismo criterio que el panel (pending sin cola activa), sin exigir solo completed.
 */

require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');

function parseArgs() {
    const out = { dryRun: false, communiqueId: null, relaxed: false, strict: true };
    for (const a of process.argv.slice(2)) {
        if (a === '--dry-run') out.dryRun = true;
        else if (a === '--relaxed') {
            out.relaxed = true;
            out.strict = false;
        } else if (a === '--strict') {
            out.strict = true;
            out.relaxed = false;
        } else if (a.startsWith('--communique-id=')) out.communiqueId = a.slice('--communique-id='.length).trim();
    }
    return out;
}

async function main() {
    const args = parseArgs();
    try {
        const pool = await connectDB();

        let commFilter = '';
        const reqBase = pool.request();
        if (args.communiqueId) {
            commFilter = ' AND n.communique_id = @communiqueId';
            reqBase.input('communiqueId', sql.UniqueIdentifier, args.communiqueId);
        }

        // Criterio base: pending y sin lote activo en cola
        const baseWhere = `
            n.status = N'pending'
            ${commFilter}
            AND NOT EXISTS (
                SELECT 1 FROM CommuniqueEmailQueue q
                WHERE q.communique_id = n.communique_id
                  AND q.status IN (N'pending', N'processing')
            )
        `;

        const strictAnd = args.strict
            ? `
            AND EXISTS (
                SELECT 1 FROM CommuniqueEmailQueue q
                WHERE q.communique_id = n.communique_id AND q.status = N'completed'
            )
            AND NOT EXISTS (
                SELECT 1 FROM CommuniqueEmailQueue q
                WHERE q.communique_id = n.communique_id AND q.status = N'failed'
            )
            `
            : '';

        const preview = await reqBase.query(`
            SELECT COUNT(*) AS n
            FROM CommuniqueNotifications n
            WHERE ${baseWhere.trim()}
            ${strictAnd}
        `);

        const n = Number(preview.recordset[0]?.n) || 0;
        console.log(`\n📋 Filas a actualizar (pending → sent): ${n}`);
        console.log(`   Modo: ${args.strict ? 'strict (al menos un lote completed, sin failed)' : 'relaxed (solo sin cola activa)'}`);
        if (args.communiqueId) console.log(`   Filtro communique_id: ${args.communiqueId}`);

        if (n > 0) {
            const sample = await reqBase.query(`
                SELECT TOP 8 n.id, n.email, n.communique_id, c.title
                FROM CommuniqueNotifications n
                INNER JOIN Communiques c ON c.id = n.communique_id
                WHERE ${baseWhere}
                ${strictAnd}
            `);
            console.log('\n   Muestra:');
            sample.recordset.forEach((r) => {
                console.log(`   - ${r.email} | ${r.title || ''} (${r.communique_id})`);
            });
            if (n > 8) console.log(`   ... y ${n - 8} más`);
        }

        if (args.dryRun) {
            console.log('\n(dry-run: no se ejecutó UPDATE)\n');
            process.exit(0);
        }

        if (n === 0) {
            console.log('\n✅ Nada que actualizar.\n');
            process.exit(0);
        }

        const upd = await reqBase.query(`
            UPDATE n
            SET n.status = N'sent',
                n.sent_at = SYSDATETIME(),
                n.message = NULL
            FROM CommuniqueNotifications n
            WHERE ${baseWhere}
            ${strictAnd}
        `);

        const affected = upd.rowsAffected[0] ?? n;
        console.log(`\n✅ Actualizadas ${affected} notificaciones a sent.\n`);
        process.exit(0);
    } catch (e) {
        console.error('❌', e.message);
        process.exit(1);
    }
}

main();
