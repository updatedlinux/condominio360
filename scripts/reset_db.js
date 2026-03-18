require('dotenv').config();
const { connectDB } = require('../src/config/database');

const resetDb = async () => {
    let pool;
    try {
        console.log('⚠️  STARTING DATABASE RESET (DROP ALL TABLES) ⚠️');
        pool = await connectDB();

        // 1. Drop Foreign Keys
        const dropFksQuery = `
            DECLARE @sql NVARCHAR(MAX) = N'';
            SELECT @sql += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id))
                + '.' + QUOTENAME(OBJECT_NAME(parent_object_id)) + 
                ' DROP CONSTRAINT ' + QUOTENAME(name) + ';' + CHAR(13)
            FROM sys.foreign_keys;
            EXEC sp_executesql @sql;
        `;
        await pool.request().query(dropFksQuery);
        console.log('✅ Foreign Keys Dropped.');

        // 2. Drop Tables
        const dropTablesQuery = `
            DECLARE @sql NVARCHAR(MAX) = N'';
            SELECT @sql += N'DROP TABLE ' + QUOTENAME(TABLE_SCHEMA) + '.' + QUOTENAME(TABLE_NAME) + ';' + CHAR(13)
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE';
            EXEC sp_executesql @sql;
        `;
        await pool.request().query(dropTablesQuery);
        console.log('✅ Tables Dropped.');

        console.log('✨ Database Reset Complete.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Reset failed:', error);
        process.exit(1);
    }
};

resetDb();
