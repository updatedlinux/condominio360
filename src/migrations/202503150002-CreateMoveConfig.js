const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tabla TenantMoveConfig
 * Configuración de días y horarios permitidos para mudanzas
 */
class CreateMoveConfig extends Migration {
    async up() {
        const tableExists = await this.tableExists('TenantMoveConfig');
        
        if (tableExists) {
            console.log('   ⚠️ Tabla TenantMoveConfig ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE TenantMoveConfig (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL UNIQUE,
                
                -- Días permitidos (array de números 0-6, donde 0=Domingo)
                allowed_days NVARCHAR(50) NOT NULL DEFAULT '6', -- Por defecto solo sábados (6)
                
                -- Horario permitido
                start_time TIME NOT NULL DEFAULT '08:00',
                end_time TIME NOT NULL DEFAULT '17:00',
                
                -- Antelación mínima requerida (en días)
                min_notice_days INT NOT NULL DEFAULT 7,
                
                -- Máximo de mudanzas por día (0 = ilimitado)
                max_moves_per_day INT NOT NULL DEFAULT 0,
                
                -- Campos adicionales requeridos
                require_insurance BIT DEFAULT 0,
                require_elevator_booking BIT DEFAULT 0,
                
                -- Configuración de notificaciones
                notify_security BIT DEFAULT 1,
                notify_admin BIT DEFAULT 1,
                
                -- Instrucciones adicionales
                additional_instructions NVARCHAR(MAX) NULL,
                
                -- Estado
                is_active BIT DEFAULT 1,
                
                -- Auditoría
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                created_by UNIQUEIDENTIFIER NULL,
                
                CONSTRAINT FK_TenantMoveConfig_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_TenantMoveConfig_Users FOREIGN KEY (created_by) 
                    REFERENCES Users(id) ON DELETE SET NULL
            )
        `);

        // Índices
        await this.query(`
            CREATE INDEX IX_TenantMoveConfig_Tenant ON TenantMoveConfig(tenant_id)
        `);

        console.log('   ✅ Tabla TenantMoveConfig creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('TenantMoveConfig');
        
        if (!tableExists) {
            console.log('   ⚠️ Tabla TenantMoveConfig no existe');
            return;
        }

        await this.query('DROP TABLE IF EXISTS TenantMoveConfig');
        console.log('   ✅ Tabla TenantMoveConfig eliminada');
    }
}

module.exports = CreateMoveConfig;
