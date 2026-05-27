const fs = require('fs');
const path = require('path');
const { connectDB, sql } = require('../../config/database');
const BankModel = require('../../models/BankModel');
const BankStatementImportModel = require('../../models/BankStatementImportModel');
const BankStatementMovementModel = require('../../models/BankStatementMovementModel');
const BankParserRegistry = require('./parsers/BankParserRegistry');
const ReconciliationMatcher = require('./ReconciliationMatcher');

/**
 * Orquestador del flujo de conciliación bancaria.
 *
 * Flujo:
 *   1. Tenant admin sube un PDF y selecciona el banco activado.
 *   2. Service:
 *      a) Resuelve el parser asociado al banco.
 *      b) Parsea el PDF → movimientos normalizados.
 *      c) Guarda el import + los movimientos.
 *      d) Recupera reportes de pago PENDING_CONFIRMATION del tenant.
 *      e) Corre el matcher.
 *      f) Persiste el match en cada movimiento.
 *      g) Aplica política híbrida de auto-confirmación.
 *   3. Devuelve el resumen estructurado para mostrar al tenant admin.
 */
class BankReconciliationService {
    /**
     * Procesa un archivo (ya guardado en disco) y devuelve el resumen.
     */
    static async processStatement({
        tenantId,
        bankId,
        tenantBankAccountId,
        importedBy,
        sourceFilePath,
        sourceFileName,
        sourceMime,
        sourceSizeBytes
    }) {
        const bank = await BankModel.findById(bankId);
        if (!bank) {
            throw new Error('Banco no encontrado');
        }
        if (!bank.is_active) {
            throw new Error('El banco está deshabilitado en el sistema');
        }

        const parser = BankParserRegistry.getByParserKey(bank.parser_key);
        if (!parser) {
            throw new Error(`No hay driver registrado para el parser_key '${bank.parser_key}'`);
        }

        const buffer = fs.readFileSync(sourceFilePath);
        const parsed = await parser.parse(buffer, sourceMime, sourceFileName);

        const importId = await BankStatementImportModel.createWithMovements({
            tenantId,
            bankId,
            tenantBankAccountId,
            sourceFilePath,
            sourceFileName,
            sourceMime,
            sourceSizeBytes,
            importedBy,
            periodFrom: parsed.periodFrom,
            periodTo: parsed.periodTo,
            movements: parsed.movements
        });

        const result = await this._runMatchingForImport(tenantId, importId, importedBy);

        return {
            importId,
            bankCode: bank.code,
            bankName: bank.name,
            accountHolder: parsed.accountHolder,
            accountMask: parsed.accountMask,
            periodFrom: parsed.periodFrom,
            periodTo: parsed.periodTo,
            initialBalance: parsed.initialBalance,
            finalBalance: parsed.finalBalance,
            warnings: parsed.warnings,
            totals: result.totals,
            matched: result.matched,
            suggested: result.suggested,
            unmatchedMovements: result.unmatchedMovements,
            unmatchedReports: result.unmatchedReports
        };
    }

    /**
     * Vuelve a ejecutar el matcher sobre un import ya cargado. Útil al volver a
     * abrir el modal de resultados.
     */
    static async _runMatchingForImport(tenantId, importId, actorUserId) {
        const movements = await BankStatementMovementModel.listByImport(importId);
        const movementsForMatch = movements
            .filter(m => m.direction === 'CREDIT')
            .map(m => ({
                ...m,
                movement_date: m.movement_date ? new Date(m.movement_date) : null,
                amount_ves: Number(m.amount_ves || 0),
                payer_document: m.payer_document || null
            }));

        const reports = await this._fetchCandidateReports(tenantId);

        const result = ReconciliationMatcher.run(movementsForMatch, reports);

        let matchedCount = 0;
        let suggestedCount = 0;

        for (const pair of result.matches) {
            const movement = movementsForMatch[pair.movementIndex];
            const report = reports[pair.reportIndex];
            await BankStatementMovementModel.setMatch(movement.id, report.payment_report_id, {
                matchStatus: pair.status,
                matchScore: pair.score,
                matchedBy: actorUserId
            });
            if (pair.status === 'CONFIRMED') {
                matchedCount++;
                await this._autoConfirmPaymentReport(report.payment_report_id, actorUserId, pair.score);
            } else {
                suggestedCount++;
            }
        }

        const unmatchedMovements = result.unmatchedMovementIndices.map(i => movementsForMatch[i]);
        const unmatchedReports = result.unmatchedReportIndices.map(i => reports[i]);

        const totalCredits = movements.filter(m => m.direction === 'CREDIT').length;
        const totalDebits = movements.filter(m => m.direction === 'DEBIT').length;

        await BankStatementImportModel.updateStats(importId, {
            matched: matchedCount,
            suggested: suggestedCount,
            unmatched: unmatchedMovements.length
        });

        const movementsAfter = await BankStatementMovementModel.listWithMatchDetails(importId);
        const unmatchedReportsAfter = await BankStatementMovementModel.listPendingPaymentReportsWithoutMatch(tenantId, importId);

        return {
            totals: {
                movements: movements.length,
                credits: totalCredits,
                debits: totalDebits,
                matched: matchedCount,
                suggested: suggestedCount,
                unmatched: unmatchedMovements.length
            },
            matched: movementsAfter.filter(m => m.match_status === 'CONFIRMED'),
            suggested: movementsAfter.filter(m => m.match_status === 'SUGGESTED'),
            unmatchedMovements: movementsAfter.filter(m => m.direction === 'CREDIT' && m.match_status === 'UNMATCHED'),
            unmatchedReports: unmatchedReportsAfter
        };
    }

