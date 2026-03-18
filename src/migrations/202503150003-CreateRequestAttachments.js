const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tabla RequestAttachments
 * Para almacenar archivos adjuntos en solicitudes
 */
class CreateRequestAttachments extends Migration {
    async up() {
        const tableExists = await this.tableExists('RequestAttachments');
        
        if (tableExists) {
            console.log('   ⚠️ Tabla RequestAttachments ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE RequestAttachments (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                request_id UNIQUEIDENTIFIER NOT NULL,
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                
                -- Información del archivo
                original_name NVARCHAR(255) NOT NULL,
                file_name NVARCHAR(255) NOT NULL UNIQUE,
                file_path NVARCHAR(500) NOT NULL,
                file_size INT NOT NULL, -- en bytes
                mime_type NVARCHAR(100) NOT NULL,
                
                -- Quién subió
                uploaded_by UNIQUEIDENTIFIER NOT NULL,
                uploaded_by_type NVARCHAR(20) DEFAULT 'OWNER' CHECK (uploaded_by_type IN ('OWNER', 'ADMIN', 'SYSTEM')),
                
                -- Metadata
                description NVARCHAR(500) NULL,
                
                -- Timestamps
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                
                -- Constraints
                CONSTRAINT FK_RequestAttachments_Requests FOREIGN KEY (request_id) 
                    REFERENCES Requests(id) ON DELETE CASCADE,
                CONSTRAINT FK_RequestAttachments_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_RequestAttachments_Users FOREIGN KEY (uploaded_by) 
                    REFERENCES Users(id) ON DELETE CASCADE
            )
        `);

        // Índices
        await this.query(`
            CREATE INDEX IX_RequestAttachments_Request ON RequestAttachments(request_id)
        `);

        await this.query(`
            CREATE INDEX IX_RequestAttachments_Tenant ON RequestAttachments(tenant_id)
        `);

        console.log('   ✅ Tabla RequestAttachments creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('RequestAttachments');
        
        if (!tableExists) {
            console.log('   ⚠️ Tabla RequestAttachments no existe');
            return;
        }

        await this.query('DROP TABLE IF EXISTS RequestAttachments');
        console.log('   ✅ Tabla RequestAttachments eliminada');
    }
}

module.exports = CreateRequestAttachments;
