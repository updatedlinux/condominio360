require('dotenv').config();
const { connectDB } = require('../src/config/database');

async function fixForeignKey() {
    try {
        console.log('🔧 Eliminando Foreign Key constraint de Consultations...');
        const pool = await connectDB();
        
        // Eliminar constraint FK_Consultations_Users
        await pool.request().query(`
            IF EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_Consultations_Users')
            ALTER TABLE Consultations DROP CONSTRAINT FK_Consultations_Users
        `);
        
        console.log('✅ Foreign Key eliminada');
        console.log('✅ Ahora los TenantAdmins pueden crear consultas');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

fixForeignKey();
