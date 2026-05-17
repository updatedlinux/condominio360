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
 * Hasta `maxAttempts` días hábiles consecutivos desde startYmd (salta sáb/dom).
 * @param {string} startYmd
 * @param {number} [maxAttempts]
 * @returns {string[]}
 */
function getBusinessDaysFrom(startYmd, maxAttempts = 3) {
    const result = [];
    let cur = startYmd;

    while (isWeekendYmd(cur)) {
        cur = addDaysYmd(cur, 1);
    }

    while (result.length < maxAttempts) {
        if (!isWeekendYmd(cur)) {
            result.push(cur);
        }
        cur = addDaysYmd(cur, 1);
        while (isWeekendYmd(cur)) {
            cur = addDaysYmd(cur, 1);
        }
    }

    return result;
}

/**
 * Objetivos al publicar un día laboral ~6 PM (no aplica en catch-up de fin de semana).
 * @param {Date} [referenceDate]
 * @returns {string[]}
 */
function getScheduledPublishTargets(referenceDate = new Date()) {
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
 * Decide qué fechas consultar en el API histórico.
 * - Si falta tasa en BD: catch-up desde el día fiscal mínimo (también sáb/dom).
 * - Si es día laboral después de las 6 PM y ya hay tasa del día: publicación del siguiente hábil.
 * @param {Date} [referenceDate]
 * @param {string|null} [storedRateDate] YYYY-MM-DD en BD
 * @param {{ forcePublish?: boolean }} [options]
 * @returns {string[]}
 */
function resolveHistoricoTargets(referenceDate = new Date(), storedRateDate = null, options = {}) {
    const minRequired = getMinimumRequiredRateDate(referenceDate);
    const stored = storedRateDate ? normalizeRateDate(storedRateDate) : null;
    const needsCatchUp = !stored || !isRateDateAdequate(stored, minRequired);

    if (needsCatchUp) {
        return getBusinessDaysFrom(minRequired, 3);
    }

    const c = getCaracasParts(referenceDate);
    const isWeekend = c.dayOfWeek === 0 || c.dayOfWeek === 6;
    if (isWeekend) {
        return [];
    }

    if (options.forcePublish || c.hour >= 18) {
        return getScheduledPublishTargets(referenceDate);
    }

    return [];
}

/** @deprecated Usar resolveHistoricoTargets */
function getHistoricoFetchTargets(referenceDate = new Date()) {
    return getScheduledPublishTargets(referenceDate);
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
 * Día civil YYYY-MM-DD de una tasa BCV (columna SQL DATE).
 * No usar zona horaria local: DATE en SQL = medianoche UTC de ese día.
 * @param {string|Date} rateDate
 * @returns {string}
 */
function normalizeRateDate(rateDate) {
    if (!rateDate) return '';
    if (typeof rateDate === 'string') {
        const m = rateDate.match(/^(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : '';
    }
    if (rateDate instanceof Date && !isNaN(rateDate.getTime())) {
        const y = rateDate.getUTCFullYear();
        const mo = String(rateDate.getUTCMonth() + 1).padStart(2, '0');
        const da = String(rateDate.getUTCDate()).padStart(2, '0');
        return `${y}-${mo}-${da}`;
    }
    const m = String(rateDate).match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
}

/**
 * Presentación dd/mm/yyyy para UI (fecha efectiva almacenada).
 * @param {string|Date} rateDate
 * @returns {string|null}
 */
function formatRateDateDisplay(rateDate) {
    const ymd = normalizeRateDate(rateDate);
    if (!ymd) return null;
    const [y, m, d] = ymd.split('-');
    return `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}`;
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
    getBusinessDaysFrom,
    getScheduledPublishTargets,
    getHistoricoFetchTargets,
    resolveHistoricoTargets,
    getMinimumRequiredRateDate,
    toHistoricoPath,
    normalizeRateDate,
    formatRateDateDisplay,
    isRateDateAdequate
};
