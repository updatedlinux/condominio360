const VENEZUELA_TZ = 'America/Caracas';

/**
 * Fecha de vencimiento: 1.er día del mes siguiente al período facturado.
 * Ej. período mayo 2026 → vence 1 de junio de 2026.
 * @param {number} billingYear
 * @param {number} billingMonth 1-12
 * @returns {Date} medianoche UTC anclada al día civil en Caracas
 */
function getInvoiceDueDate(billingYear, billingMonth) {
    const y = parseInt(billingYear, 10);
    const m = parseInt(billingMonth, 10);
    if (!y || !m || m < 1 || m > 12) return null;
    const dueMonthIndex = m; // mes siguiente (m es 1-12, Date usa 0-index: m=5 → junio)
    return new Date(Date.UTC(y, dueMonthIndex, 1, 12, 0, 0));
}

function getCaracasDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: VENEZUELA_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return {
        year: parseInt(get('year'), 10),
        month: parseInt(get('month'), 10),
        day: parseInt(get('day'), 10)
    };
}

function calendarDaysBetween(startDate, endDate = new Date()) {
    const s = getCaracasDateParts(startDate);
    const e = getCaracasDateParts(endDate);
    const t0 = Date.UTC(s.year, s.month - 1, s.day);
    const t1 = Date.UTC(e.year, e.month - 1, e.day);
    return Math.max(0, Math.round((t1 - t0) / 86400000));
}

function getIsoWeekKey(date = new Date()) {
    const p = getCaracasDateParts(date);
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const MONTH_NAMES_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

function formatPeriodLabel(billingMonth, billingYear) {
    const m = parseInt(billingMonth, 10);
    const y = parseInt(billingYear, 10);
    if (!m || !y) return 'Período no indicado';
    return `${MONTH_NAMES_ES[m - 1]} ${y}`;
}

module.exports = {
    getInvoiceDueDate,
    calendarDaysBetween,
    getCaracasDateParts,
    getIsoWeekKey,
    formatPeriodLabel,
    MONTH_NAMES_ES
};
