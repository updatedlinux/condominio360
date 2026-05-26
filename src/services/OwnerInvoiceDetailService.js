const BillingModel = require('../models/BillingModel');
const ExchangeRateModel = require('../models/ExchangeRateModel');
const BillingRateFreezeService = require('./BillingRateFreezeService');
const HistoricalDebtService = require('./HistoricalDebtService');
const { itemToVes, allocateVesByWeight } = require('../utils/currencyConversion');
const { enrichInvoicePropertyCode } = require('../utils/invoiceNumber');
const { sql, connectDB } = require('../config/database');

/**
 * Prepara el detalle de un recibo para propietario (vista web y PDF).
 */
class OwnerInvoiceDetailService {

    static resolveDisplayStatus(invoice) {
        const isLegacy = invoice.invoice_kind === 'LEGACY_DEBT';
        const balanceUsd = parseFloat(invoice.assigned_amount_usd) || 0;
        const paidUsd = parseFloat(invoice.paid_amount_usd) || 0;

        if (invoice.status === 'PAID') {
            return { key: 'PAID', label: 'Pagado', stamp: true };
        }
        if (isLegacy && paidUsd > 0.000001 && balanceUsd > 0.000001) {
            return { key: 'PARTIAL', label: 'Pago parcial', stamp: false };
        }
        return { key: 'PENDING', label: 'Pendiente de pago', stamp: false };
    }

    /**
     * @returns {Promise<{ invoice, tenant, displayStatus, paymentReport }|null>} null si no encontrado
     * @throws con status 403/404 vía err.status
     */
    static async prepareForOwner(invoiceId, tenantId, userId) {
        const invoice = await BillingModel.getInvoiceWithItems(invoiceId, tenantId);
        if (!invoice) {
            const err = new Error('Recibo no encontrado');
            err.status = 404;
            throw err;
        }

        const pool = await connectDB();
        const ownerCheck = await pool.request()
            .input('property_id', sql.UniqueIdentifier, invoice.property_id)
            .input('user_id', sql.UniqueIdentifier, userId)
            .query('SELECT 1 FROM PropertyOwners WHERE property_id = @property_id AND user_id = @user_id');

        if (ownerCheck.recordset.length === 0) {
            const err = new Error('No tienes acceso a este recibo');
            err.status = 403;
            throw err;
        }

        if (!invoice.sent_to_owners) {
            const err = new Error('Este recibo aún no está disponible');
            err.status = 403;
            throw err;
        }

        const tenantResult = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT id, name, slug, logo_path FROM Tenants WHERE id = @tenant_id');

        const tenant = tenantResult.recordset[0] || { name: 'Condominio', logo_path: null };
        if (tenant.logo_path) {
            tenant.logo_url = `/uploads/${tenant.logo_path}`;
        }

        const latestRate = await ExchangeRateModel.getLatest();
        const preliminary = HistoricalDebtService.isLegacyInvoice(invoice)
            ? HistoricalDebtService.getFreezeContextFromInvoice(invoice)
            : {
                exchange_rate_usd: invoice.exchange_rate_preliminary,
                exchange_rate_date: invoice.preliminary_exchange_rate_date,
                rate_freeze_mode: invoice.rate_freeze_mode,
                rate_freeze_window_days: invoice.rate_freeze_window_days,
                rate_unpaid_migrate_after_month: invoice.rate_unpaid_migrate_after_month,
                created_at: invoice.preliminary_created_at
            };

        const rateCurrent = parseFloat(invoice.current_exchange_rate)
            || parseFloat(invoice.exchange_rate_at_creation)
            || BillingRateFreezeService.getFrozenRate(preliminary);

        const totalUsd = parseFloat(invoice.total_amount_usd)
            || (parseFloat(invoice.assigned_amount_ves) / (rateCurrent || 1));

        const paymentReport = await BillingModel.getLatestPaymentReport(invoiceId);
        if (paymentReport && paymentReport.status === 'PENDING_CONFIRMATION') {
            invoice.has_pending_payment_report = true;
        }

        const rateInfo = BillingRateFreezeService.buildRateInfo({
            preliminary,
            totalUsd,
            latestRate,
            pendingInvoicesCount: invoice.status === 'PENDING' ? 1 : 0,
            allInvoicesPaid: invoice.status === 'PAID'
        });
        if (rateInfo) {
            rateInfo.rate_current = rateCurrent;
            rateInfo.contravalue_current_ves = parseFloat(invoice.assigned_amount_ves);
        }
        invoice.rate_info = rateInfo;

        if (invoice.items && rateCurrent) {
            const itemsRecalc = invoice.items.map((it) => {
                const base = parseFloat(it.base_amount) || 0;
                const convVes = itemToVes(base, it.currency, rateCurrent);
                return { ...it, _convVes: convVes };
            });
            const convList = itemsRecalc.map((it) => it._convVes);
            const totalVes = parseFloat(invoice.assigned_amount_ves) || 0;
            const allocated = allocateVesByWeight(totalVes, convList);
            invoice.items = itemsRecalc.map((it, idx) => {
                const { _convVes, ...rest } = it;
                return {
                    ...rest,
                    assigned_amount_ves: allocated[idx],
                    converted_amount_ves: _convVes
                };
            });
            if (invoice.items.length === 1) {
                invoice.items[0].assigned_amount_ves = totalVes;
            }
        }

        invoice._rateCurrent = rateCurrent;
        invoice._totalUsd = totalUsd;

        enrichInvoicePropertyCode(invoice);

        const displayStatus = this.resolveDisplayStatus(invoice);

        return { invoice, tenant, displayStatus, paymentReport };
    }
}

module.exports = OwnerInvoiceDetailService;
