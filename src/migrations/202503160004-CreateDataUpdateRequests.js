const Migration = require('./Migration');

/**
 * Migración: Crear tabla DataUpdateRequests
 * Solicitudes de actualización de datos de propietarios hacia Super Admin
 */
class CreateDataUpdateRequests extends Migration {
    async up() {
        const tableExists = await this.tableExists('DataUpdateRequests');
        if (tableExists) {
            console.log('   ⚠️ Tabla DataUpdateRequests ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE DataUpdateRequests (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                user_id UNIQUEIDENTIFIER NOT NULL,
                status NVARCHAR(20) NOT NULL DEFAULT 'PENDING' 
                    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
                old_data NVARCHAR(MAX) NOT NULL,
                new_data NVARCHAR(MAX) NOT NULL,
                requested_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                reviewed_at DATETIME2 NULL,
                reviewed_by UNIQUEIDENTIFIER NULL,
                rejection_reason NVARCHAR(500) NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_DataUpdateRequests_Users FOREIGN KEY (user_id) 
                    REFERENCES Users(id) ON DELETE CASCADE
            )
        `);

        await this.query(`
            CREATE INDEX IX_DataUpdateRequests_Status ON DataUpdateRequests(status)
        `);
        await this.query(`
            CREATE INDEX IX_DataUpdateRequests_User ON DataUpdateRequests(user_id)
        `);
        await this.query(`
            CREATE INDEX IX_DataUpdateRequests_RequestedAt ON DataUpdateRequests(requested_at DESC)
        `);

        console.log('   ✅ Tabla DataUpdateRequests creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('DataUpdateRequests');
        if (!tableExists) {
            console.log('   ⚠️ Tabla DataUpdateRequests no existe');
            return;
        }
        await this.query('DROP TABLE IF EXISTS DataUpdateRequests');
        console.log('   ✅ Tabla DataUpdateRequests eliminada');
    }
}

module.exports = CreateDataUpdateRequests;
