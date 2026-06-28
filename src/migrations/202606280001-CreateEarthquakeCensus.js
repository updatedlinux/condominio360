const Migration = require('./Migration');

/**
 * Censo de emergencia — datos solicitados por Protección Civil (terremoto Venezuela).
 */
class CreateEarthquakeCensus extends Migration {
    async up() {
        if (!(await this.tableExists('EarthquakeCensusSubmissions'))) {
            await this.query(`
                CREATE TABLE EarthquakeCensusSubmissions (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    property_id UNIQUEIDENTIFIER NULL,
                    building_label NVARCHAR(200) NOT NULL,
                    apartment_label NVARCHAR(100) NOT NULL,
                    contact_phone NVARCHAR(30) NOT NULL,
                    notes NVARCHAR(1000) NULL,
                    submitted_at DATETIME2 DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_EarthquakeCensusSubmissions_Tenants FOREIGN KEY (tenant_id)
                        REFERENCES Tenants(id) ON DELETE CASCADE,
                    CONSTRAINT FK_EarthquakeCensusSubmissions_Properties FOREIGN KEY (property_id)
                        REFERENCES Properties(id) ON DELETE SET NULL
                )
            `);

            await this.query(`
                CREATE UNIQUE INDEX UX_EarthquakeCensusSubmissions_Tenant_Property
                ON EarthquakeCensusSubmissions(tenant_id, property_id)
                WHERE property_id IS NOT NULL
            `);

            await this.query(`
                CREATE INDEX IX_EarthquakeCensusSubmissions_Tenant
                ON EarthquakeCensusSubmissions(tenant_id, submitted_at DESC)
            `);

            console.log('   ✅ Tabla EarthquakeCensusSubmissions creada');
        }

        if (!(await this.tableExists('EarthquakeCensusMembers'))) {
            await this.query(`
                CREATE TABLE EarthquakeCensusMembers (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    submission_id UNIQUEIDENTIFIER NOT NULL,
                    first_name NVARCHAR(120) NOT NULL,
                    last_name NVARCHAR(120) NOT NULL,
                    cedula NVARCHAR(20) NOT NULL,
                    age INT NULL,
                    birth_date DATE NULL,
                    occupation_education NVARCHAR(200) NULL,
                    has_disability BIT NOT NULL DEFAULT 0,
                    disability_notes NVARCHAR(500) NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    CONSTRAINT FK_EarthquakeCensusMembers_Submissions FOREIGN KEY (submission_id)
                        REFERENCES EarthquakeCensusSubmissions(id) ON DELETE CASCADE
                )
            `);

            await this.query(`
                CREATE INDEX IX_EarthquakeCensusMembers_Submission
                ON EarthquakeCensusMembers(submission_id, sort_order)
            `);

            console.log('   ✅ Tabla EarthquakeCensusMembers creada');
        }

        if (!(await this.tableExists('EarthquakeCensusPhotos'))) {
            await this.query(`
                CREATE TABLE EarthquakeCensusPhotos (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    submission_id UNIQUEIDENTIFIER NOT NULL,
                    file_path NVARCHAR(500) NOT NULL,
                    original_name NVARCHAR(255) NULL,
                    uploaded_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_EarthquakeCensusPhotos_Submissions FOREIGN KEY (submission_id)
                        REFERENCES EarthquakeCensusSubmissions(id) ON DELETE CASCADE
                )
            `);

            await this.query(`
                CREATE INDEX IX_EarthquakeCensusPhotos_Submission
                ON EarthquakeCensusPhotos(submission_id)
            `);

            console.log('   ✅ Tabla EarthquakeCensusPhotos creada');
        }
    }

    async down() {
        if (await this.tableExists('EarthquakeCensusPhotos')) {
            await this.query('DROP TABLE EarthquakeCensusPhotos');
        }
        if (await this.tableExists('EarthquakeCensusMembers')) {
            await this.query('DROP TABLE EarthquakeCensusMembers');
        }
        if (await this.tableExists('EarthquakeCensusSubmissions')) {
            await this.query('DROP TABLE EarthquakeCensusSubmissions');
        }
        console.log('   ✅ Tablas de censo terremoto eliminadas');
    }
}

module.exports = CreateEarthquakeCensus;
