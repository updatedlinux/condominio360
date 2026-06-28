const Migration = require('./Migration');

class AddEarthquakeCensusPhotoZip extends Migration {
    async up() {
        if (!(await this.tableExists('EarthquakeCensusSubmissions'))) return;

        if (!(await this.columnExists('EarthquakeCensusSubmissions', 'photos_zip_token'))) {
            await this.query(`
                ALTER TABLE EarthquakeCensusSubmissions
                ADD photos_zip_token NVARCHAR(64) NULL,
                    photos_zip_path NVARCHAR(500) NULL,
                    photos_zip_updated_at DATETIME2 NULL
            `);
            await this.query(`
                CREATE UNIQUE INDEX UX_EarthquakeCensusSubmissions_PhotoZipToken
                ON EarthquakeCensusSubmissions(photos_zip_token)
                WHERE photos_zip_token IS NOT NULL
            `);
            console.log('   ✅ Columnas photos_zip_* agregadas');
        }
    }

    async down() {
        if (!(await this.tableExists('EarthquakeCensusSubmissions'))) return;
        if (await this.columnExists('EarthquakeCensusSubmissions', 'photos_zip_token')) {
            await this.query(`
                DROP INDEX IF EXISTS UX_EarthquakeCensusSubmissions_PhotoZipToken ON EarthquakeCensusSubmissions
            `);
            await this.query(`
                ALTER TABLE EarthquakeCensusSubmissions
                DROP COLUMN photos_zip_token, photos_zip_path, photos_zip_updated_at
            `);
        }
    }
}

module.exports = AddEarthquakeCensusPhotoZip;
