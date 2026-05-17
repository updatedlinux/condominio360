const BankReconciliationService = require('../services/reconciliation/BankReconciliationService');
const BankStatementImportModel = require('../models/BankStatementImportModel');
const BankModel = require('../models/BankModel');
const AuditService = require('../services/AuditService');

class TenantAdminReconciliationController {
    /**
     * GET /api/tenant-admin/reconciliation/banks
     * Lista bancos activos (catálogo) para que el admin elija al subir.
     */
    static async listActiveBanks(req, res) {
        try {
            const banks = await BankModel.listActive();
            res.json({ success: true, data: banks });
        } catch (error) {
            console.error('Reconciliation listActiveBanks error:', error);
            res.status(500).json({ success: false, error: 'Error al listar bancos' });
        }
    }

    /**
     * POST /api/tenant-admin/reconciliation/imports
     * multipart/form-data:
     *   - file: PDF del estado de cuenta
     *   - bank_id: UUID del banco
     *   - tenant_bank_account_id?: UUID de la cuenta destino (opcional)
     */
    static async createImport(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const file = req.file;
            const { bank_id, tenant_bank_account_id } = req.body || {};
            if (!file) return res.status(400).json({ success: false, error: 'Archivo requerido' });
            if (!bank_id) return res.status(400).json({ success: false, error: 'Banco requerido' });

            const result = await BankReconciliationService.processStatement({
                tenantId,
                bankId: bank_id,
                tenantBankAccountId: tenant_bank_account_id || null,
                importedBy: userId,
                sourceFilePath: file.path,
                sourceFileName: file.originalname,
                sourceMime: file.mimetype,
                sourceSizeBytes: file.size
            });

            try {
                await AuditService.log({
                    tenantId,
                    actorId: userId,
                    action: 'BANK_STATEMENT_IMPORTED',
                    entityType: 'BANK_STATEMENT_IMPORT',
                    entityId: result.importId,
                    metadata: {
                        bank: result.bankName,
                        period_from: result.periodFrom,
                        period_to: result.periodTo,
                        matched: result.totals && result.totals.matched,
                        suggested: result.totals && result.totals.suggested,
                        unmatched: result.totals && result.totals.unmatched
                    }
                });
            } catch (_) { /* noop */ }

            res.json({ success: true, data: result });
        } catch (error) {
            console.error('Reconciliation createImport error:', error);
            res.status(500).json({ success: false, error: error.message || 'Error al procesar el estado de cuenta' });
        }
    }

    static async listImports(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const imports = await BankStatementImportModel.listByTenant(tenantId, { limit: 50 });
            res.json({ success: true, data: imports });
        } catch (error) {
            console.error('Reconciliation listImports error:', error);
            res.status(500).json({ success: false, error: 'Error al listar importaciones' });
        }
    }

    static async getImportResults(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            const imp = await BankStatementImportModel.findById(id);
            if (!imp || String(imp.tenant_id) !== String(tenantId)) {
                return res.status(404).json({ success: false, error: 'Import no encontrado' });
            }
            const result = await BankReconciliationService.getImportResults(tenantId, id);
            res.json({ success: true, data: { import: imp, ...result } });
        } catch (error) {
            console.error('Reconciliation getImportResults error:', error);
            res.status(500).json({ success: false, error: 'Error al obtener resultados' });
        }
    }

    static async rerun(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;
            const { id } = req.params;
            const imp = await BankStatementImportModel.findById(id);
            if (!imp || String(imp.tenant_id) !== String(tenantId)) {
                return res.status(404).json({ success: false, error: 'Import no encontrado' });
            }
            const result = await BankReconciliationService.rerunMatching(tenantId, id, userId);
            res.json({ success: true, data: result });
        } catch (error) {
            console.error('Reconciliation rerun error:', error);
            res.status(500).json({ success: false, error: 'Error al recalcular conciliación' });
        }
    }

    static async confirmSuggestion(req, res) {
        try {
            const userId = req.user.userId;
            const { movementId } = req.params;
            const { payment_report_id } = req.body || {};
            if (!payment_report_id) return res.status(400).json({ success: false, error: 'payment_report_id requerido' });
            await BankReconciliationService.confirmSuggestion(movementId, payment_report_id, userId);
            res.json({ success: true });
        } catch (error) {
            console.error('Reconciliation confirmSuggestion error:', error);
            res.status(500).json({ success: false, error: 'Error al confirmar sugerencia' });
        }
    }

    static async rejectMatch(req, res) {
        try {
            const userId = req.user.userId;
            const { movementId } = req.params;
            await BankReconciliationService.rejectMatch(movementId, userId);
            res.json({ success: true });
        } catch (error) {
            console.error('Reconciliation rejectMatch error:', error);
            res.status(500).json({ success: false, error: 'Error al rechazar match' });
        }
    }

    static async linkManually(req, res) {
        try {
            const userId = req.user.userId;
            const { movementId } = req.params;
            const { payment_report_id } = req.body || {};
            if (!payment_report_id) return res.status(400).json({ success: false, error: 'payment_report_id requerido' });
            await BankReconciliationService.linkManually(movementId, payment_report_id, userId);
            res.json({ success: true });
        } catch (error) {
            console.error('Reconciliation linkManually error:', error);
            res.status(500).json({ success: false, error: 'Error al vincular' });
        }
    }
}

module.exports = TenantAdminReconciliationController;