    /**
     * Refresca la matriz de match para un import previo, recalculando contra
     * los reportes vigentes. Útil cuando el usuario vuelve a abrir el modal.
     */
    static async rerunMatching(tenantId, importId, actorUserId) {
        return this._runMatchingForImport(tenantId, importId, actorUserId);
    }

    static async getImportResults(tenantId, importId) {
        const movementsAfter = await BankStatementMovementModel.listWithMatchDetails(importId);
        const movements = await BankStatementMovementModel.listByImport(importId);
        const totalCredits = movements.filter(m => m.direction === 'CREDIT').length;
        const totalDebits = movements.filter(m => m.direction === 'DEBIT').length;
        const matched = movementsAfter.filter(m => m.match_status === 'CONFIRMED');
        const suggested = movementsAfter.filter(m => m.match_status === 'SUGGESTED');
        const unmatchedMovements = movementsAfter.filter(m => m.direction === 'CREDIT' && m.match_status === 'UNMATCHED');
        const unmatchedReports = await BankStatementMovementModel.listPendingPaymentReportsWithoutMatch(tenantId, importId);
        return {
            totals: {
                movements: movements.length,
                credits: totalCredits,
                debits: totalDebits,
                matched: matched.length,
                suggested: suggested.length,
                unmatched: unmatchedMovements.length
            },
            matched,
            suggested,
            unmatchedMovements,
            unmatchedReports
        };
    }

    /**
     * Confirma manualmente una sugerencia. Vincula el movimiento al reporte
     * y marca el reporte como CONFIRMED en BillingPaymentReports.
     */
    static async confirmSuggestion(movementId, paymentReportId, actorUserId) {
        const movement = await BankStatementMovementModel.findById(movementId);
        if (!movement) throw new Error('Movimiento no encontrado');
        await BankStatementMovementModel.setMatch(movementId, paymentReportId, {
            matchStatus: 'CONFIRMED',
            matchScore: movement.match_score,
            matchedBy: actorUserId
        });
        await this._autoConfirmPaymentReport(paymentReportId, actorUserId, movement.match_score);
        return { ok: true };
    }

    static async rejectMatch(movementId, actorUserId) {
        const movement = await BankStatementMovementModel.findById(movementId);
        if (!movement) throw new Error('Movimiento no encontrado');
        await BankStatementMovementModel.clearMatch(movementId);
        return { ok: true };
    }

    /**
     * Vincula manualmente un movimiento sin match a un reporte específico.
     */
    static async linkManually(movementId, paymentReportId, actorUserId) {
        await BankStatementMovementModel.setMatch(movementId, paymentReportId, {
            matchStatus: 'CONFIRMED',
            matchScore: 100,
            matchedBy: actorUserId
        });
        await this._autoConfirmPaymentReport(paymentReportId, actorUserId, 100);
        return { ok: true };
    }

    static async _fetchCandidateReports(tenantId) {
        return BankStatementMovementModel.listPendingPaymentReportsWithoutMatch(tenantId);
    }

    /**
     * Cambia el BillingPaymentReport a CONFIRMED, sin usar el flujo del
     * controller (porque esto no se origina por una acción manual del admin
     * sino por la conciliación automática). Solo actúa si está PENDING.
     */
    static async _autoConfirmPaymentReport(paymentReportId, actorUserId, score) {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.UniqueIdentifier, paymentReportId)
            .input('actor', sql.UniqueIdentifier, actorUserId)
            .query(`
                UPDATE BillingPaymentReports
                SET status = N'CONFIRMED',
                    confirmed_at = SYSDATETIME(),
                    updated_at = SYSDATETIME()
                WHERE id = @id AND status = N'PENDING_CONFIRMATION'
            `);

        await pool.request()
            .input('id', sql.UniqueIdentifier, paymentReportId)
            .query(`
                UPDATE bi
                SET bi.status = N'PAID', bi.updated_at = SYSDATETIME()
                FROM BillingInvoices bi
                INNER JOIN BillingPaymentReports bpr ON bpr.invoice_id = bi.id
                WHERE bpr.id = @id
            `);
    }
}

module.exports = BankReconciliationService;
