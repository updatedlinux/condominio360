const { sql, connectDB } = require('../config/database');

class TenantModel {
    /**
     * Find a tenant by their slug (useful for subdomain resolution)
     * @param {string} slug 
     * @returns {Promise<Object|null>}
     */
    static async findBySlug(slug) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('slug', sql.NVarChar, slug)
                .query('SELECT * FROM Tenants WHERE slug = @slug AND active = 1');

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding tenant by slug:', error);
            throw error;
        }
    }

    /**
     * Find a tenant by ID
     * @param {string} id 
     * @returns {Promise<Object|null>}
     */
    static async findById(id) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT t.*, 
                        (SELECT COUNT(*) FROM Buildings WHERE tenant_id = t.id AND is_active = 1) as building_count,
                        (SELECT COUNT(*) FROM Properties WHERE tenant_id = t.id) as property_count
                    FROM Tenants t 
                    WHERE t.id = @id
                `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error finding tenant by id:', error);
            throw error;
        }
    }

    /**
     * Create a new tenant (SuperAdmin only)
     * @param {Object} tenantData 
     */
    static async create(tenantData) {
        const { name, slug, address, billing_type, building_type, settings } = tenantData;
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('name', sql.NVarChar, name)
                .input('slug', sql.NVarChar, slug)
                .input('address', sql.NVarChar, address || null)
                .input('billing_type', sql.NVarChar, billing_type || 'FIXED')
                .input('building_type', sql.NVarChar, building_type || 'SINGLE')
                .input('settings', sql.NVarChar, JSON.stringify(settings || {}))
                .query(`
                    INSERT INTO Tenants (name, slug, address, billing_type, building_type, settings)
                    OUTPUT INSERTED.*
                    VALUES (@name, @slug, @address, @billing_type, @building_type, @settings)
                `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error creating tenant:', error);
            throw error;
        }
    }

    /**
     * Update tenant settings
     * @param {string} id 
     * @param {Object} data 
     */
    static async update(id, data) {
        const allowedFields = ['name', 'address', 'billing_type', 'billing_mode', 'payment_info', 'building_type', 'settings', 'active', 'saas_unit_price_usd'];
        const updates = [];
        const inputs = [{ name: 'id', type: sql.UniqueIdentifier, value: id }];

        for (const [key, value] of Object.entries(data)) {
            if (allowedFields.includes(key) && value !== undefined) {
                updates.push(`${key} = @${key}`);
                if (key === 'settings') {
                    inputs.push({ name: key, type: sql.NVarChar, value: JSON.stringify(value) });
                } else if (key === 'saas_unit_price_usd') {
                    let parsed = null;
                    if (value !== null && value !== '') {
                        parsed = parseFloat(value);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            throw new Error('Tarifa SaaS inválida');
                        }
                    }
                    inputs.push({ name: key, type: sql.Decimal(18, 6), value: parsed });
                } else {
                    inputs.push({ name: key, type: sql.NVarChar, value });
                }
            }
        }

        if (updates.length === 0) return null;

        try {
            const pool = await connectDB();
            const request = pool.request();
            inputs.forEach(input => request.input(input.name, input.type, input.value));

            const result = await request.query(`
                UPDATE Tenants 
                SET ${updates.join(', ')}, updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE id = @id
            `);

            return result.recordset[0];
        } catch (error) {
            console.error('Error updating tenant:', error);
            throw error;
        }
    }

    /**
     * Get all tenants with stats
     */
    static async getAll(options = {}) {
        const { page = 1, limit = 50, active = null } = options;
        const offset = (page - 1) * limit;

        try {
            const pool = await connectDB();
            
            let whereClause = '';
            if (active !== null) {
                whereClause = 'WHERE active = @active';
            }

            const countResult = await pool.request()
                .input('active', sql.Bit, active)
                .query(`SELECT COUNT(*) as total FROM Tenants ${whereClause}`);

            const total = countResult.recordset[0].total;

            const dataResult = await pool.request()
                .input('active', sql.Bit, active)
                .input('offset', sql.Int, offset)
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT t.*,
                        (SELECT COUNT(*) FROM Properties WHERE tenant_id = t.id) as property_count,
                        (SELECT COUNT(*) FROM Buildings WHERE tenant_id = t.id AND is_active = 1) as building_count,
                        (SELECT COUNT(*) FROM Users u 
                         INNER JOIN PropertyOwners po ON u.id = po.user_id 
                         INNER JOIN Properties p ON po.property_id = p.id 
                         WHERE p.tenant_id = t.id) as owner_count
                    FROM Tenants t
                    ${whereClause}
                    ORDER BY t.created_at DESC
                    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
                `);

            return {
                tenants: dataResult.recordset,
                pagination: { total, page, limit, pages: Math.ceil(total / limit) }
            };
        } catch (error) {
            console.error('Error getting tenants:', error);
            throw error;
        }
    }

    /**
     * URL base del API externo (ej. https://host.../api), sin barra final.
     */
    static normalizeWhatsAppApiBaseUrl(input) {
        const t = (input || '').trim();
        if (!t) return null;
        let u = t;
        if (!/^https?:\/\//i.test(u)) {
            u = `https://${u.replace(/^\/+/, '')}`;
        }
        u = u.replace(/\/+$/, '');
        try {
            const parsed = new URL(u);
            // Solo origen (p. ej. https://host) → el API suele estar bajo /api (evita 404 en …/send-message)
            if (!parsed.pathname || parsed.pathname === '/') {
                u = `${u}/api`;
            }
        } catch {
            /* mantener u */
        }
        return u.replace(/\/+$/, '');
    }

    /**
     * Configuración para envío (incluye secret). null si no está contratado/configurado.
     */
    static async getWhatsAppDeliveryConfig(tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT whatsapp_api_base_url, whatsapp_api_secret, whatsapp_messaging_enabled
                    FROM Tenants WHERE id = @id
                `);
            const t = result.recordset[0];
            if (!t || !t.whatsapp_messaging_enabled) return null;
            const baseUrl = TenantModel.normalizeWhatsAppApiBaseUrl(t.whatsapp_api_base_url);
            const secretKey = (t.whatsapp_api_secret || '').trim();
            if (!baseUrl || !secretKey) return null;
            return { baseUrl, secretKey };
        } catch (error) {
            console.error('getWhatsAppDeliveryConfig error:', error);
            return null;
        }
    }

    /**
     * Superadmin / UI: sin secret; indica si hay clave guardada.
     */
    static async getWhatsAppSettingsPublic(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT whatsapp_api_base_url, whatsapp_messaging_enabled,
                    CASE WHEN whatsapp_api_secret IS NOT NULL AND LEN(LTRIM(RTRIM(whatsapp_api_secret))) > 0
                        THEN 1 ELSE 0 END AS has_api_secret
                FROM Tenants WHERE id = @id
            `);
        const row = result.recordset[0];
        if (!row) return null;
        return {
            enabled: !!row.whatsapp_messaging_enabled,
            apiBaseUrl: row.whatsapp_api_base_url || '',
            hasApiSecret: !!row.has_api_secret
        };
    }

    /**
     * @param {Object} data - enabled?, apiBaseUrl?, apiKey? (vacío = mantener clave anterior)
     */
    static async updateWhatsAppSettings(tenantId, data) {
        const pool = await connectDB();
        const cur = await pool.request()
            .input('id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT whatsapp_api_base_url, whatsapp_api_secret FROM Tenants WHERE id = @id
            `);
        const ex = cur.recordset[0];
        if (!ex) throw new Error('Condominio no encontrado');

        const request = pool.request().input('id', sql.UniqueIdentifier, tenantId);
        const parts = [];

        if (data.enabled !== undefined) {
            parts.push('whatsapp_messaging_enabled = @w_en');
            request.input('w_en', sql.Bit, data.enabled ? 1 : 0);
        }
        if (data.apiBaseUrl !== undefined) {
            const normalized = TenantModel.normalizeWhatsAppApiBaseUrl(data.apiBaseUrl);
            parts.push('whatsapp_api_base_url = @w_url');
            request.input('w_url', sql.NVarChar, normalized || null);
        }
        if (data.apiKey !== undefined) {
            const k = String(data.apiKey || '').trim();
            parts.push('whatsapp_api_secret = @w_sec');
            if (k.length > 0) {
                request.input('w_sec', sql.NVarChar, k);
            } else {
                request.input('w_sec', sql.NVarChar, ex.whatsapp_api_secret || null);
            }
        }

        if (parts.length === 0) {
            return TenantModel.findById(tenantId);
        }
        parts.push('updated_at = SYSDATETIME()');

        await request.query(`
            UPDATE Tenants SET ${parts.join(', ')} WHERE id = @id
        `);
        return TenantModel.findById(tenantId);
    }

    static normalizeBitFlag(value, defaultEnabled = true) {
        if (value === undefined || value === null) return defaultEnabled;
        return value === true || value === 1 || value === '1';
    }

    /**
     * Flags de módulos de portería (visitas / deliveries) para propietarios y vigilancia.
     */
    static async getPortalFeatureFlags(tenantId) {
        const pool = await connectDB();
        const result = await pool.request()
            .input('id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT visits_announcements_enabled, deliveries_announcements_enabled, vehicle_access_enabled
                FROM Tenants WHERE id = @id
            `);
        const row = result.recordset[0];
        if (!row) return null;
        return {
            visits_announcements_enabled: TenantModel.normalizeBitFlag(row.visits_announcements_enabled, true),
            deliveries_announcements_enabled: TenantModel.normalizeBitFlag(row.deliveries_announcements_enabled, true),
            vehicle_access_enabled: TenantModel.normalizeBitFlag(row.vehicle_access_enabled, true)
        };
    }

    /**
     * SuperAdmin: activar/desactivar módulos de portería (visitas, deliveries, acceso vehicular).
     * @param {Object} data - { visitsEnabled?, deliveriesEnabled?, vehicleAccessEnabled? }
     */
    static async updatePortalFeatureFlags(tenantId, data) {
        const pool = await connectDB();
        const cur = await pool.request()
            .input('id', sql.UniqueIdentifier, tenantId)
            .query('SELECT id FROM Tenants WHERE id = @id');
        if (!cur.recordset[0]) throw new Error('Condominio no encontrado');

        const request = pool.request().input('id', sql.UniqueIdentifier, tenantId);
        const parts = [];

        if (data.visitsEnabled !== undefined) {
            parts.push('visits_announcements_enabled = @v_en');
            request.input('v_en', sql.Bit, data.visitsEnabled ? 1 : 0);
        }
        if (data.deliveriesEnabled !== undefined) {
            parts.push('deliveries_announcements_enabled = @d_en');
            request.input('d_en', sql.Bit, data.deliveriesEnabled ? 1 : 0);
        }
        if (data.vehicleAccessEnabled !== undefined) {
            parts.push('vehicle_access_enabled = @v_acc');
            request.input('v_acc', sql.Bit, data.vehicleAccessEnabled ? 1 : 0);
        }

        if (parts.length === 0) {
            return TenantModel.getPortalFeatureFlags(tenantId);
        }

        parts.push('updated_at = SYSDATETIME()');
        await request.query(`UPDATE Tenants SET ${parts.join(', ')} WHERE id = @id`);
        return TenantModel.getPortalFeatureFlags(tenantId);
    }
}

module.exports = TenantModel;
