#!/usr/bin/env node
/**
 * Script para ejecutar migración 023 - Agregar sent_to_owners a BillingInvoices
 */

require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');

async function runMigration() {
    try {
        console.log('🔌 Conectando a la base de datos...');
        const pool = await connectDB();
        
        console.log('🔍 Verificando si la columna existe...');
        const checkResult = await pool.request()
            .query(`
                SELECT COUNT(*) as count 
                FROM sys.columns 
                WHERE Name = 'sent_to_owners' 
                AND Object_ID = Object_ID(N'BillingInvoices')
            `);
        
        if (checkResult.recordset[0].count > 0) {
            console.log('✅ La columna sent_to_owners ya existe');
            process.exit(0);
        }
        
        console.log('➕ Agregando columnas sent_to_owners y sent_at...');
        await pool.request().query(`
            ALTER TABLE BillingInvoices 
            ADD sent_to_owners BIT DEFAULT 0,
                sent_at DATETIME2
        `);
        
        console.log('✅ Migración completada exitosamente');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error en la migración:', error.message);
        process.exit(1);
    }
}

runMigration();
