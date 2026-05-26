const path = require('path');
const ExcelJS = require('exceljs');
const VendorModel = require('../models/VendorModel');
const VendorContractModel = require('../models/VendorContractModel');
const BillingModel = require('../models/BillingModel');
const ExchangeRateModel = require('../models/ExchangeRateModel');
const EmailService = require('../services/EmailService');
const ReserveFundModel = require('../models/ReserveFundModel');
const ReserveFundService = require('../services/ReserveFundService');
const BillingRateFreezeService = require('../services/BillingRateFreezeService');
const {
    itemToUsd,
    itemToVes,
    sumPreliminaryTotals,
    allocateVesByWeight
} = require('../utils/currencyConversion');
const { normalizeRateDate, formatRateDateDisplay } = require('../utils/bcvFiscalCalendar');
const { buildMonthlyInvoiceNumber, enrichInvoicePropertyCode, getInvoicePropertyCode } = require('../utils/invoiceNumber');
const { sql, connectDB } = require('../config/database');

/**
 * TenantAdmin Billing Controller
 * Gestión completa de facturación de condominios
 */
class TenantAdminBillingController {

    // ==================== CONFIGURACIÓN ====================

    /**
     * GET /api/tenant-admin/billing/config
     * Obtener configuración de facturación del tenant
     */
    /**
     * GET /api/tenant-admin/billing/bcv-rate-context
     * Tasa almacenada + aviso 6 p.m. para modal de preliminar.
     */
    static async getBcvRateContext(req, res) {
        try {
            const data = await BillingRateFreezeService.getBcvRateContext();
            if (!data.rate) {
                return res.status(400).json({
                    success: false,
                    error: 'No hay tasa BCV almacenada. Intente actualizar la tasa.'
                });
            }
            res.json({ success: true, data });
        } catch (error) {
            console.error('getBcvRateContext error:', error);
            res.status(500).json({ success: false, error: 'Error al obtener contexto de tasa BCV' });
        }
    }

    static _parseRateFreezeFromBody(body) {
        const mode = BillingRateFreezeService.normalizeMode(body.rate_freeze_mode);
        let windowDays = null;
        if (mode === 'WINDOW') {
            windowDays = parseInt(body.rate_freeze_window_days, 10);
            if (![5, 10, 15].includes(windowDays)) {
                const err = new Error('La ventana de congelamiento debe ser 5, 10 o 15 días');
                err.statusCode = 400;
                throw err;
            }
        }
        let unpaidMigrateAfterMonth = false;
        if (mode === 'PERMANENT') {
            unpaidMigrateAfterMonth = body.rate_unpaid_migrate_after_month === true
                || body.rate_unpaid_migrate_after_month === 'true'
                || body.rate_unpaid_migrate_after_month === '1'
                || body.rate_unpaid_migrate_after_month === 1;
        }
        return { mode, windowDays, unpaidMigrateAfterMonth };
    }

    static _preliminaryExchangeRateDate(latestRate) {
        if (!latestRate?.rate_date) return null;
        const ymd = normalizeRateDate(latestRate.rate_date);
        return ymd || null;
    }

    static _preliminaryFromInvoiceRow(inv) {
        return {
            exchange_rate_usd: inv.exchange_rate_preliminary,
            exchange_rate_date: inv.preliminary_exchange_rate_date,
            rate_freeze_mode: inv.rate_freeze_mode,
            rate_freeze_window_days: inv.rate_freeze_window_days,
            rate_unpaid_migrate_after_month: inv.rate_unpaid_migrate_after_month,
            created_at: inv.preliminary_created_at
        };
    }

    static _buildInvoiceRateInfo(invoice, latestRate) {
        const preliminary = TenantAdminBillingController._preliminaryFromInvoiceRow(invoice);
        const rateCurrent = parseFloat(invoice.current_exchange_rate)
            || parseFloat(invoice.exchange_rate_at_creation)
            || BillingRateFreezeService.getFrozenRate(preliminary);
        const totalUsd = parseFloat(invoice.total_amount_usd)
            || (parseFloat(invoice.assigned_amount_ves) / (rateCurrent || 1));
        const pending = invoice.status === 'PENDING' ? 1 : 0;
        const info = BillingRateFreezeService.buildRateInfo({
            preliminary,
            totalUsd,
            latestRate,
            pendingInvoicesCount: pending,
            allInvoicesPaid: invoice.status === 'PAID'
        });
        if (!info) return null;
        info.rate_current = rateCurrent;
        info.contravalue_current_ves = parseFloat(invoice.assigned_amount_ves);
        return info;
    }

