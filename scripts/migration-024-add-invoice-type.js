#!/usr/bin/env node
/**
 * Migración 024: Agregar columna invoice_type a BillingPreliminaries
 */

require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');

async function migrate() {
    try {
        console.log('🔌 Conectando a la base de datos...');
        const pool = await connectDB();
        
        // Verificar si la columna existe
        const checkResult = await pool.request()
            .query(`
                SELECT COUNT(*) as count 
                FROM sys.columns 
                WHERE Name = 'invoice_type' 
                AND Object_ID = Object_ID(N'BillingPreliminaries')
            `);
        
        if (checkResult.recordset[0].count > 0) {
            console.log('✅ La columna invoice_type ya existe');
        } else {
            console.log('➕ Agregando columna invoice_type...');
            await pool.request().query(`
                ALTER TABLE BillingPreliminaries 
                ADD invoice_type NVARCHAR(50) DEFAULT 'ORDINARY'
            `);
            console.log('✅ Columna invoice_type agregada');
        }
        
        // Actualizar registros existentes para identificar el tipo
        console.log('🔄 Actualizando registros existentes...');
        
        // Recibos extraordinarios por nombre
        await pool.request().query(`
            UPDATE BillingPreliminaries 
            SET invoice_type = 'EXTRAORDINARY'
            WHERE name LIKE '%extraordinario%' 
            OR name LIKE '%Extraordinario%'
            OR invoice_type IS NULL
        `);
        
        console.log('✅ Migración completada');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

migrate();
