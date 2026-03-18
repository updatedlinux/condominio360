const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear índices y modificar constraints en Users
 * - Índice único en DNI (cuando no es NULL)
 * - Índice en invitation_token para búsquedas rápidas
 * - Modificar email para permitir NULL temporalmente durante invitaciones
 */
class CreateDniIndexAndModifyUsers extends Migration {
    async up() {
        // 1. Crear índice único en DNI (solo para valores no NULL)
        const dniIndexExists = await this.indexExists('Users', 'IX_Users_Dni_Unique');
        if (!dniIndexExists) {
            // Primero verificar que no hay DNIs duplicados
            const checkDuplicates = await this.query(`
                SELECT dni, COUNT(*) as count 
                FROM Users 
                WHERE dni IS NOT NULL 
                GROUP BY dni 
                HAVING COUNT(*) > 1
            `);

            if (checkDuplicates.recordset.length > 0) {
                throw new Error(`Hay ${checkDuplicates.recordset.length} DNIs duplicados. Resuelve antes de crear el índice único.`);
            }

            await this.query(`
                CREATE UNIQUE INDEX IX_Users_Dni_Unique 
                ON Users(dni) 
                WHERE dni IS NOT NULL
            `);
            console.log('   ✅ Índice único IX_Users_Dni_Unique creado');
        } else {
            console.log('   ⚠️ Índice IX_Users_Dni_Unique ya existe');
        }

        // 2. Crear índice en invitation_token
        const tokenIndexExists = await this.indexExists('Users', 'IX_Users_InvitationToken');
        if (!tokenIndexExists) {
            await this.query(`
                CREATE INDEX IX_Users_InvitationToken 
                ON Users(invitation_token) 
                WHERE invitation_token IS NOT NULL
            `);
            console.log('   ✅ Índice IX_Users_InvitationToken creado');
        } else {
            console.log('   ⚠️ Índice IX_Users_InvitationToken ya existe');
        }

        // 3. Crear índice en registration_status para filtros
        const statusIndexExists = await this.indexExists('Users', 'IX_Users_RegistrationStatus');
        if (!statusIndexExists) {
            await this.query(`
                CREATE INDEX IX_Users_RegistrationStatus 
                ON Users(registration_status)
            `);
            console.log('   ✅ Índice IX_Users_RegistrationStatus creado');
        } else {
            console.log('   ⚠️ Índice IX_Users_RegistrationStatus ya existe');
        }

        // 4. Agregar índice en email que excluya NULLs (para permitir invitaciones pendientes)
        // Primero verificar si existe el constraint UNIQUE actual
        const emailConstraintExists = await this.query(`
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
            WHERE TABLE_NAME = 'Users' 
            AND CONSTRAINT_NAME = 'UQ_Users_Email'
        `);

        if (emailConstraintExists.recordset[0].count > 0) {
            // Eliminar constraint existente
            await this.query(`
                ALTER TABLE Users 
                DROP CONSTRAINT UQ_Users_Email
            `);
            console.log('   ✅ Constraint UQ_Users_Email eliminado');
        }

        // Crear índice único filtrado (solo emails no NULL)
        const emailIndexExists = await this.indexExists('Users', 'IX_Users_Email_Unique');
        if (!emailIndexExists) {
            await this.query(`
                CREATE UNIQUE INDEX IX_Users_Email_Unique 
                ON Users(email) 
                WHERE email IS NOT NULL
            `);
            console.log('   ✅ Índice único IX_Users_Email_Unique creado (permite NULL)');
        } else {
            console.log('   ⚠️ Índice IX_Users_Email_Unique ya existe');
        }
    }

    async down() {
        // Eliminar índices en orden inverso
        const indexes = [
            'IX_Users_Email_Unique',
            'IX_Users_RegistrationStatus',
            'IX_Users_InvitationToken',
            'IX_Users_Dni_Unique'
        ];

        for (const indexName of indexes) {
            const exists = await this.indexExists('Users', indexName);
            if (exists) {
                await this.query(`DROP INDEX IF EXISTS ${indexName} ON Users`);
                console.log(`   ✅ Índice ${indexName} eliminado`);
            }
        }

        // Restaurar constraint UNIQUE original en email (si hay datos)
        const constraintExists = await this.query(`
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
            WHERE TABLE_NAME = 'Users' 
            AND CONSTRAINT_NAME = 'UQ_Users_Email'
        `);

        if (constraintExists.recordset[0].count === 0) {
            // Verificar que no hay emails duplicados
            const checkDuplicates = await this.query(`
                SELECT email, COUNT(*) as count 
                FROM Users 
                WHERE email IS NOT NULL 
                GROUP BY email 
                HAVING COUNT(*) > 1
            `);

            if (checkDuplicates.recordset.length === 0) {
                await this.query(`
                    ALTER TABLE Users 
                    ADD CONSTRAINT UQ_Users_Email UNIQUE (email)
                `);
                console.log('   ✅ Constraint UQ_Users_Email restaurado');
            }
        }
    }
}

module.exports = CreateDniIndexAndModifyUsers;
