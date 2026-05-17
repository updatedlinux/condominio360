const ReserveFundModel = require('../models/ReserveFundModel');

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

    /** Monto expresado en USD (base única para el % del fondo). */
    static toUsd(amount, currency, exchangeRate) {
        const n = Number(amount || 0);
        const rate = Number(exchangeRate || 0);
        if (currency === 'USD') return n;
        if (rate <= 0) return 0;
        return n / rate;
    }

    static itemType(item) {
        return String(item.item_type || item.type || 'ORDINARY').toUpperCase();
    }

    static contractId(item) {
        const id = item.vendor_contract_id || item.contract_id;
        return id != null ? String(id) : null;
    }

    /**
     * Base en USD: suma de ítems del preliminar (no de BD), convertidos a USD con la tasa BCV.
     * - Ordinarios: solo si su contrato está seleccionado en el fondo.
     * - Extraordinarios: solo si include_extraordinary.
     */
    static calculateBaseUsd(fund, exchangeRate, preliminaryItems = []) {
        const contractIds = new Set((fund.contract_ids || []).map(String));
        let baseUsd = 0;

        for (const item of preliminaryItems) {
            const itemType = this.itemType(item);
            if (itemType === 'FUND' || itemType === 'ADJUSTMENT') continue;

            const amount = item.amount ?? item.base_amount;
            const currency = item.currency || 'VES';

            if (itemType === 'EXTRAORDINARY') {
                if (!fund.include_extraordinary) continue;
                baseUsd += this.toUsd(amount, currency, exchangeRate);
                continue;
            }

            if (itemType === 'ORDINARY') {
                if (contractIds.size === 0) continue;
                const cid = this.contractId(item);
                if (!cid || !contractIds.has(cid)) continue;
                baseUsd += this.toUsd(amount, currency, exchangeRate);
            }
        }

        return Math.round(baseUsd * 100) / 100;
    }

    /**
     * Genera líneas FUND para insertar en un preliminar ordinario.
     */
    static async buildPreliminaryFundItems(tenantId, preliminaryItems, exchangeRate) {
        const funds = await ReserveFundModel.listByTenant(tenantId, { activeOnly: true });
        const out = [];
        const rate = Number(exchangeRate || 0);

        for (const fund of funds) {
            const pct = Number(fund.percentage || 0);
            if (pct <= 0) continue;

            const baseUsd = this.calculateBaseUsd(fund, rate, preliminaryItems);
            if (baseUsd <= 0) continue;

            const fundUsd = Math.round(baseUsd * (pct / 100) * 100) / 100;
            if (fundUsd <= 0) continue;

            const amountVes = Math.round(fundUsd * rate * 100) / 100;

            out.push({
                item_type: 'FUND',
                description: `${fund.name} (${pct}% sobre $ ${baseUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD)`,
                amount: amountVes,
                currency: 'VES',
                vendor_contract_id: null,
                reserve_fund_id: fund.id,
                notes: `Base: $ ${baseUsd} USD; ${pct}%`
            });
        }

        return out;
    }

    /**
     * Vista previa para la UI al armar un preliminar.
     */
    static async previewAll(tenantId, preliminaryItems, exchangeRate) {
        const funds = await ReserveFundModel.listByTenant(tenantId, { activeOnly: true });
        const rate = Number(exchangeRate || 0);
        const previews = [];

        for (const fund of funds) {
            const baseUsd = this.calculateBaseUsd(fund, rate, preliminaryItems);
            const pct = Number(fund.percentage || 0);
            const fundUsd = Math.round(baseUsd * (pct / 100) * 100) / 100;
            previews.push({
                fund,
                base_usd: baseUsd,
                fund_usd: fundUsd,
                base_ves: Math.round(baseUsd * rate * 100) / 100,
                amount_ves: Math.round(fundUsd * rate * 100) / 100,
                percentage: pct
            });
        }

        return previews;
    }
}

module.exports = ReserveFundService;
