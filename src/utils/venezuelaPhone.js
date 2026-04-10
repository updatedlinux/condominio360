/**
 * Normaliza teléfonos móviles venezolanos al formato esperado por el API externo:
 * countryCode "+58", phoneNumber nacional sin prefijo (10 dígitos típicos 4XXXXXXXXX).
 * No modifica datos en BD; solo para el envío.
 *
 * Ejemplos: 04242967747 → 4242967747, 4242967747 → 4242967747, +584242967747 → 4242967747
 */

function digitsOnly(s) {
    if (!s || typeof s !== 'string') return '';
    return s.replace(/\D/g, '');
}

/**
 * @param {string} raw
 * @returns {{ countryCode: string, phoneNumber: string } | null}
 */
function normalizeVenezuelaMobileForWhatsApp(raw) {
    let d = digitsOnly(raw);
    if (!d) return null;

    if (d.startsWith('58') && d.length >= 12) {
        d = d.slice(2);
    } else if (d.startsWith('058') && d.length >= 13) {
        d = d.slice(3);
    }

    while (d.startsWith('0')) {
        d = d.slice(1);
    }

    if (d.length > 10 && d.startsWith('4')) {
        d = d.slice(0, 10);
    }

    if (d.length === 10 && /^4\d{9}$/.test(d)) {
        return { countryCode: '+58', phoneNumber: d };
    }

    if (d.length === 11 && d.startsWith('4')) {
        const ten = d.slice(0, 10);
        if (/^4\d{9}$/.test(ten)) {
            return { countryCode: '+58', phoneNumber: ten };
        }
    }

    return null;
}

module.exports = {
    normalizeVenezuelaMobileForWhatsApp,
    digitsOnly
};
