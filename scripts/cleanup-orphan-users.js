#!/usr/bin/env node
/**
 * Elimina usuarios huérfanos de la tabla Users
 * Huérfano = sin TenantAdmins, PropertyOwners, TenantUsers, y no superadmin
 *
 * NOTA: Los propietarios sin unidades asignadas son "huérfanos legítimos" - se
 * reciclan cuando se asignan a otro condominio (createOwner por DNI/email).
 * Este script los eliminaría. Úsalo solo para limpiar datos de prueba/desarrollo.
 *
 * Uso: node scripts/cleanup-orphan-users.js [--dry-run]
 */
require('dotenv').config();
const { connectDB, sql } = require('../src/config/database');

async function cleanup(dryRun = false) {
    try {
        const pool = await connectDB();

        // Obtener usuarios huérfanos
        const result = await pool.request().query(`
            SELECT u.id, u.email, u.first_name, u.last_name
            FROM Users u
            WHERE u.is_superadmin = 0
            AND NOT EXISTS (SELECT 1 FROM TenantAdmins ta WHERE ta.user_id = u.id)
            AND NOT EXISTS (SELECT 1 FROM PropertyOwners po WHERE po.user_id = u.id)
            AND NOT EXISTS (SELECT 1 FROM TenantUsers tu WHERE tu.user_id = u.id)
            ORDER BY u.email
        `);

        const orphans = result.recordset;

        if (orphans.length === 0) {
            console.log('✅ No hay usuarios huérfanos.');
            process.exit(0);
            return;
        }

        console.log(`\nEncontrados ${orphans.length} usuario(s) huérfano(s):\n`);
        orphans.forEach(o => console.log(`  - ${o.email} (${o.first_name} ${o.last_name})`));

        if (dryRun) {
            console.log('\n[DRY-RUN] No se eliminó nada. Ejecuta sin --dry-run para eliminar.');
            process.exit(0);
            return;
        }

        const transaction = pool.transaction();
        await transaction.begin();

        try {
            for (const o of orphans) {
                // Eliminar ConsultationVotes si existen
                await transaction.request()
                    .input('user_id', sql.UniqueIdentifier, o.id)
                    .query('DELETE FROM ConsultationVotes WHERE user_id = @user_id').catch(() => {});
                // Eliminar User
                await transaction.request()
                    .input('id', sql.UniqueIdentifier, o.id)
                    .query('DELETE FROM Users WHERE id = @id');
                console.log(`  ✓ Eliminado: ${o.email}`);
            }
            await transaction.commit();
            console.log(`\n✅ ${orphans.length} usuario(s) huérfano(s) eliminado(s).`);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

const dryRun = process.argv.includes('--dry-run');
cleanup(dryRun);
