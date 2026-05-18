#!/usr/bin/env node
/**
 * Reescala logos ya subidos al tamaño estándar (400×160 máx.).
 * Uso: node scripts/normalize-tenant-logos.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB, sql } = require('../src/config/database');
const TenantLogoService = require('../src/services/TenantLogoService');

async function main() {
    const pool = await connectDB();
    const result = await pool.request().query(`
        SELECT id, name, logo_path FROM Tenants WHERE logo_path IS NOT NULL AND logo_path <> ''
    `);

    let ok = 0;
    let fail = 0;
    for (const row of result.recordset) {
        const full = path.join(process.cwd(), 'uploads', row.logo_path);
        if (!fs.existsSync(full)) {
            console.warn(`⚠️  ${row.name}: archivo no encontrado (${row.logo_path})`);
            fail++;
            continue;
        }
        try {
            await TenantLogoService.normalizeUploadedFile(full);
            console.log(`✅ ${row.name}`);
            ok++;
        } catch (e) {
            console.error(`❌ ${row.name}:`, e.message);
            fail++;
        }
    }
    console.log(`\nListo: ${ok} normalizados, ${fail} con error.`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
