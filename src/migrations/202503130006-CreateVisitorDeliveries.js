const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tabla VisitorDeliveries
 * Registro de delivery/ delivery drivers (Rappi, UberEats, etc.)
 * Acceso rápido sin necesidad de registro completo de visitante
 */
class CreateVisitorDeliveries extends Migration {
    async up() {
        const tableExists = await this.tableExists('VisitorDeliveries');
        
        if (tableExists) {
            console.log('   ⚠️ Tabla VisitorDeliveries ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE VisitorDeliveries (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                
                -- Info del delivery
                company NVARCHAR(50) NULL, -- 'Rappi', 'UberEats', 'PedidosYa', 'Otro'
                driver_name NVARCHAR(100) NULL,
                driver_phone NVARCHAR(20) NULL,
                vehicle_plate NVARCHAR(20) NULL,
                
                -- A quién va dirigido
                property_id UNIQUEIDENTIFIER NULL,
                resident_name NVARCHAR(100) NULL,
                
                -- Estado
                status NVARCHAR(20) DEFAULT 'PENDING' 
                    CHECK (status IN ('PENDING', 'DELIVERED', 'CANCELLED')),
                
                -- Tiempos
                entry_time DATETIME2 DEFAULT SYSDATETIME(),
                exit_time DATETIME2 NULL,
                delivered_at DATETIME2 NULL,
                
                -- Quién registró
                registered_by UNIQUEIDENTIFIER NULL,
                registered_by_type NVARCHAR(20) DEFAULT 'SECURITY',
                
                -- Notas
                notes NVARCHAR(500) NULL,
                package_description NVARCHAR(255) NULL,
                
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                
                -- Constraints
                CONSTRAINT FK_VisitorDeliveries_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_VisitorDeliveries_Properties FOREIGN KEY (property_id) 
                    REFERENCES Properties(id) ON DELETE SET NULL,
                CONSTRAINT FK_VisitorDeliveries_Users FOREIGN KEY (registered_by) 
                    REFERENCES Users(id) ON DELETE SET NULL
            )
        `);

        // Índices
        await this.query(`
            CREATE INDEX IX_VisitorDeliveries_Tenant_Status 
            ON VisitorDeliveries(tenant_id, status, entry_time DESC)
        `);

        await this.query(`
            CREATE INDEX IX_VisitorDeliveries_Property 
            ON VisitorDeliveries(property_id, created_at DESC)
        `);

        await this.query(`
            CREATE INDEX IX_VisitorDeliveries_EntryTime 
            ON VisitorDeliveries(tenant_id, entry_time DESC)
        `);

        console.log('   ✅ Tabla VisitorDeliveries creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('VisitorDeliveries');
        
        if (!tableExists) {
            console.log('   ⚠️ Tabla VisitorDeliveries no existe');
            return;
        }

        await this.query('DROP TABLE IF EXISTS VisitorDeliveries');
        console.log('   ✅ Tabla VisitorDeliveries eliminada');
    }
}

module.exports = CreateVisitorDeliveries;
