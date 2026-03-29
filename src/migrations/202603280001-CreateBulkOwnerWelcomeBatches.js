const Migration = require('./Migration');

/**
 * Cola de envío de correos de bienvenida tras carga masiva de propietarios (Super Admin).
 * Los correos no se envían hasta que el admin confirma con el endpoint dedicado.
 */
class CreateBulkOwnerWelcomeBatches extends Migration {
    async up() {
        const tableExists = await this.tableExists('BulkOwnerWelcomeBatches');
        if (tableExists) {
            console.log('   ⚠️ Tabla BulkOwnerWelcomeBatches ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE BulkOwnerWelcomeBatches (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                created_by UNIQUEIDENTIFIER NULL,
                created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                status NVARCHAR(30) NOT NULL DEFAULT 'PENDING_SEND'
                    CHECK (status IN ('PENDING_SEND', 'PROCESSING', 'COMPLETED', 'FAILED')),
                items_json NVARCHAR(MAX) NOT NULL,
                total_items INT NOT NULL DEFAULT 0,
                error_summary NVARCHAR(MAX) NULL,
                started_at DATETIME2 NULL,
                completed_at DATETIME2 NULL,
                CONSTRAINT FK_BulkOwnerWelcomeBatches_Tenants FOREIGN KEY (tenant_id)
                    REFERENCES Tenants(id) ON DELETE CASCADE
            )
        `);

        await this.query(`
            CREATE INDEX IX_BulkOwnerWelcomeBatches_Tenant_Status
            ON BulkOwnerWelcomeBatches(tenant_id, status, created_at DESC)
        `);

        console.log('   ✅ Tabla BulkOwnerWelcomeBatches creada');
    }

    async down() {
        const tableExists = await this.tableExists('BulkOwnerWelcomeBatches');
        if (!tableExists) return;
        await this.query('DROP TABLE BulkOwnerWelcomeBatches');
        console.log('   ✅ Tabla BulkOwnerWelcomeBatches eliminada');
    }
}

module.exports = CreateBulkOwnerWelcomeBatches;
