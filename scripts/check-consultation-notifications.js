#!/usr/bin/env node
/**
 * Verifica el estado de correos encolados para una carta consulta.
 *
 * Uso:
 *   node scripts/check-consultation-notifications.js --id=0A05B249-936B-4F8B-87F5-65C3A133DCEF
 *   node scripts/check-consultation-notifications.js --id=<uuid> --show-failed
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { sql, connectDB } = require('../src/config/database');

const DEFAULT_ID = '0A05B249-936B-4F8B-87F5-65C3A133DCEF';

function parseArgs() {
    const args = { id: DEFAULT_ID, showFailed: false };
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--id=')) args.id = arg.slice(5);
        if (arg === '--show-failed') args.showFailed = true;
    }
    return args;
}

async function main() {
    const { id, showFailed } = parseArgs();
    const pool = await connectDB();

    const consult = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .query(`
            SELECT c.id, c.title, c.status, c.target_building, c.tenant_id, t.name AS tenant_name
            FROM Consultations c
            INNER JOIN Tenants t ON c.tenant_id = t.id
            WHERE c.id = @id
        `);

    if (consult.recordset.length === 0) {
        console.error(`❌ Consulta no encontrada: ${id}`);
        process.exit(1);
    }

    const c = consult.recordset[0];
    console.log('\n📋 Consulta');
    console.log(`   ${c.tenant_name}`);
    console.log(`   ${c.title}`);
    console.log(`   ID: ${c.id}\n`);

    const eligible = await pool.request()
        .input('consultationId', sql.UniqueIdentifier, id)
        .query(`
            SELECT COUNT(DISTINCT u.id) AS owners
            FROM Consultations cons
            INNER JOIN Properties p ON p.tenant_id = cons.tenant_id
            INNER JOIN PropertyOwners po ON po.property_id = p.id
            INNER JOIN Users u ON u.id = po.user_id
            LEFT JOIN Buildings b ON p.building_id = b.id
            WHERE cons.id = @consultationId
            AND u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) != ''
            AND (
                cons.target_building IS NULL
                OR p.building = cons.target_building
                OR b.name = cons.target_building
            )
        `);

    const expectedOwners = eligible.recordset[0].owners;

    const byStatus = await pool.request()
        .input('pattern', sql.NVarChar, `%${id}%`)
        .query(`
            SELECT type, status, COUNT(*) AS n
            FROM NotificationQueue
            WHERE data LIKE @pattern
            AND type IN ('consultation_creation', 'consultation_activation')
            GROUP BY type, status
            ORDER BY type, status
        `);

    const totals = await pool.request()
        .input('pattern', sql.NVarChar, `%${id}%`)
        .query(`
            SELECT
                SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) AS sent,
                SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
                COUNT(*) AS total
            FROM NotificationQueue
            WHERE data LIKE @pattern
            AND type IN ('consultation_creation', 'consultation_activation')
        `);

    const t = totals.recordset[0];
    const sent = Number(t.sent) || 0;
    const failed = Number(t.failed) || 0;
    const pending = Number(t.pending) || 0;
    const total = Number(t.total) || 0;

    console.log('📧 Cola NotificationQueue (esta consulta)');
    console.log(`   Propietarios elegibles con email: ${expectedOwners}`);
    console.log(`   Registros en cola (total):         ${total}`);
    console.log('');

    if (byStatus.recordset.length === 0) {
        console.log('   ⚠️  No hay filas en NotificationQueue para este ID.');
        console.log('   (Si enviaste antes del encolado, no habrá historial aquí.)');
        process.exit(0);
    }

    console.log('   Por tipo y estado:');
    for (const row of byStatus.recordset) {
        console.log(`   - ${row.type} / ${row.status}: ${row.n}`);
    }

    console.log('');
    console.log(`   ✅ SENT:    ${sent}`);
    console.log(`   ❌ FAILED:  ${failed}`);
    console.log(`   ⏳ PENDING: ${pending}`);

    const creationSent = byStatus.recordset
        .filter((r) => r.type === 'consultation_creation' && r.status === 'SENT')
        .reduce((s, r) => s + r.n, 0);

    if (creationSent >= expectedOwners && failed === 0 && pending === 0) {
        console.log('\n🎉 OK: Todos los correos de creación constan como SENT.');
    } else if (failed > 0 || pending > 0) {
        console.log('\n⚠️  Revisar FAILED o PENDING. Reenvío:');
        console.log(`   node scripts/reconcile-consultation.js --id=${id} --notify --notify-kind=creation --process-now`);
    } else if (creationSent < expectedOwners) {
        console.log(`\n⚠️  SENT (${creationSent}) < elegibles (${expectedOwners}). Puede faltar encolar o hubo borrado parcial.`);
    }

    if (showFailed && failed > 0) {
        const failedRows = await pool.request()
            .input('pattern', sql.NVarChar, `%${id}%`)
            .query(`
                SELECT TOP 50
                    nq.id,
                    nq.type,
                    nq.status,
                    nq.error_message,
                    nq.created_at,
                    u.email,
                    u.first_name,
                    u.last_name
                FROM NotificationQueue nq
                LEFT JOIN Users u ON u.id = nq.user_id
                WHERE nq.data LIKE @pattern
                AND nq.status = 'FAILED'
                AND nq.type IN ('consultation_creation', 'consultation_activation')
                ORDER BY nq.updated_at DESC
            `);

        console.log('\n❌ Detalle FAILED (máx. 50):');
        for (const row of failedRows.recordset) {
            const name = `${row.first_name || ''} ${row.last_name || ''}`.trim();
            console.log(`   - ${row.email || '(sin email)'} ${name ? `(${name})` : ''}`);
            console.log(`     ${row.type} | ${row.error_message || 'sin mensaje'}`);
        }
        if (failed > 50) {
            console.log(`   ... y ${failed - 50} más`);
        }
    } else if (failed > 0) {
        console.log('\n   Usa --show-failed para ver emails y errores.');
    }

    console.log('');
    process.exit(failed > 0 || pending > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
});
