const { sql, connectDB } = require('../config/database');

/**
 * Modelo para Facturación (Preliminares, Recibos, Items)
 */
class BillingModel {
    // ==================== PRELIMINARES ====================
    
    /**
     * Crear preliminar de facturación
     */
    static async createPreliminary(data) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, data.tenant_id)
                .input('billing_month', sql.Int, data.billing_month)
                .input('billing_year', sql.Int, data.billing_year)
                .input('name', sql.NVarChar, data.name)
                .input('exchange_rate_usd', sql.Decimal(10, 2), data.exchange_rate_usd)
                .input('created_by', sql.UniqueIdentifier, data.created_by)
                .input('invoice_type', sql.NVarChar, data.invoice_type || 'ORDINARY')
                .query(`
                    INSERT INTO BillingPreliminaries (tenant_id, billing_month, billing_year, name, exchange_rate_usd, created_by, invoice_type)
                    OUTPUT INSERTED.*
                    VALUES (@tenant_id, @billing_month, @billing_year, @name, @exchange_rate_usd, @created_by, @invoice_type)
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error creating preliminary:', error);
            throw error;
        }
    }

    /**
     * Agregar item a preliminar
     */
    static async addPreliminaryItem(data) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('preliminary_id', sql.UniqueIdentifier, data.preliminary_id)
                .input('item_type', sql.NVarChar, data.item_type)
                .input('description', sql.NVarChar, data.description)
                .input('vendor_contract_id', sql.UniqueIdentifier, data.vendor_contract_id || null)
                .input('base_amount', sql.Decimal(15, 2), data.base_amount)
                .input('currency', sql.NVarChar, data.currency)
                .input('converted_amount_ves', sql.Decimal(15, 2), data.converted_amount_ves)
                .input('notes', sql.NVarChar, data.notes || null)
                .input('attachment_path', sql.NVarChar, data.attachment_path || null)
                .input('attachment_mime', sql.NVarChar, data.attachment_mime || null)
                .query(`
                    INSERT INTO BillingPreliminaryItems (preliminary_id, item_type, description, vendor_contract_id, base_amount, currency, converted_amount_ves, notes, attachment_path, attachment_mime)
                    OUTPUT INSERTED.*
                    VALUES (@preliminary_id, @item_type, @description, @vendor_contract_id, @base_amount, @currency, @converted_amount_ves, @notes, @attachment_path, @attachment_mime)
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error adding preliminary item:', error);
            throw error;
        }
    }

    /**
     * Obtener preliminar con items
     */
    static async getPreliminaryWithItems(id, tenantId) {
        try {
            const pool = await connectDB();
            
            // Preliminar
            const preliminaryResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT p.*, ta.first_name + ' ' + ta.last_name as created_by_name
                    FROM BillingPreliminaries p
                    LEFT JOIN TenantAdmins ta ON p.created_by = ta.id
                    WHERE p.id = @id AND p.tenant_id = @tenant_id
                `);
            
            if (preliminaryResult.recordset.length === 0) return null;
            
            const preliminary = preliminaryResult.recordset[0];
            
            // Items
            const itemsResult = await pool.request()
                .input('preliminary_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT i.*, vc.description as contract_description, v.name as vendor_name
                    FROM BillingPreliminaryItems i
                    LEFT JOIN VendorContracts vc ON i.vendor_contract_id = vc.id
                    LEFT JOIN Vendors v ON vc.vendor_id = v.id
                    WHERE i.preliminary_id = @preliminary_id
                    ORDER BY i.item_type, i.description
                `);
            
            preliminary.items = itemsResult.recordset;
            
            return preliminary;
        } catch (error) {
            console.error('Error fetching preliminary:', error);
            throw error;
        }
    }

    /**
     * Obtener preliminares de un tenant
     */
    static async getPreliminariesByTenant(tenantId, options = {}) {
        try {
            const pool = await connectDB();
            let query = `
                SELECT p.*, 
                    ta.first_name + ' ' + ta.last_name as created_by_name,
                    (SELECT COUNT(*) FROM BillingInvoices WHERE preliminary_id = p.id) as invoices_count,
                    (SELECT SUM(assigned_amount_ves) FROM BillingInvoices WHERE preliminary_id = p.id AND status = 'PAID') as total_collected
                FROM BillingPreliminaries p
                LEFT JOIN TenantAdmins ta ON p.created_by = ta.id
                WHERE p.tenant_id = @tenant_id
            `;

            if (options.status) {
                query += ` AND p.status = @status`;
            }
            if (options.months_back) {
                query += ` AND (p.billing_year * 12 + p.billing_month) >= (YEAR(DATEADD(month, -@months_back, GETDATE())) * 12 + MONTH(DATEADD(month, -@months_back, GETDATE())))`;
            }

            query += ` ORDER BY p.billing_year DESC, p.billing_month DESC`;

            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            if (options.status) {
                request.input('status', sql.NVarChar, options.status);
            }
            if (options.months_back) {
                request.input('months_back', sql.Int, Math.min(Math.max(parseInt(options.months_back) || 5, 1), 24));
            }

            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching preliminaries:', error);
            throw error;
        }
    }

    /**
     * Finalizar preliminar (generar recibos)
     */
    static async finalizePreliminary(id, tenantId, totals) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('total_amount_usd', sql.Decimal(15, 2), totals.total_usd)
                .input('total_amount_ves', sql.Decimal(15, 2), totals.total_ves)
                .query(`
                    UPDATE BillingPreliminaries 
                    SET status = 'FINALIZED', 
                        total_amount_usd = @total_amount_usd,
                        total_amount_ves = @total_amount_ves,
                        finalized_at = SYSDATETIME(),
                        updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenant_id
                `);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finalizing preliminary:', error);
            throw error;
        }
    }

    /**
     * Actualizar solo los totales del preliminar (sin cambiar estado)
     * Usado durante la creación inicial
     */
    static async updatePreliminaryTotals(id, tenantId, totals) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('total_amount_usd', sql.Decimal(15, 2), totals.total_usd)
                .input('total_amount_ves', sql.Decimal(15, 2), totals.total_ves)
                .query(`
                    UPDATE BillingPreliminaries 
                    SET total_amount_usd = @total_amount_usd,
                        total_amount_ves = @total_amount_ves,
                        updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenant_id
                `);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error updating preliminary totals:', error);
            throw error;
        }
    }

    // ==================== RECIBOS (INVOICES) ====================

    /**
     * Crear recibo para un inmueble
     */
    static async createInvoice(data) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, data.tenant_id)
                .input('preliminary_id', sql.UniqueIdentifier, data.preliminary_id)
                .input('property_id', sql.UniqueIdentifier, data.property_id)
                .input('owner_id', sql.UniqueIdentifier, data.owner_id || null)
                .input('invoice_number', sql.NVarChar, data.invoice_number)
                .input('total_amount_usd', sql.Decimal(15, 2), data.total_amount_usd)
                .input('total_amount_ves', sql.Decimal(15, 2), data.total_amount_ves)
                .input('assigned_amount_usd', sql.Decimal(15, 2), data.assigned_amount_usd)
                .input('assigned_amount_ves', sql.Decimal(15, 2), data.assigned_amount_ves)
                .input('proportion_type', sql.NVarChar, data.proportion_type)
                .input('proportion_value', sql.Decimal(10, 4), data.proportion_value)
                .input('exchange_rate_at_creation', sql.Decimal(10, 2), data.exchange_rate_at_creation)
                .input('current_exchange_rate', sql.Decimal(10, 2), data.current_exchange_rate)
                .query(`
                    INSERT INTO BillingInvoices (
                        tenant_id, preliminary_id, property_id, owner_id, invoice_number,
                        total_amount_usd, total_amount_ves, assigned_amount_usd, assigned_amount_ves,
                        proportion_type, proportion_value, exchange_rate_at_creation, current_exchange_rate
                    )
                    OUTPUT INSERTED.*
                    VALUES (
                        @tenant_id, @preliminary_id, @property_id, @owner_id, @invoice_number,
                        @total_amount_usd, @total_amount_ves, @assigned_amount_usd, @assigned_amount_ves,
                        @proportion_type, @proportion_value, @exchange_rate_at_creation, @current_exchange_rate
                    )
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error creating invoice:', error);
            throw error;
        }
    }

    /**
     * Agregar item desglosado a recibo
     */
    static async addInvoiceItem(data) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('invoice_id', sql.UniqueIdentifier, data.invoice_id)
                .input('item_type', sql.NVarChar, data.item_type)
                .input('description', sql.NVarChar, data.description)
                .input('base_amount', sql.Decimal(15, 2), data.base_amount)
                .input('currency', sql.NVarChar, data.currency)
                .input('converted_amount_ves', sql.Decimal(15, 2), data.converted_amount_ves)
                .input('assigned_amount_ves', sql.Decimal(15, 2), data.assigned_amount_ves)
                .input('notes', sql.NVarChar, data.notes || null)
                .input('attachment_path', sql.NVarChar, data.attachment_path || null)
                .input('attachment_mime', sql.NVarChar, data.attachment_mime || null)
                .query(`
                    INSERT INTO BillingInvoiceItems (invoice_id, item_type, description, base_amount, currency, converted_amount_ves, assigned_amount_ves, notes, attachment_path, attachment_mime)
                    OUTPUT INSERTED.*
                    VALUES (@invoice_id, @item_type, @description, @base_amount, @currency, @converted_amount_ves, @assigned_amount_ves, @notes, @attachment_path, @attachment_mime)
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error adding invoice item:', error);
            throw error;
        }
    }

    /**
     * Obtener recibos por preliminar
     */
    static async getInvoicesByPreliminary(preliminaryId, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('preliminary_id', sql.UniqueIdentifier, preliminaryId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT i.*, p.name as property_name, p.building, 
                        u.first_name + ' ' + u.last_name as owner_name,
                        u.email as owner_email
                    FROM BillingInvoices i
                    INNER JOIN Properties p ON i.property_id = p.id
                    LEFT JOIN PropertyOwners po ON p.id = po.property_id
                    LEFT JOIN Users u ON po.user_id = u.id
                    WHERE i.preliminary_id = @preliminary_id AND i.tenant_id = @tenant_id
                    ORDER BY p.building, p.name
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching invoices:', error);
            throw error;
        }
    }

    /**
     * Todos los inmuebles del tenant con datos del recibo del preliminar (LEFT JOIN: sin recibo si no aplica)
     */
    static async getPropertiesWithInvoiceForPreliminary(preliminaryId, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('preliminary_id', sql.UniqueIdentifier, preliminaryId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT
                        p.id AS property_id,
                        p.name AS property_name,
                        COALESCE(b.name, p.building) AS building_label,
                        p.floor,
                        p.area_sqm,
                        p.alicuota,
                        i.id AS invoice_id,
                        i.invoice_number,
                        i.status,
                        i.assigned_amount_usd,
                        i.assigned_amount_ves,
                        i.paid_amount_ves,
                        i.paid_at,
                        i.payment_method,
                        i.payment_reference,
                        i.payment_notes,
                        LTRIM(RTRIM(CONCAT(ISNULL(ou.first_name, N''), N' ', ISNULL(ou.last_name, N'')))) AS owner_name,
                        ou.email AS owner_email
                    FROM Properties p
                    LEFT JOIN Buildings b ON b.id = p.building_id
                    LEFT JOIN BillingInvoices i
                        ON i.property_id = p.id AND i.preliminary_id = @preliminary_id AND i.tenant_id = @tenant_id
                    OUTER APPLY (
                        SELECT TOP 1 u.first_name, u.last_name, u.email
                        FROM PropertyOwners po
                        INNER JOIN Users u ON u.id = po.user_id
                        WHERE po.property_id = p.id
                        ORDER BY po.is_primary_owner DESC, po.percentage_ownership DESC
                    ) AS ou
                    WHERE p.tenant_id = @tenant_id
                    ORDER BY COALESCE(b.name, p.building, N''), p.name
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching properties with invoices:', error);
            throw error;
        }
    }

    /**
     * Recibos de un mes/período de facturación (para export Excel tenant admin)
     */
    static async getInvoicesForBillingMonth(tenantId, billingYear, billingMonth) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('billing_year', sql.Int, billingYear)
                .input('billing_month', sql.Int, billingMonth)
                .query(`
                    SELECT
                        i.id,
                        i.invoice_number,
                        i.status,
                        i.total_amount_usd,
                        i.total_amount_ves,
                        i.assigned_amount_usd,
                        i.assigned_amount_ves,
                        i.proportion_type,
                        i.proportion_value,
                        i.paid_amount_ves,
                        i.paid_at,
                        i.payment_method,
                        i.payment_reference,
                        i.exchange_rate_at_creation,
                        i.current_exchange_rate,
                        i.created_at,
                        p.name AS property_name,
                        COALESCE(b.name, p.building) AS building_label,
                        p.floor,
                        pr.billing_month,
                        pr.billing_year,
                        pr.name AS preliminary_name,
                        pr.id AS preliminary_id,
                        LTRIM(RTRIM(CONCAT(ISNULL(ou.first_name, N''), N' ', ISNULL(ou.last_name, N'')))) AS owner_name,
                        ou.email AS owner_email,
                        CASE WHEN EXISTS (
                            SELECT 1 FROM BillingPaymentReports r
                            WHERE r.invoice_id = i.id AND r.status = N'PENDING_CONFIRMATION'
                        ) THEN 1 ELSE 0 END AS payment_report_pending
                    FROM BillingInvoices i
                    INNER JOIN Properties p ON i.property_id = p.id
                    LEFT JOIN Buildings b ON b.id = p.building_id
                    INNER JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                    OUTER APPLY (
                        SELECT TOP 1 u.first_name, u.last_name, u.email
                        FROM PropertyOwners po
                        INNER JOIN Users u ON u.id = po.user_id
                        WHERE po.property_id = p.id
                        ORDER BY po.is_primary_owner DESC, po.percentage_ownership DESC
                    ) AS ou
                    WHERE i.tenant_id = @tenant_id
                      AND pr.billing_year = @billing_year
                      AND pr.billing_month = @billing_month
                    ORDER BY COALESCE(b.name, p.building, N''), p.name, i.invoice_number
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching invoices for billing month:', error);
            throw error;
        }
    }

    /**
     * Obtener recibo por ID con items
     */
    static async getInvoiceWithItems(id, tenantId) {
        try {
            const pool = await connectDB();
            
            // Recibo
            const invoiceResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT i.*, p.name as property_name, p.building, p.alicuota,
                        pr.billing_month, pr.billing_year, pr.name as preliminary_name,
                        pr.exchange_rate_usd as exchange_rate_preliminary,
                        pr.created_at as preliminary_created_at,
                        u.first_name + ' ' + u.last_name as owner_name, u.email as owner_email
                    FROM BillingInvoices i
                    INNER JOIN Properties p ON i.property_id = p.id
                    INNER JOIN BillingPreliminaries pr ON i.preliminary_id = pr.id
                    LEFT JOIN PropertyOwners po ON p.id = po.property_id AND po.is_primary_owner = 1
                    LEFT JOIN Users u ON po.user_id = u.id
                    WHERE i.id = @id AND i.tenant_id = @tenant_id
                `);
            
            if (invoiceResult.recordset.length === 0) return null;
            
            const invoice = invoiceResult.recordset[0];
            
            // Items
            const itemsResult = await pool.request()
                .input('invoice_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT * FROM BillingInvoiceItems
                    WHERE invoice_id = @invoice_id
                    ORDER BY item_type, description
                `);
            
            invoice.items = itemsResult.recordset;
            
            return invoice;
        } catch (error) {
            console.error('Error fetching invoice:', error);
            throw error;
        }
    }

    /**
     * Obtener recibos pendientes por propiedad (para actualización de tasa)
     */
    static async getPendingInvoicesForRateUpdate() {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .query(`
                    SELECT i.*, t.billing_mode
                    FROM BillingInvoices i
                    INNER JOIN Tenants t ON i.tenant_id = t.id
                    WHERE i.status = 'PENDING'
                      AND NOT EXISTS (
                          SELECT 1 FROM BillingPaymentReports r
                          WHERE r.invoice_id = i.id AND r.status = N'PENDING_CONFIRMATION'
                      )
                    ORDER BY i.tenant_id, i.property_id
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching pending invoices:', error);
            throw error;
        }
    }

    /**
     * Actualizar tasa de cambio de recibo pendiente y sus items
     */
    static async updateInvoiceRate(id, newRate, newAmountVes) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('current_exchange_rate', sql.Decimal(10, 2), newRate)
                .input('assigned_amount_ves', sql.Decimal(15, 2), newAmountVes)
                .query(`
                    UPDATE BillingInvoices 
                    SET current_exchange_rate = @current_exchange_rate,
                        assigned_amount_ves = @assigned_amount_ves,
                        last_rate_update = SYSDATETIME(),
                        updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND status = 'PENDING'
                `);
            const updated = result.recordset[0] || null;
            if (updated) {
                await BillingModel.updateInvoiceItemsForNewRate(id, newRate, updated.proportion_value);
            }
            return updated;
        } catch (error) {
            console.error('Error updating invoice rate:', error);
            throw error;
        }
    }

    /**
     * Recalcula el monto VES del recibo con la tasa BCV más reciente (misma lógica que el job diario).
     * Se usa al rechazar un reporte de pago: el recibo vuelve a pendiente y debe reflejar la tasa del día.
     */
    static async refreshInvoiceToLatestBcvRate(invoiceId, tenantId) {
        try {
            const ExchangeRateModel = require('./ExchangeRateModel');
            const latestRate = await ExchangeRateModel.getLatest();
            if (!latestRate || latestRate.usd_rate == null) {
                return null;
            }
            const pool = await connectDB();
            const invRes = await pool.request()
                .input('id', sql.UniqueIdentifier, invoiceId)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT assigned_amount_usd FROM BillingInvoices
                    WHERE id = @id AND tenant_id = @tenant_id AND status = N'PENDING'
                `);
            const row = invRes.recordset[0];
            if (!row) {
                return null;
            }
            const usd = parseFloat(row.assigned_amount_usd) || 0;
            const newRate = parseFloat(latestRate.usd_rate);
            const newAmountVes = usd * newRate;
            return BillingModel.updateInvoiceRate(invoiceId, newRate, newAmountVes);
        } catch (error) {
            console.error('Error refreshing invoice BCV rate:', error);
            throw error;
        }
    }

    /**
     * Actualizar items de recibo cuando cambia la tasa
     */
    static async updateInvoiceItemsForNewRate(invoiceId, newRate, proportionValue) {
        try {
            const pool = await connectDB();
            const itemsResult = await pool.request()
                .input('invoice_id', sql.UniqueIdentifier, invoiceId)
                .query(`
                    SELECT id, base_amount, currency FROM BillingInvoiceItems WHERE invoice_id = @invoice_id
                `);
            for (const item of itemsResult.recordset) {
                const base = parseFloat(item.base_amount) || 0;
                const convVes = item.currency === 'USD' ? base * newRate : base;
                const assignedVes = convVes * (parseFloat(proportionValue) || 1);
                await pool.request()
                    .input('id', sql.UniqueIdentifier, item.id)
                    .input('converted_amount_ves', sql.Decimal(15, 2), convVes)
                    .input('assigned_amount_ves', sql.Decimal(15, 2), assignedVes)
                    .query(`
                        UPDATE BillingInvoiceItems 
                        SET converted_amount_ves = @converted_amount_ves,
                            assigned_amount_ves = @assigned_amount_ves
                        WHERE id = @id
                    `);
            }
        } catch (error) {
            console.error('Error updating invoice items rate:', error);
            throw error;
        }
    }

    /**
     * Crear reporte de pago por propietario
     */
    static async createPaymentReport(data) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('invoice_id', sql.UniqueIdentifier, data.invoice_id)
                .input('submitted_by', sql.UniqueIdentifier, data.submitted_by)
                .input('banco_emisor', sql.NVarChar, data.banco_emisor)
                .input('fecha_transferencia', sql.NVarChar, data.fecha_transferencia)
                .input('ref_transferencia', sql.NVarChar, data.ref_transferencia)
                .input('monto_abonado_ves', sql.Decimal(15, 2), data.monto_abonado_ves)
                .input('comentario', sql.NVarChar, data.comentario || null)
                .input('attachment_path', sql.NVarChar, data.attachment_path || null)
                .query(`
                    INSERT INTO BillingPaymentReports (invoice_id, submitted_by, banco_emisor, fecha_transferencia, ref_transferencia, monto_abonado_ves, comentario, attachment_path)
                    OUTPUT INSERTED.*
                    VALUES (@invoice_id, @submitted_by, @banco_emisor, @fecha_transferencia, @ref_transferencia, @monto_abonado_ves, @comentario, @attachment_path)
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error creating payment report:', error);
            throw error;
        }
    }

    /**
     * Obtener último reporte de pago por recibo
     */
    static async getLatestPaymentReport(invoiceId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('invoice_id', sql.UniqueIdentifier, invoiceId)
                .query(`
                    SELECT TOP 1 r.*, u.first_name + ' ' + u.last_name as submitted_by_name
                    FROM BillingPaymentReports r
                    LEFT JOIN Users u ON r.submitted_by = u.id
                    WHERE r.invoice_id = @invoice_id
                    ORDER BY r.created_at DESC
                `);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error fetching payment report:', error);
            throw error;
        }
    }

    /**
     * Confirmar reporte de pago (marca recibo como PAID)
     */
    static async confirmPaymentReport(reportId, invoiceId, tenantId, adminId) {
        try {
            const pool = await connectDB();
            const report = await BillingModel.getLatestPaymentReport(invoiceId);
            if (!report || report.id !== reportId || report.status !== 'PENDING_CONFIRMATION') {
                return null;
            }

            await pool.request()
                .input('report_id', sql.UniqueIdentifier, reportId)
                .input('admin_id', sql.UniqueIdentifier, adminId)
                .query(`
                    UPDATE BillingPaymentReports 
                    SET status = 'CONFIRMED', confirmed_by = @admin_id, confirmed_at = SYSDATETIME(), updated_at = SYSDATETIME()
                    WHERE id = @report_id
                `);

            const paymentData = {
                paid_amount_ves: report.monto_abonado_ves,
                payment_method: 'Transferencia Bancaria',
                payment_reference: report.ref_transferencia,
                payment_notes: report.comentario ? `Banco emisor: ${report.banco_emisor}. ${report.comentario}` : `Banco emisor: ${report.banco_emisor}`
            };
            return await BillingModel.registerPayment(invoiceId, tenantId, paymentData);
        } catch (error) {
            console.error('Error confirming payment report:', error);
            throw error;
        }
    }

    /**
     * Rechazar reporte de pago
     */
    static async rejectPaymentReport(reportId, invoiceId, tenantId, rejectionReason) {
        try {
            const pool = await connectDB();
            const report = await BillingModel.getLatestPaymentReport(invoiceId);
            if (!report || report.id !== reportId || report.status !== 'PENDING_CONFIRMATION') {
                return null;
            }

            const result = await pool.request()
                .input('report_id', sql.UniqueIdentifier, reportId)
                .input('reason', sql.NVarChar, rejectionReason || 'Sin especificar')
                .query(`
                    UPDATE BillingPaymentReports 
                    SET status = 'REJECTED', rejection_reason = @reason, rejected_at = SYSDATETIME(), updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @report_id
                `);
            const out = result.recordset[0] || null;
            if (out) {
                await BillingModel.refreshInvoiceToLatestBcvRate(invoiceId, tenantId);
            }
            return out;
        } catch (error) {
            console.error('Error rejecting payment report:', error);
            throw error;
        }
    }

    /**
     * Registrar pago de recibo
     */
    static async registerPayment(id, tenantId, paymentData) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('paid_amount_ves', sql.Decimal(15, 2), paymentData.paid_amount_ves)
                .input('payment_method', sql.NVarChar, paymentData.payment_method)
                .input('payment_reference', sql.NVarChar, paymentData.payment_reference || null)
                .input('payment_notes', sql.NVarChar, paymentData.payment_notes || null)
                .query(`
                    UPDATE BillingInvoices 
                    SET status = 'PAID',
                        paid_amount_ves = @paid_amount_ves,
                        paid_at = SYSDATETIME(),
                        payment_method = @payment_method,
                        payment_reference = @payment_reference,
                        payment_notes = @payment_notes,
                        updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenant_id
                `);
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error registering payment:', error);
            throw error;
        }
    }

    /**
     * Marcar preliminar como enviado a propietarios
     */
    static async markPreliminaryAsSent(id, tenantId) {
        try {
            const pool = await connectDB();
            
            // Marcar preliminar como enviado
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    UPDATE BillingPreliminaries 
                    SET sent_to_owners = 1, 
                        sent_at = SYSDATETIME(),
                        updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenant_id
                `);
            
            // Marcar todos los recibos asociados como enviados
            await pool.request()
                .input('preliminary_id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    UPDATE BillingInvoices 
                    SET sent_to_owners = 1, 
                        sent_at = SYSDATETIME(),
                        updated_at = SYSDATETIME()
                    WHERE preliminary_id = @preliminary_id AND tenant_id = @tenant_id
                `);
            
            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error marking preliminary as sent:', error);
            throw error;
        }
    }

    // ==================== PLANTILLAS ====================

    /**
     * Crear plantilla de item extraordinario
     */
    static async createTemplate(data) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, data.tenant_id)
                .input('name', sql.NVarChar, data.name)
                .input('description', sql.NVarChar, data.description || null)
                .input('default_amount', sql.Decimal(15, 2), data.default_amount || null)
                .input('default_currency', sql.NVarChar, data.default_currency || 'VES')
                .input('category', sql.NVarChar, data.category || null)
                .query(`
                    INSERT INTO BillingExtraordinaryTemplates (tenant_id, name, description, default_amount, default_currency, category)
                    OUTPUT INSERTED.*
                    VALUES (@tenant_id, @name, @description, @default_amount, @default_currency, @category)
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error creating template:', error);
            throw error;
        }
    }

    /**
     * Obtener plantillas de un tenant
     */
    static async getTemplatesByTenant(tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT * FROM BillingExtraordinaryTemplates
                    WHERE tenant_id = @tenant_id AND is_active = 1
                    ORDER BY category, name
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching templates:', error);
            throw error;
        }
    }

    /**
     * Estadísticas de facturación
     */
    static async getBillingStats(tenantId, preliminaryId = null) {
        try {
            const pool = await connectDB();
            
            let query = `
                SELECT 
                    COUNT(*) as total_invoices,
                    SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) as paid_count,
                    SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
                    SUM(assigned_amount_ves) as total_amount,
                    SUM(CASE WHEN status = 'PAID' THEN paid_amount_ves ELSE 0 END) as total_collected,
                    SUM(CASE WHEN status = 'PENDING' THEN assigned_amount_ves ELSE 0 END) as total_pending
                FROM BillingInvoices
                WHERE tenant_id = @tenant_id
            `;

            if (preliminaryId) {
                query += ` AND preliminary_id = @preliminary_id`;
            }

            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            if (preliminaryId) {
                request.input('preliminary_id', sql.UniqueIdentifier, preliminaryId);
            }

            const result = await request.query(query);
            return result.recordset[0];
        } catch (error) {
            console.error('Error fetching billing stats:', error);
            throw error;
        }
    }

    /**
     * Eliminar preliminar y sus items (solo si está en estado DRAFT)
     */
    static async deletePreliminary(id, tenantId) {
        try {
            const pool = await connectDB();
            
            // Verificar que el preliminar exista y esté en estado DRAFT
            const checkResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT status FROM BillingPreliminaries 
                    WHERE id = @id AND tenant_id = @tenant_id
                `);
            
            if (checkResult.recordset.length === 0) {
                return { success: false, error: 'Preliminar no encontrado' };
            }
            
            const status = checkResult.recordset[0].status;
            if (status !== 'DRAFT') {
                return { success: false, error: 'Solo se pueden eliminar preliminares en estado borrador' };
            }
            
            // Eliminar items primero (por FK)
            await pool.request()
                .input('preliminary_id', sql.UniqueIdentifier, id)
                .query(`DELETE FROM BillingPreliminaryItems WHERE preliminary_id = @preliminary_id`);
            
            // Eliminar preliminar
            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`DELETE FROM BillingPreliminaries WHERE id = @id AND tenant_id = @tenant_id`);
            
            return { success: true };
        } catch (error) {
            console.error('Error deleting preliminary:', error);
            throw error;
        }
    }
}

module.exports = BillingModel;
