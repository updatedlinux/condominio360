#!/usr/bin/env node

/**
 * Script CLI para ejecutar migraciones
 * Uso:
 *   node scripts/migrate.js           # Ejecuta migraciones pendientes
 *   node scripts/migrate.js status    # Muestra estado
 *   node scripts/migrate.js rollback  # Revierte último batch
 */

require('dotenv').config();
const MigrationRunner = require('../src/migrations/MigrationRunner');

const command = process.argv[2] || 'run';

async function main() {
    const runner = new MigrationRunner();
    
    try {
        switch (command) {
            case 'run':
            case 'up':
                await runner.run();
                break;
            case 'status':
                await runner.status();
                break;
            case 'rollback':
            case 'down':
                await runner.rollback();
                break;
            default:
                console.log(`
🚀 Migration Runner - SQL Server

Uso:
  node scripts/migrate.js           Ejecutar migraciones pendientes
  node scripts/migrate.js status    Ver estado de migraciones
  node scripts/migrate.js rollback  Revertir último batch

                `);
                process.exit(1);
        }
        
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

main();
