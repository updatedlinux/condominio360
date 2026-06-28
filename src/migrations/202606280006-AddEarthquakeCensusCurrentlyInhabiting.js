const Migration = require('./Migration');

class AddEarthquakeCensusCurrentlyInhabiting extends Migration {
    async up() {
        if (!(await this.tableExists('EarthquakeCensusSubmissions'))) return;

        if (!(await this.columnExists('EarthquakeCensusSubmissions', 'currently_inhabiting'))) {
            await this.query(`
                ALTER TABLE EarthquakeCensusSubmissions
                ADD currently_inhabiting BIT NOT NULL
                    CONSTRAINT DF_EarthquakeCensusSubmissions_currently_inhabiting DEFAULT 1
            `);
            console.log('   ✅ Columna currently_inhabiting agregada (registros previos = habita)');
        }
    }

    async down() {
        if (!(await this.tableExists('EarthquakeCensusSubmissions'))) return;
        if (await this.columnExists('EarthquakeCensusSubmissions', 'currently_inhabiting')) {
            await this.query(`
                ALTER TABLE EarthquakeCensusSubmissions
                DROP CONSTRAINT IF EXISTS DF_EarthquakeCensusSubmissions_currently_inhabiting
            `);
            await this.query(`
                ALTER TABLE EarthquakeCensusSubmissions DROP COLUMN currently_inhabiting
            `);
        }
    }
}

module.exports = AddEarthquakeCensusCurrentlyInhabiting;
