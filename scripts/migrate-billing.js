/**
 * Script para ejecutar migración del sistema de facturación
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const Migration = require('../database/migrations/202503210001-CreateBillingTables');

async function run() {
    try {
        console.log('🚀 Ejecutando migración de facturación...');
        await Migration.up();
        console.log('✅ Migración completada exitosamente');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error ejecutando migración:', error);
        process.exit(1);
    }
}

run();
