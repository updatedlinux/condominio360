#!/usr/bin/env node
/**
 * Verificar estructura de tabla Properties
 */

require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');

async function check() {
    try {
        console.log('🔌 Conectando...');
        const pool = await connectDB();
        
        // Ver columnas de Properties
        console.log('\n📋 Columnas de Properties:');
        const columns = await pool.request()
            .query(`
                SELECT COLUMN_NAME, DATA_TYPE 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'Properties'
                ORDER BY ORDINAL_POSITION
            `);
        
        columns.recordset.forEach(col => {
            console.log(`  - ${col.COLUMN_NAME}: ${col.DATA_TYPE}`);
        });
        
        // Ver inmuebles del tenant
        console.log('\n🏠 Inmuebles del tenant:');
        const tenantId = 'AB1449E4-AB72-489C-974C-70E94DA215BF';
        const properties = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT TOP 10 id, name, building, building_id FROM Properties WHERE tenant_id = @tenant_id');
        
        properties.recordset.forEach(p => {
            console.log(`  - ${p.name}: building='${p.building}', building_id='${p.building_id}'`);
        });
        
        // Ver edificios
        console.log('\n🏢 Edificios:');
        const buildings = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT id, name FROM Buildings WHERE tenant_id = @tenant_id');
        
        buildings.recordset.forEach(b => {
            console.log(`  - ${b.name} (${b.id})`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

check();
