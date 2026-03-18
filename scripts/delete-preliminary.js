#!/usr/bin/env node
/**
 * Script para eliminar un preliminar específico
 * Uso: node scripts/delete-preliminary.js
 */

require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');

const PRELIMINARY_ID = 'D4D8D594-16C8-43EA-B674-E7024EFB6BDD';
const TENANT_ID = 'AB1449E4-AB72-489C-974C-70E94DA215BF';

async function deletePreliminary() {
    try {
        console.log('🔍 Conectando a la base de datos...');
        const pool = await connectDB();
        
        // Verificar que existe
        console.log('🔍 Buscando preliminar...');
        const checkResult = await pool.request()
            .input('id', sql.UniqueIdentifier, PRELIMINARY_ID)
            .input('tenant_id', sql.UniqueIdentifier, TENANT_ID)
            .query('SELECT name, status, total_amount_ves, total_amount_usd FROM BillingPreliminaries WHERE id = @id AND tenant_id = @tenant_id');
        
        if (checkResult.recordset.length === 0) {
            console.log('❌ Preliminar no encontrado');
            process.exit(1);
        }
        
        const preliminary = checkResult.recordset[0];
        console.log('✅ Preliminar encontrado:');
        console.log(`   Nombre: ${preliminary.name}`);
        console.log(`   Estado: ${preliminary.status}`);
        console.log(`   Total VES: ${preliminary.total_amount_ves}`);
        console.log(`   Total USD: ${preliminary.total_amount_usd}`);
        
        // Eliminar items del preliminar
        console.log('🗑️  Eliminando items del preliminar...');
        await pool.request()
            .input('preliminary_id', sql.UniqueIdentifier, PRELIMINARY_ID)
            .query('DELETE FROM BillingPreliminaryItems WHERE preliminary_id = @preliminary_id');
        console.log('   ✓ Items eliminados');
        
        // Eliminar items de recibos asociados
        console.log('🗑️  Eliminando items de recibos...');
        await pool.request()
            .input('preliminary_id', sql.UniqueIdentifier, PRELIMINARY_ID)
            .query(`DELETE FROM BillingInvoiceItems 
                    WHERE invoice_id IN (SELECT id FROM BillingInvoices WHERE preliminary_id = @preliminary_id)`);
        console.log('   ✓ Items de recibos eliminados');
        
        // Eliminar recibos asociados
        console.log('🗑️  Eliminando recibos...');
        await pool.request()
            .input('preliminary_id', sql.UniqueIdentifier, PRELIMINARY_ID)
            .query('DELETE FROM BillingInvoices WHERE preliminary_id = @preliminary_id');
        console.log('   ✓ Recibos eliminados');
        
        // Eliminar el preliminar
        console.log('🗑️  Eliminando preliminar...');
        await pool.request()
            .input('id', sql.UniqueIdentifier, PRELIMINARY_ID)
            .input('tenant_id', sql.UniqueIdentifier, TENANT_ID)
            .query('DELETE FROM BillingPreliminaries WHERE id = @id AND tenant_id = @tenant_id');
        console.log('   ✓ Preliminar eliminado');
        
        console.log('\n✅ ¡Listo! El preliminar fue eliminado exitosamente.');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

deletePreliminary();
