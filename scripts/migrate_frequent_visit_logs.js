/**
 * Script de migración para asignar pass_id a los VisitorLogs de visitas frecuentes
 * que fueron creados sin este campo.
 * 
 * Este script vincula los logs de entrada de visitas frecuentes con sus respectivos
 * pases (VisitorPasses) para que aparezcan correctamente en el historial del propietario.
 */

require('dotenv').config();
const { connectDB } = require('../src/config/database');
const sql = require('mssql');

async function migrateFrequentVisitLogs() {
    try {
        console.log('🔄 Iniciando migración de logs de visitas frecuentes...\n');
        
        const pool = await connectDB();
        
        // Buscar logs que no tienen pass_id pero corresponden a visitas frecuentes
        const logsToFix = await pool.request()
            .query(`
                SELECT vl.id as log_id, vl.visitor_id, vl.property_id, vl.entry_time
                FROM VisitorLogs vl
                WHERE vl.pass_id IS NULL
                AND EXISTS (
                    SELECT 1 FROM VisitorPasses vp 
                    WHERE vp.visitor_id = vl.visitor_id 
                    AND vp.property_id = vl.property_id
                    AND vp.type = 'FREQUENT'
                )
            `);
        
        console.log(`📊 Se encontraron ${logsToFix.recordset.length} logs sin pass_id`);
        
        let updated = 0;
        let errors = 0;
        
        for (const log of logsToFix.recordset) {
            try {
                // Buscar el pase frecuente correspondiente
                const passResult = await pool.request()
                    .input('visitor_id', sql.UniqueIdentifier, log.visitor_id)
                    .input('property_id', sql.UniqueIdentifier, log.property_id)
                    .query(`
                        SELECT TOP 1 id 
                        FROM VisitorPasses 
                        WHERE visitor_id = @visitor_id 
                        AND property_id = @property_id
                        AND type = 'FREQUENT'
                        ORDER BY created_at DESC
                    `);
                
                if (passResult.recordset.length > 0) {
                    const passId = passResult.recordset[0].id;
                    
                    // Actualizar el log con el pass_id
                    await pool.request()
                        .input('log_id', sql.UniqueIdentifier, log.log_id)
                        .input('pass_id', sql.UniqueIdentifier, passId)
                        .query(`
                            UPDATE VisitorLogs 
                            SET pass_id = @pass_id 
                            WHERE id = @log_id
                        `);
                    
                    updated++;
                    console.log(`  ✓ Log ${log.log_id} → Pass ${passId}`);
                }
            } catch (err) {
                errors++;
                console.error(`  ✗ Error en log ${log.log_id}:`, err.message);
            }
        }
        
        console.log(`\n✅ Migración completada:`);
        console.log(`   - Actualizados: ${updated}`);
        console.log(`   - Errores: ${errors}`);
        console.log(`   - Total procesados: ${logsToFix.recordset.length}`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error en la migración:', error);
        process.exit(1);
    }
}

migrateFrequentVisitLogs();
