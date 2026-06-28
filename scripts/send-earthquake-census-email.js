#!/usr/bin/env node
/**
 * Envío MANUAL (CLI) de correo masivo a propietarios: censo terremoto /terremotove.
 * NO se ejecuta automáticamente — debe invocarse explícitamente.
 *
 * Por defecto solo muestra destinatarios (dry-run). Para enviar: --send --yes
 *
 * Uso:
 *   node scripts/send-earthquake-census-email.js
 *   node scripts/send-earthquake-census-email.js --tenant-slug=mi-condominio
 *   node scripts/send-earthquake-census-email.js --tenant-id=<uuid>
 *   node scripts/send-earthquake-census-email.js --limit=5 --send --yes
 *   node scripts/send-earthquake-census-email.js --test-email=correo@ejemplo.com --send --yes
 *   npm run send-earthquake-census-email -- --send --yes
 */

const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectDB, sql } = require('../src/config/database');
const UserModel = require('../src/models/UserModel');
const TenantModel = require('../src/models/TenantModel');
const EmailService = require('../src/services/EmailService');
const MailgunMailProvider = require('../src/services/email/MailgunMailProvider');

function isEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve((answer || '').trim());
        });
    });
}

function parseArgs(argv) {
    const opts = {
        help: false,
        send: false,
        yes: false,
        force: false,
        tenantId: null,
        tenantSlug: null,
        limit: null,
        testEmail: null,
        delayMs: parseInt(process.env.EARTHQUAKE_CENSUS_EMAIL_DELAY_MS || '1500', 10),
        chunkSize: parseInt(process.env.EARTHQUAKE_CENSUS_EMAIL_CHUNK || '25', 10)
    };

    for (const arg of argv.slice(2)) {
        if (arg === '--help' || arg === '-h') opts.help = true;
        else if (arg === '--send') opts.send = true;
        else if (arg === '--yes' || arg === '-y') opts.yes = true;
        else if (arg === '--force') opts.force = true;
        else if (arg.startsWith('--tenant-id=')) opts.tenantId = arg.slice('--tenant-id='.length).trim();
        else if (arg.startsWith('--tenant-slug=')) opts.tenantSlug = arg.slice('--tenant-slug='.length).trim();
        else if (arg.startsWith('--limit=')) opts.limit = parseInt(arg.slice('--limit='.length), 10);
        else if (arg.startsWith('--test-email=')) opts.testEmail = arg.slice('--test-email='.length).trim();
        else if (arg.startsWith('--delay-ms=')) opts.delayMs = parseInt(arg.slice('--delay-ms='.length), 10);
        else if (arg.startsWith('--chunk-size=')) opts.chunkSize = parseInt(arg.slice('--chunk-size='.length), 10);
    }

    return opts;
}

function censusUrl() {
    const base = (process.env.APP_URL || 'https://condominio-360.com').trim().replace(/\/$/, '');
    return `${base}/terremotove`;
}

async function fetchOwnerRows({ tenantId, tenantSlug }) {
    const pool = await connectDB();
    const request = pool.request();

    let tenantFilter = '';
    if (tenantId) {
        tenantFilter = ' AND t.id = @tenant_id';
        request.input('tenant_id', sql.UniqueIdentifier, tenantId);
    } else if (tenantSlug) {
        tenantFilter = ' AND t.slug = @tenant_slug';
        request.input('tenant_slug', sql.NVarChar, tenantSlug);
    }

    const result = await request.query(`
        SELECT DISTINCT
            u.id AS user_id,
            u.first_name,
            u.last_name,
            t.id AS tenant_id,
            t.name AS tenant_name
        FROM Users u
        INNER JOIN Tenants t ON t.active = 1
        WHERE ISNULL(u.is_active, 1) = 1
        ${tenantFilter}
        AND (
            EXISTS (
                SELECT 1 FROM TenantUsers tu
                WHERE tu.user_id = u.id AND tu.tenant_id = t.id
                  AND tu.role = N'OWNER' AND tu.status = N'ACTIVE'
            )
            OR EXISTS (
                SELECT 1 FROM PropertyOwners po
                INNER JOIN Properties p ON p.id = po.property_id
                WHERE po.user_id = u.id AND p.tenant_id = t.id
            )
        )
        ORDER BY t.name, u.last_name, u.first_name
    `);

    return result.recordset;
}

