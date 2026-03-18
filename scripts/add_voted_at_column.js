/**
 * Script para agregar columna voted_at a ConsultationVotes
 * Ejecutar: node scripts/add_voted_at_column.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sql, connectDB } = require('../src/config/database');

async function addVotedAtColumn() {
    try {
        const pool = await connectDB();
        console.log('✅ Conectado a la base de datos');

        // Verificar si existe voted_at
        const votedAtCheck = await pool.request().query(`
            SELECT COUNT(*) as count 
            FROM sys.columns 
            WHERE Name = 'voted_at' AND Object_ID = Object_ID(N'ConsultationVotes')
        `);
        const hasVotedAt = votedAtCheck.recordset[0].count > 0;

        // Verificar si existe created_at
        const createdAtCheck = await pool.request().query(`
            SELECT COUNT(*) as count 
            FROM sys.columns 
            WHERE Name = 'created_at' AND Object_ID = Object_ID(N'ConsultationVotes')
        `);
        const hasCreatedAt = createdAtCheck.recordset[0].count > 0;

        console.log(`ℹ️  voted_at existe: ${hasVotedAt}`);
        console.log(`ℹ️  created_at existe: ${hasCreatedAt}`);

        if (hasVotedAt) {
            console.log('✅ La columna voted_at ya existe. No se requiere acción.');
            process.exit(0);
        }

        // Si no existe voted_at pero existe created_at, renombrarla
        if (hasCreatedAt && !hasVotedAt) {
            console.log('📝 Renombrando created_at a voted_at...');
            await pool.request().query(`
                EXEC sp_rename 'ConsultationVotes.created_at', 'voted_at', 'COLUMN'
            `);
            console.log('✅ Columna renombrada exitosamente');
        }

        // Si no existe ninguna, crear voted_at
        if (!hasVotedAt && !hasCreatedAt) {
            console.log('📝 Creando columna voted_at...');
            await pool.request().query(`
                ALTER TABLE ConsultationVotes 
                ADD voted_at DATETIME2 DEFAULT SYSDATETIME()
            `);
            console.log('✅ Columna voted_at creada exitosamente');
        }

        // Verificar estructura final
        console.log('\n📋 Estructura final de ConsultationVotes:');
        const columns = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'ConsultationVotes'
            ORDER BY ORDINAL_POSITION
        `);
        
        columns.recordset.forEach(col => {
            console.log(`   - ${col.COLUMN_NAME}: ${col.DATA_TYPE} ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });

        console.log('\n✅ Script completado exitosamente');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

addVotedAtColumn();
