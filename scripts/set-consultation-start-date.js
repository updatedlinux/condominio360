#!/usr/bin/env node
/**
 * Ajusta la fecha de inicio de una carta consulta (solo desarrollo/pruebas).
 *
 * Uso:
 *   node scripts/set-consultation-start-date.js
 *   node scripts/set-consultation-start-date.js --id=<uuid> --date=2026-06-03
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { sql, connectDB } = require('../src/config/database');

const DEFAULT_CONSULTATION_ID = 'A49CB778-D16E-4A86-8A5D-7CBD5DBB0800';
const DEFAULT_START_DATE = '2026-06-03'; // 3/06/2026 — 00:00 hora Venezuela (GMT-4)

function parseArgs() {
    const args = { id: DEFAULT_CONSULTATION_ID, date: DEFAULT_START_DATE };
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--id=')) args.id = arg.slice(5);
        if (arg.startsWith('--date=')) args.date = arg.slice(7);
    }
    return args;
}

function toVenezuelaMidnightUTC(dateStr) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) {
        throw new Error(`Fecha inválida "${dateStr}". Usa formato YYYY-MM-DD.`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return new Date(Date.UTC(year, month - 1, day, 4, 0, 0));
}

function formatVenezuela(date) {
    return date.toLocaleString('es-VE', {
        timeZone: 'America/Caracas',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function main() {
    const { id, date } = parseArgs();
    const startDateUTC = toVenezuelaMidnightUTC(date);

    console.log('🔍 Conectando a la base de datos...');
    const pool = await connectDB();

    const before = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .query(`
            SELECT id, title, status, start_date, end_date, target_building, tenant_id
            FROM Consultations
            WHERE id = @id
        `);

    if (before.recordset.length === 0) {
        console.error(`❌ No se encontró la consulta ${id}`);
        process.exit(1);
    }

    const c = before.recordset[0];
    console.log('\n📋 Consulta actual:');
    console.log(`   ID:      ${c.id}`);
    console.log(`   Título:  ${c.title}`);
    console.log(`   Estado:  ${c.status}`);
    console.log(`   Inicio:  ${formatVenezuela(new Date(c.start_date))} (VET)`);
    console.log(`   Cierre:  ${formatVenezuela(new Date(c.end_date))} (VET)`);

    const now = new Date();
    if (new Date(c.end_date) < now) {
        console.warn('\n⚠️  La fecha de cierre ya pasó. El propietario no verá la carta como activa hasta que end_date sea futura.');
    }

    await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('start_date', sql.DateTime2, startDateUTC)
        .query(`
            UPDATE Consultations
            SET start_date = @start_date,
                status = CASE WHEN status = 'DRAFT' THEN 'OPEN' ELSE status END,
                updated_at = SYSDATETIME()
            WHERE id = @id
        `);

    const after = await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .query(`
            SELECT title, status, start_date, end_date
            FROM Consultations
            WHERE id = @id
        `);

    const updated = after.recordset[0];
    console.log('\n✅ Fecha de inicio actualizada:');
    console.log(`   Inicio:  ${formatVenezuela(new Date(updated.start_date))} (VET)`);
    console.log(`   UTC BD:  ${new Date(updated.start_date).toISOString()}`);
    console.log(`   Estado:  ${updated.status}`);
    console.log(`   Cierre:  ${formatVenezuela(new Date(updated.end_date))} (VET)`);

    const visibleForOwner =
        updated.status === 'OPEN' &&
        new Date(updated.start_date) <= now &&
        new Date(updated.end_date) >= now;

    console.log(
        visibleForOwner
            ? '\n👁️  La carta debería aparecer como activa para el propietario.'
            : '\n⚠️  Revisa status/end_date: aún podría no mostrarse como activa al propietario.'
    );

    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