async function resolvePrimaryEmail(userId) {
    const emails = await UserModel.getEmails(userId);
    const normalized = [];
    for (const row of emails) {
        const e = String(row.email || '').trim().toLowerCase();
        if (e && isEmail(e) && !normalized.includes(e)) normalized.push(e);
    }
    return normalized[0] || null;
}

async function buildRecipients(rows, { testEmail, limit }) {
    const seen = new Set();
    const recipients = [];

    for (const row of rows) {
        const email = testEmail || (await resolvePrimaryEmail(row.user_id));
        if (!email || !isEmail(email)) continue;

        const key = `${row.tenant_id}:${email.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        recipients.push({
            userId: row.user_id,
            email: email.toLowerCase(),
            firstName: row.first_name || 'Propietario',
            tenantId: row.tenant_id,
            tenantName: row.tenant_name
        });

        if (limit && recipients.length >= limit) break;
    }

    return recipients;
}

function printHelp() {
    console.log(`
send-earthquake-census-email.js — Aviso masivo censo /terremotove (MANUAL)

  node scripts/send-earthquake-census-email.js [opciones]

Opciones:
  (sin --send)          Solo lista destinatarios (dry-run). NO envía correos.
  --send                Habilita el envío (requiere confirmación o --yes).
  --yes, -y             Omite confirmación interactiva (usar con cuidado).
  --force               Reenvía aunque ya exista registro idempotente previo.
  --tenant-id=<uuid>    Solo propietarios de ese condominio.
  --tenant-slug=<slug>  Solo propietarios de ese condominio (por slug).
  --limit=N             Máximo N correos (útil para prueba).
  --test-email=addr     Envía todos los destinatarios filtrados a este correo (prueba).
  --delay-ms=N          Pausa entre lotes (default: 1500 ms).
  --chunk-size=N        Correos por lote (default: 25).

Variables .env:
  APP_URL                         Base del enlace (default https://condominio-360.com)
  MAILGUN_API_KEY                 Requerida para envío real
  EARTHQUAKE_CENSUS_EMAIL_DELAY_MS
  EARTHQUAKE_CENSUS_EMAIL_CHUNK

Ejemplos:
  # Ver cuántos recibirían el correo (todos los condominios)
  node scripts/send-earthquake-census-email.js

  # Probar con 3 correos reales
  node scripts/send-earthquake-census-email.js --tenant-slug=torre-a --limit=3 --send --yes

  # Envío masivo a un condominio
  node scripts/send-earthquake-census-email.js --tenant-slug=mi-condominio --send --yes

  # Envío masivo a TODOS los condominios activos
  node scripts/send-earthquake-census-email.js --send --yes
`);
}

async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        printHelp();
        process.exit(0);
    }

    if (opts.tenantId) {
        const t = await TenantModel.findById(opts.tenantId);
        if (!t) {
            console.error('❌ Condominio no encontrado:', opts.tenantId);
            process.exit(1);
        }
    }
    if (opts.tenantSlug) {
        const t = await TenantModel.findBySlug(opts.tenantSlug);
        if (!t) {
            console.error('❌ Condominio no encontrado con slug:', opts.tenantSlug);
            process.exit(1);
        }
    }

    const url = censusUrl();
    console.log('\n📋 Censo terremoto — notificación por correo (script manual)\n');
    console.log('  Enlace del formulario:', url);
    console.log('  Alcance:', opts.tenantId ? `tenant-id=${opts.tenantId}` : opts.tenantSlug ? `slug=${opts.tenantSlug}` : 'TODOS los condominios activos');
    if (opts.testEmail) console.log('  Modo prueba: todos los envíos irán a', opts.testEmail);
    console.log('');

    const rows = await fetchOwnerRows({ tenantId: opts.tenantId, tenantSlug: opts.tenantSlug });
    const recipients = await buildRecipients(rows, { testEmail: opts.testEmail, limit: opts.limit });

    const byTenant = {};
    for (const r of recipients) {
        byTenant[r.tenantName] = (byTenant[r.tenantName] || 0) + 1;
    }

    console.log(`  Propietarios con correo: ${recipients.length}`);
    if (Object.keys(byTenant).length) {
        console.log('  Por condominio:');
        for (const [name, count] of Object.entries(byTenant).sort((a, b) => a[0].localeCompare(b[0]))) {
            console.log(`    • ${name}: ${count}`);
        }
    }

    const skipped = rows.length - recipients.length;
    if (skipped > 0) {
        console.log(`  (Omitidos sin email válido o duplicados: ~${Math.max(0, skipped)})`);
    }

    if (!recipients.length) {
        console.log('\n⚠️  No hay destinatarios. Revise propietarios y correos en BD.');
        process.exit(0);
    }

    console.log('\n  Muestra (máx. 8):');
    recipients.slice(0, 8).forEach((r) => {
        console.log(`    • ${r.email} — ${r.firstName} (${r.tenantName})`);
    });
    if (recipients.length > 8) console.log(`    … y ${recipients.length - 8} más`);

    if (!opts.send) {
        console.log('\n⏸️  Dry-run: no se envió ningún correo.');
        console.log('   Para enviar: node scripts/send-earthquake-census-email.js --send');
        console.log('   O con confirmación automática: ... --send --yes');
        if (opts.tenantSlug) console.log(`   Ejemplo: node scripts/send-earthquake-census-email.js --tenant-slug=${opts.tenantSlug} --send --yes`);
        process.exit(0);
    }

    if (!MailgunMailProvider.isConfigured()) {
        console.error('\n❌ MAILGUN_API_KEY no configurada. No se puede enviar.');
        process.exit(1);
    }

    if (!opts.yes) {
        const answer = await ask(`\n⚠️  ¿Enviar ${recipients.length} correo(s)? Escriba SEND para confirmar: `);
        if (answer !== 'SEND') {
            console.log('Cancelado.');
            process.exit(0);
        }
    }

    const batchId = crypto.randomUUID();
    const batchLabel = `earthquake_census_${Date.now()}`;
    let sent = 0;
    let failed = 0;
    let skippedDup = 0;

    console.log(`\n📤 Enviando (lote ${batchLabel}, id ${batchId})…\n`);

    for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        const idempotencyKey = opts.force
            ? null
            : `earthquake_census_alert:v1:${r.tenantId}:${r.email}`;

        try {
            const result = await EmailService.sendEarthquakeCensusAlert(
                r.email,
                r.firstName,
                r.tenantName,
                url,
                {
                    tenantId: r.tenantId,
                    pipeline: 'transactional',
                    idempotencyKey,
                    sourceBatchId: batchId,
                    metadata: { script: 'send-earthquake-census-email.js', userId: r.userId, batchLabel }
                }
            );

            if (result.duplicate) {
                skippedDup++;
                console.log(`  ⏭️  ${r.email} (${r.tenantName}) — ya enviado antes`);
            } else {
                sent++;
                console.log(`  ✅ ${r.email} (${r.tenantName})`);
            }
        } catch (err) {
            failed++;
            console.error(`  ❌ ${r.email}: ${err.message || err}`);
        }

        const isChunkEnd = (i + 1) % opts.chunkSize === 0;
        if (isChunkEnd && i + 1 < recipients.length && opts.delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
        }
    }

    console.log('\n📊 Resumen:');
    console.log(`   Enviados: ${sent}`);
    console.log(`   Omitidos (idempotencia): ${skippedDup}`);
    console.log(`   Fallidos: ${failed}`);
    console.log(`   Total procesados: ${recipients.length}`);
    console.log('\n   Los correos se envían de forma inmediata vía Mailgun (pipeline transaccional).');
    console.log('   Pausa entre lotes configurable con --delay-ms.\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('❌ Error fatal:', err.message || err);
    process.exit(1);
});
