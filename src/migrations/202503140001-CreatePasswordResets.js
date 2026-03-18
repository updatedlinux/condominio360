const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tabla PasswordResets
 * Para almacenar tokens de recuperación de contraseña
 */
class CreatePasswordResets extends Migration {
    async up() {
        const tableExists = await this.tableExists('PasswordResets');
        
        if (tableExists) {
            console.log('   ⚠️ Tabla PasswordResets ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE PasswordResets (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                user_id UNIQUEIDENTIFIER NOT NULL,
                user_type NVARCHAR(20) NOT NULL DEFAULT 'OWNER' CHECK (user_type IN ('OWNER', 'TENANT_ADMIN', 'SUPERADMIN')),
                token NVARCHAR(255) NOT NULL UNIQUE,
                expires_at DATETIME2 NOT NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                used_at DATETIME2 NULL
            )
        `);

        // Índices
        await this.query(`
            CREATE INDEX IX_PasswordResets_Token ON PasswordResets(token)
        `);

        await this.query(`
            CREATE INDEX IX_PasswordResets_User ON PasswordResets(user_id, user_type)
        `);

        await this.query(`
            CREATE INDEX IX_PasswordResets_Expires ON PasswordResets(expires_at)
        `);

        console.log('   ✅ Tabla PasswordResets creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('PasswordResets');
        
        if (!tableExists) {
            console.log('   ⚠️ Tabla PasswordResets no existe');
            return;
        }

        await this.query('DROP TABLE IF EXISTS PasswordResets');
        console.log('   ✅ Tabla PasswordResets eliminada');
    }
}

module.exports = CreatePasswordResets;