    static async getConfig(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const pool = await connectDB();
            
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT billing_type, billing_mode, payment_info
                    FROM Tenants
                    WHERE id = @tenant_id
                `);
            
            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Tenant no encontrado' });
            }

            const config = result.recordset[0];
            
            // Obtener tasa BCV actual (fecha efectiva de la API, no la de extracción)
            const latestRate = await ExchangeRateModel.getLatest();
            const exchangeRate = latestRate ? latestRate.usd_rate : 0;
            const rateDate = latestRate?.rate_date ? new Date(latestRate.rate_date).toISOString().split('T')[0] : null;
            
            res.json({
                success: true,
                data: {
                    billing_type: config.billing_type || 'ALICUOTA',
                    billing_mode: config.billing_mode || 'FULL',
                    payment_info: config.payment_info ? JSON.parse(config.payment_info) : null,
                    usd_to_ves_rate: exchangeRate,
                    rate_date: rateDate
                }
            });
        } catch (error) {
            console.error('Get billing config error:', error);
            res.status(500).json({ error: 'Error al obtener configuración' });
        }
    }

    /**
     * PUT /api/tenant-admin/billing/config
     * Actualizar configuración de facturación
     */
    static async updateConfig(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { billing_type, billing_mode, payment_info } = req.body;

            const pool = await connectDB();
            
            const updates = [];
            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            if (billing_type !== undefined) {
                if (!['ALICUOTA', 'FIXED'].includes(billing_type)) {
                    return res.status(400).json({ error: 'Tipo de facturación inválido' });
                }
                updates.push('billing_type = @billing_type');
                request.input('billing_type', sql.NVarChar, billing_type);
            }

            if (billing_mode !== undefined) {
                if (!['FULL', 'SUPPORT'].includes(billing_mode)) {
                    return res.status(400).json({ error: 'Modo de facturación inválido' });
                }
                updates.push('billing_mode = @billing_mode');
                request.input('billing_mode', sql.NVarChar, billing_mode);
            }

            if (payment_info !== undefined) {
                updates.push('payment_info = @payment_info');
                request.input('payment_info', sql.NVarChar, JSON.stringify(payment_info));
            }

            if (updates.length === 0) {
                return res.status(400).json({ error: 'No hay campos para actualizar' });
            }

            await request.query(`
                UPDATE Tenants SET ${updates.join(', ')}, updated_at = SYSDATETIME()
                WHERE id = @tenant_id
            `);

            res.json({
                success: true,
                message: 'Configuración actualizada'
            });
        } catch (error) {
            console.error('Update billing config error:', error);
            res.status(500).json({ error: 'Error al actualizar configuración' });
        }
    }

    // ==================== PROVEEDORES ====================

    /**
     * GET /api/tenant-admin/billing/vendors
     */
    static async listVendors(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const vendors = await VendorModel.getByTenant(tenantId);
            
            res.json({
                success: true,
                data: vendors
            });
        } catch (error) {
            console.error('List vendors error:', error);
            res.status(500).json({ error: 'Error al obtener proveedores' });
        }
    }

    /**
     * POST /api/tenant-admin/billing/vendors
     */
    static async createVendor(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { name, description, contact_name, contact_email, contact_phone, service_type } = req.body;

            if (!name) {
                return res.status(400).json({ error: 'El nombre es requerido' });
            }

            const vendor = await VendorModel.create({
                tenant_id: tenantId,
                name,
                description,
                contact_name,
                contact_email,
                contact_phone,
                service_type
            });

            res.status(201).json({
                success: true,
                data: vendor
            });
        } catch (error) {
            console.error('Create vendor error:', error);
            res.status(500).json({ error: 'Error al crear proveedor' });
        }
    }

    /**
     * PUT /api/tenant-admin/billing/vendors/:id
     */
    static async updateVendor(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;

            const vendor = await VendorModel.update(id, tenantId, req.body);
            
            if (!vendor) {
                return res.status(404).json({ error: 'Proveedor no encontrado' });
            }

            res.json({
                success: true,
                data: vendor
            });
        } catch (error) {
            console.error('Update vendor error:', error);
            res.status(500).json({ error: 'Error al actualizar proveedor' });
        }
    }

    /**
     * DELETE /api/tenant-admin/billing/vendors/:id
     */
    static async deleteVendor(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;

            const vendor = await VendorModel.delete(id, tenantId);
            
            if (!vendor) {
                return res.status(404).json({ error: 'Proveedor no encontrado' });
            }

            res.json({
                success: true,
                message: 'Proveedor eliminado'
            });
        } catch (error) {
            console.error('Delete vendor error:', error);
            res.status(500).json({ error: 'Error al eliminar proveedor' });
        }
    }

    // ==================== CONTRATOS ====================

    /**
     * GET /api/tenant-admin/billing/contracts
     */
    static async listContracts(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { active } = req.query;
            
            let contracts;
            if (active === 'true') {
                contracts = await VendorContractModel.getActiveByTenant(tenantId);
            } else {
                contracts = await VendorContractModel.getByTenant(tenantId);
            }
            
            res.json({
                success: true,
                data: contracts
            });
        } catch (error) {
            console.error('List contracts error:', error);
            res.status(500).json({ error: 'Error al obtener contratos' });
        }
    }

    /**
     * POST /api/tenant-admin/billing/contracts
     */
    static async createContract(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { vendor_id, description, amount, currency, billing_frequency, start_date, end_date } = req.body;

            if (!vendor_id || !description || amount === undefined || !start_date) {
                return res.status(400).json({ error: 'Faltan campos requeridos' });
            }

            const contract = await VendorContractModel.create({
                vendor_id,
                tenant_id: tenantId,
                description,
                amount,
                currency: currency || 'VES',
                billing_frequency: billing_frequency || 'MONTHLY',
                start_date,
                end_date
            });

            res.status(201).json({
                success: true,
                data: contract
            });
        } catch (error) {
            console.error('Create contract error:', error);
            res.status(500).json({ error: 'Error al crear contrato' });
        }
    }

    /**
     * PUT /api/tenant-admin/billing/contracts/:id
     */
    static async updateContract(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;

            const contract = await VendorContractModel.update(id, tenantId, req.body);
            
            if (!contract) {
                return res.status(404).json({ error: 'Contrato no encontrado' });
            }

            res.json({
                success: true,
                data: contract
            });
        } catch (error) {
            console.error('Update contract error:', error);
            res.status(500).json({ error: 'Error al actualizar contrato' });
        }
    }

    /**
     * DELETE /api/tenant-admin/billing/contracts/:id
     */
    static async deleteContract(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;

            const contract = await VendorContractModel.delete(id, tenantId);
            
            if (!contract) {
                return res.status(404).json({ error: 'Contrato no encontrado' });
            }

            res.json({
                success: true,
                message: 'Contrato eliminado'
            });
        } catch (error) {
            console.error('Delete contract error:', error);
            res.status(500).json({ error: 'Error al eliminar contrato' });
        }
    }

    // ==================== FONDOS DE RESERVA / AHORRO ====================

    static async listReserveFunds(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const funds = await ReserveFundModel.listByTenant(tenantId);
            res.json({ success: true, data: funds });
        } catch (error) {
            console.error('List reserve funds error:', error);
            res.status(500).json({ error: 'Error al listar fondos de reserva' });
        }
    }

    static async createReserveFund(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { name, fund_nature, percentage, include_extraordinary, contract_ids, notes } = req.body;
            if (!name || percentage === undefined) {
                return res.status(400).json({ error: 'Nombre y porcentaje son requeridos' });
            }
            const pct = Number(percentage);
            if (pct <= 0 || pct > 100) {
                return res.status(400).json({ error: 'El porcentaje debe estar entre 0 y 100' });
            }
            const fund = await ReserveFundModel.create({
                tenant_id: tenantId,
                name,
                fund_nature: fund_nature || 'ORDINARY_RESERVE',
                percentage: pct,
                include_extraordinary: !!include_extraordinary,
                contract_ids: contract_ids || [],
                notes
            });
            res.status(201).json({ success: true, data: fund });
        } catch (error) {
            console.error('Create reserve fund error:', error);
            res.status(500).json({ error: 'Error al crear fondo de reserva' });
        }
    }

    static async updateReserveFund(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            const body = { ...req.body };
            if (body.percentage !== undefined) {
                const pct = Number(body.percentage);
                if (pct <= 0 || pct > 100) {
                    return res.status(400).json({ error: 'El porcentaje debe estar entre 0 y 100' });
                }
                body.percentage = pct;
            }
            const fund = await ReserveFundModel.update(id, tenantId, body);
            if (!fund) return res.status(404).json({ error: 'Fondo no encontrado' });
            res.json({ success: true, data: fund });
        } catch (error) {
            console.error('Update reserve fund error:', error);
            res.status(500).json({ error: 'Error al actualizar fondo de reserva' });
        }
    }

    static async deleteReserveFund(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            const fund = await ReserveFundModel.deactivate(id, tenantId);
            if (!fund) return res.status(404).json({ error: 'Fondo no encontrado' });
            res.json({ success: true, message: 'Fondo desactivado' });
        } catch (error) {
            console.error('Delete reserve fund error:', error);
            res.status(500).json({ error: 'Error al desactivar fondo' });
        }
    }

    static async previewReserveFunds(req, res) {
        try {
            const tenantId = req.user.tenantId;
            let items = req.body?.items;
            if (typeof items === 'string') {
                try { items = JSON.parse(items); } catch (_) { items = []; }
            }
            const latestRate = await ExchangeRateModel.getLatest();
            const exchangeRate = latestRate ? latestRate.usd_rate : 0;
            if (!exchangeRate) {
                return res.status(400).json({ error: 'No hay tasa BCV disponible' });
            }
            const previews = await ReserveFundService.previewAll(tenantId, items || [], exchangeRate);
            res.json({ success: true, data: { previews, exchange_rate: exchangeRate } });
        } catch (error) {
            console.error('Preview reserve funds error:', error);
            res.status(500).json({ error: 'Error al calcular fondos' });
        }
    }

    // ==================== PRELIMINARES ====================

    /**
     * GET /api/tenant-admin/billing/preliminaries
     */
    static async listPreliminaries(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { status, months_back } = req.query;
            
            const preliminaries = await BillingModel.getPreliminariesByTenant(tenantId, { status, months_back });
            
            res.json({
                success: true,
                data: preliminaries
            });
        } catch (error) {
            console.error('List preliminaries error:', error);
            res.status(500).json({ error: 'Error al obtener preliminares' });
        }
    }

    /**
     * GET /api/tenant-admin/billing/preliminaries/:id
     */
    static async getPreliminary(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            
            const preliminary = await BillingModel.getPreliminaryWithItems(id, tenantId);
            
            if (!preliminary) {
                return res.status(404).json({ error: 'Preliminar no encontrado' });
            }

            // Tasa actual para mostrar totales actualizados
            const latestRate = await ExchangeRateModel.getLatest();
            const rateToday = latestRate ? parseFloat(latestRate.usd_rate) : null;
            const ratePrelim = parseFloat(preliminary.exchange_rate_usd) || 0;
            const totalUsd = parseFloat(preliminary.total_amount_usd) || 0;

            const recalculated = rateToday ? {
                total_ves: TenantAdminBillingController._recalcPreliminaryTotals(preliminary.items || [], rateToday).totalVes,
                items: (preliminary.items || []).map(it => {
                    const base = parseFloat(it.base_amount) || 0;
                    const convVes = itemToVes(base, it.currency, rateToday);
                    return { ...it, converted_amount_ves: convVes };
                })
            } : null;

            preliminary.recalculated = recalculated;

            // Obtener estadísticas
            const stats = await BillingModel.getBillingStats(tenantId, id);
            
            // Si está finalizado, obtener los recibos generados (PAID = congelados, PENDING = varían con tasa)
            let invoices = [];
            let totalVesFromInvoices = null;
            let allInvoicesPaid = false;
            let pendingInvoicesCount = 0;

            if (preliminary.status === 'FINALIZED') {
                const pool = await connectDB();
                const invoicesResult = await pool.request()
                    .input('preliminary_id', sql.UniqueIdentifier, id)
                    .input('tenant_id', sql.UniqueIdentifier, tenantId)
                    .query(`
                        SELECT i.*, p.name as property_name, p.building
                        FROM BillingInvoices i
                        INNER JOIN Properties p ON i.property_id = p.id
                        WHERE i.preliminary_id = @preliminary_id AND i.tenant_id = @tenant_id
                        ORDER BY p.building, p.name
                    `);
                invoices = invoicesResult.recordset;
                totalVesFromInvoices = invoices.reduce((sum, inv) => sum + (parseFloat(inv.assigned_amount_ves) || 0), 0);
                pendingInvoicesCount = invoices.filter(inv => inv.status === 'PENDING').length;
                allInvoicesPaid = pendingInvoicesCount === 0;
            }

            preliminary.rate_info = BillingRateFreezeService.buildRateInfo({
                preliminary,
                totalUsd,
                latestRate,
                pendingInvoicesCount,
                allInvoicesPaid,
                totalVesFromInvoices
            });

            res.json({
                success: true,
                data: {
                    ...preliminary,
                    stats,
                    invoices
                }
            });
        } catch (error) {
            console.error('Get preliminary error:', error);
            res.status(500).json({ error: 'Error al obtener preliminar' });
        }
    }

    /**
     * DELETE /api/tenant-admin/billing/preliminaries/:id
     * Eliminar preliminar (solo si está en DRAFT)
     */
    static async deletePreliminary(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            
            const result = await BillingModel.deletePreliminary(id, tenantId);
            
            if (result.success) {
                res.json({ success: true, message: 'Preliminar eliminado correctamente' });
            } else {
                res.status(400).json({ success: false, error: result.error });
            }
        } catch (error) {
            console.error('Delete preliminary error:', error);
            res.status(500).json({ error: 'Error al eliminar preliminar' });
        }
    }

    /**
     * POST /api/tenant-admin/billing/preliminaries
     * Crear preliminar con items
     */
    static async createPreliminary(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const userId = req.user.userId;

            const isMultipart = req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data');
            let body = req.body;
            if (isMultipart) {
                body = { ...req.body };
                if (typeof body.items === 'string') {
                    try {
                        body.items = JSON.parse(body.items);
                    } catch (e) {
                        return res.status(400).json({ error: 'Formato de items inválido' });
                    }
                }
                if (body.billing_month != null && body.billing_month !== '') {
                    body.billing_month = parseInt(body.billing_month, 10);
                }
                if (body.billing_year != null && body.billing_year !== '') {
                    body.billing_year = parseInt(body.billing_year, 10);
                }
                if (body.rate_freeze_window_days != null && body.rate_freeze_window_days !== '') {
                    body.rate_freeze_window_days = parseInt(body.rate_freeze_window_days, 10);
                }
            }

            const { billing_month, billing_year, name, items } = body;

            if (!billing_month || !billing_year || !items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'Mes, año e items son requeridos' });
            }

            const fileByIndex = {};
            if (req.files && Array.isArray(req.files)) {
                for (const f of req.files) {
                    const m = /^attachment_(\d+)$/.exec(f.fieldname);
                    if (m) {
                        fileByIndex[parseInt(m[1], 10)] = f;
                    }
                }
            }

            let rateFreeze;
            try {
                rateFreeze = TenantAdminBillingController._parseRateFreezeFromBody(body);
            } catch (e) {
                return res.status(e.statusCode || 400).json({ error: e.message });
            }

            const latestRate = await ExchangeRateModel.getLatest();
            const exchangeRate = latestRate ? latestRate.usd_rate : 0;
            const exchangeRateDate = TenantAdminBillingController._preliminaryExchangeRateDate(latestRate);

            if (exchangeRate === 0) {
                return res.status(400).json({ error: 'No hay tasa BCV disponible. Intente más tarde.' });
            }

            // Determinar tipo de preliminar
            let invoiceType = 'ORDINARY';
            if (body.target_building) {
                invoiceType = 'EXTRAORDINARY_BUILDING';
            } else if (body.target_property) {
                invoiceType = 'EXTRAORDINARY_PROPERTY';
            } else if (body.is_extraordinary) {
                invoiceType = 'EXTRAORDINARY';
            }

            const pool = await connectDB();

            let itemsToProcess = [...items];
            const isOrdinaryPreliminary = invoiceType === 'ORDINARY';

            if (isOrdinaryPreliminary) {
                const modeRes = await pool.request()
                    .input('tenant_id', sql.UniqueIdentifier, tenantId)
                    .query('SELECT billing_mode FROM Tenants WHERE id = @tenant_id');
                const billingMode = modeRes.recordset[0]?.billing_mode || 'FULL';

                if (billingMode === 'FULL') {
                    const autoFundIds = new Set();
                    const fundItems = await ReserveFundService.buildPreliminaryFundItems(
                        tenantId,
                        itemsToProcess,
                        exchangeRate
                    );
                    fundItems.forEach((fi) => {
                        if (fi.reserve_fund_id) autoFundIds.add(String(fi.reserve_fund_id));
                    });
                    itemsToProcess = itemsToProcess.filter(
                        (i) => !(i.item_type === 'FUND' && i.reserve_fund_id && autoFundIds.has(String(i.reserve_fund_id)))
                    );
                    itemsToProcess = [...itemsToProcess, ...fundItems];
                }
            }

            // Crear preliminar
            const preliminary = await BillingModel.createPreliminary({
                tenant_id: tenantId,
                billing_month,
                billing_year,
                name: name || `Recibo ${billing_month}/${billing_year}`,
                exchange_rate_usd: exchangeRate,
                exchange_rate_date: exchangeRateDate,
                rate_freeze_mode: rateFreeze.mode,
                rate_freeze_window_days: rateFreeze.windowDays,
                rate_unpaid_migrate_after_month: rateFreeze.unpaidMigrateAfterMonth,
                created_by: userId,
                invoice_type: invoiceType
            });

            // Agregar items y calcular totales
            let totalUsd = 0;
            let totalVes = 0;

            for (let i = 0; i < itemsToProcess.length; i++) {
                const item = itemsToProcess[i];
                let itemUsd;
                let itemVes;

                itemUsd = itemToUsd(item.amount, item.currency, exchangeRate);
                itemVes = itemToVes(item.amount, item.currency, exchangeRate);

                let attachment_path = null;
                let attachment_mime = null;
                const up = fileByIndex[i];
                if (up && up.path) {
                    attachment_path = `/uploads/billing-preliminary-items/${tenantId}/${path.basename(up.path)}`;
                    attachment_mime = up.mimetype || null;
                }

                await BillingModel.addPreliminaryItem({
                    preliminary_id: preliminary.id,
                    item_type: item.item_type,
                    description: item.description,
                    vendor_contract_id: item.vendor_contract_id || null,
                    base_amount: item.amount,
                    currency: item.currency,
                    converted_amount_ves: itemVes,
                    notes: item.notes,
                    attachment_path,
                    attachment_mime,
                    reserve_fund_id: item.reserve_fund_id || null
                });

                totalUsd += itemUsd;
                totalVes += itemVes;
            }

            // Actualizar totales del preliminar (manteniendo estado DRAFT)
            await BillingModel.updatePreliminaryTotals(preliminary.id, tenantId, {
                total_usd: totalUsd,
                total_ves: totalVes
            });

            res.status(201).json({
                success: true,
                data: await BillingModel.getPreliminaryWithItems(preliminary.id, tenantId)
            });
        } catch (error) {
            console.error('Create preliminary error:', error);
            res.status(500).json({ error: 'Error al crear preliminar' });
        }
    }

    /**
     * POST /api/tenant-admin/billing/preliminaries/:id/generate
     * Generar recibos para todos los inmuebles o para un edificio específico
     */
    static async generateInvoices(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            const { building } = req.query; // Edificio específico (opcional)

            // Obtener preliminar
            const preliminary = await BillingModel.getPreliminaryWithItems(id, tenantId);
            
            if (!preliminary) {
                return res.status(404).json({ error: 'Preliminar no encontrado' });
            }

            if (preliminary.status !== 'DRAFT') {
                return res.status(400).json({ error: 'El preliminar ya fue procesado' });
            }

            const exchangeRate = parseFloat(preliminary.exchange_rate_usd) || 0;
            if (exchangeRate === 0) {
                return res.status(400).json({ error: 'No hay tasa BCV en el preliminar.' });
            }
            const { totalUsd: recalcTotalUsd, totalVes: recalcTotalVes } = TenantAdminBillingController._recalcPreliminaryTotals(preliminary.items, exchangeRate);

            // Obtener configuración del tenant
            const pool = await connectDB();
            const tenantResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT billing_type FROM Tenants WHERE id = @tenant_id');
            
            const billingType = tenantResult.recordset[0]?.billing_type || 'ALICUOTA';

            // Obtener inmuebles (todos o filtrados por edificio)
            let buildingName = building;
            
            // Si el parámetro building parece ser un UUID (ID), buscar el nombre del edificio
            if (building && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(building)) {
                const buildingResult = await pool.request()
                    .input('id', sql.UniqueIdentifier, building)
                    .input('tenant_id', sql.UniqueIdentifier, tenantId)
                    .query('SELECT name FROM Buildings WHERE id = @id AND tenant_id = @tenant_id');
                
                if (buildingResult.recordset.length > 0) {
                    buildingName = buildingResult.recordset[0].name;
                    console.log(`[Billing] Edificio encontrado: ${buildingName}`);
                }
            }
            
            // Debug: Ver todos los inmuebles y sus edificios
            const debugResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT id, name, building, building_id FROM Properties WHERE tenant_id = @tenant_id');
            console.log(`[Billing] Total inmuebles: ${debugResult.recordset.length}`);
            console.log(`[Billing] Buscando edificio: '${buildingName}' (ID: ${building})`);
            
            let propertiesQuery = `
                SELECT p.id, p.name, p.slug, p.building, p.alicuota, b.name AS building_name
                FROM Properties p
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.tenant_id = @tenant_id`;
            if (building) {
                propertiesQuery += ' AND p.building_id = @buildingId';
            }
            propertiesQuery += ' ORDER BY p.name';

            const tenantMetaRes = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT building_type FROM Tenants WHERE id = @tenant_id');
            const buildingType = tenantMetaRes.recordset[0]?.building_type || 'SINGLE';
            
            const propertiesRequest = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId);
            
            if (building) {
                propertiesRequest.input('buildingId', sql.UniqueIdentifier, building);
            }
            
            const propertiesResult = await propertiesRequest.query(propertiesQuery);
            const properties = propertiesResult.recordset;
            
            console.log(`[Billing] Inmuebles encontrados: ${properties.length}`);
            
            if (properties.length === 0) {
                return res.status(400).json({ error: buildingName ? `No hay inmuebles en el edificio/calle ${buildingName}` : 'No hay inmuebles para generar recibos' });
            }

            // Calcular proporciones
            let totalProportion = 0;
            const propertyProportions = properties.map(p => {
                let proportion;
                if (billingType === 'ALICUOTA') {
                    proportion = (p.alicuota || 0) / 100; // Convertir porcentaje a decimal
                } else {
                    proportion = 1 / properties.length; // Partes iguales
                }
                totalProportion += proportion;
                return { ...p, proportion };
            });

            // Generar recibos (número visible incluye código del inmueble)
            const invoices = [];

            for (const prop of propertyProportions) {
                const assignedAmountUsd = recalcTotalUsd * (prop.proportion / totalProportion);
                const assignedAmountVes = recalcTotalVes * (prop.proportion / totalProportion);

                const invoiceNumber = buildMonthlyInvoiceNumber(
                    prop,
                    preliminary.billing_year,
                    preliminary.billing_month,
                    { buildingType }
                );

                const invoice = await BillingModel.createInvoice({
                    tenant_id: tenantId,
                    preliminary_id: id,
                    property_id: prop.id,
                    owner_id: null, // Se puede actualizar después
                    invoice_number: invoiceNumber,
                    total_amount_usd: recalcTotalUsd,
                    total_amount_ves: recalcTotalVes,
                    assigned_amount_usd: assignedAmountUsd,
                    assigned_amount_ves: assignedAmountVes,
                    proportion_type: billingType,
                    proportion_value: prop.proportion,
                    exchange_rate_at_creation: exchangeRate,
                    current_exchange_rate: exchangeRate
                });

                // Agregar items desglosados (recalculados con tasa actual)
                for (const item of preliminary.items) {
                    const itemConvVes = itemToVes(item.base_amount, item.currency, exchangeRate);
                    const assignedItemAmount = itemConvVes * (prop.proportion / totalProportion);
                    
                    await BillingModel.addInvoiceItem({
                    invoice_id: invoice.id,
                    item_type: item.item_type,
                    description: item.description,
                    base_amount: item.base_amount,
                    currency: item.currency,
                    converted_amount_ves: itemConvVes,
                    assigned_amount_ves: assignedItemAmount,
                        notes: item.notes,
                        attachment_path: item.attachment_path || null,
                        attachment_mime: item.attachment_mime || null
                    });
                }

                invoices.push(invoice);
            }

            // Finalizar preliminar (con totales recalculados)
            await BillingModel.finalizePreliminary(id, tenantId, {
                total_usd: recalcTotalUsd,
                total_ves: recalcTotalVes
            });

            // En modo FULL, encolar notificaciones a propietarios
            const billingModeResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT billing_mode FROM Tenants WHERE id = @tenant_id');
            
            if (billingModeResult.recordset[0]?.billing_mode === 'FULL') {
                // Encolar notificaciones para cada inmueble
                for (const invoice of invoices) {
                    await TenantAdminBillingController.queueInvoiceNotification(invoice.id, tenantId);
                }
            }

            res.json({
                success: true,
                message: building 
                    ? `${invoices.length} recibos generados para ${building}` 
                    : `${invoices.length} recibos generados exitosamente`,
                data: {
                    invoices_count: invoices.length,
                    preliminary_id: id,
                    building: building || null
                }
            });
        } catch (error) {
            console.error('Generate invoices error:', error);
            res.status(500).json({ error: 'Error al generar recibos' });
        }
    }

    /**
     * POST /api/tenant-admin/billing/preliminaries/:id/generate-property/:propertyId
     * Generar recibo para un inmueble específico (cobro directo)
     */
    static async generateInvoiceForProperty(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id, propertyId } = req.params;

            // Obtener preliminar
            const preliminary = await BillingModel.getPreliminaryWithItems(id, tenantId);
            
            if (!preliminary) {
                return res.status(404).json({ error: 'Preliminar no encontrado' });
            }

            if (preliminary.status !== 'DRAFT') {
                return res.status(400).json({ error: 'El preliminar ya fue procesado' });
            }

            const exchangeRate = parseFloat(preliminary.exchange_rate_usd) || 0;
            if (exchangeRate === 0) {
                return res.status(400).json({ error: 'No hay tasa BCV en el preliminar.' });
            }
            const { totalUsd: recalcTotalUsd, totalVes: recalcTotalVes } = TenantAdminBillingController._recalcPreliminaryTotals(preliminary.items, exchangeRate);

            // Verificar que el inmueble pertenezca al tenant
            const pool = await connectDB();
            const propertyResult = await pool.request()
                .input('property_id', sql.UniqueIdentifier, propertyId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT p.id, p.name, p.slug, p.building, p.alicuota, b.name AS building_name, t.building_type
                    FROM Properties p
                    INNER JOIN Tenants t ON t.id = p.tenant_id
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    WHERE p.id = @property_id AND p.tenant_id = @tenant_id
                `);

