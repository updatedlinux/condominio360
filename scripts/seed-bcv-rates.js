/**
 * Script para poblar datos de prueba de tasas BCV
 * Uso: node scripts/seed-bcv-rates.js
 */

require('dotenv').config();
const { connectDB, sql } = require('../src/config/database');

async function seedBCVRates() {
    try {
        console.log('🌱 Seeding BCV exchange rates...');
        const pool = await connectDB();

        // Datos de ejemplo (tasas simuladas)
        const rates = [
            { date: '2026-03-14', usd: 65.45, eur: 71.20 },
            { date: '2026-03-13', usd: 65.32, eur: 71.05 },
            { date: '2026-03-12', usd: 65.28, eur: 70.95 },
            { date: '2026-03-11', usd: 65.15, eur: 70.80 },
            { date: '2026-03-10', usd: 65.02, eur: 70.65 },
            { date: '2026-03-09', usd: 64.95, eur: 70.50 },
        ];

        for (const rate of rates) {
            // Calcular cambio porcentual (simulado)
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
            
            console.log(`✅ Rate for ${rate.date}: USD ${rate.usd}, EUR ${rate.eur}`);
        }

        console.log('✅ BCV rates seeded successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding BCV rates:', error);
        process.exit(1);
    }
}

seedBCVRates();
