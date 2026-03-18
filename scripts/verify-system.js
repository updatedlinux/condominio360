#!/usr/bin/env node

/**
 * Script de verificación del sistema
 * Comprueba que todas las tablas, migraciones y modelos estén correctos
 */

require('dotenv').config();
const { connectDB, sql } = require('../src/config/database');

async function verifySystem() {
    console.log('🔍 Verificando sistema Condominio360...\n');
    
    try {
        const pool = await connectDB();
        
        // 1. Verificar tabla de migraciones
        console.log('1️⃣ Verificando tabla de migraciones...');
        const migrationsCheck = await pool.request().query(`
            SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'migrations'
        `);
        
        if (migrationsCheck.recordset[0].count === 0) {
            console.log('   ❌ Tabla de migraciones no existe');
            console.log('   💡 Ejecuta: npm run migrate');
        } else {
            const migrations = await pool.request().query('SELECT COUNT(*) as count FROM migrations');
            console.log(`   ✅ Tabla de migraciones existe (${migrations.recordset[0].count} migraciones)`);
        }
        
        // 2. Verificar estructura de Users
        console.log('\n2️⃣ Verificando tabla Users...');
        const userColumns = ['dni', 'email_verified', 'registration_status', 'invited_at', 'invitation_token'];
        for (const col of userColumns) {
            const check = await pool.request().query(`
                SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'Users' AND COLUMN_NAME = '${col}'
            `);
            const status = check.recordset[0].count > 0 ? '✅' : '❌';
            console.log(`   ${status} Columna ${col}`);
        }
        
        // 3. Verificar tabla TenantAdmins
        console.log('\n3️⃣ Verificando tabla TenantAdmins...');
        const tenantAdminsCheck = await pool.request().query(`
            SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'TenantAdmins'
        `);
        
        if (tenantAdminsCheck.recordset[0].count === 0) {
            console.log('   ❌ Tabla TenantAdmins no existe');
        } else {
            console.log('   ✅ Tabla TenantAdmins existe');
            const cols = await pool.request().query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'TenantAdmins'
            `);
            console.log(`   📋 Columnas: ${cols.recordset.map(c => c.COLUMN_NAME).join(', ')}`);
        }
        
        // 4. Verificar tabla AuditLogs
        console.log('\n4️⃣ Verificando tabla AuditLogs...');
        const auditCheck = await pool.request().query(`
            SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'AuditLogs'
        `);
        
        if (auditCheck.recordset[0].count === 0) {
            console.log('   ❌ Tabla AuditLogs no existe');
        } else {
            console.log('   ✅ Tabla AuditLogs existe');
        }
        
        // 5. Verificar tabla VisitorDeliveries
        console.log('\n5️⃣ Verificando tabla VisitorDeliveries...');
        const deliveryCheck = await pool.request().query(`
            SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'VisitorDeliveries'
        `);
        
        if (deliveryCheck.recordset[0].count === 0) {
            console.log('   ❌ Tabla VisitorDeliveries no existe');
        } else {
            console.log('   ✅ Tabla VisitorDeliveries existe');
        }
        
        // 6. Verificar índices en Users
        console.log('\n6️⃣ Verificando índices en Users...');
        const indexes = ['IX_Users_Dni_Unique', 'IX_Users_Email_Unique', 'IX_Users_InvitationToken'];
        for (const idx of indexes) {
            const check = await pool.request().query(`
                SELECT COUNT(*) as count FROM sys.indexes 
                WHERE name = '${idx}' AND object_id = OBJECT_ID('Users')
            `);
            const status = check.recordset[0].count > 0 ? '✅' : '❌';
            console.log(`   ${status} Índice ${idx}`);
        }
        
        // 7. Verificar campos en Properties
        console.log('\n7️⃣ Verificando tabla Properties...');
        const propertyCols = ['created_by', 'created_by_type'];
        for (const col of propertyCols) {
            const check = await pool.request().query(`
                SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'Properties' AND COLUMN_NAME = '${col}'
            `);
            const status = check.recordset[0].count > 0 ? '✅' : '❌';
            console.log(`   ${status} Columna ${col}`);
        }

        // 8. Verificar tablas NFC
        console.log('\n8️⃣ Verificando tablas NFC...');
        const nfcTables = ['NFC_Cards', 'NFC_AccessLogs'];
        for (const table of nfcTables) {
            const check = await pool.request().query(`
                SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_NAME = '${table}'
            `);
            const status = check.recordset[0].count > 0 ? '✅' : '❌';
            console.log(`   ${status} Tabla ${table}`);
        }
        
        // 9. Contar tablas totales
        console.log('\n9️⃣ Resumen de tablas...');
        const tables = await pool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `);
        console.log(`   📊 Total de tablas: ${tables.recordset.length}`);
        console.log(`   📋 Tablas: ${tables.recordset.map(t => t.TABLE_NAME).join(', ')}`);
        
        await pool.close();
        
        console.log('\n✨ Verificación completada!\n');
        
    } catch (error) {
        console.error('\n❌ Error durante la verificación:', error.message);
        process.exit(1);
    }
}

verifySystem();
