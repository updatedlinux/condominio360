const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { sql, connectDB } = require('./src/config/database');

async function check() {
    try {
        const pool = await connectDB();
        console.log('✅ Connected.');

        // 1. Check Requests Table Columns
        const columns = await pool.request().query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'Requests'
        `);
        console.log('Requests Columns:', columns.recordset.map(c => c.COLUMN_NAME));

        // 2. Check RequestTypes Content
        const types = await pool.request().query('SELECT * FROM RequestTypes');
        console.log('RequestTypes Rows:', types.recordset);

        // 3. Check Tenant ID
        const tenants = await pool.request().query("SELECT id, slug FROM Tenants WHERE slug = 'demo'");
        console.log('Demo Tenant:', tenants.recordset);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
