const ReserveFundModel = require('../models/ReserveFundModel');
const VendorContractModel = require('../models/VendorContractModel');
const { itemToUsd, itemToVes, usdToVes } = require('../utils/currencyConversion');

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

    static normalizeId(id) {
        if (id == null || id === '') return null;
        return String(id).trim().toUpperCase();
    }

    static normalizeDescription(desc) {
        return String(desc || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    static itemType(item) {
        return String(item.item_type || item.type || 'ORDINARY').toUpperCase();
    }

    static contractId(item) {
        const id = item.vendor_contract_id || item.contract_id;
        return ReserveFundService.normalizeId(id);
    }

    static buildContractLookup(fund, contracts) {
        const contractIds = new Set(
            (fund.contract_ids || []).map((id) => ReserveFundService.normalizeId(id)).filter(Boolean)
        );
        const byDescription = new Map();
        const byAmountKey = new Map();

        for (const c of contracts || []) {
            const nid = ReserveFundService.normalizeId(c.id);
            if (!nid || !contractIds.has(nid)) continue;

            const descKey = ReserveFundService.normalizeDescription(
                `${c.vendor_name || ''} - ${c.description || ''}`
            );
            if (descKey && descKey !== '-') {
                byDescription.set(descKey, nid);
            }

            const amountKey = `${Number(c.amount)}|${c.currency || 'VES'}`;
            if (!byAmountKey.has(amountKey)) {
                byAmountKey.set(amountKey, nid);
            }
        }

        return { contractIds, byDescription, byAmountKey };
    }

    static resolveContractId(item, lookup) {
        const explicit = ReserveFundService.contractId(item);
        if (explicit && lookup.contractIds.has(explicit)) {
            return explicit;
        }

        const descKey = ReserveFundService.normalizeDescription(item.description);
        if (descKey && lookup.byDescription.has(descKey)) {
            return lookup.byDescription.get(descKey);
        }

        const amountKey = `${Number(item.amount ?? item.base_amount ?? 0)}|${item.currency || 'VES'}`;
        if (lookup.byAmountKey.has(amountKey)) {
            return lookup.byAmountKey.get(amountKey);
        }

        return null;
    }

    static calculateBaseUsd(fund, exchangeRate, preliminaryItems = [], contractLookup = null) {
        const lookup = contractLookup || ReserveFundService.buildContractLookup(fund, []);
        let baseUsd = 0;

        for (const item of preliminaryItems) {
            const itemType = ReserveFundService.itemType(item);
            if (itemType === 'FUND' || itemType === 'ADJUSTMENT') continue;

            const amount = item.amount ?? item.base_amount;
            const currency = item.currency || 'VES';

            if (itemType === 'EXTRAORDINARY') {
                if (!fund.include_extraordinary) continue;
                baseUsd += itemToUsd(amount, currency, exchangeRate);
                continue;
            }

            if (itemType === 'ORDINARY') {
                if (lookup.contractIds.size === 0) continue;
                const cid = ReserveFundService.resolveContractId(item, lookup);
                if (!cid) continue;
                baseUsd += itemToUsd(amount, currency, exchangeRate);
            }
        }

        return baseUsd;
    }

    static async buildPreliminaryFundItems(tenantId, preliminaryItems, exchangeRate) {
        const funds = await ReserveFundModel.listByTenant(tenantId, { activeOnly: true });
        const contracts = await VendorContractModel.getByTenant(tenantId);
        const out = [];
        const rate = Number(exchangeRate || 0);

        for (const fund of funds) {
            const pct = Number(fund.percentage || 0);
            if (pct <= 0) continue;

            const lookup = ReserveFundService.buildContractLookup(fund, contracts);
            const baseUsd = ReserveFundService.calculateBaseUsd(
                fund, rate, preliminaryItems, lookup
            );
            if (baseUsd <= 0) continue;

            const fundUsd = baseUsd * (pct / 100);
            if (fundUsd <= 0) continue;

            const amountVes = itemToVes(fundUsd, 'USD', rate);

            out.push({
                item_type: 'FUND',
                description: `${fund.name} (${pct}% sobre $ ${baseUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USD)`,
                amount: amountVes,
                currency: 'VES',
                vendor_contract_id: null,
                reserve_fund_id: fund.id,
                notes: `Base: $ ${baseUsd} USD; ${pct}%`
            });
        }

        return out;
    }

    static async previewAll(tenantId, preliminaryItems, exchangeRate) {
        const funds = await ReserveFundModel.listByTenant(tenantId, { activeOnly: true });
        const contracts = await VendorContractModel.getByTenant(tenantId);
        const rate = Number(exchangeRate || 0);
        const previews = [];

        for (const fund of funds) {
            const lookup = ReserveFundService.buildContractLookup(fund, contracts);
            const baseUsd = ReserveFundService.calculateBaseUsd(
                fund, rate, preliminaryItems, lookup
            );
            const pct = Number(fund.percentage || 0);
            const fundUsd = baseUsd * (pct / 100);
            previews.push({
                fund,
                base_usd: baseUsd,
                fund_usd: fundUsd,
                base_ves: usdToVes(baseUsd, rate),
                amount_ves: usdToVes(fundUsd, rate),
                percentage: pct
            });
        }

        return previews;
    }
}

module.exports = ReserveFundService;
