#!/usr/bin/env node
/**
 * Envío de prueba vía Mailgun API usando las mismas variables que la app (.env).
 *
 * Uso:
 *   node scripts/send-test-email.js correo@ejemplo.com
 *   TEST_EMAIL_TO=correo@ejemplo.com node scripts/send-test-email.js
 *   node scripts/send-test-email.js   (pide el correo por teclado)
 *
 * Opcional en .env o shell:
 *   MAILGUN_TEST_DOMAIN=mg.condominio-360.com  (dominio de envío verificado en Mailgun)
 */

const path = require('path');
const readline = require('readline');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Cargar después de dotenv (el singleton lee process.env al instanciarse)
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

async function main() {
    let to = (process.argv[2] || process.env.TEST_EMAIL_TO || '').trim();

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
<p>Este es un <strong>correo de prueba</strong> generado con <code>scripts/send-test-email.js</code>.</p>
<p>Dominio de envío: <code>${domain}</code></p>
<p>Si lo recibes, la API de Mailgun y el dominio están bien configurados.</p>`;
    const text =
        (process.env.TEST_EMAIL_TEXT || '').trim() ||
        `Correo de prueba (scripts/send-test-email.js). Dominio: ${domain}`;

    console.log('Enviando…');
    console.log('  Destino:', to);
    console.log('  Dominio Mailgun:', domain);
    console.log('  Región:', process.env.MAILGUN_REGION || 'us');

    try {
        const result = await MailgunMailProvider.send({
            domain,
            to,
            subject,
            html,
            text
        });
        console.log('✅ Enviado. ID Mailgun:', result.id);
        if (result.raw && typeof result.raw === 'object') {
            console.log('   Respuesta:', JSON.stringify(result.raw, null, 0).slice(0, 500));
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
