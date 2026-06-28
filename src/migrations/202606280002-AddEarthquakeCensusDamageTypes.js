const Migration = require('./Migration');

/**
 * Daños al inmueble en censo terremoto (checks opcionales + notas).
 */
class AddEarthquakeCensusDamageTypes extends Migration {
    async up() {
        if (!(await this.tableExists('EarthquakeCensusSubmissions'))) {
            console.log('   ⚠️ EarthquakeCensusSubmissions no existe, omitiendo...');
            return;
        }

        if (!(await this.columnExists('EarthquakeCensusSubmissions', 'damage_types'))) {
            await this.query(`
                ALTER TABLE EarthquakeCensusSubmissions
                ADD damage_types NVARCHAR(MAX) NULL,
                    damage_notes NVARCHAR(500) NULL
            `);
            console.log('   ✅ Columnas damage_types y damage_notes agregadas');
        }
    }

    async down() {
        if (!(await this.tableExists('EarthquakeCensusSubmissions'))) return;

        if (await this.columnExists('EarthquakeCensusSubmissions', 'damage_types')) {
            await this.query(`
                ALTER TABLE EarthquakeCensusSubmissions
                DROP COLUMN damage_types, damage_notes
            `);
        }
    }
}

module.exports = AddEarthquakeCensusDamageTypes;
