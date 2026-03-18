require('dotenv').config();
const { connectDB, sql } = require('../src/config/database');

async function runMigration() {
    try {
        console.log('🔌 Conectando a la base de datos...');
        const pool = await connectDB();
        console.log('✅ Conexión exitosa\n');
        
        // Verificar si tabla existe
        const checkResult = await pool.request()
            .query("SELECT * FROM sys.tables WHERE name = 'ExchangeRates'");
        
        if (checkResult.recordset.length === 0) {
            console.log('📊 Creando tabla ExchangeRates...');
            await pool.request().query(`
                CREATE TABLE ExchangeRates (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    rate_date DATE NOT NULL UNIQUE,
                    usd_rate DECIMAL(12,4) NOT NULL,
                    eur_rate DECIMAL(12,4) NOT NULL,
                    change_percentage_usd DECIMAL(5,2) NULL,
                    change_percentage_eur DECIMAL(5,2) NULL,
                    source VARCHAR(50) DEFAULT 'BCV_API',
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 DEFAULT SYSDATETIME()
                )
            `);
            
            await pool.request().query(`
                CREATE INDEX idx_exchange_rates_date ON ExchangeRates(rate_date DESC)
            `);
            
            console.log('✅ Tabla ExchangeRates creada exitosamente\n');
        } else {
            console.log('✅ Tabla ExchangeRates ya existe\n');
        }
        
        // Poblar datos de prueba
        console.log('🌱 Poblando datos de prueba...\n');
        
        const rates = [
            { date: '2026-03-14', usd: 65.45, eur: 71.20 },
            { date: '2026-03-13', usd: 65.32, eur: 71.05 },
            { date: '2026-03-12', usd: 65.28, eur: 70.95 },
            { date: '2026-03-11', usd: 65.15, eur: 70.80 },
            { date: '2026-03-10', usd: 65.02, eur: 70.65 },
            { date: '2026-03-09', usd: 64.95, eur: 70.50 },
        ];

        for (const rate of rates) {
            const changeUsd = (Math.random() * 0.5 - 0.25).toFixed(2);
            const changeEur = (Math.random() * 0.5 - 0.25).toFixed(2);

            await pool.request()
                .input('date', sql.Date, rate.date)
                .input('usd', sql.Decimal(12, 4), rate.usd)
                .input('eur', sql.Decimal(12, 4), rate.eur)
                .input('changeUsd', sql.Decimal(5, 2), changeUsd)
                .input('changeEur', sql.Decimal(5, 2), changeEur)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM ExchangeRates WHERE rate_date = @date)
                    INSERT INTO ExchangeRates (rate_date, usd_rate, eur_rate, change_percentage_usd, change_percentage_eur)
                    VALUES (@date, @usd, @eur, @changeUsd, @changeEur)
                `);
            
            console.log(`✅ Tasa ${rate.date}: USD Bs. ${rate.usd}, EUR Bs. ${rate.eur} (Cambio: ${changeUsd}% / ${changeEur}%)`);
        }

        console.log('\n✅ Migración y seed completados exitosamente!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.message.includes('ECONNREFUSED')) {
            console.error('\n💡 Verifica que:');
            console.error('   1. SQL Server esté corriendo');
            console.error('   2. Las credenciales en .env sean correctas');
            console.error('   3. El puerto 1433 esté abierto');
        }
        process.exit(1);
    }
}

runMigration();
