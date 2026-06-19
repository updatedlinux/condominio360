/**
 * Normalización de credenciales para login y cambio de contraseña.
 * Recorta espacios accidentales (móvil / copiar-pegar) sin alterar la contraseña interna.
 */
function normalizeLoginIdentifier(identifier) {
    return String(identifier || '').trim();
}

function normalizePassword(password) {
    return String(password ?? '').trim();
}

/**
 * Identificadores que deben autenticarse como usuario (cédula/correo),
 * no como nickname de inmueble (evita colisiones y claves desincronizadas).
 */
function looksLikeEmailOrDni(identifier) {
    const s = normalizeLoginIdentifier(identifier);
    if (!s) return false;
    if (s.includes('@')) return true;
    const compact = s.replace(/\s/g, '');
    if (/^v[-.]?\d{5,12}$/i.test(compact)) return true;
    if (/^\d{5,12}$/.test(compact)) return true;
    return false;
}

module.exports = {
    normalizeLoginIdentifier,
    normalizePassword,
    looksLikeEmailOrDni
};
