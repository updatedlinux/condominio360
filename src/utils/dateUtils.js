/**
 * Utilidades de fecha para zona horaria Venezuela (America/Caracas, GMT-4)
 */

const VENEZUELA_TZ = 'America/Caracas';

/**
 * Obtiene la fecha actual en Venezuela como YYYY-MM-DD
 * @returns {string} Fecha en formato YYYY-MM-DD
 */
function getTodayVenezuela() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: VENEZUELA_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(new Date());
    const date = {};
    parts.forEach(p => { if (p.type !== 'literal') date[p.type] = p.value; });
    return `${date.year}-${date.month}-${date.day}`;
}

module.exports = { getTodayVenezuela, VENEZUELA_TZ };
