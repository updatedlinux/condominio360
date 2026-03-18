const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tabla AuditLogs
 * Registro de auditoría de acciones importantes del sistema
 */
class CreateAuditLogs extends Migration {
    async up() {
        const tableExists = await this.tableExists('AuditLogs');
        
        if (tableExists) {
            console.log('   ⚠️ Tabla AuditLogs ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE AuditLogs (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NULL,
                
                -- Quién realizó la acción
                actor_id UNIQUEIDENTIFIER NULL,
                actor_type NVARCHAR(20) DEFAULT 'SYSTEM' CHECK (actor_type IN ('USER', 'TENANT_ADMIN', 'SYSTEM', 'API')),
                actor_email NVARCHAR(150) NULL,
                
                -- Qué acción se realizó
                action NVARCHAR(50) NOT NULL,
                entity_type NVARCHAR(50) NOT NULL,
                entity_id NVARCHAR(100) NULL,
                
                -- Detalles
                description NVARCHAR(500) NULL,
                old_values NVARCHAR(MAX) NULL,
                new_values NVARCHAR(MAX) NULL,
                
                -- Contexto
                ip_address NVARCHAR(45) NULL,
                user_agent NVARCHAR(500) NULL,
                
                -- Metadata
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                
                -- Constraints
                CONSTRAINT FK_AuditLogs_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE SET NULL
            )
        `);

        // Índices para consultas comunes
        await this.query(`
            CREATE INDEX IX_AuditLogs_Tenant_Entity 
            ON AuditLogs(tenant_id, entity_type, created_at DESC)
        `);

        await this.query(`
            CREATE INDEX IX_AuditLogs_Actor 
            ON AuditLogs(actor_id, actor_type, created_at DESC)
        `);

        await this.query(`
            CREATE INDEX IX_AuditLogs_Action 
            ON AuditLogs(action, created_at DESC)
        `);

        await this.query(`
            CREATE INDEX IX_AuditLogs_CreatedAt 
            ON AuditLogs(created_at DESC)
        `);

        console.log('   ✅ Tabla AuditLogs creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('AuditLogs');
        
        if (!tableExists) {
            console.log('   ⚠️ Tabla AuditLogs no existe');
            return;
        }

        await this.query('DROP TABLE IF EXISTS AuditLogs');
        console.log('   ✅ Tabla AuditLogs eliminada');
    }
}

module.exports = CreateAuditLogs;
