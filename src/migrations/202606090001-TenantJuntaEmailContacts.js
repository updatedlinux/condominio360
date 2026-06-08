const Migration = require('./Migration');

/**
 * Contactos frecuentes para correos support → junta (por condominio).
 */
class TenantJuntaEmailContacts extends Migration {
    async up() {
        if (!(await this.tableExists('TenantJuntaEmailContacts'))) {
            await this.query(`
                CREATE TABLE TenantJuntaEmailContacts (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    email NVARCHAR(320) NOT NULL,
                    display_name NVARCHAR(200) NULL,
                    notes NVARCHAR(500) NULL,
                    created_by UNIQUEIDENTIFIER NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    CONSTRAINT FK_TJEC_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                    CONSTRAINT UQ_TJEC_Tenant_Email UNIQUE (tenant_id, email)
                )
            `);
            console.log('   ✅ Tabla TenantJuntaEmailContacts');
        }

        if (!(await this.indexExists('TenantJuntaEmailContacts', 'IX_TJEC_Tenant'))) {
            await this.query(`
                CREATE NONCLUSTERED INDEX IX_TJEC_Tenant
                ON TenantJuntaEmailContacts (tenant_id, display_name)
            `);
        }
    }

    async down() {
        if (await this.tableExists('TenantJuntaEmailContacts')) {
            await this.query('DROP TABLE TenantJuntaEmailContacts');
        }
    }
}

module.exports = TenantJuntaEmailContacts;
