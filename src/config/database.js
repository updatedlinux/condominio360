const sql = require('mssql');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 1433,
    database: process.env.DB_NAME,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true', // True for Azure, False for local dev
        trustServerCertificate: true // Change to false for production with valid certs
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let pool = null;

const connectDB = async () => {
    try {
        if (pool) return pool; // Return existing pool if available

        pool = await sql.connect(dbConfig);
        console.log('✅ Connected to SQL Server successfully');

        pool.on('error', err => {
            console.error('❌ SQL Pool Error:', err);
            pool = null; // Reset pool on error
        });

        return pool;
    } catch (err) {
        console.error('❌ Database connection failed:', err);
        // throw err; // Throw error instead of exit to let the caller handle it or crash safely
        process.exit(1);
    }
};

module.exports = {
    sql,
    connectDB
};
