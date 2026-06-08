/**
 * Normalización de móviles para WhatsApp (OpenWA chatId).
 * Soporta Venezuela (+58), España (+34) y Estados Unidos (+1).
 * Devuelve null si el número no es reconocible como móvil válido.
 */

const VENEZUELA_MOBILE_PREFIXES = ['424', '412', '416', '426', '414', '422'];

function digitsOnly(s) {
    if (!s || typeof s !== 'string') return '';
    return s.replace(/\D/g, '');
}

function stripLeadingZeros(d) {
    let x = d;
    while (x.startsWith('0')) x = x.slice(1);
    return x;
}

function normalizeVenezuelaMobile(d) {
    let n = d;
    if (n.startsWith('58') && n.length >= 12) n = n.slice(2);
    else if (n.startsWith('0058')) n = n.slice(4);
    n = stripLeadingZeros(n);
    if (n.length !== 10) return null;
    const prefix3 = n.slice(0, 3);
    if (!VENEZUELA_MOBILE_PREFIXES.includes(prefix3)) return null;
    return { countryCode: '58', nationalNumber: n, chatId: `58${n}@c.us` };
}

function normalizeSpainMobile(d) {
    let n = d;
    if (n.startsWith('34') && n.length >= 11) n = n.slice(2);
    else if (n.startsWith('0034')) n = n.slice(4);
    n = stripLeadingZeros(n);
    if (n.length !== 9) return null;
    const first = n[0];
    if (!['6', '7', '9'].includes(first)) return null;
    return { countryCode: '34', nationalNumber: n, chatId: `34${n}@c.us` };
}

function normalizeUsMobile(d) {
    let n = d;
    if (n.startsWith('1') && n.length === 11) n = n.slice(1);
    else if (n.startsWith('001')) n = n.slice(3);
    n = stripLeadingZeros(n);
    if (n.length !== 10) return null;
    const areaFirst = n[0];
    if (areaFirst === '0' || areaFirst === '1') return null;
    return { countryCode: '1', nationalNumber: n, chatId: `1${n}@c.us` };
}

/**
 * @param {string} raw
 * @returns {{ countryCode: string, nationalNumber: string, chatId: string, displayE164: string } | null}
 */
function normalizePhoneForWhatsApp(raw) {
    let d = digitsOnly(raw);
    if (!d) return null;

    if (d.startsWith('0058') || (d.startsWith('58') && d.length >= 12)) {
        const r = normalizeVenezuelaMobile(d);
        if (r) return { ...r, displayE164: `+${r.countryCode}${r.nationalNumber}` };
    }
    if (d.startsWith('0034') || (d.startsWith('34') && d.length >= 11)) {
        const r = normalizeSpainMobile(d);
        if (r) return { ...r, displayE164: `+${r.countryCode}${r.nationalNumber}` };
    }
    if (d.startsWith('001') || (d.startsWith('1') && d.length === 11)) {
        const r = normalizeUsMobile(d);
        if (r) return { ...r, displayE164: `+${r.countryCode}${r.nationalNumber}` };
    }

    d = stripLeadingZeros(d);

    const ve = normalizeVenezuelaMobile(d);
    if (ve) return { ...ve, displayE164: `+${ve.countryCode}${ve.nationalNumber}` };

    const es = normalizeSpainMobile(d);
    if (es) return { ...es, displayE164: `+${es.countryCode}${es.nationalNumber}` };

    const us = normalizeUsMobile(d);
    if (us) return { ...us, displayE164: `+${us.countryCode}${us.nationalNumber}` };

    return null;
}

/** @deprecated use normalizePhoneForWhatsApp */
function normalizeVenezuelaMobileForWhatsApp(raw) {
    const r = normalizePhoneForWhatsApp(raw);
    if (!r || r.countryCode !== '58') return null;
    return { countryCode: '+58', phoneNumber: r.nationalNumber };
}

module.exports = {
    normalizePhoneForWhatsApp,
    normalizeVenezuelaMobileForWhatsApp,
    digitsOnly,
    VENEZUELA_MOBILE_PREFIXES
};
