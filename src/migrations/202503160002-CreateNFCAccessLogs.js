const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tabla NFC_AccessLogs
 * Registro de accesos usando tarjetas NFC
 */
class CreateNFCAccessLogs extends Migration {
    async up() {
        const tableExists = await this.tableExists('NFC_AccessLogs');
        
        if (tableExists) {
            console.log('   ⚠️ Tabla NFC_AccessLogs ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE NFC_AccessLogs (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                
                -- Tarjeta utilizada
                nfc_card_id UNIQUEIDENTIFIER NULL, -- Puede ser NULL si el UID no está registrado
                card_uid NVARCHAR(50) NOT NULL,    -- UID escaneado
                
                -- Unidad asociada (si la tarjeta está registrada)
                property_id UNIQUEIDENTIFIER NULL,
                
                -- Tipo de acceso
                access_type NVARCHAR(20) NOT NULL CHECK (access_type IN ('ENTRY', 'EXIT')),
                
                -- Resultado de la validación
                status NVARCHAR(20) NOT NULL CHECK (status IN ('GRANTED', 'DENIED', 'ERROR')),
                denial_reason NVARCHAR(255) NULL, -- Si fue denegado, por qué
                
                -- Información del propietario (para mostrar en pantalla)
                owner_name NVARCHAR(200) NULL,
                property_name NVARCHAR(100) NULL,
                
                -- Quién registró el acceso (vigilancia)
                registered_by UNIQUEIDENTIFIER NULL,
                
                -- Metadata del dispositivo/lectura
                device_info NVARCHAR(255) NULL, -- Info del dispositivo NFC usado
                
                -- Timestamps
                access_time DATETIME2 DEFAULT SYSDATETIME(),
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                
                -- Constraints (sin FK a Users para evitar dependencia circular)
                CONSTRAINT FK_NFC_AccessLogs_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE
            )
        `);

        // Índices para consultas frecuentes
        await this.query(`
            CREATE INDEX IX_NFC_AccessLogs_Tenant_Time ON NFC_AccessLogs(tenant_id, access_time DESC)
        `);

        await this.query(`
            CREATE INDEX IX_NFC_AccessLogs_Card ON NFC_AccessLogs(nfc_card_id, access_time DESC)
        `);

        await this.query(`
            CREATE INDEX IX_NFC_AccessLogs_Property ON NFC_AccessLogs(property_id, access_time DESC)
        `);

        await this.query(`
            CREATE INDEX IX_NFC_AccessLogs_Status ON NFC_AccessLogs(status, access_time DESC)
        `);

        console.log('   ✅ Tabla NFC_AccessLogs creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('NFC_AccessLogs');
        
        if (!tableExists) {
            console.log('   ⚠️ Tabla NFC_AccessLogs no existe');
            return;
        }

        await this.query('DROP TABLE IF EXISTS NFC_AccessLogs');
        console.log('   ✅ Tabla NFC_AccessLogs eliminada');
    }
}

module.exports = CreateNFCAccessLogs;
