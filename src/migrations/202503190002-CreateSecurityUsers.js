const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tabla SecurityUsers
 * Usuarios de vigilancia/seguridad creados por el admin de tenant
 */
class CreateSecurityUsers extends Migration {
    async up() {
        const tableExists = await this.tableExists('SecurityUsers');
        
        if (tableExists) {
            console.log('   ⚠️ Tabla SecurityUsers ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE SecurityUsers (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                
                -- Credenciales
                email NVARCHAR(255) NOT NULL,
                password_hash NVARCHAR(255) NOT NULL,
                
                -- Datos personales
                first_name NVARCHAR(100) NOT NULL,
                last_name NVARCHAR(100) NOT NULL,
                phone NVARCHAR(20) NULL,
                
                -- Identificación
                document_type NVARCHAR(20) DEFAULT 'DNI',
                document_number NVARCHAR(20) NULL,
                
                -- Estado
                is_active BIT DEFAULT 1,
                
                -- Quién creó el usuario
                created_by UNIQUEIDENTIFIER NULL,
                
                -- Timestamps
                last_login DATETIME2 NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                
                -- Constraints
                CONSTRAINT UQ_SecurityUsers_Email_Tenant UNIQUE (email, tenant_id),
                CONSTRAINT FK_SecurityUsers_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_SecurityUsers_CreatedBy FOREIGN KEY (created_by) 
                    REFERENCES Users(id) ON DELETE SET NULL
            )
        `);

        // Índices
        await this.query(`
            CREATE INDEX IX_SecurityUsers_Tenant 
            ON SecurityUsers(tenant_id, is_active, created_at)
        `);

        await this.query(`
            CREATE INDEX IX_SecurityUsers_Email 
            ON SecurityUsers(email)
        `);

        console.log('   ✅ Tabla SecurityUsers creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('SecurityUsers');
        
        if (!tableExists) {
            console.log('   ⚠️ Tabla SecurityUsers no existe');
            return;
        }

        await this.query('DROP TABLE IF EXISTS SecurityUsers');
        console.log('   ✅ Tabla SecurityUsers eliminada');
    }
}

module.exports = CreateSecurityUsers;
