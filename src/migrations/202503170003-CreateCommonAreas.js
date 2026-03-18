const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Sistema de Reservas de Áreas Comunes
 * - CommonAreas: Áreas comunes configurables
 * - CommonAreaReservations: Reservas por propietario
 * - CommonAreaAvailability: Disponibilidad por día/hora (opcional)
 */
class CreateCommonAreas extends Migration {
    async up() {
        const tables = ['CommonAreaReservations', 'CommonAreas'];
        
        for (const table of tables) {
            if (await this.tableExists(table)) {
                console.log(`   ⚠️ Tabla ${table} ya existe, omitiendo...`);
                return;
            }
        }

        // 1. Tabla CommonAreas
        await this.query(`
            CREATE TABLE CommonAreas (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                name NVARCHAR(100) NOT NULL,
                description NVARCHAR(500) NULL,
                type NVARCHAR(50) DEFAULT 'OTHER' CHECK (type IN ('POOL', 'BBQ', 'GYM', 'ROOM', 'TENNIS', 'SOCCER', 'OTHER')),
                capacity INT DEFAULT 1,
                min_hours_advance INT DEFAULT 24,
                max_days_advance INT DEFAULT 30,
                min_duration_hours INT DEFAULT 1,
                max_duration_hours INT DEFAULT 4,
                opening_time TIME DEFAULT '08:00',
                closing_time TIME DEFAULT '20:00',
                requires_approval BIT DEFAULT 0,
                is_active BIT DEFAULT 1,
                image_url NVARCHAR(500) NULL,
                rules NVARCHAR(MAX) NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_CommonAreas_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE
            )
        `);

        // 2. Tabla CommonAreaReservations
        await this.query(`
            CREATE TABLE CommonAreaReservations (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                common_area_id UNIQUEIDENTIFIER NOT NULL,
                property_id UNIQUEIDENTIFIER NOT NULL,
                user_id UNIQUEIDENTIFIER NOT NULL,
                reservation_date DATE NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                num_guests INT DEFAULT 1,
                notes NVARCHAR(500) NULL,
                status NVARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED')),
                approved_by UNIQUEIDENTIFIER NULL,
                approved_at DATETIME2 NULL,
                rejection_reason NVARCHAR(500) NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_Reservations_CommonAreas FOREIGN KEY (common_area_id) 
                    REFERENCES CommonAreas(id) ON DELETE CASCADE,
                CONSTRAINT FK_Reservations_Properties FOREIGN KEY (property_id) 
                    REFERENCES Properties(id),
                CONSTRAINT FK_Reservations_Users FOREIGN KEY (user_id) 
                    REFERENCES Users(id),
                CONSTRAINT FK_Reservations_Approver FOREIGN KEY (approved_by) 
                    REFERENCES Users(id)
            )
        `);

        // Índices
        await this.query(`
            CREATE INDEX IX_CommonAreas_Tenant ON CommonAreas(tenant_id, is_active)
        `);

        await this.query(`
            CREATE INDEX IX_Reservations_Area_Date ON CommonAreaReservations(common_area_id, reservation_date, status)
        `);

        await this.query(`
            CREATE INDEX IX_Reservations_User ON CommonAreaReservations(user_id, reservation_date DESC)
        `);

        await this.query(`
            CREATE INDEX IX_Reservations_Property ON CommonAreaReservations(property_id, reservation_date)
        `);

        // Constraint para evitar overlap de reservas
        await this.query(`
            CREATE UNIQUE INDEX IX_Reservations_NoOverlap 
            ON CommonAreaReservations(common_area_id, reservation_date, start_time, end_time)
            WHERE status IN ('PENDING', 'CONFIRMED')
        `);

        console.log('   ✅ Tablas de Common Areas creadas exitosamente');
    }

    async down() {
        const tables = ['CommonAreaReservations', 'CommonAreas'];
        
        for (const table of tables) {
            if (await this.tableExists(table)) {
                await this.query(`DROP TABLE IF EXISTS ${table}`);
                console.log(`   ✅ Tabla ${table} eliminada`);
            }
        }
    }
}

module.exports = CreateCommonAreas;
