const Migration = require('./Migration');

/**
 * Migración: Notificaciones in-app (mensajes cortos para propietarios)
 * Max 250 caracteres, draft/scheduled/sent, WhatsApp placeholder
 */
class CreateInAppNotifications extends Migration {
    async up() {
        if (await this.tableExists('InAppNotifications')) {
            console.log('   ⚠️ Tabla InAppNotifications ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE InAppNotifications (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                created_by UNIQUEIDENTIFIER NOT NULL,
                message NVARCHAR(250) NOT NULL,
                status NVARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'SENT')),
                scheduled_at DATETIME2 NULL,
                sent_at DATETIME2 NULL,
                send_whatsapp BIT DEFAULT 0,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_InAppNotifications_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_InAppNotifications_CreatedBy FOREIGN KEY (created_by) 
                    REFERENCES TenantAdmins(id)
            )
        `);

        await this.query(`
            CREATE INDEX IX_InAppNotifications_Tenant_Status ON InAppNotifications(tenant_id, status, sent_at DESC)
        `);

        await this.query(`
            CREATE INDEX IX_InAppNotifications_Scheduled ON InAppNotifications(scheduled_at) 
            WHERE status = 'SCHEDULED' AND scheduled_at IS NOT NULL
        `);

        console.log('   ✅ Tabla InAppNotifications creada exitosamente');
    }

    async down() {
        if (await this.tableExists('InAppNotifications')) {
            await this.query('DROP TABLE InAppNotifications');
            console.log('   ✅ Tabla InAppNotifications eliminada');
        }
    }
}

module.exports = CreateInAppNotifications;
