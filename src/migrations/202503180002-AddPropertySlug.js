const { connectDB, sql } = require('../config/database');

/**
 * Migration: Add slug column to Properties table
 * El slug se usa para identificar inmuebles de forma única en CSV imports
 */
const Migration = require('./Migration');

/**
 * Migration: Add slug column to Properties table
 * El slug se usa para identificar inmuebles de forma única en CSV imports
 */
class AddPropertySlugMigration extends Migration {
    async up() {
        const pool = await connectDB();
        
        // Add slug column if not exists
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Properties') AND name = 'slug')
            ALTER TABLE Properties ADD slug NVARCHAR(100) NULL
        `);

        // Create index on slug
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Properties_Slug')
            CREATE INDEX IX_Properties_Slug ON Properties(slug)
        `);

        // Populate slug for existing properties
        await pool.request().query(`
            UPDATE Properties 
            SET slug = LOWER(REPLACE(REPLACE(name, ' ', '-'), '.', ''))
            WHERE slug IS NULL
        `);

        console.log('✓ Property slug migration completed');
    }

    async down() {
        const pool = await connectDB();
        
        await pool.request().query(`
            IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Properties') AND name = 'slug')
            ALTER TABLE Properties DROP COLUMN slug
        `);

        console.log('✓ Property slug migration reverted');
    }
}

module.exports = AddPropertySlugMigration;
