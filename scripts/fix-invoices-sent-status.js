#!/usr/bin/env node
/**
 * Script para actualizar el estado sent_to_owners de recibos existentes
 * Basado en el estado del preliminar asociado
 */

require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');

async function fixInvoices() {
    try {
        console.log('🔌 Conectando a la base de datos...');
        const pool = await connectDB();
        
        console.log('🔄 Actualizando recibos basados en el estado del preliminar...');
        
        // Actualizar recibos cuyo preliminar ya fue enviado
        const result = await pool.request().query(`
            UPDATE i
            SET i.sent_to_owners = 1,
                i.sent_at = p.sent_at
            FROM BillingInvoices i
            INNER JOIN BillingPreliminaries p ON i.preliminary_id = p.id
            WHERE p.sent_to_owners = 1
            AND (i.sent_to_owners IS NULL OR i.sent_to_owners = 0)
        `);
        
        console.log(`✅ ${result.rowsAffected[0]} recibos actualizados`);
        
        // También actualizar recibos de preliminares FINALIZED (por si acaso)
        const result2 = await pool.request().query(`
            UPDATE i
            SET i.sent_to_owners = 1
            FROM BillingInvoices i
            INNER JOIN BillingPreliminaries p ON i.preliminary_id = p.id
            WHERE p.status = 'FINALIZED'
            AND (i.sent_to_owners IS NULL OR i.sent_to_owners = 0)
        `);
        
        console.log(`✅ ${result2.rowsAffected[0]} recibos adicionales actualizados (FINALIZED)`);
        
        console.log('🎉 Proceso completado');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

fixInvoices();
