const BankModel = require('../models/BankModel');
const AdminController = require('./AdminController');

/**
 * Gestión global de bancos para conciliación bancaria (vista SuperAdmin).
 * Solo permite activar/desactivar y editar notas (los drivers se hardcodean
 * por código y se registran en BankParserRegistry).
 */
class AdminBankController {
    static async list(req, res) {
        try {
            const banks = await BankModel.listAll();
            res.json({ success: true, data: banks });
        } catch (error) {
            console.error('AdminBankController.list error:', error);
            res.status(500).json({ success: false, error: 'Error al listar bancos' });
        }
    }

    static async toggleActive(req, res) {
        try {
            const { id } = req.params;
            const { active } = req.body || {};
            if (typeof active !== 'boolean') {
                return res.status(400).json({ success: false, error: 'El campo "active" es requerido (booleano)' });
            }
            const bank = await BankModel.findById(id);
            if (!bank) return res.status(404).json({ success: false, error: 'Banco no encontrado' });

            const updated = await BankModel.setActive(id, active);
            try {
                await AdminController.logAudit(
                    req,
                    'UPDATE',
                    'BANK',
                    id,
                    `${active ? 'Activó' : 'Desactivó'} banco para conciliación: ${bank.name}`,
                    null
                );
            } catch (_) { /* noop */ }

            res.json({ success: true, data: updated });
        } catch (error) {
            console.error('AdminBankController.toggleActive error:', error);
            res.status(500).json({ success: false, error: 'Error al actualizar banco' });
        }
    }

    static async updateNotes(req, res) {
        try {
            const { id } = req.params;
            const { notes } = req.body || {};
            const bank = await BankModel.findById(id);
            if (!bank) return res.status(404).json({ success: false, error: 'Banco no encontrado' });
            const updated = await BankModel.updateNotes(id, notes);
            res.json({ success: true, data: updated });
        } catch (error) {
            console.error('AdminBankController.updateNotes error:', error);
            res.status(500).json({ success: false, error: 'Error al actualizar notas' });
        }
    }
}

module.exports = AdminBankController;
