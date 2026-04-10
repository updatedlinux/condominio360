/**
 * Normalización solo para móviles Venezuela (operadoras habituales).
 * countryCode "+58", phoneNumber: 10 dígitos sin prefijo de país.
 * No modifica la BD.
 *
 * Si el número no es un móvil VE reconocible (p. ej. +34, +1, fijo, etc.),
 * devuelve null → no se encola WhatsApp para ese propietario.
 */

/** Códigos de área móvil (sin el 4 inicial común: 4 + XX) → prefijos de 3 dígitos nacionales */
const VENEZUELA_MOBILE_PREFIXES = ['424', '412', '416', '426', '414', '422'];

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

    // Código país Venezuela explícito: 58 + nacional (típicamente 12 dígitos en total)
    if (d.startsWith('58') && d.length >= 12) {
        d = d.slice(2);
    } else if (d.startsWith('0058')) {
        d = d.slice(4);
    }

    // Formato local 04XX…
    while (d.startsWith('0')) {
        d = d.slice(1);
    }

    // Debe quedar exactamente el número nacional de 10 dígitos (4XX + 7 dígitos)
    if (d.length !== 10) {
        return null;
    }

    const prefix3 = d.slice(0, 3);
    if (!VENEZUELA_MOBILE_PREFIXES.includes(prefix3)) {
        return null;
    }

    return { countryCode: '+58', phoneNumber: d };
}

module.exports = {
    normalizeVenezuelaMobileForWhatsApp,
    digitsOnly,
    VENEZUELA_MOBILE_PREFIXES
};
