#!/usr/bin/env node
/**
 * Diagnóstico: Listar todos los usuarios en la tabla Users y su origen/categoría
 * Uso: node scripts/diagnose-users.js
 */
require('dotenv').config();
const { connectDB } = require('../src/config/database');

async function diagnose() {
    try {
        const pool = await connectDB();

        const result = await pool.request().query(`
            SELECT 
                u.id,
                u.email,
                u.first_name,
                u.last_name,
                u.is_superadmin,
                u.dni,
                u.registration_status,
                u.created_at,
                -- Categorías
                CASE WHEN u.is_superadmin = 1 THEN 1 ELSE 0 END as es_superadmin,
                (SELECT COUNT(*) FROM TenantAdmins ta WHERE ta.user_id = u.id) as es_admin_junta,
                (SELECT COUNT(*) FROM PropertyOwners po WHERE po.user_id = u.id) as es_propietario,
                (SELECT COUNT(*) FROM TenantUsers tu WHERE tu.user_id = u.id) as en_tenant_users,
                (SELECT TOP 1 tu.role FROM TenantUsers tu WHERE tu.user_id = u.id) as rol_tenant_users
            FROM Users u
            ORDER BY u.created_at ASC
        `);

        console.log('\n=== DIAGNÓSTICO DE USUARIOS EN TABLA Users ===\n');
        console.log(`Total registros en Users: ${result.recordset.length}\n`);

        const categorias = {
            superadmin: [],
            adminJunta: [],
            propietario: [],
            tenantUsersOnly: [],
            huerfano: []
        };

        result.recordset.forEach((r, i) => {
            const tipos = [];
            if (r.es_superadmin) tipos.push('SuperAdmin');
            if (r.es_admin_junta > 0) tipos.push('Admin Junta');
            if (r.es_propietario > 0) tipos.push('Propietario');
            if (r.en_tenant_users > 0) tipos.push(`TenantUsers(${r.rol_tenant_users})`);

            let categoria = 'huerfano';
            if (r.es_superadmin) categoria = 'superadmin';
            else if (r.es_propietario > 0) categoria = 'propietario';
            else if (r.es_admin_junta > 0) categoria = 'adminJunta';
            else if (r.en_tenant_users > 0) categoria = 'tenantUsersOnly';

            categorias[categoria].push({ ...r, tipos });

            console.log(`${i + 1}. ${r.email}`);
            console.log(`   Nombre: ${r.first_name} ${r.last_name}`);
            console.log(`   Tipo(s): ${tipos.join(', ') || 'Sin vínculos (huérfano)'}`);
            console.log(`   DNI: ${r.dni || 'N/A'} | Estado: ${r.registration_status || 'N/A'}`);
            console.log(`   Creado: ${r.created_at}`);
            console.log('');
        });

        console.log('\n--- RESUMEN POR CATEGORÍA ---');
        console.log(`SuperAdmins: ${categorias.superadmin.length}`);
        console.log(`Admins de Junta (TenantAdmins): ${categorias.adminJunta.length}`);
        console.log(`Propietarios (PropertyOwners): ${categorias.propietario.length}`);
        console.log(`Solo TenantUsers (schema antiguo): ${categorias.tenantUsersOnly.length}`);
        console.log(`Huérfanos (sin vínculos): ${categorias.huerfano.length}`);

        // Verificar SecurityUsers (tabla separada - NO cuentan en Users)
        const secResult = await pool.request().query('SELECT COUNT(*) as total FROM SecurityUsers');
        console.log(`\n(Usuarios de vigilancia en tabla SecurityUsers: ${secResult.recordset[0].total} - NO cuentan en "Users")`);

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

diagnose();
