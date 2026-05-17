/**
 * Utilidades de tipo de inmueble (cliente). Mantener en sync con src/utils/propertyType.js
 */
(function (global) {
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
        office: 'Office',
        oficina: 'Office',
        store: 'Store',
        local: 'Store',
        'local comercial': 'Store',
        parking: 'Parking',
        estacionamiento: 'Parking',
        parqueo: 'Parking',
        storage: 'Storage',
        deposito: 'Storage',
        bodega: 'Storage',
        lot: 'Lot',
        terreno: 'Lot',
        lote: 'Lot'
    };

    function stripAccents(s) {
        return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function normalizePropertyType(raw) {
        if (raw == null || String(raw).trim() === '') return null;
        const trimmed = String(raw).trim();
        if (CANONICAL_TYPES.includes(trimmed)) return trimmed;
        const key = stripAccents(trimmed).toLowerCase().replace(/\s+/g, ' ');
        return ALIASES[key] || null;
    }

    function normalizePropertyTypeOrDefault(raw, defaultType) {
        return normalizePropertyType(raw) || defaultType || 'Apartment';
    }

    function getPropertyTypeLabel(type) {
        const canonical = normalizePropertyType(type) || type;
        return LABELS_ES[canonical] || canonical || 'Apartamento';
    }

    function propertyTypeToSelectValue(type) {
        return normalizePropertyTypeOrDefault(type, 'Apartment');
    }

    global.PropertyTypeUtils = {
        CANONICAL_TYPES,
        LABELS_ES,
        normalizePropertyType,
        normalizePropertyTypeOrDefault,
        getPropertyTypeLabel,
        propertyTypeToSelectValue
    };
})(typeof window !== 'undefined' ? window : global);
