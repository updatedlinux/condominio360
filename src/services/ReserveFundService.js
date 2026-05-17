const ReserveFundModel = require('../models/ReserveFundModel');
const VendorContractModel = require('../models/VendorContractModel');

const NATURE_LABELS = {
    ORDINARY_RESERVE: 'Fondo de reserva ordinario',
    SAVINGS: 'Fondo de ahorro',
    MAINTENANCE: 'Mantenimiento mayor',
    OTHER: 'Otro'
};

class ReserveFundService {
    static natureLabel(code) {
        return NATURE_LABELS[code] || code;
    }

    static toVes(amount, currency, exchangeRate) {
        const n = Number(amount || 0);
        if (currency === 'USD') return n * Number(exchangeRate || 0);
        return n;
    }

    /**
     * Calcula la base en VES para un fondo según contratos seleccionados y opcionalmente ítems extraordinarios del preliminar.
     */
    static async calculateBaseVes(tenantId, fund, exchangeRate, preliminaryItems = []) {
        const contractIds = new Set((fund.contract_ids || []).map(String));
        let baseVes = 0;

        if (contractIds.size > 0) {
            const contracts = await VendorContractModel.getByTenant(tenantId);
            for (const c of contracts) {
                if (!contractIds.has(String(c.id))) continue;
                if (c.status !== 'ACTIVE') continue;
                baseVes += this.toVes(c.amount, c.currency, exchangeRate);
            }
        }

        if (fund.include_extraordinary) {
            for (const item of preliminaryItems) {
                if (item.item_type !== 'EXTRAORDINARY' && item.type !== 'EXTRAORDINARY') continue;
                const amount = item.amount ?? item.base_amount;
                const currency = item.currency || 'VES';
                baseVes += this.toVes(amount, currency, exchangeRate);
            }
        }

        return Math.round(baseVes * 100) / 100;
    }

    /**
     * Genera líneas FUND para insertar en un preliminar ordinario.
     */
    static async buildPreliminaryFundItems(tenantId, preliminaryItems, exchangeRate) {
        const funds = await ReserveFundModel.listByTenant(tenantId, { activeOnly: true });
        const out = [];

        for (const fund of funds) {
            const pct = Number(fund.percentage || 0);
            if (pct <= 0) continue;

            const baseVes = await this.calculateBaseVes(tenantId, fund, exchangeRate, preliminaryItems);
            if (baseVes <= 0 && (fund.contract_ids || []).length > 0) continue;

            const amountVes = Math.round(baseVes * (pct / 100) * 100) / 100;
            if (amountVes <= 0) continue;

            const nature = this.natureLabel(fund.fund_nature);
            out.push({
                item_type: 'FUND',
                description: `${fund.name} — ${nature} (${pct}% sobre base Bs. ${baseVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })})`,
                amount: amountVes,
                currency: 'VES',
                vendor_contract_id: null,
                reserve_fund_id: fund.id,
                notes: `Base: Bs. ${baseVes}; ${pct}%`
            });
        }

        return out;
    }

    /**
     * Vista previa para la UI al armar un preliminar.
     */
    static async previewAll(tenantId, preliminaryItems, exchangeRate) {
        const funds = await ReserveFundModel.listByTenant(tenantId, { activeOnly: true });
        const previews = [];

        for (const fund of funds) {
            const baseVes = await this.calculateBaseVes(tenantId, fund, exchangeRate, preliminaryItems);
            const pct = Number(fund.percentage || 0);
            previews.push({
                fund,
                base_ves: baseVes,
                amount_ves: Math.round(baseVes * (pct / 100) * 100) / 100,
                percentage: pct
            });
        }

        return previews;
    }
}

module.exports = ReserveFundService;
