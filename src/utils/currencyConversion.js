/**
 * Conversiones USD ↔ VES sin redondeo artificial (precisión completa en JS).
 * La persistencia en SQL usa DECIMAL(18,6) — ver migración de precisión monetaria.
 */

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function numRate(value) {
    const n = num(value);
    return n > 0 ? n : 0;
}

/** USD → VES */
function usdToVes(amountUsd, exchangeRate) {
    return num(amountUsd) * numRate(exchangeRate);
}

/** VES → USD */
function vesToUsd(amountVes, exchangeRate) {
    const rate = numRate(exchangeRate);
    if (rate <= 0) return 0;
    return num(amountVes) / rate;
}

/** Monto de ítem a USD (base para % fondos, totales USD). */
function itemToUsd(amount, currency, exchangeRate) {
    const c = String(currency || 'VES').toUpperCase();
    if (c === 'USD') return num(amount);
    return vesToUsd(amount, exchangeRate);
}

/** Monto de ítem a VES (almacenamiento / cobro en bolívares). */
function itemToVes(amount, currency, exchangeRate) {
    const c = String(currency || 'VES').toUpperCase();
    if (c === 'VES') return num(amount);
    return usdToVes(amount, exchangeRate);
}

/** Suma totales de líneas del preliminar (sin redondeo). */
function sumPreliminaryTotals(items, exchangeRate) {
    let totalUsd = 0;
    let totalVes = 0;
    for (const item of items || []) {
        const base = num(item.base_amount ?? item.amount);
        const currency = item.currency || 'VES';
        totalUsd += itemToUsd(base, currency, exchangeRate);
        totalVes += itemToVes(base, currency, exchangeRate);
    }
    return { totalUsd, totalVes };
}

/** Reparte un total VES entre líneas según peso de conversión (sin redondeo). */
function allocateVesByWeight(totalVes, lineConvVesList) {
    const sum = lineConvVesList.reduce((s, v) => s + num(v), 0);
    if (sum <= 0) {
        return lineConvVesList.map((v) => num(v));
    }
    const total = num(totalVes);
    return lineConvVesList.map((v) => total * (num(v) / sum));
}

module.exports = {
    usdToVes,
    vesToUsd,
    itemToUsd,
    itemToVes,
    sumPreliminaryTotals,
    allocateVesByWeight
};
