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

const nfc = new NFC();

nfc.on('reader', (reader) => {
    readerCount += 1;
    console.log(`[NFC] Lector: ${reader.name}`);

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
    console.error('[NFC] Error global:', err.message);
});

const app = express();
app.use(
    cors({
        origin: true,
        methods: ['GET', 'OPTIONS']
    })
);

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        service: 'condominio360-nfc-local-bridge',
        readers: readerCount,
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
    console.log('   GET /health  — estado');
    console.log('   GET /last    — último UID leído (ts en ms)');
    console.log('   Acerca la tarjeta al lector USB; el panel de seguridad puede consultar /last.');
    console.log('');
});
