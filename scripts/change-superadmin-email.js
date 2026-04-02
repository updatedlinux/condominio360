#!/usr/bin/env node
/**
 * Actualiza el correo del superadmin (Users + UserEmails si existe fila con el correo antiguo).
 *
 * Por defecto:
 *   superadmin@condominio360.com → superadm-c360@arsysintela.com
 *
 * Uso:
 *   node scripts/change-superadmin-email.js
 *
 * Variables opcionales:
 *   SUPERADMIN_EMAIL_OLD  (default: superadmin@condominio360.com)
 *   SUPERADMIN_EMAIL_NEW  (default: superadm-c360@arsysintela.com)
 */
require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');

const OLD_EMAIL = process.env.SUPERADMIN_EMAIL_OLD || 'superadmin@condominio360.com';
const NEW_EMAIL = process.env.SUPERADMIN_EMAIL_NEW || 'superadm-c360@arsysintela.com';

async function main() {
    const pool = await connectDB();

    const find = await pool
        .request()
        .input('old', sql.NVarChar, OLD_EMAIL)
        .query(`
            SELECT id, email, first_name, last_name
            FROM Users
            WHERE ISNULL(is_superadmin, 0) = 1
              AND LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(@old))
        `);

    if (!find.recordset.length) {
        console.error(`No se encontró superadmin con correo: ${OLD_EMAIL}`);
        process.exit(1);
    }

    const row = find.recordset[0];
    const userId = row.id;

    const taken = await pool
        .request()
        .input('newEmail', sql.NVarChar, NEW_EMAIL)
        .input('excludeId', sql.UniqueIdentifier, userId)
        .query(`
            SELECT id FROM Users
            WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(@newEmail))
              AND id <> @excludeId
        `);

    if (taken.recordset.length) {
        console.error(`El correo nuevo ya está en uso por otro usuario: ${NEW_EMAIL}`);
        process.exit(1);
    }

    await pool
        .request()
        .input('id', sql.UniqueIdentifier, userId)
        .input('newEmail', sql.NVarChar, NEW_EMAIL)
        .query(`
            UPDATE Users
            SET email = @newEmail, updated_at = SYSDATETIME()
            WHERE id = @id
        `);

    const ueCheck = await pool.request().query(`
        SELECT 1 AS x FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = N'UserEmails'
    `);
    if (ueCheck.recordset.length) {
        const ue = await pool
            .request()
            .input('uid', sql.UniqueIdentifier, userId)
            .input('old', sql.NVarChar, OLD_EMAIL)
            .input('new', sql.NVarChar, NEW_EMAIL)
            .query(`
                UPDATE UserEmails
                SET email = @new
                WHERE user_id = @uid
                  AND LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(@old))
            `);
        const n = Array.isArray(ue.rowsAffected) ? ue.rowsAffected[0] : ue.rowsAffected;
        console.log(`UserEmails filas actualizadas: ${n}`);
    }

    console.log(`OK: superadmin ${row.first_name} ${row.last_name} (${row.id})`);
    console.log(`   ${OLD_EMAIL} → ${NEW_EMAIL}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
