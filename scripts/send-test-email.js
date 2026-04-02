#!/usr/bin/env node
/**
 * Envío de prueba vía Mailgun usando el .env de la app.
 *
 * Modo directo (por defecto): llama solo a MailgunMailProvider → NO escribe en BD
 *   → no aparece en Super Admin → Correo saliente; webhooks no enlazan filas en email_logs.
 *
 * Modo --persist: usa EmailOrchestrator (igual que la app) → sí crea job/recipient/logs
 *   → aparece en el panel y el message-id coincide con webhooks.
 *
 * Uso:
 *   node scripts/send-test-email.js correo@ejemplo.com
 *   node scripts/send-test-email.js --persist correo@ejemplo.com
 *   RECORD_TEST_EMAIL=1 node scripts/send-test-email.js correo@ejemplo.com
 *   npm run send-test-email -- --persist correo@ejemplo.com
 */

const path = require('path');
const readline = require('readline');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MailgunMailProvider = require('../src/services/email/MailgunMailProvider');

function isEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
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
    const args = argv.slice(2);
    let persist = process.env.RECORD_TEST_EMAIL === '1' || process.env.PERSIST_TEST_EMAIL === '1';
    const rest = [];
    for (const a of args) {
        if (a === '--persist' || a === '-p') persist = true;
        else if (a === '--help' || a === '-h') return { help: true, persist: false, to: null };
        else rest.push(a);
    }
    const to = (rest[0] || process.env.TEST_EMAIL_TO || '').trim();
    return { persist, to };
}

async function main() {
    const { help, persist, to: toArg } = parseArgs(process.argv);
    if (help) {
        console.log(`
send-test-email.js — prueba Mailgun con variables del .env

  node scripts/send-test-email.js [opciones] <correo@dominio.com>

Opciones:
  --persist, -p    Registra el envío en BD (EmailOrchestrator) como el resto de la app.
                   Aparece en Super Admin → Correo saliente; webhooks pueden enlazar el message-id.
  RECORD_TEST_EMAIL=1   Mismo efecto que --persist

Sin --persist: envío directo a la API de Mailgun (no BD, no panel).

Variables útiles: MAILGUN_TEST_DOMAIN, TEST_EMAIL_SUBJECT, TEST_EMAIL_HTML, TEST_EMAIL_TEXT
`);
        process.exit(0);
    }

    let to = toArg;
    if (!to) {
        to = await ask('Correo destino (prueba): ');
    }

    if (!isEmail(to)) {
        console.error('❌ Dirección no válida:', to);
        process.exit(1);
    }

    if (!MailgunMailProvider.isConfigured()) {
        console.error('❌ MAILGUN_API_KEY no está definida o Mailgun no está configurado en .env');
        process.exit(1);
    }

    const domain = (process.env.MAILGUN_TEST_DOMAIN || '').trim() || MailgunMailProvider.defaultDomain;
    const subject = (process.env.TEST_EMAIL_SUBJECT || '').trim() || 'Prueba Condominio360 (Mailgun)';
    const html =
        (process.env.TEST_EMAIL_HTML || '').trim() ||
        `<p>Hola,</p>
<p>Este es un <strong>correo de prueba</strong> generado con <code>scripts/send-test-email.js</code>${persist ? ' <em>(modo --persist, registrado en BD)</em>' : ''}.</p>
<p>Dominio de envío: <code>${domain}</code></p>
<p>Si lo recibes, la API de Mailgun y el dominio están bien configurados.</p>`;
    const text =
        (process.env.TEST_EMAIL_TEXT || '').trim() ||
        `Correo de prueba (scripts/send-test-email.js). Dominio: ${domain}${persist ? ' [persist]' : ''}`;

    console.log('Enviando…');
    console.log('  Modo:', persist ? 'orquestado (BD + panel + webhooks)' : 'directo Mailgun (sin BD)');
    console.log('  Destino:', to);
    console.log('  Dominio Mailgun:', domain);
    console.log('  Región:', process.env.MAILGUN_REGION || 'us');

    try {
        if (persist) {
            const EmailOrchestrator = require('../src/services/email/EmailOrchestrator');
            const messageType = `test_cli_${Date.now()}`;
            const result = await EmailOrchestrator.dispatchMail({
                to,
                subject,
                html,
                text,
                tenantId: null,
                messageType,
                pipeline: 'transactional',
                metadata: { source: 'send-test-email.js', persist: true }
            });
            if (result.duplicate) {
                console.log('⚠️  Idempotencia: ya constaba como enviado. ID:', result.messageId);
            } else {
                console.log('✅ Enviado vía orquestador. Message ID:', result.messageId);
                console.log('   Revisa Super Admin → Correo saliente y, tras eventos Mailgun, los webhooks en logs.');
            }
        } else {
            const result = await MailgunMailProvider.send({
                domain,
                to,
                subject,
                html,
                text
            });
            console.log('✅ Enviado (directo). ID Mailgun:', result.id);
            if (result.raw && typeof result.raw === 'object') {
                console.log('   Respuesta:', JSON.stringify(result.raw, null, 0).slice(0, 500));
            }
            console.log('\n(i) Este modo no guarda en BD. Usa --persist para probar panel + webhooks.');
        }
    } catch (err) {
        console.error('❌ Error:', err.message || err);
        if (err.status || err.statusCode) {
            console.error('   HTTP:', err.status || err.statusCode);
        }
        process.exit(1);
    }
}

main();
