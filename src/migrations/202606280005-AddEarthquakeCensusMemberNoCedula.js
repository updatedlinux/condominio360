const Migration = require('./Migration');

class AddEarthquakeCensusMemberNoCedula extends Migration {
    async up() {
        if (!(await this.tableExists('EarthquakeCensusMembers'))) return;

        if (!(await this.columnExists('EarthquakeCensusMembers', 'no_cedula'))) {
            await this.query(`
                ALTER TABLE EarthquakeCensusMembers
                ADD no_cedula BIT NOT NULL CONSTRAINT DF_EarthquakeCensusMembers_no_cedula DEFAULT 0
            `);
            console.log('   ✅ Columna no_cedula agregada');
        }

        await this.query(`
            ALTER TABLE EarthquakeCensusMembers
            ALTER COLUMN cedula NVARCHAR(20) NULL
        `);
        console.log('   ✅ cedula ahora permite NULL (menores sin CI)');
    }

    async down() {
        if (!(await this.tableExists('EarthquakeCensusMembers'))) return;

        await this.query(`
            UPDATE EarthquakeCensusMembers SET cedula = 'SIN-CI' WHERE cedula IS NULL
        `);
        await this.query(`
            ALTER TABLE EarthquakeCensusMembers
            ALTER COLUMN cedula NVARCHAR(20) NOT NULL
        `);

        if (await this.columnExists('EarthquakeCensusMembers', 'no_cedula')) {
            await this.query(`
                ALTER TABLE EarthquakeCensusMembers
                DROP CONSTRAINT IF EXISTS DF_EarthquakeCensusMembers_no_cedula
            `);
            await this.query(`
                ALTER TABLE EarthquakeCensusMembers DROP COLUMN no_cedula
            `);
        }
    }
}

module.exports = AddEarthquakeCensusMemberNoCedula;
