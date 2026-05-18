const { v4: uuidv4 } = require('uuid');
const { sql, connectDB } = require('../config/database');
const ExchangeRateModel = require('../models/ExchangeRateModel');
const PropertyHistoricalDebtModel = require('../models/PropertyHistoricalDebtModel');
const BillingRateFreezeService = require('./BillingRateFreezeService');
const { itemToUsd, usdToVes } = require('../utils/currencyConversion');
const { normalizeRateDate } = require('../utils/bcvFiscalCalendar');

const USD_EPSILON = 0.000001;

class HistoricalDebtService {
    static toSlug(s) {
        return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    static resolvePropertySlug(inmuebleSlug, tenantProperties, buildingType) {
        const slug = String(inmuebleSlug || '').trim();
        if (!slug) return null;
        return tenantProperties.find((p) => {
            const pSlug = p.slug || HistoricalDebtService.toSlug(p.name);
            const buildingSlug = p.building_name ? HistoricalDebtService.toSlug(p.building_name) : null;
            const fullSlug = buildingType === 'MULTIPLE' && buildingSlug
                ? `${buildingSlug}-${pSlug}` : pSlug;
            return fullSlug === slug || pSlug === slug;
        }) || null;
    }

    static normalizeFreezeMode(mode) {
        return BillingRateFreezeService.normalizeMode(mode);
    }

    static parseRow(row, rowIndex) {
        const label = row.inmueble_slug || `Fila ${rowIndex}`;
        const inmueble_slug = String(row.inmueble_slug || '').trim();
        const monto = parseFloat(String(row.monto || '').replace(',', '.'));
        const moneda = String(row.moneda || 'USD').trim().toUpperCase();
        const descripcion = String(row.descripcion || row.description || 'Deuda histórica pre-sistema').trim();
        const congelamiento = HistoricalDebtService.normalizeFreezeMode(
            row.congelamiento_tasa || row.rate_freeze_mode || 'NONE'
        );
        const diasVentanaRaw = row.dias_ventana ?? row.rate_freeze_window_days;
        const dias_ventana = diasVentanaRaw != null && diasVentanaRaw !== ''
            ? parseInt(diasVentanaRaw, 10) : null;
        const migrarRaw = row.migrar_mes_impago ?? row.rate_unpaid_migrate_after_month;
        const migrar_mes_impago = migrarRaw === true || migrarRaw === 1 || migrarRaw === '1'
            || String(migrarRaw || '').toLowerCase() === 'true' || String(migrarRaw || '').toLowerCase() === 'si';

        if (!inmueble_slug) throw new Error(`${label}: inmueble_slug es requerido`);
        if (!Number.isFinite(monto) || monto <= 0) throw new Error(`${label}: monto inválido`);
        if (!['USD', 'VES'].includes(moneda)) throw new Error(`${label}: moneda debe ser USD o VES`);
        if (congelamiento === 'WINDOW' && (!dias_ventana || dias_ventana < 1)) {
            throw new Error(`${label}: dias_ventana es requerido cuando congelamiento_tasa es WINDOW`);
        }
        if (congelamiento !== 'PERMANENT' && migrar_mes_impago) {
            throw new Error(`${label}: migrar_mes_impago solo aplica con congelamiento PERMANENT`);
        }

        return {
            inmueble_slug,
            monto,
            moneda,
            descripcion: descripcion || 'Deuda histórica pre-sistema',
            rate_freeze_mode: congelamiento,
            rate_freeze_window_days: congelamiento === 'WINDOW' ? dias_ventana : null,
            rate_unpaid_migrate_after_month: congelamiento === 'PERMANENT' ? migrar_mes_impago : false
        };
    }

    static async getExchangeContext() {
        const latest = await ExchangeRateModel.getLatest();
        if (!latest?.usd_rate) {
            throw new Error('No hay tasa BCV disponible. Actualice la tasa antes de cargar deuda histórica.');
        }
        const rate = parseFloat(latest.usd_rate);
        const rateDate = normalizeRateDate(latest.rate_date_ymd || latest.rate_date) || null;
        return { rate, rateDate };
    }

    static computePrincipalUsd(amount, currency, exchangeRate) {
        return itemToUsd(amount, currency, exchangeRate);
    }

    static async createOne(tenantId, payload, createdBy) {
        const pool = await connectDB();
        const transaction = pool.transaction();
        await transaction.begin();
        try {
            const result = await HistoricalDebtService._createInTransaction(
                transaction, tenantId, payload, createdBy
            );
            await transaction.commit();
            return result;
        } catch (e) {
            await transaction.rollback();
            throw e;
        }
    }

    static async bulkCreate(tenantId, rows, createdBy) {
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error('Se requiere al menos un registro');
        }

        const pool = await connectDB();
        const tenantRes = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT building_type, billing_mode FROM Tenants WHERE id = @tenant_id');
        const tenant = tenantRes.recordset[0];
        if (!tenant) throw new Error('Condominio no encontrado');
        if ((tenant.billing_mode || 'FULL') !== 'FULL') {
            throw new Error('La deuda histórica solo está disponible en modo de facturación completo');
        }

        const propsResult = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT p.id, p.name, p.slug, b.name AS building_name
                FROM Properties p
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.tenant_id = @tenant_id
            `);
        const tenantProperties = propsResult.recordset || [];
        const buildingType = tenant.building_type || 'SINGLE';
        const { rate, rateDate } = await HistoricalDebtService.getExchangeContext();

        const parsed = [];
        const seenProperties = new Set();
        for (let i = 0; i < rows.length; i++) {
            const p = HistoricalDebtService.parseRow(rows[i], i + 1);
            const prop = HistoricalDebtService.resolvePropertySlug(p.inmueble_slug, tenantProperties, buildingType);
            if (!prop) {
                throw new Error(`Fila ${i + 1}: el slug "${p.inmueble_slug}" no existe en este condominio`);
            }
            if (seenProperties.has(String(prop.id).toLowerCase())) {
                throw new Error(`Fila ${i + 1}: inmueble duplicado en el archivo (${p.inmueble_slug})`);
            }
            seenProperties.add(String(prop.id).toLowerCase());
            const active = await PropertyHistoricalDebtModel.findActiveByProperty(prop.id, tenantId);
            if (active) {
                throw new Error(`Fila ${i + 1}: el inmueble "${p.inmueble_slug}" ya tiene deuda histórica activa`);
            }
            parsed.push({ ...p, property_id: prop.id, property_name: prop.name });
        }

        const transaction = pool.transaction();
        await transaction.begin();
        try {
            const created = [];
            for (const row of parsed) {
                const one = await HistoricalDebtService._createInTransaction(
                    transaction,
                    tenantId,
                    {
                        property_id: row.property_id,
                        amount: row.monto,
                        currency: row.moneda,
                        description: row.descripcion,
                        rate_freeze_mode: row.rate_freeze_mode,
                        rate_freeze_window_days: row.rate_freeze_window_days,
                        rate_unpaid_migrate_after_month: row.rate_unpaid_migrate_after_month,
                        exchange_rate: rate,
                        exchange_rate_date: rateDate
                    },
                    createdBy
                );
                created.push(one);
            }
            await transaction.commit();
            return created;
        } catch (e) {
            await transaction.rollback();
            throw e;
        }
    }

    static async _createInTransaction(transaction, tenantId, payload, createdBy) {
        const propertyId = payload.property_id;
        if (!propertyId) throw new Error('property_id es requerido');

        const active = await transaction.request()
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT 1 FROM PropertyHistoricalDebts
                WHERE property_id = @property_id AND tenant_id = @tenant_id AND status = N'ACTIVE'
            `);
        if (active.recordset.length > 0) {
            throw new Error('Este inmueble ya tiene una deuda histórica activa');
        }

