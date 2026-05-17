const ExchangeRateModel = require('../models/ExchangeRateModel');
const { formatRateDateDisplay, normalizeRateDate } = require('../utils/bcvFiscalCalendar');

const VENEZUELA_TZ = 'America/Caracas';
const BCV_UPDATE_HOUR = 18;

/**
 * Congelamiento de tasa BCV por preliminar.
 */
class BillingRateFreezeService {
    static getVenezuelaDateParts(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: VENEZUELA_TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: 'numeric',
            hour12: false
        }).formatToParts(date);
        const get = (type) => parts.find((p) => p.type === type)?.value;
        return {
            dateStr: `${get('year')}-${get('month')}-${get('day')}`,
            hour: parseInt(get('hour'), 10) || 0
        };
    }

    static formatRateDate(d) {
        return formatRateDateDisplay(d);
    }

    /**
     * Días calendario desde creación del preliminar (día 0 = fecha de creación).
     */
    static daysSincePreliminaryCreation(createdAt, referenceDate = new Date()) {
        if (!createdAt) return 0;
        const start = BillingRateFreezeService.getVenezuelaDateParts(new Date(createdAt)).dateStr;
        const end = BillingRateFreezeService.getVenezuelaDateParts(referenceDate).dateStr;
        const d0 = new Date(`${start}T12:00:00Z`).getTime();
        const d1 = new Date(`${end}T12:00:00Z`).getTime();
        return Math.max(0, Math.round((d1 - d0) / 86400000));
    }

    static normalizeMode(mode) {
        const m = String(mode || 'NONE').toUpperCase();
        if (m === 'PERMANENT' || m === 'WINDOW') return m;
        return 'NONE';
    }

    static normalizeBitFlag(value) {
        return value === true || value === 1 || value === '1';
    }

    /**
     * Tras el mes calendario de creación (ej. creado 1-may → desde 1-jun).
     */
    static hasCalendarMonthPassedSinceCreation(createdAt, referenceDate = new Date()) {
        if (!createdAt) return false;
        const c = BillingRateFreezeService.getVenezuelaDateParts(new Date(createdAt)).dateStr;
        const r = BillingRateFreezeService.getVenezuelaDateParts(referenceDate).dateStr;
        const cYear = parseInt(c.slice(0, 4), 10);
        const cMonth = parseInt(c.slice(5, 7), 10);
        const rYear = parseInt(r.slice(0, 4), 10);
        const rMonth = parseInt(r.slice(5, 7), 10);
        return rYear > cYear || (rYear === cYear && rMonth > cMonth);
    }

    /**
     * Congelamiento permanente con migración: pasó 1 mes calendario → actualización diaria.
     */
    static isPermanentMigratedToDaily(preliminary, referenceDate = new Date()) {
        if (BillingRateFreezeService.normalizeMode(preliminary?.rate_freeze_mode) !== 'PERMANENT') {
            return false;
        }
        if (!BillingRateFreezeService.normalizeBitFlag(preliminary.rate_unpaid_migrate_after_month)) {
            return false;
        }
        return BillingRateFreezeService.hasCalendarMonthPassedSinceCreation(
            preliminary.created_at,
            referenceDate
        );
    }

    /**
     * ¿La política del preliminar exige tasa congelada en la fecha de referencia?
     */
    static isFreezeActive(preliminary, referenceDate = new Date()) {
        if (!preliminary) return false;
        const mode = BillingRateFreezeService.normalizeMode(preliminary.rate_freeze_mode);
        if (mode === 'NONE') return false;
        if (mode === 'PERMANENT') {
            if (BillingRateFreezeService.isPermanentMigratedToDaily(preliminary, referenceDate)) {
                return false;
            }
            return true;
        }
        const windowDays = parseInt(preliminary.rate_freeze_window_days, 10);
        if (!windowDays || windowDays < 1) return false;
        const elapsed = BillingRateFreezeService.daysSincePreliminaryCreation(
            preliminary.created_at,
            referenceDate
        );
        return elapsed < windowDays;
    }

    /**
     * ¿El job diario debe actualizar este recibo pendiente?
     */
    static shouldApplyDailyRateUpdate(preliminary) {
        return !BillingRateFreezeService.isFreezeActive(preliminary);
    }

    static getFrozenRate(preliminary) {
        return parseFloat(preliminary?.exchange_rate_usd) || 0;
    }

    /**
     * Contexto para el modal de creación de preliminar (alerta 6 p.m.).
     */
    static async getBcvRateContext() {
        const latest = await ExchangeRateModel.getLatest();
        const rate = latest ? parseFloat(latest.usd_rate) : 0;
        const rateDateYmd = latest?.rate_date ? normalizeRateDate(latest.rate_date) : '';
        const rateDateStr = rateDateYmd ? formatRateDateDisplay(rateDateYmd) : null;
        const { hour } = BillingRateFreezeService.getVenezuelaDateParts();
        const isAfter6Pm = hour >= BCV_UPDATE_HOUR;

        let noticeHtml;
        if (!rate) {
            noticeHtml = 'No hay tasa BCV almacenada. Actualice la tasa antes de crear el preliminar.';
        } else if (isAfter6Pm) {
            noticeHtml =
                `Tasa que se aplicará al preliminar: <strong>Bs. ${rate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> ` +
                `(fecha efectiva BCV: <strong>${rateDateStr || '—'}</strong>). ` +
                `Ya pasó la actualización diaria de las 6:00 p.m. (hora Venezuela); esta es la tasa vigente publicada para ese día.`;
        } else {
            noticeHtml =
                `Tasa que se aplicará al preliminar: <strong>Bs. ${rate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> ` +
                `(fecha efectiva almacenada: <strong>${rateDateStr || '—'}</strong>). ` +
                `<strong>A las 6:00 p.m.</strong> (hora Venezuela) el sistema puede actualizar la tasa según el BCV. ` +
                `Si crea el preliminar antes de esa hora, el monto congelado usará la tasa almacenada en este momento.`;
        }

        return {
            rate,
            rate_date: rateDateYmd || null,
            rate_date_formatted: rateDateStr,
            is_after_6pm: isAfter6Pm,
            venezuela_hour: hour,
            notice_html: noticeHtml
        };
    }

    /**
     * rate_info para UI (junta / propietario).
     */
    static buildRateInfo({
        preliminary,
        totalUsd,
        latestRate,
        pendingInvoicesCount = 0,
        allInvoicesPaid = false,
        totalVesFromInvoices = null
    }) {
        const ratePrelim = BillingRateFreezeService.getFrozenRate(preliminary);
        if (!ratePrelim) return null;

        const rateToday = latestRate ? parseFloat(latestRate.usd_rate) : ratePrelim;
        const freezeActive = BillingRateFreezeService.isFreezeActive(preliminary);
        const mode = BillingRateFreezeService.normalizeMode(preliminary.rate_freeze_mode);
        const ratePrelimDate = preliminary.exchange_rate_date
            ? BillingRateFreezeService.formatRateDate(preliminary.exchange_rate_date)
            : BillingRateFreezeService.formatRateDate(preliminary.created_at);

        const showRateDifferential =
            !allInvoicesPaid && pendingInvoicesCount > 0 && rateToday && Math.abs(rateToday - ratePrelim) > 0.001;

        const migratedToDaily = BillingRateFreezeService.isPermanentMigratedToDaily(preliminary);

        let freezeLabel = 'Sin congelamiento (tasa actualizada diariamente)';
        if (mode === 'PERMANENT') {
            if (migratedToDaily) {
                freezeLabel = 'Tasa congelada finalizada: más de 1 mes impago — actualización diaria activa';
            } else if (BillingRateFreezeService.normalizeBitFlag(preliminary.rate_unpaid_migrate_after_month)) {
                freezeLabel = 'Tasa congelada (si sigue impago tras 1 mes calendario, pasará a actualización diaria)';
            } else {
                freezeLabel = 'Tasa congelada desde la generación del preliminar';
            }
        } else if (mode === 'WINDOW') {
            const w = preliminary.rate_freeze_window_days;
            freezeLabel = freezeActive
                ? `Tasa congelada (ventana ${w} días, día ${BillingRateFreezeService.daysSincePreliminaryCreation(preliminary.created_at) + 1} de ${w})`
                : `Ventana de congelamiento (${w} días) finalizada — cobro con tasa actual`;
        }

        return {
            rate_preliminary: ratePrelim,
            rate_preliminary_date: ratePrelimDate,
            rate_today: rateToday,
            rate_today_date: latestRate?.rate_date
                ? BillingRateFreezeService.formatRateDate(latestRate.rate_date)
                : null,
            contravalue_preliminary_ves: totalUsd * ratePrelim,
            contravalue_today_ves: rateToday ? totalUsd * rateToday : null,
            total_usd: totalUsd,
            spread_pct: showRateDifferential ? ((rateToday - ratePrelim) / ratePrelim * 100) : null,
            all_invoices_paid: allInvoicesPaid,
            total_ves_from_invoices: totalVesFromInvoices,
            rate_freeze_mode: mode,
            rate_freeze_window_days: preliminary.rate_freeze_window_days || null,
            rate_unpaid_migrate_after_month: BillingRateFreezeService.normalizeBitFlag(
                preliminary.rate_unpaid_migrate_after_month
            ),
            permanent_migrated_to_daily: migratedToDaily,
            freeze_active: freezeActive,
            freeze_label: freezeLabel,
            show_rate_differential: showRateDifferential
        };
    }
}

module.exports = BillingRateFreezeService;
