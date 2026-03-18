const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Agregar campos a tabla Users
 * - dni: Documento de identidad nacional (único)
 * - email_verified: Si el email fue verificado
 * - registration_status: Estado del registro
 */
class AddFieldsToUsers extends Migration {
    async up() {
        // 1. Agregar columna dni
        const dniExists = await this.columnExists('Users', 'dni');
        if (!dniExists) {
            await this.query(`
                ALTER TABLE Users 
                ADD dni NVARCHAR(20) NULL
            `);
            console.log('   ✅ Columna dni agregada');
        } else {
            console.log('   ⚠️ Columna dni ya existe');
        }

        // 2. Agregar columna email_verified
        const emailVerifiedExists = await this.columnExists('Users', 'email_verified');
        if (!emailVerifiedExists) {
            await this.query(`
                ALTER TABLE Users 
                ADD email_verified BIT DEFAULT 0
            `);
            console.log('   ✅ Columna email_verified agregada');
        } else {
            console.log('   ⚠️ Columna email_verified ya existe');
        }

        // 3. Agregar columna registration_status
        const registrationStatusExists = await this.columnExists('Users', 'registration_status');
        if (!registrationStatusExists) {
            await this.query(`
                ALTER TABLE Users 
                ADD registration_status NVARCHAR(20) DEFAULT 'PENDING' 
                    CHECK (registration_status IN ('PENDING', 'INVITED', 'ACTIVE', 'SUSPENDED'))
            `);
            console.log('   ✅ Columna registration_status agregada');
        } else {
            console.log('   ⚠️ Columna registration_status ya existe');
        }

        // 4. Agregar columna invited_at (para tracking de invitaciones)
        const invitedAtExists = await this.columnExists('Users', 'invited_at');
        if (!invitedAtExists) {
            await this.query(`
                ALTER TABLE Users 
                ADD invited_at DATETIME2 NULL
            `);
            console.log('   ✅ Columna invited_at agregada');
        } else {
            console.log('   ⚠️ Columna invited_at ya existe');
        }

        // 5. Agregar columna invitation_token
        const invitationTokenExists = await this.columnExists('Users', 'invitation_token');
        if (!invitationTokenExists) {
            await this.query(`
                ALTER TABLE Users 
                ADD invitation_token NVARCHAR(255) NULL
            `);
            console.log('   ✅ Columna invitation_token agregada');
        } else {
            console.log('   ⚠️ Columna invitation_token ya existe');
        }
    }

    async down() {
        // Eliminar columnas en orden inverso
        const columnsToRemove = [
            'invitation_token',
            'invited_at', 
            'registration_status',
            'email_verified',
            'dni'
        ];

        for (const column of columnsToRemove) {
            const exists = await this.columnExists('Users', column);
            if (exists) {
                await this.query(`
                    ALTER TABLE Users 
                    DROP COLUMN ${column}
                `);
                console.log(`   ✅ Columna ${column} eliminada`);
            }
        }
    }
}

module.exports = AddFieldsToUsers;
