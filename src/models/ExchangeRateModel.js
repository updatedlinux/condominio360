const { connectDB, sql } = require('../config/database');

/**
 * Modelo para manejar las tasas de cambio BCV
 */
class ExchangeRateModel {
    /**
     * Obtener la tasa de cambio más reciente
     * @returns {Promise<Object|null>}
     */
    static async getLatest() {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .query(`
                    SELECT TOP 1 * FROM ExchangeRates
                    ORDER BY rate_date DESC
                `);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error getting latest exchange rate:', error);
            return null;
        }
    }

    /**
     * Obtener tasas de cambio paginadas
     * @param {number} page - Número de página
     * @param {number} limit - Límite por página
     * @returns {Promise<Object>}
     */
    static async getPaginated(page = 1, limit = 4) {
        try {
            const pool = await connectDB();
            const offset = (page - 1) * limit;

            // Get total count
            const countResult = await pool.request()
                .query('SELECT COUNT(*) as total FROM ExchangeRates');
            const total = countResult.recordset[0].total;

            // Get paginated rates
            const result = await pool.request()
                .input('limit', sql.Int, limit)
                .input('offset', sql.Int, offset)
                .query(`
                    SELECT * FROM ExchangeRates
                    ORDER BY rate_date DESC
                    OFFSET @offset ROWS
                    FETCH NEXT @limit ROWS ONLY
                `);

            return {
                rates: result.recordset,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            console.error('Error getting paginated exchange rates:', error);
            return { rates: [], pagination: { page, limit, total: 0, totalPages: 0 } };
        }
    }

    /**
     * Insertar o actualizar una tasa de cambio
     * @param {Object} data
     * @param {string} data.date - Fecha en formato YYYY-MM-DD
     * @param {number} data.usd - Tasa USD
     * @param {number} data.eur - Tasa EUR
     * @param {number} data.changePercentageUsd - Cambio porcentual USD
     * @param {number} data.changePercentageEur - Cambio porcentual EUR
     * @returns {Promise<boolean>}
     */
    static async upsert(data) {
        try {
            const pool = await connectDB();
            
            // Check if rate exists for this date
            const existing = await pool.request()
                .input('date', sql.Date, data.date)
                .query('SELECT id FROM ExchangeRates WHERE rate_date = @date');

            if (existing.recordset.length > 0) {
                // Update existing
                await pool.request()
                    .input('date', sql.Date, data.date)
                    .input('usd', sql.Decimal(12, 4), data.usd)
                    .input('eur', sql.Decimal(12, 4), data.eur)
                    .input('changeUsd', sql.Decimal(5, 2), data.changePercentageUsd || 0)
                    .input('changeEur', sql.Decimal(5, 2), data.changePercentageEur || 0)
                    .query(`
                        UPDATE ExchangeRates
                        SET usd_rate = @usd,
                            eur_rate = @eur,
                            change_percentage_usd = @changeUsd,
                            change_percentage_eur = @changeEur,
                            updated_at = SYSDATETIME()
                        WHERE rate_date = @date
                    `);
            } else {
                // Insert new
                await pool.request()
                    .input('date', sql.Date, data.date)
                    .input('usd', sql.Decimal(12, 4), data.usd)
                    .input('eur', sql.Decimal(12, 4), data.eur)
                    .input('changeUsd', sql.Decimal(5, 2), data.changePercentageUsd || 0)
                    .input('changeEur', sql.Decimal(5, 2), data.changePercentageEur || 0)
                    .query(`
                        INSERT INTO ExchangeRates (rate_date, usd_rate, eur_rate, change_percentage_usd, change_percentage_eur)
                        VALUES (@date, @usd, @eur, @changeUsd, @changeEur)
                    `);
            }
            
            return true;
        } catch (error) {
            console.error('Error upserting exchange rate:', error);
            return false;
        }
    }

    /**
     * Obtener tasas recientes para gráficas (últimos N días)
     * @param {number} days - Cantidad de días
     * @returns {Promise<Array>}
     */
    static async getRecentForChart(days = 30) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('days', sql.Int, days)
                .query(`
                    SELECT rate_date, usd_rate, eur_rate
                    FROM ExchangeRates
                    WHERE rate_date >= DATEADD(day, -@days, GETDATE())
                    ORDER BY rate_date ASC
                `);
            return result.recordset || [];
        } catch (error) {
            console.error('Error getting recent rates:', error);
            return [];
        }
    }

    /**
     * Verificar si ya existe tasa para una fecha
     * @param {string} date - Fecha en formato YYYY-MM-DD
     * @returns {Promise<boolean>}
     */
    static async existsForDate(date) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('date', sql.Date, date)
                .query('SELECT 1 FROM ExchangeRates WHERE rate_date = @date');
            return result.recordset.length > 0;
        } catch (error) {
            console.error('Error checking exchange rate existence:', error);
            return false;
        }
    }

    /**
     * Obtener la tasa de un día específico
     * @param {string} date - Fecha en formato YYYY-MM-DD
     * @returns {Promise<Object|null>}
     */
    static async getByDate(date) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('date', sql.Date, date)
                .query('SELECT * FROM ExchangeRates WHERE rate_date = @date');
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error getting exchange rate by date:', error);
            return null;
        }
    }
}

module.exports = ExchangeRateModel;