            if (propertyResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Inmueble no encontrado' });
            }

            const property = propertyResult.recordset[0];

            const invoiceNumber = buildMonthlyInvoiceNumber(
                property,
                preliminary.billing_year,
                preliminary.billing_month,
                { buildingType: property.building_type || 'SINGLE' }
            );

            // Crear recibo para el inmueble (monto completo, con tasa actual)
            const invoice = await BillingModel.createInvoice({
                tenant_id: tenantId,
                preliminary_id: id,
                property_id: propertyId,
                owner_id: null,
                invoice_number: invoiceNumber,
                total_amount_usd: recalcTotalUsd,
                total_amount_ves: recalcTotalVes,
                assigned_amount_usd: recalcTotalUsd, // Monto completo
                assigned_amount_ves: recalcTotalVes, // Monto completo
                proportion_type: 'FIXED',
                proportion_value: 1, // 100% del monto
                exchange_rate_at_creation: exchangeRate,
                current_exchange_rate: exchangeRate
            });

            // Agregar items desglosados (recalculados con tasa actual)
            for (const item of preliminary.items) {
                const itemConvVes = itemToVes(item.base_amount, item.currency, exchangeRate);
                await BillingModel.addInvoiceItem({
                    invoice_id: invoice.id,
                    item_type: item.item_type,
                    description: item.description,
                    base_amount: item.base_amount,
                    currency: item.currency,
                    converted_amount_ves: itemConvVes,
                    assigned_amount_ves: itemConvVes, // Monto completo
                    notes: item.notes,
                    attachment_path: item.attachment_path || null,
                    attachment_mime: item.attachment_mime || null
                });
            }

