/**
 * Calendario fiscal BCV (Venezuela): la tasa publicada ~6 PM aplica al día hábil bancario siguiente.
 * Feriados bancarios se detectan por respuesta vacía del API histórico.
 */
const TZ = 'America/Caracas';

/**
 * @param {Date} [date]
 * @returns {{ year: number, month: number, day: number, dayOfWeek: number, hour: number, minute: number }}
 */
function getCaracasParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(date);

    const get = (type) => parts.find((p) => p.type === type)?.value;
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    return {
        year: parseInt(get('year'), 10),
        month: parseInt(get('month'), 10),
        day: parseInt(get('day'), 10),
        dayOfWeek: weekdayMap[get('weekday')] ?? 0,
        hour: parseInt(get('hour'), 10),
        minute: parseInt(get('minute'), 10)
    };
}

/**
 * @param {{ year: number, month: number, day: number }} p
 * @returns {string} YYYY-MM-DD
 */
function toYmd(p) {
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * @param {string} ymd
 * @returns {{ year: number, month: number, day: number }}
 */
function parseYmd(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return { year: y, month: m, day: d };
}

/**
 * @param {string} ymd
 * @param {number} days
 * @returns {string}
 */
function addDaysYmd(ymd, days) {
    const p = parseYmd(ymd);
    const dt = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
    return toYmd({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() });
}

/**
 * @param {string} ymd
 * @returns {boolean}
 */
function isWeekendYmd(ymd) {
    const p = parseYmd(ymd);
    const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    return dow === 0 || dow === 6;
}

/**
 * Primer día hábil bancario estrictamente después de ymd (salta sáb/dom).
 * @param {string} ymd
 * @returns {string}
 */
function nextBusinessDayAfter(ymd) {
    let cur = addDaysYmd(ymd, 1);
    while (isWeekendYmd(cur)) {
        cur = addDaysYmd(cur, 1);
    }
    return cur;
}

/**
 * Fechas a consultar en el API histórico al publicar (~6 PM hora Venezuela).
 * - Lun–Jue: día hábil siguiente.
 * - Vie: lunes (+3), martes (+4), miércoles (+5) como hasta 3 intentos.
 * - Sáb/Dom: sin publicación (se usa la última tasa guardada).
 * @param {Date} [referenceDate]
 * @returns {string[]}
 */
function getHistoricoFetchTargets(referenceDate = new Date()) {
    const c = getCaracasParts(referenceDate);
    const today = toYmd(c);

    if (c.dayOfWeek === 0 || c.dayOfWeek === 6) {
        return [];
    }

    if (c.dayOfWeek === 5) {
        return [addDaysYmd(today, 3), addDaysYmd(today, 4), addDaysYmd(today, 5)];
    }

    return [nextBusinessDayAfter(today)];
}

/**
 * Fecha fiscal mínima que debe existir en BD para operar en este momento.
 * @param {Date} [referenceDate]
 * @returns {string}
 */
function getMinimumRequiredRateDate(referenceDate = new Date()) {
    const c = getCaracasParts(referenceDate);
    const today = toYmd(c);
    const afterPublishWindow = c.hour >= 18;

    if (c.dayOfWeek === 0 || c.dayOfWeek === 6) {
        return nextBusinessDayAfter(today);
    }

    if (afterPublishWindow) {
        return nextBusinessDayAfter(today);
    }

    return today;
}

/**
 * @param {string} ymd
 * @returns {string} YYYY/MM/DD para ve.dolarapi.com histórico
 */
function toHistoricoPath(ymd) {
    const p = parseYmd(ymd);
    return `${p.year}/${String(p.month).padStart(2, '0')}/${String(p.day).padStart(2, '0')}`;
}

/**
 * @param {string|Date} rateDate
 * @returns {string}
 */
function normalizeRateDate(rateDate) {
    if (!rateDate) return '';
    if (typeof rateDate === 'string') return rateDate.slice(0, 10);
    if (rateDate instanceof Date) return rateDate.toISOString().slice(0, 10);
    return String(rateDate).slice(0, 10);
}

/**
 * @param {string} storedDate
 * @param {string} requiredDate
 * @returns {boolean}
 */
function isRateDateAdequate(storedDate, requiredDate) {
    const s = normalizeRateDate(storedDate);
    const r = normalizeRateDate(requiredDate);
    return s >= r;
}

module.exports = {
    TZ,
    getCaracasParts,
    toYmd,
    parseYmd,
    addDaysYmd,
    isWeekendYmd,
    nextBusinessDayAfter,
    getHistoricoFetchTargets,
    getMinimumRequiredRateDate,
    toHistoricoPath,
    normalizeRateDate,
    isRateDateAdequate
};
