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

/**
 * Límites UTC (inicio inclusivo, fin exclusivo) para abarcar días completos en Venezuela (GMT-4).
 * Misma convención que SecurityController: medianoche VE del día `from` → 04:00 UTC; fin del día `to` → medianoche VE día siguiente.
 * @param {string} fromYmd YYYY-MM-DD
 * @param {string} toYmd YYYY-MM-DD
 */
function venezuelaDateRangeToUtcBounds(fromYmd, toYmd) {
    const [fy, fm, fd] = fromYmd.split('-').map(Number);
    const [ty, tm, td] = toYmd.split('-').map(Number);
    const rangeStart = new Date(Date.UTC(fy, fm - 1, fd, 4, 0, 0, 0));
    const rangeEndExclusive = new Date(Date.UTC(ty, tm - 1, td + 1, 4, 0, 0, 0));
    return { rangeStart, rangeEndExclusive };
}

module.exports = { getTodayVenezuela, VENEZUELA_TZ, venezuelaDateRangeToUtcBounds };
