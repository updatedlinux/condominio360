/**
 * Tipos de daño al inmueble — censo terremoto / Protección Civil.
 * keys estables para almacenamiento JSON en BD.
 */
const EARTHQUAKE_DAMAGE_TYPES = [
    { key: 'gas_failure', label: 'Falla de gas', icon: 'propane' },
    { key: 'electrical_failure', label: 'Falla de electricidad', icon: 'bolt' },
    { key: 'cracked_walls', label: 'Paredes agrietadas', icon: 'crop_square' },
    { key: 'water_pipe_failure', label: 'Falla de agua (tubería rota)', icon: 'water_drop' },
    { key: 'wall_displacement', label: 'Desplazamiento de pared', icon: 'open_with' },
    { key: 'ceiling_damage', label: 'Daño en techo o losa', icon: 'roofing' },
    { key: 'floor_damage', label: 'Daño en piso', icon: 'layers' },
    { key: 'broken_windows', label: 'Ventanas o puertas rotas', icon: 'window' },
    { key: 'sewage_failure', label: 'Falla de desagüe / aguas negras', icon: 'plumbing' },
    { key: 'structural_instability', label: 'Inestabilidad estructural visible', icon: 'warning' }
];

const VALID_DAMAGE_KEYS = new Set(EARTHQUAKE_DAMAGE_TYPES.map((d) => d.key));

function normalizeDamageTypes(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((k) => VALID_DAMAGE_KEYS.has(k)))];
}

function labelForDamageKey(key) {
    const item = EARTHQUAKE_DAMAGE_TYPES.find((d) => d.key === key);
    return item ? item.label : key;
}

function formatDamageLabels(keys) {
    return normalizeDamageTypes(keys).map(labelForDamageKey);
}

module.exports = {
    EARTHQUAKE_DAMAGE_TYPES,
    VALID_DAMAGE_KEYS,
    normalizeDamageTypes,
    labelForDamageKey,
    formatDamageLabels
};
