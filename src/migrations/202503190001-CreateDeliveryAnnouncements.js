const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tabla DeliveryAnnouncements
 * Permite a los propietarios anunciar deliveries/encomiendas anticipadamente
 */
class CreateDeliveryAnnouncements extends Migration {
    async up() {
        const tableExists = await this.tableExists('DeliveryAnnouncements');
        
        if (tableExists) {
            console.log('   ⚠️ Tabla DeliveryAnnouncements ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE DeliveryAnnouncements (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                property_id UNIQUEIDENTIFIER NOT NULL,
                user_id UNIQUEIDENTIFIER NOT NULL,
                
                -- Info del delivery
                name NVARCHAR(200) NOT NULL, -- Nombre del delivery/encomienda
                company NVARCHAR(200) NOT NULL, -- Empresa (Amazon, MercadoLibre, etc.)
                tracking_number NVARCHAR(100) NULL, -- Número de tracking opcional
                
                -- Fechas
                expected_date DATE NOT NULL, -- Fecha esperada de llegada
                announced_at DATETIME2 DEFAULT SYSDATETIME(),
                
                -- Estado
                status NVARCHAR(20) DEFAULT 'ANNOUNCED'
                    CHECK (status IN ('ANNOUNCED', 'ARRIVED', 'DELIVERED', 'CANCELLED')),
                
                -- Cuando llegó
                arrival_time DATETIME2 NULL,
                delivered_at DATETIME2 NULL,
                
                -- Quién registró la llegada (security)
                received_by UNIQUEIDENTIFIER NULL,
                
                -- Notas adicionales
                notes NVARCHAR(500) NULL,
                
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                
                -- Constraints
                CONSTRAINT FK_DeliveryAnnouncements_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_DeliveryAnnouncements_Properties FOREIGN KEY (property_id) 
                    REFERENCES Properties(id) ON DELETE CASCADE,
                CONSTRAINT FK_DeliveryAnnouncements_Users FOREIGN KEY (user_id) 
                    REFERENCES Users(id) ON DELETE CASCADE,
                CONSTRAINT FK_DeliveryAnnouncements_ReceivedBy FOREIGN KEY (received_by) 
                    REFERENCES Users(id) ON DELETE SET NULL
            )
        `);

        // Índices
        await this.query(`
            CREATE INDEX IX_DeliveryAnnouncements_Tenant_Status 
            ON DeliveryAnnouncements(tenant_id, status, expected_date)
        `);

        await this.query(`
            CREATE INDEX IX_DeliveryAnnouncements_Property 
            ON DeliveryAnnouncements(property_id, status, created_at DESC)
        `);

        await this.query(`
            CREATE INDEX IX_DeliveryAnnouncements_User 
            ON DeliveryAnnouncements(user_id, status, created_at DESC)
        `);

        await this.query(`
            CREATE INDEX IX_DeliveryAnnouncements_ExpectedDate 
            ON DeliveryAnnouncements(tenant_id, expected_date, status)
        `);

        console.log('   ✅ Tabla DeliveryAnnouncements creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('DeliveryAnnouncements');
        
        if (!tableExists) {
            console.log('   ⚠️ Tabla DeliveryAnnouncements no existe');
            return;
        }

        await this.query('DROP TABLE IF EXISTS DeliveryAnnouncements');
        console.log('   ✅ Tabla DeliveryAnnouncements eliminada');
    }
}

module.exports = CreateDeliveryAnnouncements;