            // Finalizar preliminar
            await BillingModel.finalizePreliminary(id, tenantId, {
                total_usd: recalcTotalUsd,
                total_ves: recalcTotalVes
            });

            // En modo FULL, encolar notificación al propietario
            const billingModeResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT billing_mode FROM Tenants WHERE id = @tenant_id');
            
            if (billingModeResult.recordset[0]?.billing_mode === 'FULL') {
                await TenantAdminBillingController.queueInvoiceNotification(invoice.id, tenantId);
            }

            res.json({
                success: true,
                message: `Recibo generado exitosamente para ${property.name}`,
                data: {
                    invoice_id: invoice.id,
                    invoice_number: invoiceNumber,
                    property: property.name,
                    amount_usd: preliminary.total_amount_usd,
                    amount_ves: preliminary.total_amount_ves
                }
            });
        } catch (error) {
            console.error('Generate invoice for property error:', error);
            res.status(500).json({ error: 'Error al generar recibo' });
        }
    }

    /**
     * POST /api/tenant-admin/billing/preliminaries/:id/send
     * Enviar recibos a propietarios (solo modo FULL)
     */
    static async sendInvoices(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;

            // Verificar modo de facturación
            const pool = await connectDB();
            const tenantResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT billing_mode FROM Tenants WHERE id = @tenant_id');
            
            if (tenantResult.recordset[0]?.billing_mode !== 'FULL') {
                return res.status(400).json({ error: 'Solo disponible en modo FULL' });
            }

            // Marcar como enviado
            await BillingModel.markPreliminaryAsSent(id, tenantId);

            // Enviar notificaciones por email
            const NotificationQueueModel = require('../models/NotificationQueueModel');
            const EmailService = require('../services/EmailService');
            
            console.log(`[Billing] Buscando notificaciones pendientes para tenant ${tenantId}`);
            const pendingNotifications = await NotificationQueueModel.getPendingByTenant(tenantId, 100);
            console.log(`[Billing] Encontradas ${pendingNotifications.length} notificaciones pendientes`);
            
            if (pendingNotifications.length === 0) {
                return res.json({
                    success: true,
                    message: 'Recibos marcados como enviados, pero no hay notificaciones pendientes'
                });
            }
            
            let sentCount = 0;
            let failedCount = 0;
            
            for (const notification of pendingNotifications) {
                try {
                    // Verificar si el usuario tiene email
                    const pool = await connectDB();
                    const userResult = await pool.request()
                        .input('user_id', sql.UniqueIdentifier, notification.user_id)
                        .query('SELECT email, first_name FROM Users WHERE id = @user_id');
                    
                    if (userResult.recordset.length === 0 || !userResult.recordset[0].email) {
                        await NotificationQueueModel.markAsFailed(notification.id, 'Usuario sin email');
                        failedCount++;
                        continue;
                    }
                    
                    const user = userResult.recordset[0];

                    let invoiceMetaHtml = '';
                    try {
                        const data = JSON.parse(notification.data || '{}');
                        if (data.property_invoice_code) {
                            invoiceMetaHtml += `<p style="margin:0 0 8px;color:#3C4043;font-size:14px;"><strong>Código inmueble:</strong> <span style="font-family:monospace;">${data.property_invoice_code}</span></p>`;
                        }
                        if (data.invoice_number) {
                            invoiceMetaHtml += `<p style="margin:0 0 8px;color:#3C4043;font-size:14px;"><strong>Nº de recibo:</strong> ${data.invoice_number}</p>`;
                        }
                    } catch (_) { /* noop */ }
                    
                    // Enviar email con estilo mejorado
                    const emailHtml = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden;">
                            <div style="background: linear-gradient(135deg, #8B5028 0%, #6b3d1f 100%); padding: 24px; text-align: center;">
                                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">🏢 Condominio360</h1>
                                <p style="color: #f5f5f5; margin: 8px 0 0 0; font-size: 14px;">Gestión Inteligente de Condominios</p>
                            </div>
                            <div style="padding: 32px; background: #ffffff;">
                                <h2 style="color: #3C4043; margin-top: 0;">${notification.title}</h2>
                                <p style="color: #5F6368; font-size: 16px; line-height: 1.6;">Hola <strong>${user.first_name}</strong>,</p>
                                <p style="color: #5F6368; font-size: 16px; line-height: 1.6;">${notification.message}</p>
                                ${invoiceMetaHtml ? `<div style="background:#fafafa;border:1px solid #e5e5e5;border-radius:8px;padding:16px;margin:16px 0;">${invoiceMetaHtml}</div>` : ''}
                                
                                <div style="background: #f8f9fa; border-left: 4px solid #8B5028; padding: 16px; margin: 24px 0; border-radius: 4px;">
                                    <p style="margin: 0; color: #3C4043; font-size: 14px;">
                                        <strong>💡 Importante:</strong> Ingresa a tu panel de propietario en Condominio360 para ver el detalle completo de tu recibo y realizar el pago.
                                    </p>
                                </div>
                            </div>
                            <div style="background: #f5f5f5; padding: 16px; text-align: center; border-top: 1px solid #e5e5e5;">
                                <p style="color: #9AA0A6; font-size: 12px; margin: 0;">
                                    Este es un mensaje automático de Condominio360<br>
                                    © ${new Date().getFullYear()} Condominio360 - Todos los derechos reservados
                                </p>
                            </div>
                        </div>
                    `;
                    
                    await EmailService.send(
                        user.email,
                        notification.title,
                        emailHtml,
                        notification.message,
                        { tenantId, messageType: 'billing_invoice_notification' }
                    );
                    
                    await NotificationQueueModel.markAsSent(notification.id);
                    sentCount++;
                    
                } catch (error) {
                    console.error('Error sending notification:', error);
                    await NotificationQueueModel.markAsFailed(notification.id, error.message);
                    failedCount++;
                }
            }

            res.json({
                success: true,
                message: `Recibos enviados: ${sentCount} exitosos, ${failedCount} fallidos`
            });
        } catch (error) {
            console.error('Send invoices error:', error);
            res.status(500).json({ error: 'Error al enviar recibos' });
        }
    }

    // ==================== RECIBOS ====================

    /**
     * GET /api/tenant-admin/properties/:propertyId/billing-invoices
     * Recibos de facturación de un inmueble (para tab en detalle de inmueble)
     */
    static async getPropertyBillingInvoices(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const propertyId = req.params.id;

            const pool = await connectDB();

            const propCheck = await pool.request()
                .input('property_id', sql.UniqueIdentifier, propertyId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT id FROM Properties WHERE id = @property_id AND tenant_id = @tenant_id');
            if (propCheck.recordset.length === 0) {
                return res.status(404).json({ error: 'Inmueble no encontrado' });
            }

            const invResult = await pool.request()
                .input('property_id', sql.UniqueIdentifier, propertyId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT i.*, pr.billing_month, pr.billing_year, pr.name as preliminary_name,
                           pr.exchange_rate_usd as exchange_rate_preliminary,
                           pr.exchange_rate_date as preliminary_exchange_rate_date,
                           pr.rate_freeze_mode, pr.rate_freeze_window_days, pr.rate_unpaid_migrate_after_month,
                           pr.created_at as preliminary_created_at
                    FROM BillingInvoices i
                    INNER JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                    WHERE i.property_id = @property_id AND i.tenant_id = @tenant_id
                    ORDER BY pr.billing_year DESC, pr.billing_month DESC
                `);

            const invoices = invResult.recordset;
            const latestRate = await ExchangeRateModel.getLatest();
            const rateToday = latestRate ? parseFloat(latestRate.usd_rate) : 0;

            for (const inv of invoices) {
                const itemsRes = await pool.request()
                    .input('invoice_id', sql.UniqueIdentifier, inv.id)
                    .query('SELECT * FROM BillingInvoiceItems WHERE invoice_id = @invoice_id ORDER BY item_type, description');
                inv.items = itemsRes.recordset;

                inv.payment_report = await BillingModel.getLatestPaymentReport(inv.id);

                inv.rate_info = TenantAdminBillingController._buildInvoiceRateInfo(inv, latestRate);
            }

            res.json({ success: true, data: invoices });
        } catch (error) {
            console.error('Get property billing invoices error:', error);
            res.status(500).json({ error: 'Error al obtener recibos' });
        }
    }

    /**
     * GET /api/tenant-admin/billing/invoices
     */
    static async listInvoices(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { preliminary_id, status, property_id, months_back } = req.query;
            
            const pool = await connectDB();
            
            let query = `
                SELECT i.*, p.name as property_name, p.building,
                    pr.billing_month, pr.billing_year, pr.name as preliminary_name,
                    CASE WHEN i.invoice_kind = N'LEGACY_DEBT' THEN N'Deuda histórica' ELSE pr.name END AS period_label,
                    (SELECT TOP 1 1 FROM BillingPaymentReports r WHERE r.invoice_id = i.id AND r.status = 'PENDING_CONFIRMATION') as payment_report_pending
                FROM BillingInvoices i
                INNER JOIN Properties p ON i.property_id = p.id
                LEFT JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                WHERE i.tenant_id = @tenant_id
                  AND (i.invoice_kind = N'LEGACY_DEBT' OR pr.id IS NOT NULL)
            `;

            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            if (preliminary_id) {
                query += ` AND i.preliminary_id = @preliminary_id`;
                request.input('preliminary_id', sql.UniqueIdentifier, preliminary_id);
            }

            if (status) {
                query += ` AND i.status = @status`;
                request.input('status', sql.NVarChar, status);
            }

            if (property_id) {
                query += ` AND i.property_id = @property_id`;
                request.input('property_id', sql.UniqueIdentifier, property_id);
            }

            if (months_back) {
                const n = Math.min(Math.max(parseInt(months_back) || 5, 1), 24);
                query += ` AND (pr.billing_year * 12 + pr.billing_month) >= (YEAR(DATEADD(month, -@months_back, GETDATE())) * 12 + MONTH(DATEADD(month, -@months_back, GETDATE())))`;
                request.input('months_back', sql.Int, n);
            }

            query += ` ORDER BY CASE WHEN i.invoice_kind = N'LEGACY_DEBT' THEN 0 ELSE 1 END,
                pr.billing_year DESC, pr.billing_month DESC, p.building, p.name`;

            const result = await request.query(query);
            
            res.json({
                success: true,
                data: result.recordset
            });
        } catch (error) {
            console.error('List invoices error:', error);
            res.status(500).json({ error: 'Error al obtener recibos' });
        }
    }

    /**
     * GET /api/tenant-admin/billing/invoices/export-by-month?year=YYYY&month=M
     * Excel solo del mes indicado (recuentos + detalle de recibos)
     */
    static async exportInvoicesByMonth(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const year = parseInt(req.query.year, 10);
            const month = parseInt(req.query.month, 10);
            if (!year || year < 2000 || year > 2100 || !month || month < 1 || month > 12) {
                return res.status(400).json({ error: 'Parámetros year y month inválidos (month 1-12)' });
            }

            const rows = await BillingModel.getInvoicesForBillingMonth(tenantId, year, month);
            const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
            const periodLabel = `${months[month - 1]} ${year}`;

            let paid = 0;
            let pending = 0;
            let other = 0;
            let sumAssignedVes = 0;
            let sumPaidVes = 0;
            let pendingReport = 0;
            rows.forEach((r) => {
                const st = r.status;
                if (st === 'PAID') {
                    paid += 1;
                } else if (st === 'PENDING') {
                    pending += 1;
                } else {
                    other += 1;
                }
                sumAssignedVes += parseFloat(r.assigned_amount_ves) || 0;
                if (st === 'PAID') sumPaidVes += parseFloat(r.paid_amount_ves) || parseFloat(r.assigned_amount_ves) || 0;
                if (r.payment_report_pending === 1 || r.payment_report_pending === true) pendingReport += 1;
            });

            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Condominio360';
            const sheetRes = workbook.addWorksheet('Resumen', { properties: { tabColor: { argb: 'FFF97316' } } });
            sheetRes.columns = [
                { header: 'Concepto', key: 'k', width: 28 },
                { header: 'Valor', key: 'v', width: 40 }
            ];
            sheetRes.getRow(1).font = { bold: true };
            sheetRes.addRows([
                { k: 'Período de facturación', v: periodLabel },
                { k: 'Total recibos', v: rows.length },
                { k: 'Pagados', v: paid },
                { k: 'Pendientes de pago', v: pending },
                { k: 'Otros estados', v: other },
                { k: 'Con reporte de pago pendiente de confirmación', v: pendingReport },
                { k: 'Monto total asignado (VES)', v: sumAssignedVes },
                { k: 'Monto cobrado según recibos pagados (VES)', v: sumPaidVes }
            ]);

            const sheetDet = workbook.addWorksheet('Recibos', { properties: { tabColor: { argb: 'FF10B981' } } });
            sheetDet.columns = [
                { header: 'Nº Recibo', key: 'num', width: 16 },
                { header: 'Preliminar', key: 'prelim', width: 28 },
                { header: 'Inmueble', key: 'prop', width: 22 },
                { header: 'Edificio/Calle', key: 'edif', width: 18 },
                { header: 'Propietario', key: 'owner', width: 26 },
                { header: 'Email', key: 'email', width: 28 },
                { header: 'Estado', key: 'estado', width: 12 },
                { header: 'Tipo reparto', key: 'prop_type', width: 14 },
                { header: 'Alícuota / parte', key: 'prop_val', width: 14 },
                { header: 'Monto USD', key: 'usd', width: 14 },
                { header: 'Monto VES', key: 'ves', width: 16 },
                { header: 'Pagado VES', key: 'paid_ves', width: 14 },
                { header: 'Fecha pago', key: 'paid_at', width: 18 },
                { header: 'Método pago', key: 'pm', width: 14 },
                { header: 'Referencia', key: 'ref', width: 22 },
                { header: 'Reporte pendiente', key: 'rep_pend', width: 16 },
                { header: 'Tasa creación', key: 'rate_c', width: 12 },
                { header: 'Tasa actual', key: 'rate_a', width: 12 },
                { header: 'ID recibo', key: 'id', width: 38 }
            ];
            sheetDet.getRow(1).font = { bold: true };
            sheetDet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
            sheetDet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

            const estadoTxt = (s) => (s === 'PAID' ? 'Pagado' : s === 'PENDING' ? 'Pendiente' : (s || '-'));

            rows.forEach((r) => {
                sheetDet.addRow({
                    num: r.invoice_number || '-',
                    prelim: r.preliminary_name || '-',
                    prop: r.property_name || '-',
                    edif: r.building_label || '-',
                    owner: (r.owner_name || '').trim() || '-',
                    email: r.owner_email || '',
                    estado: estadoTxt(r.status),
                    prop_type: r.proportion_type || '',
                    prop_val: r.proportion_value != null ? parseFloat(r.proportion_value) : '',
                    usd: parseFloat(r.assigned_amount_usd || 0),
                    ves: parseFloat(r.assigned_amount_ves || 0),
                    paid_ves: r.paid_amount_ves != null ? parseFloat(r.paid_amount_ves) : '',
                    paid_at: r.paid_at ? new Date(r.paid_at) : '',
                    pm: r.payment_method || '',
                    ref: r.payment_reference || '',
                    rep_pend: r.payment_report_pending ? 'Sí' : 'No',
                    rate_c: r.exchange_rate_at_creation != null ? parseFloat(r.exchange_rate_at_creation) : '',
                    rate_a: r.current_exchange_rate != null ? parseFloat(r.current_exchange_rate) : '',
                    id: r.id
                });
            });

            const filename = `recibos-${year}-${String(month).padStart(2, '0')}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            await workbook.xlsx.write(res);
        } catch (error) {
            console.error('Export invoices by month error:', error);
            res.status(500).json({ error: 'Error al exportar recibos del mes' });
        }
    }

    /**
     * GET /api/tenant-admin/billing/invoices/:id
     */
    static async getInvoice(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            
            const invoice = await BillingModel.getInvoiceWithItems(id, tenantId);
            
            if (!invoice) {
                return res.status(404).json({ error: 'Recibo no encontrado' });
            }

            enrichInvoicePropertyCode(invoice);

            // Tasa del día y comparativa para spread (igual que OwnerBillingController)
            const latestRate = await ExchangeRateModel.getLatest();
            const totalUsd = parseFloat(invoice.total_amount_usd) || (parseFloat(invoice.assigned_amount_ves) / (parseFloat(invoice.current_exchange_rate) || 1));
            invoice.rate_info = TenantAdminBillingController._buildInvoiceRateInfo(invoice, latestRate);
            const rateCurrent = invoice.rate_info?.rate_current
                || parseFloat(invoice.current_exchange_rate)
                || parseFloat(invoice.exchange_rate_at_creation);

            // Recalcular montos de items con tasa actual
            if (invoice.items && rateCurrent) {
                const itemsRecalc = invoice.items.map(it => {
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
                if (invoice.items.length === 1) invoice.items[0].assigned_amount_ves = totalVes;
            }

            // Incluir reporte de pago pendiente si existe
            const paymentReport = await BillingModel.getLatestPaymentReport(id);
            if (paymentReport) {
                invoice.payment_report = paymentReport;
            }
            
            res.json({
                success: true,
                data: invoice
            });
        } catch (error) {
            console.error('Get invoice error:', error);
            res.status(500).json({ error: 'Error al obtener recibo' });
        }
    }

    /**
     * POST /api/tenant-admin/billing/invoices/:id/payment
     * Registrar pago de recibo (por junta, sin reporte previo)
     */
    static async registerPayment(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            const { paid_amount_ves, payment_method, payment_reference, payment_notes } = req.body;

            if (!paid_amount_ves || !payment_method) {
                return res.status(400).json({ error: 'Monto y método de pago son requeridos' });
            }

            const pool = await connectDB();
            const invCheck = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`SELECT invoice_kind FROM BillingInvoices WHERE id = @id AND tenant_id = @tenant_id`);
            const kind = invCheck.recordset[0]?.invoice_kind;
            const paymentPayload = {
                paid_amount_ves,
                payment_method,
                payment_reference,
                payment_notes
            };
            const invoice = kind === 'LEGACY_DEBT'
                ? await BillingModel.registerLegacyPartialPayment(id, tenantId, paymentPayload)
                : await BillingModel.registerPayment(id, tenantId, paymentPayload);

            if (!invoice) {
                return res.status(404).json({ error: 'Recibo no encontrado' });
            }

            res.json({
                success: true,
                data: invoice
            });
        } catch (error) {
            console.error('Register payment error:', error);
            res.status(500).json({ error: 'Error al registrar pago' });
        }
    }

    /**
     * POST /api/tenant-admin/billing/invoices/:id/confirm-payment
     * Confirmar reporte de pago enviado por propietario
     */
    static async confirmPayment(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const adminId = req.user.adminId || req.user.userId;
            const { id } = req.params;

            const report = await BillingModel.getLatestPaymentReport(id);
            if (!report) {
                return res.status(404).json({ error: 'No hay reporte de pago para este recibo' });
            }
            if (report.status !== 'PENDING_CONFIRMATION') {
                return res.status(400).json({ error: 'El reporte ya fue procesado' });
            }

            const invoice = await BillingModel.confirmPaymentReport(report.id, id, tenantId, adminId);
            if (!invoice) {
                return res.status(400).json({ error: 'Error al confirmar el pago' });
            }

            // Enviar email al propietario
            const pool = await connectDB();
            const ownerResult = await pool.request()
                .input('invoice_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT u.email, u.first_name
                    FROM BillingInvoices i
                    INNER JOIN PropertyOwners po ON i.property_id = po.property_id AND po.is_primary_owner = 1
                    INNER JOIN Users u ON po.user_id = u.id
                    WHERE i.id = @invoice_id
                `);
            const owner = ownerResult.recordset[0];
            if (owner?.email) {
                const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
                const invRes = await pool.request().input('id', sql.UniqueIdentifier, id).query(`
                    SELECT i.invoice_number, i.invoice_kind,
                        pr.billing_month, pr.billing_year,
                        prop.name AS property_name, prop.slug AS property_slug,
                        b.name AS building_name, t.building_type
                    FROM BillingInvoices i
                    LEFT JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                    INNER JOIN Properties prop ON prop.id = i.property_id
                    INNER JOIN Tenants t ON t.id = i.tenant_id
                    LEFT JOIN Buildings b ON b.id = prop.building_id
                    WHERE i.id = @id
                `);
                const invData = invRes.recordset[0];
                const periodLabel = invData?.invoice_kind === 'LEGACY_DEBT'
                    ? 'Deuda histórica pre-sistema'
                    : (invData ? `${months[invData.billing_month - 1]} ${invData.billing_year}` : '');
                EmailService.sendPaymentConfirmed(
                    owner.email,
                    owner.first_name || 'Propietario',
                    invData?.invoice_number || 'N/A',
                    periodLabel,
                    invoice.paid_amount_ves,
                    { tenantId },
                    getInvoicePropertyCode(invData)
                ).catch(err => console.error('Error sending payment confirmed email:', err));
            }

            res.json({
                success: true,
                data: invoice,
                message: 'Pago confirmado. Se envió notificación al propietario.'
            });
        } catch (error) {
            console.error('Confirm payment error:', error);
            res.status(500).json({ error: 'Error al confirmar pago' });
        }
    }

    /**
     * POST /api/tenant-admin/billing/invoices/:id/reject-payment
     * Rechazar reporte de pago enviado por propietario
     */
    static async rejectPayment(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { id } = req.params;
            const { rejection_reason } = req.body;

            const report = await BillingModel.getLatestPaymentReport(id);
            if (!report) {
                return res.status(404).json({ error: 'No hay reporte de pago para este recibo' });
            }
            if (report.status !== 'PENDING_CONFIRMATION') {
                return res.status(400).json({ error: 'El reporte ya fue procesado' });
            }

            const updated = await BillingModel.rejectPaymentReport(report.id, id, tenantId, rejection_reason);
            if (!updated) {
                return res.status(400).json({ error: 'Error al rechazar el reporte' });
            }

            // Enviar email al propietario
            const pool = await connectDB();
            const ownerResult = await pool.request()
                .input('invoice_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT u.email, u.first_name
                    FROM BillingInvoices i
                    INNER JOIN PropertyOwners po ON i.property_id = po.property_id AND po.is_primary_owner = 1
                    INNER JOIN Users u ON po.user_id = u.id
                    WHERE i.id = @invoice_id
                `);
            const owner = ownerResult.recordset[0];
            if (owner?.email) {
                const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
                const invRes = await pool.request().input('id', sql.UniqueIdentifier, id).query(`
                    SELECT i.invoice_number, i.invoice_kind,
                        pr.billing_month, pr.billing_year,
                        prop.name AS property_name, prop.slug AS property_slug,
                        b.name AS building_name, t.building_type
                    FROM BillingInvoices i
                    LEFT JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                    INNER JOIN Properties prop ON prop.id = i.property_id
                    INNER JOIN Tenants t ON t.id = i.tenant_id
                    LEFT JOIN Buildings b ON b.id = prop.building_id
                    WHERE i.id = @id
                `);
                const invData = invRes.recordset[0];
                const periodLabel = invData?.invoice_kind === 'LEGACY_DEBT'
                    ? 'Deuda histórica pre-sistema'
                    : (invData ? `${months[invData.billing_month - 1]} ${invData.billing_year}` : '');
                EmailService.sendPaymentRejected(
                    owner.email,
                    owner.first_name || 'Propietario',
                    invData?.invoice_number || 'N/A',
                    periodLabel,
                    rejection_reason,
                    { tenantId },
                    getInvoicePropertyCode(invData)
                ).catch(err => console.error('Error sending payment rejected email:', err));
            }

            res.json({
                success: true,
                data: updated,
                message: 'Reporte rechazado. Se envió notificación al propietario.'
            });
        } catch (error) {
            console.error('Reject payment error:', error);
            res.status(500).json({ error: 'Error al rechazar reporte' });
        }
    }

    // ==================== PLANTILLAS ====================

    /**
     * GET /api/tenant-admin/billing/templates
     */
    static async listTemplates(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const templates = await BillingModel.getTemplatesByTenant(tenantId);
            
            res.json({
                success: true,
                data: templates
            });
        } catch (error) {
            console.error('List templates error:', error);
            res.status(500).json({ error: 'Error al obtener plantillas' });
        }
    }

    /**
     * POST /api/tenant-admin/billing/templates
     */
    static async createTemplate(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { name, description, default_amount, default_currency, category } = req.body;

            if (!name) {
                return res.status(400).json({ error: 'El nombre es requerido' });
            }

            const template = await BillingModel.createTemplate({
                tenant_id: tenantId,
                name,
                description,
                default_amount,
                default_currency: default_currency || 'VES',
                category
            });

            res.status(201).json({
                success: true,
                data: template
            });
        } catch (error) {
            console.error('Create template error:', error);
            res.status(500).json({ error: 'Error al crear plantilla' });
        }
    }

    // ==================== ESTADÍSTICAS ====================

    /**
     * GET /api/tenant-admin/billing/stats
     */
    static async getStats(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { preliminary_id } = req.query;
            
            const stats = await BillingModel.getBillingStats(tenantId, preliminary_id || null);
            
            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('Get billing stats error:', error);
            res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
    }

    /**
     * GET /api/tenant-admin/billing/export/:preliminary_id
     * Exportar preliminar a Excel (modo SUPPORT)
     */
    static async exportPreliminary(req, res) {
        try {
            const tenantId = req.user.tenantId;
            const { preliminary_id } = req.params;

            const preliminary = await BillingModel.getPreliminaryWithItems(preliminary_id, tenantId);
            
            if (!preliminary) {
                return res.status(404).json({ error: 'Preliminar no encontrado' });
            }

            const invoices = await BillingModel.getInvoicesByPreliminary(preliminary_id, tenantId);
            const propertyInvoiceRows = await BillingModel.getPropertiesWithInvoiceForPreliminary(preliminary_id, tenantId);
            const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
            const periodStr = `${months[(preliminary.billing_month || 1) - 1]} ${preliminary.billing_year || ''}`;

            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Condominio360';
            workbook.created = new Date();

            // Hoja 1: Resumen
            const sheetResumen = workbook.addWorksheet('Resumen', { properties: { tabColor: { argb: 'FFF97316' } } });
            sheetResumen.columns = [
                { header: 'Campo', key: 'campo', width: 25 },
                { header: 'Valor', key: 'valor', width: 35 }
            ];
            sheetResumen.getRow(1).font = { bold: true, size: 12 };
            sheetResumen.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' } };
            sheetResumen.getRow(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
            sheetResumen.addRows([
                { campo: 'Preliminar', valor: preliminary.name || '-' },
                { campo: 'Período', valor: periodStr },
                { campo: 'Tasa de cambio (USD→VES)', valor: parseFloat(preliminary.exchange_rate_usd || 0).toFixed(2) },
                { campo: 'Total USD', valor: `$ ${parseFloat(preliminary.total_amount_usd || 0).toFixed(2)}` },
                { campo: 'Total VES', valor: parseFloat(preliminary.total_amount_ves || 0).toLocaleString('es-VE') },
                { campo: 'Total recibos', valor: String(invoices.length) }
            ]);

            // Hoja 2: Ítems del preliminar
            const sheetItems = workbook.addWorksheet('Ítems', { properties: { tabColor: { argb: 'FF3B82F6' } } });
            sheetItems.columns = [
                { header: 'Tipo', key: 'tipo', width: 15 },
                { header: 'Descripción', key: 'descripcion', width: 35 },
                { header: 'Proveedor', key: 'proveedor', width: 20 },
                { header: 'Monto base', key: 'base', width: 15 },
                { header: 'Moneda', key: 'moneda', width: 8 },
                { header: 'Monto VES', key: 'ves', width: 18 },
                { header: 'Notas', key: 'notas', width: 25 }
            ];
            sheetItems.getRow(1).font = { bold: true };
            sheetItems.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
            sheetItems.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            (preliminary.items || []).forEach(item => {
                sheetItems.addRow({
                    tipo: item.item_type || '-',
                    descripcion: item.description || '-',
                    proveedor: item.vendor_name || item.contract_description || '-',
                    base: parseFloat(item.base_amount || 0),
                    moneda: item.currency || 'USD',
                    ves: parseFloat(item.converted_amount_ves || 0),
                    notas: item.notes || ''
                });
            });

            // Hoja: Inmuebles y estado de cobro (todos los inmuebles del conjunto)
            const sheetInmuebles = workbook.addWorksheet('Inmuebles y cobro', { properties: { tabColor: { argb: 'FF6366F1' } } });
            sheetInmuebles.columns = [
                { header: 'Inmueble', key: 'inmueble', width: 20 },
                { header: 'Edificio/Calle', key: 'edificio', width: 16 },
                { header: 'Piso', key: 'piso', width: 8 },
                { header: 'Área m²', key: 'area', width: 10 },
                { header: 'Alícuota', key: 'alicuota', width: 10 },
                { header: 'Contacto (recibo)', key: 'contacto', width: 28 },
                { header: 'Nº Recibo', key: 'recibo', width: 14 },
                { header: 'Estado pago', key: 'estado', width: 14 },
                { header: 'Monto USD', key: 'usd', width: 12 },
                { header: 'Monto VES', key: 'ves', width: 14 },
                { header: 'Pagado VES', key: 'pagado_ves', width: 14 },
                { header: 'Fecha pago', key: 'paid_at', width: 18 },
                { header: 'Método pago', key: 'payment_method', width: 14 },
                { header: 'Referencia', key: 'payment_reference', width: 22 },
                { header: 'Notas pago', key: 'payment_notes', width: 28 }
            ];
            sheetInmuebles.getRow(1).font = { bold: true };
            sheetInmuebles.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6366F1' } };
            sheetInmuebles.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            const estadoLabel = (s) => {
                if (!s) return 'Sin recibo';
                if (s === 'PAID') return 'Pagado';
                if (s === 'PENDING') return 'Pendiente';
                return String(s);
            };
            propertyInvoiceRows.forEach((row) => {
                sheetInmuebles.addRow({
                    inmueble: row.property_name || '-',
                    edificio: row.building_label || '-',
                    piso: row.floor || '',
                    area: row.area_sqm != null ? parseFloat(row.area_sqm) : '',
                    alicuota: row.alicuota != null ? parseFloat(row.alicuota) : '',
                    contacto: row.owner_name ? `${(row.owner_name || '').trim()} ${row.owner_email ? '<' + row.owner_email + '>' : ''}`.trim() : '',
                    recibo: row.invoice_number || '',
                    estado: estadoLabel(row.status),
                    usd: row.assigned_amount_usd != null ? parseFloat(row.assigned_amount_usd) : '',
                    ves: row.assigned_amount_ves != null ? parseFloat(row.assigned_amount_ves) : '',
                    pagado_ves: row.paid_amount_ves != null ? parseFloat(row.paid_amount_ves) : '',
                    paid_at: row.paid_at ? new Date(row.paid_at) : '',
                    payment_method: row.payment_method || '',
                    payment_reference: row.payment_reference || '',
                    payment_notes: row.payment_notes || ''
                });
            });

            // Hoja: Recibos (detalle)
            const sheetRecibos = workbook.addWorksheet('Recibos', { properties: { tabColor: { argb: 'FF10B981' } } });
            sheetRecibos.columns = [
                { header: 'Nº Recibo', key: 'recibo', width: 14 },
                { header: 'Inmueble', key: 'inmueble', width: 18 },
                { header: 'Edificio/Calle', key: 'edificio', width: 15 },
                { header: 'Propietario', key: 'propietario', width: 25 },
                { header: 'Alicuota', key: 'alicuota', width: 12 },
                { header: 'Monto USD', key: 'usd', width: 14 },
                { header: 'Monto VES', key: 'ves', width: 18 },
                { header: 'Estado', key: 'estado', width: 12 },
                { header: 'Pagado VES', key: 'pagado_ves', width: 14 },
                { header: 'Fecha pago', key: 'paid_at', width: 18 },
                { header: 'Método', key: 'metodo', width: 14 },
                { header: 'Referencia', key: 'ref', width: 20 }
            ];
            sheetRecibos.getRow(1).font = { bold: true };
            sheetRecibos.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
            sheetRecibos.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            invoices.forEach(inv => {
                sheetRecibos.addRow({
                    recibo: inv.invoice_number || '-',
                    inmueble: inv.property_name || '-',
                    edificio: inv.building || '-',
                    propietario: inv.owner_name || '-',
                    alicuota: parseFloat(inv.proportion_value || 0),
                    usd: parseFloat(inv.assigned_amount_usd || 0),
                    ves: parseFloat(inv.assigned_amount_ves || 0),
                    estado: estadoLabel(inv.status),
                    pagado_ves: inv.paid_amount_ves != null ? parseFloat(inv.paid_amount_ves) : '',
                    paid_at: inv.paid_at ? new Date(inv.paid_at) : '',
                    metodo: inv.payment_method || '',
                    ref: inv.payment_reference || ''
                });
            });

            const safeName = (preliminary.name || 'preliminar').replace(/[^\w\s-]/g, '').slice(0, 50);
            const filename = `preliminar-${safeName}-${periodStr.replace(/\s/g, '-')}.xlsx`;

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            await workbook.xlsx.write(res);
        } catch (error) {
            console.error('Export preliminary error:', error);
            res.status(500).json({ error: 'Error al exportar preliminar' });
        }
    }

    /**
     * Encolar notificación de recibo para un propietario
     * @param {string} invoiceId - ID del recibo
     * @param {string} tenantId - ID del tenant
     */
    static async queueInvoiceNotification(invoiceId, tenantId) {
        try {
            console.log(`[Billing] Encolando notificación para recibo ${invoiceId}`);
            const pool = await connectDB();
            
            // Obtener información del recibo y propietario
            const invoiceResult = await pool.request()
                .input('invoice_id', sql.UniqueIdentifier, invoiceId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT i.*, p.name as property_name, p.slug as property_slug, p.building,
                           b.name as building_name, t.building_type,
                           pr.billing_month, pr.billing_year, pr.name as preliminary_name,
                           u.id as owner_id, u.email, u.first_name, u.last_name
                    FROM BillingInvoices i
                    INNER JOIN Properties p ON i.property_id = p.id
                    INNER JOIN Tenants t ON t.id = i.tenant_id
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    INNER JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                    LEFT JOIN PropertyOwners po ON p.id = po.property_id AND po.is_primary_owner = 1
                    LEFT JOIN Users u ON po.user_id = u.id
                    WHERE i.id = @invoice_id AND i.tenant_id = @tenant_id
                `);
            
            if (invoiceResult.recordset.length === 0) {
                console.log(`[Billing] Recibo ${invoiceId} no encontrado`);
                return;
            }
            
            const invoice = invoiceResult.recordset[0];
            const propertyCode = getInvoicePropertyCode(invoice);

            // Limpiar owner_id - a veces viene con caracteres extraños como comas
            let ownerId = invoice.owner_id;
            console.log(`[Billing] Raw owner_id: '${ownerId}', tipo: ${typeof ownerId}`);
            
            if (ownerId) {
                // Convertir a string y extraer solo caracteres hex y guiones
                ownerId = String(ownerId).replace(/[^0-9a-fA-F-]/g, '');
                console.log(`[Billing] Owner ID después de limpieza: '${ownerId}'`);
                
                // Extraer UUID válido (formato: 8-4-4-4-12)
                const uuidMatch = ownerId.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
                if (uuidMatch) {
                    ownerId = uuidMatch[0].toLowerCase();
                    console.log(`[Billing] UUID extraído: '${ownerId}'`);
                }
            }
            
            console.log(`[Billing] Recibo encontrado: ${invoice.property_name}, owner_id final: '${ownerId}', email: ${invoice.email || 'N/A'}`);
            
            // Validar que el owner_id sea un UUID válido
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!ownerId || !uuidRegex.test(ownerId)) {
                console.log(`[Billing] Owner ID inválido para recibo ${invoiceId}: raw='${invoice.owner_id}' -> final='${ownerId}'`);
                return;
            }
            
            // Si no hay propietario con email, no se puede notificar
            if (!invoice.email) {
                console.log(`[Billing] No owner email for invoice ${invoiceId}`);
                return;
            }
            
            // Crear notificación en cola
            await pool.request()
                .input('id', sql.UniqueIdentifier, require('crypto').randomUUID())
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('user_id', sql.UniqueIdentifier, ownerId)
                .input('type', sql.NVarChar, 'INVOICE_READY')
                .input('title', sql.NVarChar, `Recibo de Condominio Disponible - ${invoice.preliminary_name}`)
                .input('message', sql.NVarChar,
                    `Su inmueble ${invoice.property_name}${propertyCode ? ` (código: ${propertyCode})` : ''} tiene un recibo disponible por el período ${invoice.billing_month}/${invoice.billing_year}. ` +
                    `Nº de recibo: ${invoice.invoice_number}. ` +
                    `Monto: ${invoice.assigned_amount_ves.toFixed(2)} VES (${invoice.assigned_amount_usd.toFixed(2)} USD). ` +
                    `Ingresa a Condominio360 para ver el detalle del recibo.`)
                .input('data', sql.NVarChar, JSON.stringify({
                    invoice_id: invoiceId,
                    invoice_number: invoice.invoice_number,
                    property_invoice_code: propertyCode,
                    preliminary_name: invoice.preliminary_name,
                    billing_month: invoice.billing_month,
                    billing_year: invoice.billing_year,
                    amount_ves: invoice.assigned_amount_ves,
                    amount_usd: invoice.assigned_amount_usd
                }))
                .query(`
                    INSERT INTO NotificationQueue (id, tenant_id, user_id, type, title, message, data, status, created_at)
                    VALUES (@id, @tenant_id, @user_id, @type, @title, @message, @data, 'PENDING', SYSDATETIME())
                `);
            
            console.log(`[Billing] Notification queued for invoice ${invoiceId} to ${invoice.email}`);
        } catch (error) {
            console.error('Error queueing invoice notification:', error);
        }
    }

    /** Formatea fecha efectiva de tasa (evita desfase por timezone) */
    static _formatRateDate(val) {
        return formatRateDateDisplay(val);
    }

    /**
     * Recalcula totales de preliminar con una tasa dada.
     * Preliminares (junta → propietarios) usan siempre la tasa más reciente.
     * @param {Array} items - Items del preliminar (base_amount, currency)
     * @param {number} rate - Tasa USD→VES
     * @returns {{ totalUsd: number, totalVes: number }}
     */
    static _recalcPreliminaryTotals(items, rate) {
        return sumPreliminaryTotals(items, rate);
    }
}

module.exports = TenantAdminBillingController;
