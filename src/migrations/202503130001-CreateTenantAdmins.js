const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tabla TenantAdmins
 * Usuarios administrativos de la Junta de Condominio
 * Estos usuarios son diferentes a los propietarios
 */
class CreateTenantAdmins extends Migration {
    async up() {
        const tableExists = await this.tableExists('TenantAdmins');
        
        if (tableExists) {
            console.log('   ⚠️ Tabla TenantAdmins ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE TenantAdmins (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                user_id UNIQUEIDENTIFIER NULL,
                
                -- Datos de autenticación independientes
                email NVARCHAR(150) NOT NULL,
                password_hash NVARCHAR(255) NOT NULL,
                first_name NVARCHAR(100) NOT NULL,
                last_name NVARCHAR(100) NOT NULL,
                phone NVARCHAR(20) NULL,
                
                -- Rol administrativo
                role NVARCHAR(20) DEFAULT 'ADMIN' CHECK (role IN ('ADMIN', 'MANAGER', 'ACCOUNTANT')),
                
                -- Estado
                is_active BIT DEFAULT 1,
                last_login DATETIME2 NULL,
                
                -- Auditoría
                created_by UNIQUEIDENTIFIER NOT NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                
                -- Constraints
                CONSTRAINT UQ_TenantAdmins_Email UNIQUE (email),
                CONSTRAINT FK_TenantAdmins_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_TenantAdmins_Users FOREIGN KEY (user_id) 
                    REFERENCES Users(id) ON DELETE SET NULL
            )
        `);

        // Índices
        await this.query(`
            CREATE INDEX IX_TenantAdmins_Tenant ON TenantAdmins(tenant_id) 
            INCLUDE (email, first_name, last_name, is_active, role) 
            WHERE is_active = 1
        `);

        await this.query(`
            CREATE INDEX IX_TenantAdmins_CreatedBy ON TenantAdmins(created_by)
        `);

        console.log('   ✅ Tabla TenantAdmins creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('TenantAdmins');
        
        if (!tableExists) {
            console.log('   ⚠️ Tabla TenantAdmins no existe');
            return;
        }

        await this.query('DROP TABLE IF EXISTS TenantAdmins');
        console.log('   ✅ Tabla TenantAdmins eliminada');
    }
}

module.exports = CreateTenantAdmins;
