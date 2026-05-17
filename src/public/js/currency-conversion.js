/**
 * Conversiones USD ↔ VES en el cliente (sin Math.round en montos).
 */
(function (global) {
    function num(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }

    function numRate(value) {
        const n = num(value);
        return n > 0 ? n : 0;
    }

    function usdToVes(amountUsd, exchangeRate) {
        return num(amountUsd) * numRate(exchangeRate);
    }

    function vesToUsd(amountVes, exchangeRate) {
        const rate = numRate(exchangeRate);
        if (rate <= 0) return 0;
        return num(amountVes) / rate;
    }

    function itemToUsd(amount, currency, exchangeRate) {
        const c = String(currency || 'VES').toUpperCase();
        if (c === 'USD') return num(amount);
        return vesToUsd(amount, exchangeRate);
    }

    function itemToVes(amount, currency, exchangeRate) {
        const c = String(currency || 'VES').toUpperCase();
        if (c === 'VES') return num(amount);
        return usdToVes(amount, exchangeRate);
    }

    global.CurrencyConversion = {
        usdToVes,
        vesToUsd,
        itemToUsd,
        itemToVes
    };
})(typeof window !== 'undefined' ? window : global);
