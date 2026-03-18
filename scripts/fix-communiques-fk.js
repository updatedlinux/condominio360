require('dotenv').config();
const { connectDB } = require('../src/config/database');

async function fixForeignKey() {
    try {
        console.log('🔧 Eliminando Foreign Key constraint de Communiques...');
        const pool = await connectDB();
        
        // Eliminar constraint FK_Communique_User
        await pool.request().query(`
            IF EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_Communique_User')
            ALTER TABLE Communiques DROP CONSTRAINT FK_Communique_User
        `);
        
        console.log('✅ Foreign Key eliminada');
        console.log('✅ Ahora se pueden crear comunicados con cualquier userId');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

fixForeignKey();
