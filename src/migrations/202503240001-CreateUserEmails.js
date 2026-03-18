const Migration = require('./Migration');
const { connectDB, sql } = require('../config/database');

/**
 * Migración: Tabla UserEmails - Correos múltiples por usuario (estilo PayPal)
 * - Un propietario puede tener N correos (primario + secundarios)
 * - El correo primario se mantiene en Users.email para compatibilidad
 * - Los correos secundarios se almacenan aquí
 * - Restricción: ningún correo puede pertenecer a dos propietarios distintos
 */
class CreateUserEmails extends Migration {
    async up() {
        const tableExists = await this.tableExists('UserEmails');
        if (tableExists) {
            console.log('   ⚠️ Tabla UserEmails ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE UserEmails (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                user_id UNIQUEIDENTIFIER NOT NULL,
                email NVARCHAR(255) NOT NULL,
                is_primary BIT DEFAULT 0,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_UserEmails_Users FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
                CONSTRAINT UQ_UserEmails_Email UNIQUE (email)
            )
        `);
        console.log('   ✅ Tabla UserEmails creada');

        // Índice para búsquedas por usuario
        await this.query(`
            CREATE INDEX IX_UserEmails_UserId ON UserEmails(user_id)
        `);
        console.log('   ✅ Índice IX_UserEmails_UserId creado');

        // Migrar emails existentes de Users a UserEmails (como primarios)
        const usersWithEmail = await this.query(`
            SELECT id, email FROM Users WHERE email IS NOT NULL AND LTRIM(RTRIM(email)) != ''
        `);

        if (usersWithEmail.recordset.length > 0) {
            const pool = await connectDB();
            for (const row of usersWithEmail.recordset) {
                try {
                    await pool.request()
                        .input('user_id', sql.UniqueIdentifier, row.id)
                        .input('email', sql.NVarChar, row.email)
                        .query(`
                            INSERT INTO UserEmails (user_id, email, is_primary)
                            SELECT @user_id, @email, 1
                            WHERE NOT EXISTS (SELECT 1 FROM UserEmails WHERE user_id = @user_id AND email = @email)
                        `);
                } catch (e) {
                    // Si falla por duplicado, ignorar (ya migrado)
                }
            }
            console.log(`   ✅ Migrados ${usersWithEmail.recordset.length} emails a UserEmails`);
        }
    }

    async down() {
        const tableExists = await this.tableExists('UserEmails');
        if (!tableExists) {
            console.log('   ⚠️ Tabla UserEmails no existe');
            return;
        }
        await this.query('DROP TABLE UserEmails');
        console.log('   ✅ Tabla UserEmails eliminada');
    }
}

module.exports = CreateUserEmails;
