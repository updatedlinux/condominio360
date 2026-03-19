#!/usr/bin/env node
/**
 * Script de limpieza total de la base de datos
 * Elimina TODOS los datos excepto el SuperAdmin (Users con is_superadmin = 1)
 *
 * Uso:
 *   node scripts/cleanup-database.js
 *   npm run cleanup-db
 *
 * Para ejecutar el SQL directamente en SSMS, ver docs/DEPLOY-QA.md
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { connectDB } = require('../src/config/database');

const TABLES_ORDER = [
    // Orden: hijos primero, padres al final (respeta FKs)
    'CommunicationRecipients',
    'Communications',
    'ConsultationVotes',
    'ConsultationOptions',
    'ConsultationQuestions',
    'Consultations',
    'RequestAttachments',
    'Requests',
    'CommonAreaReservations',
    'CommonAreas',
    'CommuniqueReads',
    'CommuniqueEmailQueue',
    'CommuniqueNotifications',
    'Communiques',
    'NFC_AccessLogs',
    'NFC_Cards',
    'BillingPaymentReports',
    'BillingInvoiceItems',
    'BillingInvoices',
    'BillingPreliminaryItems',
    'BillingPreliminaries',
    'BillingExtraordinaryTemplates',
    'VendorContracts',
    'Vendors',
    'SaaSPaymentReports',
    'SaaSInvoiceItems',
    'SaaSInvoices',
    'NotificationQueue',
    'InAppNotifications',
    'DeliveryAnnouncements',
    'VisitorDeliveries',
    'VisitorLogs',      // Antes de VisitorPasses (FK pass_id -> VisitorPasses)
    'VisitorPasses',
    'Visitors',
    'PropertyOwners',
    'TenantUsers',
    'TenantAdmins',
    'SecurityUsers',
    'TenantMoveConfig',
    'RequestTypes',
    'AuditLogs',
    'PasswordResets',
    'Properties',
    'Buildings',
    'Tenants',
    'UserEmails',
];

async function tableExists(pool, name) {
    const r = await pool.request()
        .query(`SELECT 1 FROM sys.tables WHERE name = '${name}'`);
    return r.recordset.length > 0;
}

async function run() {
    console.log('\n🧹 Iniciando limpieza total de la base de datos...');
    console.log('   Se preservará únicamente el SuperAdmin (Users.is_superadmin = 1)\n');

    const pool = await connectDB();

    try {
        for (const table of TABLES_ORDER) {
            const exists = await tableExists(pool, table);
            if (!exists) {
                console.log(`   ⏭️  ${table} (no existe, omitiendo)`);
                continue;
            }
            const result = await pool.request().query(`DELETE FROM ${table}`);
            const count = result.rowsAffected?.[0] ?? 0;
            if (count > 0) {
                console.log(`   ✅ ${table}: ${count} fila(s) eliminada(s)`);
            }
        }

        // Eliminar Users que NO son superadmin
        const usersResult = await pool.request().query(`
            DELETE FROM Users WHERE ISNULL(is_superadmin, 0) = 0
        `);
        const countUsers = usersResult.rowsAffected?.[0] ?? 0;
        if (countUsers > 0) console.log(`   ✅ Users (no superadmin): ${countUsers} eliminado(s)`);

        const superadminCount = (await pool.request().query(`
            SELECT COUNT(*) as c FROM Users WHERE ISNULL(is_superadmin, 0) = 1
        `)).recordset[0]?.c || 0;

        console.log('\n✅ Limpieza completada.');
        console.log(`   SuperAdmin(es) preservado(s): ${superadminCount}`);
        console.log('   La base de datos queda lista para comenzar de cero.\n');
    } catch (err) {
        console.error('\n❌ Error durante la limpieza:', err.message);
        throw err;
    } finally {
        if (pool) pool.close?.();
    }
}

run().then(() => process.exit(0)).catch(() => process.exit(1));
