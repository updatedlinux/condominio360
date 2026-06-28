const Migration = require('./Migration');

class AddEarthquakeCensusContactEmail extends Migration {
    async up() {
        if (!(await this.tableExists('EarthquakeCensusSubmissions'))) return;

        if (!(await this.columnExists('EarthquakeCensusSubmissions', 'contact_email'))) {
            await this.query(`
                ALTER TABLE EarthquakeCensusSubmissions
                ADD contact_email NVARCHAR(255) NULL
            `);
            console.log('   ✅ Columna contact_email agregada');
        }

        if (!(await this.indexExists('EarthquakeCensusSubmissions', 'UX_EarthquakeCensusSubmissions_Tenant_Manual_Unit'))) {
            await this.query(`
                CREATE UNIQUE INDEX UX_EarthquakeCensusSubmissions_Tenant_Manual_Unit
                ON EarthquakeCensusSubmissions(tenant_id, building_label, apartment_label)
                WHERE property_id IS NULL
            `);
            console.log('   ✅ Índice único para unidades manuales');
        }
    }

    async indexExists(table, indexName) {
        const result = await this.query(`
            SELECT 1 AS ok FROM sys.indexes i
            INNER JOIN sys.objects o ON i.object_id = o.object_id
            WHERE o.name = '${table}' AND i.name = '${indexName}'
        `);
        return result.recordset.length > 0;
    }

    async down() {
        if (!(await this.tableExists('EarthquakeCensusSubmissions'))) return;
        if (await this.indexExists('EarthquakeCensusSubmissions', 'UX_EarthquakeCensusSubmissions_Tenant_Manual_Unit')) {
            await this.query('DROP INDEX UX_EarthquakeCensusSubmissions_Tenant_Manual_Unit ON EarthquakeCensusSubmissions');
        }
        if (await this.columnExists('EarthquakeCensusSubmissions', 'contact_email')) {
            await this.query('ALTER TABLE EarthquakeCensusSubmissions DROP COLUMN contact_email');
        }
    }
}

module.exports = AddEarthquakeCensusContactEmail;
