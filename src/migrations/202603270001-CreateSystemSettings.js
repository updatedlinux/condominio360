const Migration = require('./Migration');

/**
 * Configuración global (clave API DolarVzla / BCV, etc.)
 */
class CreateSystemSettings extends Migration {
    async up() {
        const exists = await this.tableExists('SystemSettings');
        if (exists) {
            console.log('   ⚠️ Tabla SystemSettings ya existe, omitiendo...');
            return;
        }
        await this.query(`
            CREATE TABLE SystemSettings (
                id INT NOT NULL CONSTRAINT PK_SystemSettings PRIMARY KEY,
                bcv_dolarvzla_api_key NVARCHAR(512) NULL,
                bcv_api_key_updated_at DATETIME2 NULL,
                updated_by UNIQUEIDENTIFIER NULL,
                CONSTRAINT CK_SystemSettings_Singleton CHECK (id = 1),
                CONSTRAINT FK_SystemSettings_UpdatedBy FOREIGN KEY (updated_by) REFERENCES Users(id)
            )
        `);
        await this.query(`INSERT INTO SystemSettings (id) VALUES (1)`);
        console.log('   ✅ Tabla SystemSettings creada');
    }

    async down() {
        if (await this.tableExists('SystemSettings')) {
            await this.query('DROP TABLE SystemSettings');
            console.log('   ✅ Tabla SystemSettings eliminada');
        }
    }
}

module.exports = CreateSystemSettings;
