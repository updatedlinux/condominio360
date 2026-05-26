/**
 * Números visibles de recibo: incluyen código único del inmueble (slug) por condominio.
 * El ID real del recibo sigue siendo el UUID en BillingInvoices.id.
 */

const MAX_PROPERTY_CODE_LEN = 28;

function toSlug(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function sanitizePropertyCode(code) {
    const normalized = String(code || '')
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    if (!normalized) return 'INM';
    if (normalized.length <= MAX_PROPERTY_CODE_LEN) return normalized;
    return normalized.slice(0, MAX_PROPERTY_CODE_LEN);
}

/**
 * @param {{ slug?: string|null, name?: string, building_name?: string|null, building_slug?: string|null }} property
 * @param {{ buildingType?: string }} [options]
 */
function resolvePropertyInvoiceCode(property, options = {}) {
    const buildingType = options.buildingType || 'SINGLE';
    let base = (property.slug && String(property.slug).trim()) || toSlug(property.name);
    if (!base) base = 'inm';

    if (buildingType === 'MULTIPLE') {
        const buildingSlug = property.building_slug || toSlug(property.building_name);
        const alreadyPrefixed = buildingSlug
            && (base === buildingSlug || base.startsWith(`${buildingSlug}-`));
        if (buildingSlug && !alreadyPrefixed) {
            base = `${buildingSlug}-${base}`;
        }
    }

    return sanitizePropertyCode(base);
}

/**
 * Recibo mensual: REC-{INMUEBLE}-{AAAA}-{MM}
 * Ej: REC-APTODEMO-001-2026-03
 */
function buildMonthlyInvoiceNumber(property, billingYear, billingMonth, options = {}) {
    const code = resolvePropertyInvoiceCode(property, options);
    const year = parseInt(billingYear, 10);
    const month = String(parseInt(billingMonth, 10)).padStart(2, '0');
    return `REC-${code}-${year}-${month}`;
}

/**
 * Deuda histórica: DEUDA-HIST-{INMUEBLE}-{NN}
 */
function buildLegacyDebtInvoiceNumber(property, sequence, options = {}) {
    const code = resolvePropertyInvoiceCode(property, options);
    const seq = String(Math.max(1, parseInt(sequence, 10) || 1)).padStart(2, '0');
    return `DEUDA-HIST-${code}-${seq}`;
}

/** Extrae código del inmueble desde número de recibo (formato nuevo). */
function parsePropertyCodeFromInvoiceNumber(invoiceNumber) {
    const s = String(invoiceNumber || '').trim();
    const monthly = s.match(/^REC-(.+)-(\d{4})-(\d{2})$/i);
    if (monthly) return sanitizePropertyCode(monthly[1]);
    const legacy = s.match(/^DEUDA-HIST-(.+)-(\d{2})$/i);
    if (legacy) return sanitizePropertyCode(legacy[1]);
    return null;
}

/**
 * Código legible del inmueble para UI, PDF y correos.
 * @param {{ property_slug?: string|null, property_name?: string, building?: string|null, building_name?: string|null, building_type?: string, invoice_number?: string }} invoice
 */
function getInvoicePropertyCode(invoice, options = {}) {
    const parsed = parsePropertyCodeFromInvoiceNumber(invoice?.invoice_number);
    if (parsed) return parsed;

    const code = resolvePropertyInvoiceCode(
        {
            slug: invoice?.property_slug,
            name: invoice?.property_name,
            building_name: invoice?.building_name || invoice?.building
        },
        { buildingType: options.buildingType || invoice?.building_type || 'SINGLE' }
    );
    return code === 'INM' ? null : code;
}

function enrichInvoicePropertyCode(invoice, options = {}) {
    if (!invoice) return invoice;
    invoice.property_invoice_code = getInvoicePropertyCode(invoice, options);
    return invoice;
}

module.exports = {
    toSlug,
    sanitizePropertyCode,
    resolvePropertyInvoiceCode,
    buildMonthlyInvoiceNumber,
    buildLegacyDebtInvoiceNumber,
    parsePropertyCodeFromInvoiceNumber,
    getInvoicePropertyCode,
    enrichInvoicePropertyCode
};
