const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Sistema de Comunicados/Cartas
 * - Communications: Comunicados masivos
 * - CommunicationRecipients: Destinatarios y estado de lectura
 */
class CreateCommunications extends Migration {
    async up() {
        const tables = ['CommunicationRecipients', 'Communications'];
        
        for (const table of tables) {
            if (await this.tableExists(table)) {
                console.log(`   ⚠️ Tabla ${table} ya existe, omitiendo...`);
                return;
            }
        }

        // 1. Tabla Communications
        await this.query(`
            CREATE TABLE Communications (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                created_by UNIQUEIDENTIFIER NOT NULL,
                title NVARCHAR(200) NOT NULL,
                content NVARCHAR(MAX) NOT NULL,
                category NVARCHAR(50) DEFAULT 'GENERAL' CHECK (category IN ('GENERAL', 'MANTENIMIENTO', 'FINANCIERO', 'SEGURIDAD', 'SOCIAL', 'URGENCIA')),
                priority NVARCHAR(20) DEFAULT 'NORMAL' CHECK (priority IN ('BAJA', 'NORMAL', 'ALTA', 'URGENTE')),
                target_type NVARCHAR(20) DEFAULT 'ALL' CHECK (target_type IN ('ALL', 'BUILDING', 'PROPERTY', 'SPECIFIC')),
                target_building NVARCHAR(100) NULL,
                target_property_id UNIQUEIDENTIFIER NULL,
                send_email BIT DEFAULT 0,
                email_sent_at DATETIME2 NULL,
                status NVARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
                published_at DATETIME2 NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_Communications_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_Communications_Users FOREIGN KEY (created_by) 
                    REFERENCES Users(id),
                CONSTRAINT FK_Communications_Properties FOREIGN KEY (target_property_id) 
                    REFERENCES Properties(id) ON DELETE SET NULL
            )
        `);

        // 2. Tabla CommunicationRecipients
        await this.query(`
            CREATE TABLE CommunicationRecipients (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                communication_id UNIQUEIDENTIFIER NOT NULL,
                user_id UNIQUEIDENTIFIER NOT NULL,
                read_at DATETIME2 NULL,
                email_delivered BIT DEFAULT 0,
                email_delivered_at DATETIME2 NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT UQ_CommunicationRecipients UNIQUE (communication_id, user_id),
                CONSTRAINT FK_CommRecipients_Communications FOREIGN KEY (communication_id) 
                    REFERENCES Communications(id) ON DELETE CASCADE,
                CONSTRAINT FK_CommRecipients_Users FOREIGN KEY (user_id) 
                    REFERENCES Users(id) ON DELETE CASCADE
            )
        `);

        // Índices
        await this.query(`
            CREATE INDEX IX_Communications_Tenant_Status ON Communications(tenant_id, status, created_at DESC)
        `);

        await this.query(`
            CREATE INDEX IX_Communications_Category ON Communications(tenant_id, category) WHERE status = 'PUBLISHED'
        `);

        await this.query(`
            CREATE INDEX IX_CommRecipients_User ON CommunicationRecipients(user_id, read_at)
        `);

        console.log('   ✅ Tablas de Communications creadas exitosamente');
    }

    async down() {
        const tables = ['CommunicationRecipients', 'Communications'];
        
        for (const table of tables) {
            if (await this.tableExists(table)) {
                await this.query(`DROP TABLE IF EXISTS ${table}`);
                console.log(`   ✅ Tabla ${table} eliminada`);
            }
        }
    }
}

module.exports = CreateCommunications;