        const rate = payload.exchange_rate ?? (await HistoricalDebtService.getExchangeContext()).rate;
        const rateDate = payload.exchange_rate_date
            ?? (await HistoricalDebtService.getExchangeContext()).rateDate;
        const amount = parseFloat(payload.amount);
        const currency = String(payload.currency || 'USD').toUpperCase();
        const principalUsd = HistoricalDebtService.computePrincipalUsd(amount, currency, rate);
        if (principalUsd <= 0) throw new Error('El monto en USD debe ser mayor a cero');

        const assignedVes = usdToVes(principalUsd, rate);
        const freezeMode = HistoricalDebtService.normalizeFreezeMode(payload.rate_freeze_mode);
        const invoiceId = uuidv4();
        const debtId = uuidv4();
        const now = new Date();

        const countRes = await transaction.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT COUNT(*) AS cnt FROM BillingInvoices
                WHERE tenant_id = @tenant_id AND invoice_kind = N'LEGACY_DEBT'
            `);
        const seq = (parseInt(countRes.recordset[0]?.cnt, 10) || 0) + 1;
        const invoiceNumber = `DEUDA-HIST-${String(seq).padStart(4, '0')}`;

        const ownerRes = await transaction.request()
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .query(`
                SELECT TOP 1 user_id FROM PropertyOwners
                WHERE property_id = @property_id
                ORDER BY is_primary_owner DESC, percentage_ownership DESC
            `);
        const ownerId = ownerRes.recordset[0]?.user_id || null;

        await transaction.request()
            .input('id', sql.UniqueIdentifier, invoiceId)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .input('property_id', sql.UniqueIdentifier, propertyId)
            .input('owner_id', sql.UniqueIdentifier, ownerId)
            .input('invoice_number', sql.NVarChar, invoiceNumber)
            .input('total_amount_usd', sql.Decimal(18, 6), principalUsd)
            .input('total_amount_ves', sql.Decimal(18, 6), assignedVes)
            .input('assigned_amount_usd', sql.Decimal(18, 6), principalUsd)
            .input('assigned_amount_ves', sql.Decimal(18, 6), assignedVes)
            .input('exchange_rate_at_creation', sql.Decimal(18, 6), rate)
            .input('current_exchange_rate', sql.Decimal(18, 6), rate)
            .input('legacy_exchange_rate_usd', sql.Decimal(18, 6), rate)
            .input('legacy_exchange_rate_date', sql.Date, rateDate)
            .input('legacy_rate_freeze_mode', sql.NVarChar, freezeMode)
            .input('legacy_rate_freeze_window_days', sql.Int, payload.rate_freeze_window_days ?? null)
            .input('legacy_rate_unpaid_migrate_after_month', sql.Bit, payload.rate_unpaid_migrate_after_month ? 1 : 0)
            .input('legacy_debt_created_at', sql.DateTime2, now)
            .query(`
                INSERT INTO BillingInvoices (
                    id, tenant_id, preliminary_id, property_id, owner_id,
                    invoice_kind, invoice_number, status,
                    total_amount_usd, total_amount_ves, assigned_amount_usd, assigned_amount_ves,
                    proportion_type, proportion_value,
                    exchange_rate_at_creation, current_exchange_rate,
                    legacy_exchange_rate_usd, legacy_exchange_rate_date,
                    legacy_rate_freeze_mode, legacy_rate_freeze_window_days,
                    legacy_rate_unpaid_migrate_after_month, legacy_debt_created_at,
                    sent_to_owners, sent_at
                )
                VALUES (
                    @id, @tenant_id, NULL, @property_id, @owner_id,
                    N'LEGACY_DEBT', @invoice_number, N'PENDING',
                    @total_amount_usd, @total_amount_ves, @assigned_amount_usd, @assigned_amount_ves,
                    N'FULL', 1,
                    @exchange_rate_at_creation, @current_exchange_rate,
                    @legacy_exchange_rate_usd, @legacy_exchange_rate_date,
                    @legacy_rate_freeze_mode, @legacy_rate_freeze_window_days,
                    @legacy_rate_unpaid_migrate_after_month, @legacy_debt_created_at,
                    1, SYSDATETIME()
                )
            `);

        const desc = payload.description || 'Deuda histórica pre-sistema';
        await transaction.request()
            .input('invoice_id', sql.UniqueIdentifier, invoiceId)
            .input('description', sql.NVarChar, desc)
            .input('base_amount', sql.Decimal(18, 6), amount)
            .input('currency', sql.NVarChar, currency)
            .input('converted_amount_ves', sql.Decimal(18, 6), assignedVes)
            .input('assigned_amount_ves', sql.Decimal(18, 6), assignedVes)
            .query(`
                INSERT INTO BillingInvoiceItems (
                    invoice_id, item_type, description, base_amount, currency,
                    converted_amount_ves, assigned_amount_ves
                )
                VALUES (
                    @invoice_id, N'LEGACY_DEBT', @description, @base_amount, @currency,
                    @converted_amount_ves, @assigned_amount_ves
                )
            `);

        const debt = await PropertyHistoricalDebtModel.insertInTransaction(transaction, {
            id: debtId,
            tenant_id: tenantId,
            property_id: propertyId,
            invoice_id: invoiceId,
            description: desc,
            input_amount: amount,
            input_currency: currency,
            principal_usd: principalUsd,
            exchange_rate_at_creation: rate,
            exchange_rate_date: rateDate,
            rate_freeze_mode: freezeMode,
            rate_freeze_window_days: payload.rate_freeze_window_days ?? null,
            rate_unpaid_migrate_after_month: payload.rate_unpaid_migrate_after_month || false,
            created_by: createdBy
        });

        await transaction.request()
            .input('invoice_id', sql.UniqueIdentifier, invoiceId)
            .input('debt_id', sql.UniqueIdentifier, debt.id)
            .query(`
                UPDATE BillingInvoices SET historical_debt_id = @debt_id WHERE id = @invoice_id
            `);

        return { debt, invoice_id: invoiceId, invoice_number: invoiceNumber };
    }

    static getFreezeContextFromInvoice(invoice) {
        if (String(invoice?.invoice_kind || '').toUpperCase() !== 'LEGACY_DEBT') {
            return null;
        }
        return {
            rate_freeze_mode: invoice.legacy_rate_freeze_mode,
            rate_freeze_window_days: invoice.legacy_rate_freeze_window_days,
            rate_unpaid_migrate_after_month: invoice.legacy_rate_unpaid_migrate_after_month,
            created_at: invoice.legacy_debt_created_at,
            exchange_rate_usd: invoice.legacy_exchange_rate_usd
        };
    }

    static isLegacyInvoice(invoice) {
        return String(invoice?.invoice_kind || '').toUpperCase() === 'LEGACY_DEBT';
    }

    static isFullyPaid(balanceUsd) {
        return parseFloat(balanceUsd) <= USD_EPSILON;
    }
}

module.exports = HistoricalDebtService;
