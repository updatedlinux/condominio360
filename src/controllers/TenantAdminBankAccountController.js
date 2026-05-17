const BankModel = require('../models/BankModel');
const TenantBankAccountModel = require('../models/TenantBankAccountModel');
const AuditService = require('../services/AuditService');

/**
 * CRUD de cuentas bancarias del tenant para conciliación.
 */
class TenantAdminBankAccountController {
    static async listBanks(req, res) {
        try {
            const banks = await BankModel.listActive();
            res.json({ success: true, data: banks });
        } catch (error) {
            console.error('TenantAdminBankAccountController.listBanks error:', error);
            res.status(500).json({ success: false, error: 'Error al listar bancos' });
        }
    }

    static async list(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
            const accounts = await TenantBankAccountModel.listByTenant(tenantId, includeInactive);
            res.json({ success: true, data: accounts });
        } catch (error) {
            console.error('TenantAdminBankAccountController.list error:', error);
            res.status(500).json({ success: false, error: 'Error al listar cuentas bancarias' });
        }
    }

    static async create(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const data = req.body || {};
            if (!data.bank_id) return res.status(400).json({ success: false, error: 'Banco requerido' });
            if (!data.account_holder) return res.status(400).json({ success: false, error: 'Titular requerido' });
            if (!data.account_type) return res.status(400).json({ success: false, error: 'Tipo de cuenta requerido' });
            const created = await TenantBankAccountModel.create(tenantId, data);
            try {
                await AuditService.log({
                    tenantId,
                    actorId: req.user.userId,
                    action: 'BANK_ACCOUNT_CREATED',
                    entityType: 'TENANT_BANK_ACCOUNT',
                    entityId: created.id,
                    metadata: { bank: created.bank_name, holder: created.account_holder }
                });
            } catch (_) { /* noop */ }
            res.json({ success: true, data: created });
        } catch (error) {
            console.error('TenantAdminBankAccountController.create error:', error);
            res.status(500).json({ success: false, error: 'Error al crear cuenta bancaria' });
        }
    }

    static async update(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            const existing = await TenantBankAccountModel.findById(id);
            if (!existing || existing.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
            }
            const updated = await TenantBankAccountModel.update(id, req.body || {});
            try {
                await AuditService.log({
                    tenantId,
                    actorId: req.user.userId,
                    action: 'BANK_ACCOUNT_UPDATED',
                    entityType: 'TENANT_BANK_ACCOUNT',
                    entityId: id
                });
            } catch (_) { /* noop */ }
            res.json({ success: true, data: updated });
        } catch (error) {
            console.error('TenantAdminBankAccountController.update error:', error);
            res.status(500).json({ success: false, error: 'Error al actualizar cuenta bancaria' });
        }
    }

    static async deactivate(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            const existing = await TenantBankAccountModel.findById(id);
            if (!existing || existing.tenant_id !== tenantId) {
                return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
            }
            await TenantBankAccountModel.deactivate(id);
            try {
                await AuditService.log({
                    tenantId,
                    actorId: req.user.userId,
                    action: 'BANK_ACCOUNT_DEACTIVATED',
                    entityType: 'TENANT_BANK_ACCOUNT',
                    entityId: id
                });
            } catch (_) { /* noop */ }
            res.json({ success: true });
        } catch (error) {
            console.error('TenantAdminBankAccountController.deactivate error:', error);
            res.status(500).json({ success: false, error: 'Error al desactivar cuenta bancaria' });
        }
    }
}

module.exports = TenantAdminBankAccountController;
