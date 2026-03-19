#!/usr/bin/env node
/**
 * Script para eliminar propietarios huérfanos por DNI
 * Elimina: PropertyOwners, TenantUsers, UserEmails y Users
 *
 * Uso:
 *   node scripts/delete-orphan-owners.js
 *   npm run delete-orphan-owners
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { connectDB, sql } = require('../src/config/database');

const DNIS_TO_DELETE = [
    '15987432',
    '18111222',
    '20333444',
    '14555666',
    '16777888',
    '19999000',
    '21222333',
    '11444555',
    '13666777',
    '17888999',
    '22111000',
    '10222444',
    '24333555',
    '25444666',
    '26555777'
];

async function main() {
    console.log('🗑️  Eliminando propietarios huérfanos por DNI...\n');

    const pool = await connectDB();
    let deleted = 0;
    let notFound = 0;

    for (const dni of DNIS_TO_DELETE) {
        try {
            const userResult = await pool.request()
                .input('dni', sql.NVarChar, dni)
                .query('SELECT id, first_name, last_name, email FROM Users WHERE dni = @dni');

            if (userResult.recordset.length === 0) {
                console.log(`  ⏭️  DNI ${dni}: No encontrado (ya eliminado o no existe)`);
                notFound++;
                continue;
            }

            const user = userResult.recordset[0];
            const label = `${user.first_name} ${user.last_name} (${user.email || 'sin email'})`;

            await pool.request()
                .input('user_id', sql.UniqueIdentifier, user.id)
                .query('DELETE FROM PropertyOwners WHERE user_id = @user_id');

            await pool.request()
                .input('user_id', sql.UniqueIdentifier, user.id)
                .query('DELETE FROM TenantUsers WHERE user_id = @user_id');

            await pool.request()
                .input('user_id', sql.UniqueIdentifier, user.id)
                .query('DELETE FROM UserEmails WHERE user_id = @user_id');

            await pool.request()
                .input('user_id', sql.UniqueIdentifier, user.id)
                .query('DELETE FROM Requests WHERE user_id = @user_id').catch(() => {});

            const deleteResult = await pool.request()
                .input('user_id', sql.UniqueIdentifier, user.id)
                .query('DELETE FROM Users WHERE id = @user_id');

            if (deleteResult.rowsAffected[0] > 0) {
                console.log(`  ✅ DNI ${dni}: Eliminado - ${label}`);
                deleted++;
            }
        } catch (err) {
            console.error(`  ❌ DNI ${dni}: Error - ${err.message}`);
        }
    }

    console.log(`\n📊 Resultado: ${deleted} eliminados, ${notFound} no encontrados`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Error:', err);
        process.exit(1);
    });
