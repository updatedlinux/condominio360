/**
 * Tipos canónicos de inmueble (valor guardado en DB y usado en formularios).
 */
const CANONICAL_TYPES = ['Apartment', 'House', 'Office', 'Store', 'Parking', 'Storage', 'Lot'];

const LABELS_ES = {
    Apartment: 'Apartamento',
    House: 'Casa',
    Office: 'Oficina',
    Store: 'Local Comercial',
    Parking: 'Estacionamiento',
    Storage: 'Depósito',
    Lot: 'Terreno'
};

/** Alias (minúsculas, sin acentos) → tipo canónico */
const ALIASES = {
    apartment: 'Apartment',
    apartamento: 'Apartment',
    apt: 'Apartment',
    apto: 'Apartment',
    departamento: 'Apartment',
    apartmento: 'Apartment',

    house: 'House',
    casa: 'House',
    vivienda: 'House',
    townhome: 'House',
    townhouse: 'House',

    office: 'Office',
    oficina: 'Office',

    store: 'Store',
    local: 'Store',
    'local comercial': 'Store',
    comercio: 'Store',
    shop: 'Store',

    parking: 'Parking',
    estacionamiento: 'Parking',
    parqueo: 'Parking',
    garaje: 'Parking',
    garage: 'Parking',

    storage: 'Storage',
    deposito: 'Storage',
    bodega: 'Storage',

    lot: 'Lot',
    terreno: 'Lot',
    lote: 'Lot'
};

function _stripAccents(s) {
    return String(s)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normaliza un texto de tipo (CSV, API, etc.) al valor canónico en inglés PascalCase.
 * @param {string} raw
 * @returns {string|null}
 */
function normalizePropertyType(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    const trimmed = String(raw).trim();
    if (CANONICAL_TYPES.includes(trimmed)) return trimmed;

    const key = _stripAccents(trimmed).toLowerCase().replace(/\s+/g, ' ');
    return ALIASES[key] || null;
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizePropertyTypeOrDefault(raw, defaultType = 'Apartment') {
    return normalizePropertyType(raw) || defaultType;
}

/**
 * Etiqueta en español para mostrar en UI.
 * @param {string} type
 * @returns {string}
 */
function getPropertyTypeLabel(type) {
    const canonical = normalizePropertyType(type) || type;
    return LABELS_ES[canonical] || canonical || 'Apartamento';
}

/**
 * Lista de tipos válidos para mensajes de error.
 */
function getAcceptedTypesHint() {
    return 'Apartment, House, Office, Store, Parking, Storage, Lot (o alias: APARTAMENTO, CASA, OFICINA, etc.)';
}

module.exports = {
    CANONICAL_TYPES,
    LABELS_ES,
    normalizePropertyType,
    normalizePropertyTypeOrDefault,
    getPropertyTypeLabel,
    getAcceptedTypesHint
};
