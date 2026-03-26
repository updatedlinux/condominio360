const ExcelJS = require('exceljs');
const VendorModel = require('../models/VendorModel');
const VendorContractModel = require('../models/VendorContractModel');
const BillingModel = require('../models/BillingModel');
const ExchangeRateModel = require('../models/ExchangeRateModel');
const EmailService = require('../services/EmailService');
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
                    const convVes = it.currency === 'USD' ? base * rateToday : base;
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

            // rate_info: diferencial cambiario solo aplica a recibos PENDIENTES. Si todos pagaron, no hay variación.
            if (ratePrelim) {
                const showRateDifferential = !allInvoicesPaid && rateToday && pendingInvoicesCount > 0;
                preliminary.rate_info = {
                    rate_preliminary: ratePrelim,
                    rate_preliminary_date: TenantAdminBillingController._formatRateDate(preliminary.created_at),
                    rate_today: rateToday,
                    rate_today_date: TenantAdminBillingController._formatRateDate(latestRate?.rate_date),
                    contravalue_preliminary_ves: totalUsd * ratePrelim,
                    contravalue_today_ves: rateToday ? totalUsd * rateToday : null,
                    total_usd: totalUsd,
                    spread_pct: showRateDifferential ? ((rateToday - ratePrelim) / ratePrelim * 100) : null,
                    all_invoices_paid: allInvoicesPaid,
                    total_ves_from_invoices: totalVesFromInvoices
                };
            } else {
                preliminary.rate_info = null;
            }

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
            const { billing_month, billing_year, name, items } = req.body;

            if (!billing_month || !billing_year || !items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'Mes, año e items son requeridos' });
            }

            // Obtener tasa BCV actual
            const latestRate = await ExchangeRateModel.getLatest();
            const exchangeRate = latestRate ? latestRate.usd_rate : 0;

            if (exchangeRate === 0) {
                return res.status(400).json({ error: 'No hay tasa BCV disponible. Intente más tarde.' });
            }

            // Determinar tipo de preliminar
            let invoiceType = 'ORDINARY';
            if (req.body.target_building) {
                invoiceType = 'EXTRAORDINARY_BUILDING';
            } else if (req.body.target_property) {
                invoiceType = 'EXTRAORDINARY_PROPERTY';
            } else if (req.body.is_extraordinary) {
                invoiceType = 'EXTRAORDINARY';
            }

            // Crear preliminar
            const preliminary = await BillingModel.createPreliminary({
                tenant_id: tenantId,
                billing_month,
                billing_year,
                name: name || `Recibo ${billing_month}/${billing_year}`,
                exchange_rate_usd: exchangeRate,
                created_by: userId,
                invoice_type: invoiceType
            });

            // Agregar items y calcular totales
            let totalUsd = 0;
            let totalVes = 0;

            for (const item of items) {
                let itemUsd, itemVes;
                
                if (item.currency === 'USD') {
                    // USD -> VES
                    itemUsd = item.amount;
                    itemVes = item.amount * exchangeRate;
                } else {
                    // VES -> USD
                    itemVes = item.amount;
                    itemUsd = item.amount / exchangeRate;
                }

                await BillingModel.addPreliminaryItem({
                    preliminary_id: preliminary.id,
                    item_type: item.item_type,
                    description: item.description,
                    vendor_contract_id: item.vendor_contract_id || null,
                    base_amount: item.amount,
                    currency: item.currency,
                    converted_amount_ves: itemVes,
                    notes: item.notes
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

            // Preliminares (junta → propietarios) SIEMPRE usan la tasa más reciente al generar
            const latestRate = await ExchangeRateModel.getLatest();
            const exchangeRate = latestRate ? latestRate.usd_rate : 0;
            if (exchangeRate === 0) {
                return res.status(400).json({ error: 'No hay tasa BCV disponible. Intente más tarde.' });
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
            
            let propertiesQuery = 'SELECT id, name, building, alicuota FROM Properties WHERE tenant_id = @tenant_id';
            if (building) {
                // Filtrar por building_id (UUID) que es el campo que realmente tiene valor
                propertiesQuery += ' AND building_id = @buildingId';
            }
            propertiesQuery += ' ORDER BY name';
            
            const propertiesRequest = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId);
            
            if (building) {
                propertiesRequest.input('buildingId', sql.UniqueIdentifier, building);
            }
            
            const propertiesResult = await propertiesRequest.query(propertiesQuery);
            const properties = propertiesResult.recordset;
            
            console.log(`[Billing] Inmuebles encontrados: ${properties.length}`);
            
            if (properties.length === 0) {
                return res.status(400).json({ error: buildingName ? `No hay inmuebles en el edificio ${buildingName}` : 'No hay inmuebles para generar recibos' });
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

            // Generar recibos
            const invoices = [];
            let invoiceCounter = 1;

            for (const prop of propertyProportions) {
                const assignedAmountUsd = recalcTotalUsd * (prop.proportion / totalProportion);
                const assignedAmountVes = recalcTotalVes * (prop.proportion / totalProportion);
                
                const invoiceNumber = `REC-${preliminary.billing_year}-${String(preliminary.billing_month).padStart(2, '0')}-${String(invoiceCounter++).padStart(3, '0')}`;

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
                    const itemConvVes = item.currency === 'USD' ? item.base_amount * exchangeRate : item.base_amount;
                    const assignedItemAmount = itemConvVes * (prop.proportion / totalProportion);
                    
                    await BillingModel.addInvoiceItem({
                    invoice_id: invoice.id,
                    item_type: item.item_type,
                    description: item.description,
                    base_amount: item.base_amount,
                    currency: item.currency,
                    converted_amount_ves: itemConvVes,
                    assigned_amount_ves: assignedItemAmount,
                        notes: item.notes
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

            // Preliminares SIEMPRE usan la tasa más reciente al generar
            const latestRate = await ExchangeRateModel.getLatest();
            const exchangeRate = latestRate ? latestRate.usd_rate : 0;
            if (exchangeRate === 0) {
                return res.status(400).json({ error: 'No hay tasa BCV disponible. Intente más tarde.' });
            }
            const { totalUsd: recalcTotalUsd, totalVes: recalcTotalVes } = TenantAdminBillingController._recalcPreliminaryTotals(preliminary.items, exchangeRate);

            // Verificar que el inmueble pertenezca al tenant
            const pool = await connectDB();
            const propertyResult = await pool.request()
                .input('property_id', sql.UniqueIdentifier, propertyId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query('SELECT id, name, building, alicuota FROM Properties WHERE id = @property_id AND tenant_id = @tenant_id');
            
            if (propertyResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Inmueble no encontrado' });
            }

            const property = propertyResult.recordset[0];

            // Generar número de recibo
            const invoiceNumber = `REC-${preliminary.billing_year}-${String(preliminary.billing_month).padStart(2, '0')}-001`;

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
                const itemConvVes = item.currency === 'USD' ? item.base_amount * exchangeRate : item.base_amount;
                await BillingModel.addInvoiceItem({
                    invoice_id: invoice.id,
                    item_type: item.item_type,
                    description: item.description,
                    base_amount: item.base_amount,
                    currency: item.currency,
                    converted_amount_ves: itemConvVes,
                    assigned_amount_ves: itemConvVes, // Monto completo
                    notes: item.notes
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
                        notification.message
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

                const ratePrelim = parseFloat(inv.exchange_rate_preliminary) || 0;
                const rateCurrent = parseFloat(inv.current_exchange_rate) || parseFloat(inv.exchange_rate_at_creation) || ratePrelim;
                const totalUsd = parseFloat(inv.total_amount_usd) || (parseFloat(inv.assigned_amount_ves) / (rateCurrent || 1));

                inv.rate_info = {
                    rate_preliminary: ratePrelim,
                    rate_preliminary_date: TenantAdminBillingController._formatRateDate(inv.preliminary_created_at),
                    rate_current: rateCurrent,
                    rate_today: rateToday,
                    rate_today_date: TenantAdminBillingController._formatRateDate(latestRate?.rate_date),
                    contravalue_preliminary_ves: ratePrelim ? totalUsd * ratePrelim : null,
                    contravalue_current_ves: parseFloat(inv.assigned_amount_ves),
                    contravalue_today_ves: rateToday ? totalUsd * rateToday : null,
                    total_usd: totalUsd,
                    spread_pct: ratePrelim ? ((rateToday - ratePrelim) / ratePrelim * 100) : null
                };
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
                    (SELECT TOP 1 1 FROM BillingPaymentReports r WHERE r.invoice_id = i.id AND r.status = 'PENDING_CONFIRMATION') as payment_report_pending
                FROM BillingInvoices i
                INNER JOIN Properties p ON i.property_id = p.id
                INNER JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                WHERE i.tenant_id = @tenant_id
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

            query += ` ORDER BY pr.billing_year DESC, pr.billing_month DESC, p.building, p.name`;

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

            // Tasa del día y comparativa para spread (igual que OwnerBillingController)
            const latestRate = await ExchangeRateModel.getLatest();
            const totalUsd = parseFloat(invoice.total_amount_usd) || (parseFloat(invoice.assigned_amount_ves) / (parseFloat(invoice.current_exchange_rate) || 1));
            const ratePrelim = parseFloat(invoice.exchange_rate_preliminary) || 0;
            const rateCurrent = parseFloat(invoice.current_exchange_rate) || parseFloat(invoice.exchange_rate_at_creation) || ratePrelim;
            const rateToday = latestRate ? parseFloat(latestRate.usd_rate) : rateCurrent;

            invoice.rate_info = {
                rate_preliminary: ratePrelim,
                rate_preliminary_date: TenantAdminBillingController._formatRateDate(invoice.preliminary_created_at),
                rate_current: rateCurrent,
                rate_today: rateToday,
                rate_today_date: TenantAdminBillingController._formatRateDate(latestRate?.rate_date),
                contravalue_preliminary_ves: ratePrelim ? totalUsd * ratePrelim : null,
                contravalue_current_ves: parseFloat(invoice.assigned_amount_ves),
                contravalue_today_ves: rateToday ? totalUsd * rateToday : null,
                total_usd: totalUsd,
                spread_pct: ratePrelim ? ((rateToday - ratePrelim) / ratePrelim * 100) : null
            };

            // Recalcular montos de items con tasa actual
            if (invoice.items && rateCurrent) {
                const itemsRecalc = invoice.items.map(it => {
                    const base = parseFloat(it.base_amount) || 0;
                    const convVes = it.currency === 'USD' ? base * rateCurrent : base;
                    return { ...it, _convVes: convVes };
                });
                const sumConvVes = itemsRecalc.reduce((s, it) => s + it._convVes, 0);
                const totalVes = parseFloat(invoice.assigned_amount_ves) || 0;
                invoice.items = itemsRecalc.map(it => {
                    const assignedVes = sumConvVes > 0 ? Math.round(totalVes * (it._convVes / sumConvVes) * 100) / 100 : it._convVes;
                    const { _convVes, ...rest } = it;
                    return { ...rest, assigned_amount_ves: assignedVes, converted_amount_ves: it._convVes };
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

            const invoice = await BillingModel.registerPayment(id, tenantId, {
                paid_amount_ves,
                payment_method,
                payment_reference,
                payment_notes
            });

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
                const invRes = await pool.request().input('id', sql.UniqueIdentifier, id).query('SELECT p.billing_month, p.billing_year, i.invoice_number FROM BillingInvoices i INNER JOIN BillingPreliminaries p ON i.preliminary_id = p.id WHERE i.id = @id');
                const invData = invRes.recordset[0];
                const periodLabel = invData ? `${months[invData.billing_month - 1]} ${invData.billing_year}` : '';
                EmailService.sendPaymentConfirmed(owner.email, owner.first_name || 'Propietario', invData?.invoice_number || 'N/A', periodLabel, invoice.paid_amount_ves).catch(err => console.error('Error sending payment confirmed email:', err));
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
                const invRes = await pool.request().input('id', sql.UniqueIdentifier, id).query('SELECT p.billing_month, p.billing_year, i.invoice_number FROM BillingInvoices i INNER JOIN BillingPreliminaries p ON i.preliminary_id = p.id WHERE i.id = @id');
                const invData = invRes.recordset[0];
                const periodLabel = invData ? `${months[invData.billing_month - 1]} ${invData.billing_year}` : '';
                EmailService.sendPaymentRejected(owner.email, owner.first_name || 'Propietario', invData?.invoice_number || 'N/A', periodLabel, rejection_reason).catch(err => console.error('Error sending payment rejected email:', err));
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
                { header: 'Edificio', key: 'edificio', width: 16 },
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
                { header: 'Edificio', key: 'edificio', width: 15 },
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
                    SELECT i.*, p.name as property_name, p.building, 
                           pr.billing_month, pr.billing_year, pr.name as preliminary_name,
                           u.id as owner_id, u.email, u.first_name, u.last_name
                    FROM BillingInvoices i
                    INNER JOIN Properties p ON i.property_id = p.id
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
                    `Su inmueble ${invoice.property_name} tiene un recibo disponible por el período ${invoice.billing_month}/${invoice.billing_year}. ` +
                    `Monto: ${invoice.assigned_amount_ves.toFixed(2)} VES (${invoice.assigned_amount_usd.toFixed(2)} USD). ` +
                    `Ingresa a Condominio360 para ver el detalle del recibo.`)
                .input('data', sql.NVarChar, JSON.stringify({
                    invoice_id: invoiceId,
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
        if (!val) return null;
        let s;
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
            s = val.split('T')[0].substring(0, 10);
        } else if (val instanceof Date) {
            s = val.toISOString().split('T')[0];
        } else if (val && typeof val === 'object' && val.toISOString) {
            s = val.toISOString().split('T')[0];
        } else return null;
        const [y, m, d] = s.split('-');
        return `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}`;
    }

    /**
     * Recalcula totales de preliminar con una tasa dada.
     * Preliminares (junta → propietarios) usan siempre la tasa más reciente.
     * @param {Array} items - Items del preliminar (base_amount, currency)
     * @param {number} rate - Tasa USD→VES
     * @returns {{ totalUsd: number, totalVes: number }}
     */
    static _recalcPreliminaryTotals(items, rate) {
        let totalUsd = 0;
        let totalVes = 0;
        for (const item of items || []) {
            const base = parseFloat(item.base_amount) || 0;
            if (item.currency === 'USD') {
                totalUsd += base;
                totalVes += base * rate;
            } else {
                totalVes += base;
                totalUsd += rate > 0 ? base / rate : 0;
            }
        }
        return { totalUsd, totalVes };
    }
}

module.exports = TenantAdminBillingController;
