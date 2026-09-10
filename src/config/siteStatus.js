/**
 * Estado público del sitio (login, demo, secciones comerciales del landing).
 * Variable de entorno: SERVICE_CLOSED=true|false
 */
function parseBoolEnv(value, defaultValue = false) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return defaultValue;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return defaultValue;
}

const SERVICE_CLOSED = parseBoolEnv(process.env.SERVICE_CLOSED, false);

module.exports = { SERVICE_CLOSED };
