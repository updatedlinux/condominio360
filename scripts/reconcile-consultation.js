#!/usr/bin/env node
/**
 * Concilia una carta consulta tras timeout o envío parcial de correos.
 * NO elimina la consulta. Re-encola correos a TODOS los propietarios elegibles del tenant/alcance.
 *
 * Requiere deploy con cola de consultas (NotificationQueue + worker cada 2 min).
 *
 * Visibilidad en panel propietario (pestaña Activas):
 *   - status OPEN, preguntas en BD, inmueble elegible
 *   - start_date <= ahora (si inicia mañana, se ve desde 00:00 VET de ese día)
 *
 * Uso en PRODUCCIÓN (ej. carta que inicia 04/06, sin cambiar fechas):
 *   node scripts/reconcile-consultation.js --id=0A05B249-936B-4F8B-87F5-65C3A133DCEF --fix-status --notify --notify-kind=creation --process-now
 *
 * Solo diagnóstico:
 *   node scripts/reconcile-consultation.js --id=<uuid> --dry-run
 *
 * Forzar inicio hoy (solo si debe verse activa ya):
 *   node scripts/reconcile-consultation.js --id=<uuid> --fix-start-today
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { sql, connectDB } = require('../src/config/database');
const ConsultationNotificationService = require('../src/services/ConsultationNotificationService');
const NotificationQueueModel = require('../src/models/NotificationQueueModel');

function parseArgs() {
    const args = {
        id: null,
        dryRun: false,
        fixStatus: false,
        fixStartToday: false,
        notify: false,
        processNow: false,
        notifyKind: 'auto'
    };
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--id=')) args.id = arg.slice(5);
        else if (arg === '--dry-run') args.dryRun = true;
        else if (arg === '--fix-status') args.fixStatus = true;
        else if (arg === '--fix-start-today') args.fixStartToday = true;
        else if (arg === '--notify') args.notify = true;
        else if (arg === '--process-now') args.processNow = true;
        else if (arg.startsWith('--notify-kind=')) args.notifyKind = arg.slice(14);
    }
    if (!args.notify && !args.dryRun && !args.fixStatus && !args.fixStartToday) {
        args.notify = true;
        args.fixStatus = true;
    }
    if (args.processNow) args.notify = true;
    return args;
}

function formatVet(date) {
    return new Date(date).toLocaleString('es-VE', {
        timeZone: 'America/Caracas',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function venezuelaMidnightUtc(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
}

function todayVenezuelaYmd() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Caracas',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    return `${y}-${m}-${d}`;
}

async function countQuestions(pool, consultationId) {
    const r = await pool.request()
        .input('id', sql.UniqueIdentifier, consultationId)
        .query(`
            SELECT
                (SELECT COUNT(*) FROM ConsultationQuestions WHERE consultation_id = @id) AS questions,
                (SELECT COUNT(*) FROM ConsultationOptions o
                 INNER JOIN ConsultationQuestions q ON o.question_id = q.id
                 WHERE q.consultation_id = @id) AS options
        `);
    return r.recordset[0];
}

async function countEligibleOwners(pool, tenantId, targetBuilding) {
    let query = `
        SELECT COUNT(DISTINCT u.id) AS owners
        FROM Users u
        INNER JOIN PropertyOwners po ON u.id = po.user_id
        INNER JOIN Properties p ON po.property_id = p.id
        LEFT JOIN Buildings b ON p.building_id = b.id
        WHERE p.tenant_id = @tenantId
        AND u.email IS NOT NULL AND u.email != ''
    `;
    if (targetBuilding) {
        query += ` AND (p.building = @targetBuilding OR b.name = @targetBuilding)`;
    }
    const r = await pool.request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('targetBuilding', sql.NVarChar, targetBuilding)
        .query(query);
    return r.recordset[0].owners;
}

async function countEligibleProperties(pool, tenantId, targetBuilding) {
    let query = `
        SELECT COUNT(*) AS n FROM Properties p
        LEFT JOIN Buildings b ON p.building_id = b.id
        WHERE p.tenant_id = @tenantId
    `;
    if (targetBuilding) {
        query += ` AND (p.building = @targetBuilding OR b.name = @targetBuilding)`;
    }
    const r = await pool.request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('targetBuilding', sql.NVarChar, targetBuilding)
        .query(query);
    return r.recordset[0].n;
}

function diagnoseVisibility(c, now) {
    const issues = [];
    const start = new Date(c.start_date);
    const end = new Date(c.end_date);

    if (c.status !== 'OPEN') {
        issues.push(`status="${c.status}" (debe ser OPEN para que aparezca activa)`);
    }
    if (now < start) {
        issues.push(`inicio futuro: ${formatVet(start)} (propietarios no la ven hasta esa fecha 00:00 VET)`);
    }
    if (now > end) {
        issues.push(`cierre pasado: ${formatVet(end)} (ya no aparece como activa)`);
    }
    return issues;
}

async function processQueueUntilDone(consultationId, maxRounds = 200) {
    let rounds = 0;
    while (rounds < maxRounds) {
        const pending = await NotificationQueueModel.countPendingConsultationNotifications(consultationId);
        if (pending === 0) break;
        console.log(`   ⏳ Cola: ${pending} pendientes, procesando lote...`);
        await ConsultationNotificationService.processNotificationQueue();
        rounds++;
        await new Promise((r) => setTimeout(r, 1500));
    }
    const left = await NotificationQueueModel.countPendingConsultationNotifications(consultationId);
    return { rounds, left };
}

async function main() {
    const args = parseArgs();
    if (!args.id) {
        console.error('Uso: node scripts/reconcile-consultation.js --id=<uuid-consulta> [--fix-status] [--fix-start-today] [--notify] [--process-now] [--dry-run]');
        process.exit(1);
    }

    console.log('🔍 Conectando...');
    const pool = await connectDB();
    const now = new Date();

    const res = await pool.request()
        .input('id', sql.UniqueIdentifier, args.id)
        .query(`
            SELECT c.*, t.name AS tenant_name
            FROM Consultations c
            INNER JOIN Tenants t ON c.tenant_id = t.id
            WHERE c.id = @id
        `);

    if (res.recordset.length === 0) {
        console.error(`❌ Consulta no encontrada: ${args.id}`);
        process.exit(1);
    }

    let c = res.recordset[0];
    const qCounts = await countQuestions(pool, c.id);
    const owners = await countEligibleOwners(pool, c.tenant_id, c.target_building);
    const properties = await countEligibleProperties(pool, c.tenant_id, c.target_building);

    console.log('\n📋 Consulta');
    console.log(`   ID:         ${c.id}`);
    console.log(`   Conjunto:   ${c.tenant_name}`);
    console.log(`   Título:     ${c.title}`);
    console.log(`   Estado:     ${c.status}`);
    console.log(`   Inicio:     ${formatVet(c.start_date)} (VET)`);
    console.log(`   Cierre:     ${formatVet(c.end_date)} (VET)`);
    console.log(`   Alcance:    ${c.target_building || 'Todo el conjunto'}`);
    console.log(`   Preguntas:  ${qCounts.questions} (${qCounts.options} opciones)`);
    console.log(`   Elegibles:  ${properties} inmuebles, ~${owners} propietarios con email`);

    const visibilityIssues = diagnoseVisibility(c, now);
    const startsInFuture = now < new Date(c.start_date);
    if (startsInFuture) {
        console.log(`\n📅 Inicio programado: ${formatVet(c.start_date)} (VET)`);
        console.log('   En pestaña Activas se verá desde esa fecha a las 00:00 (no antes).');
        console.log('   Los correos de "nueva consulta" sí pueden enviarse ya (--notify-kind=creation).');
    }
    if (visibilityIssues.length) {
        console.log('\n⚠️  Visibilidad propietario (activas):');
        visibilityIssues.forEach((i) => console.log(`   - ${i}`));
    } else if (!startsInFuture) {
        console.log('\n✅ Debería mostrarse como activa para propietarios elegibles.');
    }

    if (Number(qCounts.questions) === 0) {
        console.log('\n❌ Sin preguntas en BD: la carta no es votable. Revisar si la creación falló antes del commit.');
    }

    if (args.dryRun) {
        console.log('\n(dry-run: no se aplicaron cambios)');
        process.exit(0);
    }

    let changed = false;

    if (args.fixStatus && c.status !== 'OPEN') {
        console.log(`\n🔧 Corrigiendo status → OPEN (era ${c.status})`);
        await pool.request()
            .input('id', sql.UniqueIdentifier, c.id)
            .query(`UPDATE Consultations SET status = 'OPEN', updated_at = SYSDATETIME() WHERE id = @id`);
        c.status = 'OPEN';
        changed = true;
    }

    if (args.fixStartToday) {
        const today = todayVenezuelaYmd();
        const startUtc = venezuelaMidnightUtc(today);
        console.log(`\n🔧 Corrigiendo inicio → hoy ${today} 00:00 VET`);
        await pool.request()
            .input('id', sql.UniqueIdentifier, c.id)
            .input('start_date', sql.DateTime2, startUtc)
            .query(`UPDATE Consultations SET start_date = @start_date, updated_at = SYSDATETIME() WHERE id = @id`);
        c.start_date = startUtc;
        changed = true;
    }

    if (changed) {
        const again = diagnoseVisibility(c, new Date());
        if (again.length) {
            console.log('\n⚠️  Tras corrección aún:');
            again.forEach((i) => console.log(`   - ${i}`));
        } else {
            console.log('\n✅ Visibilidad corregida.');
        }
    }

    if (args.notify) {
        const isActive = c.status === 'OPEN' && new Date(c.start_date) <= now && new Date(c.end_date) >= now;
        let kind = args.notifyKind;
        if (kind === 'auto') {
            kind = isActive ? 'activation' : 'creation';
        }

        const recipients = await ConsultationNotificationService.getRecipients(c.tenant_id, c.target_building);
        console.log(`\n📧 Re-encolar notificaciones (${kind}) → ${recipients.length} destinatarios`);

        const removed = await NotificationQueueModel.deletePendingConsultationNotifications(c.id);
        if (removed > 0) {
            console.log(`   🗑️  Eliminados ${removed} pendientes previos en cola`);
        }

        if (kind === 'activation') {
            await ConsultationNotificationService.queueActivationNotifications(c, recipients);
            if (isActive && !c.activation_notified) {
                const ConsultationModel = require('../src/models/ConsultationModel');
                await ConsultationModel.markAsNotified(c.id);
            }
        } else {
            await ConsultationNotificationService.queueCreationNotifications(c, recipients);
        }

        const pending = await NotificationQueueModel.countPendingConsultationNotifications(c.id);
        console.log(`   📥 ${pending} correos en cola para esta consulta`);

        if (args.processNow) {
            console.log('\n🚀 Procesando cola (puede tardar varios minutos con cientos de destinatarios)...');
            const { rounds, left } = await processQueueUntilDone(c.id);
            console.log(`   ✅ Procesamiento: ${rounds} rondas, ${left} pendientes restantes`);
            if (left > 0) {
                console.log('   ℹ️  Deja PM2/servidor corriendo; el worker envía cada 2 minutos.');
            }
        } else {
            console.log('\nℹ️  Correos encolados. El servidor los envía cada ~2 min (--process-now para vaciar en este script).');
        }

        console.log('\n📌 Recordatorio legal: se reenvía a todos los elegibles con email (puede haber duplicados).');
    }

    console.log('\n🎉 Conciliación finalizada.');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
});
