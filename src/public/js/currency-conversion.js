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

    /**
     * Trunca hacia cero (no redondea). Solo para presentación en pantalla.
     */
    function truncateToDecimals(value, decimals = 2) {
        const x = num(value);
        const factor = 10 ** decimals;
        return Math.trunc(x * factor) / factor;
    }

    /**
     * Monto formateado para UI: truncado a 2 decimales, sin alterar el valor en memoria.
     */
    function formatAmountDisplay(amount, currency = 'VES') {
        const t = truncateToDecimals(amount, 2);
        const locale = currency === 'USD' ? 'en-US' : 'es-VE';
        const symbol = currency === 'USD' ? '$' : 'Bs.';
        const formatted = t.toLocaleString(locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return currency === 'USD' ? `${symbol} ${formatted}` : `${symbol} ${formatted}`;
    }

    function formatNumberDisplay(amount) {
        const t = truncateToDecimals(amount, 2);
        return t.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /** Valor para input type=number (muestra truncado, el modelo conserva precisión completa). */
    function inputDisplayAmount(amount) {
        if (amount === null || amount === undefined || amount === '') return '';
        return truncateToDecimals(amount, 2);
    }

    global.CurrencyConversion = {
        usdToVes,
        vesToUsd,
        itemToUsd,
        itemToVes,
        truncateToDecimals,
        formatAmountDisplay,
        formatNumberDisplay,
        inputDisplayAmount
    };
})(typeof window !== 'undefined' ? window : global);
