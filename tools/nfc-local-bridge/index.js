#!/usr/bin/env node
/**
 * Servidor local (solo 127.0.0.1) que lee tarjetas NFC vía PC/SC y expone el último UID por HTTP.
 * Requiere lector compatible (p. ej. ACR122U) y drivers PC/SC instalados en el sistema.
 *
 *   cd tools/nfc-local-bridge && npm install && npm start
 *
 * Variables: NFC_BRIDGE_PORT (default 4789)
 */

const express = require('express');
const cors = require('cors');
const { NFC } = require('nfc-pcsc');

const PORT = parseInt(process.env.NFC_BRIDGE_PORT || '4789', 10) || 4789;

let lastUid = null;
let lastTs = 0;
let readerCount = 0;
let pcscDiagnosticPrinted = false;

const nfc = new NFC();

function pcscReaderNames() {
    try {
        return Object.keys(nfc.readers || {});
    } catch {
        return [];
    }
}

function printPcscNoReaderHelp() {
    if (pcscDiagnosticPrinted) return;
    pcscDiagnosticPrinted = true;
    console.warn('');
    console.warn('⚠️  PC/SC no ve ningún lector USB.');
    console.warn('   Este puente solo funciona si macOS expone el dispositivo como lector de tarjetas (CCID / Smart Card).');
    console.warn('   Muchos lectores OEM no registran perfil PC/SC en Mac (solo en Windows) o necesitan driver del fabricante.');
    console.warn('');
    console.warn('   Qué revisar:');
    console.warn('   • Informe del sistema → USB: ¿aparece el lector?');
    console.warn('   • Desenchufar, otro puerto/cable, reiniciar el puente.');
    console.warn('   • Probar un lector con soporte Mac/PC/SC conocido (p. ej. ACS ACR122U).');
    console.warn('   • Abrir http://127.0.0.1:' + PORT + '/health y comprobar readerNames y pcscSeesReaders.');
    console.warn('');
}

// Dar tiempo a que el bus USB y el daemon registren el lector
setTimeout(() => {
    if (pcscReaderNames().length === 0 && readerCount === 0) printPcscNoReaderHelp();
}, 8000);

nfc.on('reader', (reader) => {
    readerCount += 1;
    console.log(`[NFC] Lector PC/SC detectado: ${reader.name}`);

    reader.on('card', (card) => {
        try {
            const raw = card.uid;
            const uid = Buffer.isBuffer(raw)
                ? raw.toString('hex').toUpperCase()
                : String(raw || '')
                      .replace(/[^A-Fa-f0-9]/g, '')
                      .toUpperCase();
            if (uid.length >= 4) {
                lastUid = uid;
                lastTs = Date.now();
                console.log(`[NFC] UID: ${uid}`);
            }
        } catch (e) {
            console.error('[NFC] Error leyendo UID:', e.message);
        }
    });

    reader.on('error', (err) => {
        console.error(`[NFC] Error lector ${reader.name}:`, err.message);
    });

    reader.on('end', () => {
        readerCount = Math.max(0, readerCount - 1);
        console.log(`[NFC] Lector desconectado: ${reader.name}`);
    });
});

nfc.on('error', (err) => {
    console.error('[NFC] Error global PC/SC:', err.message || err);
});

const app = express();
app.use(
    cors({
        origin: true,
        methods: ['GET', 'OPTIONS']
    })
);

app.get('/', (req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Puente NFC local</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 2rem auto; padding: 0 1rem;">
  <h1>Puente NFC local</h1>
  <p>Servicio activo en <code>127.0.0.1:${PORT}</code>. No hay página principal: el panel usa solo las rutas API.</p>
  <ul>
    <li><a href="/health"><code>/health</code></a> — estado y lectores detectados</li>
    <li><a href="/last"><code>/last</code></a> — último UID y marca de tiempo</li>
  </ul>
</body>
</html>`);
});

app.get('/health', (req, res) => {
    const names = pcscReaderNames();
    res.json({
        ok: true,
        service: 'condominio360-nfc-local-bridge',
        readers: readerCount,
        readerNames: names,
        pcscSeesReaders: names.length > 0,
        port: PORT
    });
});

app.get('/last', (req, res) => {
    res.json({
        uid: lastUid,
        ts: lastTs
    });
});

app.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log(`✅ Puente NFC local: http://127.0.0.1:${PORT}`);
    console.log('   GET /        — esta ayuda en el navegador');
    console.log('   GET /health  — estado');
    console.log('   GET /last    — último UID leído (ts en ms)');
    console.log('   Acerca la tarjeta al lector USB; el panel de seguridad puede consultar /last.');
    console.log('');
});
