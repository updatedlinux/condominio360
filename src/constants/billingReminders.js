/** Precio por inmueble SaaS por defecto (USD). */
const DEFAULT_SAAS_UNIT_PRICE_USD = 0.5;

/**
 * Días desde la fecha de vencimiento (1.er día del mes siguiente al período facturado)
 * en los que se envía un recordatorio acumulado de recibos vencidos.
 */
const OVERDUE_REMINDER_MILESTONES_DAYS = [1, 45, 60, 90, 120, 150, 180, 210, 240];

module.exports = {
    DEFAULT_SAAS_UNIT_PRICE_USD,
    OVERDUE_REMINDER_MILESTONES_DAYS
};
