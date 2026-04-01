const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');
const TenantModel = require('../models/TenantModel');
const UserModel = require('../models/UserModel');
const PropertyModel = require('../models/PropertyModel');
const SystemSettingsModel = require('../models/SystemSettingsModel');
const BCVService = require('../services/BCVService');
const EmailService = require('../services/EmailService');
const BulkOwnerWelcomeBatchModel = require('../models/BulkOwnerWelcomeBatchModel');
const OwnerBulkWelcomeEmailService = require('../services/OwnerBulkWelcomeEmailService');
const { sql, connectDB } = require('../config/database');

/**
 * AdminController
 * Gestión a nivel de SuperAdmin para todo el SaaS
 */
class AdminController {
    /**
     * GET /api/admin/stats
     * Estadísticas globales del sistema
     */
    static async getStats(req, res) {
        try {
            const pool = await connectDB();

            // Contar tenants
            const tenantsResult = await pool.request().query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active
                FROM Tenants
            `);

            // Contar usuarios totales
            const usersResult = await pool.request().query(`
                SELECT COUNT(*) as total FROM Users
            `);

            // Contar propietarios (users que tienen propiedades)
            const ownersResult = await pool.request().query(`
                SELECT COUNT(DISTINCT user_id) as total FROM PropertyOwners
            `);

            // Contar propiedades totales
            const propertiesResult = await pool.request().query(`
                SELECT COUNT(*) as total FROM Properties
            `);

            // Contar admins de junta
            const adminsResult = await pool.request().query(`
                SELECT COUNT(*) as total FROM TenantAdmins WHERE is_active = 1
            `);

            // Actividad reciente (últimos 7 días)
            const activityResult = await pool.request().query(`
                SELECT COUNT(*) as total FROM AuditLogs 
                WHERE created_at >= DATEADD(day, -7, GETDATE())
            `);

            res.json({
                success: true,
                data: {
                    tenants: tenantsResult.recordset[0].total,
                    tenants_active: tenantsResult.recordset[0].active,
                    users: usersResult.recordset[0].total,
                    owners: ownersResult.recordset[0].total,
                    properties: propertiesResult.recordset[0].total,
                    tenant_admins: adminsResult.recordset[0].total,
                    recent_activity: activityResult.recordset[0].total,
                    revenue: parseFloat((await pool.request().query('SELECT ISNULL(SUM(total_usd), 0) as rev FROM SaaSInvoices WHERE status = \'PAID\'')).recordset[0]?.rev) || 0
                }
            });
        } catch (error) {
            console.error('Get admin stats error:', error);
            res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
    }

    /**
     * GET /api/admin/superadmins
     * Listar todos los superadministradores
     */
    static async getSuperAdmins(req, res) {
        try {
            const superadmins = await UserModel.findAllSuperAdmins();
            res.json({ success: true, data: superadmins });
        } catch (error) {
            console.error('Get superadmins error:', error);
            res.status(500).json({ error: 'Error al obtener superadministradores' });
        }
    }

    /**
     * POST /api/admin/superadmins
     * Crear un nuevo superadministrador
     */
    static async createSuperAdmin(req, res) {
        try {
            const { first_name, last_name, email, password, phone } = req.body;
            if (!first_name || !last_name || !email || !password) {
                return res.status(400).json({ error: 'Nombre, apellido, email y contraseña son requeridos' });
            }
            if (password.length < 6) {
                return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
            }
            const user = await UserModel.createSuperAdmin({ first_name, last_name, email, password, phone });
            await AdminController.logAudit(req, 'CREATE', 'SUPERADMIN', user.id, `Creó superadministrador: ${first_name} ${last_name} (${email})`);
            res.status(201).json({ success: true, data: user });
        } catch (error) {
            console.error('Create superadmin error:', error);
            const status = error.message?.includes('ya está registrado') ? 409 : 500;
            res.status(status).json({ error: error.message || 'Error al crear superadministrador' });
        }
    }

    /**
     * DELETE /api/admin/superadmins/:id
     * Eliminar un superadministrador
     */
    static async deleteSuperAdmin(req, res) {
        try {
            const { id } = req.params;
            const currentUserId = req.user?.userId;
            if (!currentUserId) {
                return res.status(401).json({ error: 'No autorizado' });
            }
            await UserModel.deleteSuperAdmin(id, currentUserId);
            await AdminController.logAudit(req, 'DELETE', 'SUPERADMIN', id, 'Eliminó superadministrador');
            res.json({ success: true });
        } catch (error) {
            console.error('Delete superadmin error:', error);
            const status = error.message?.includes('No puede') || error.message?.includes('Debe existir') ? 400 : 500;
            res.status(status).json({ error: error.message || 'Error al eliminar superadministrador' });
        }
    }

    /**
     * GET /api/admin/owners/search
     * Buscar propietario por DNI y/o email (SuperAdmin)
     * Devuelve el propietario y los condominios a los que pertenece
     */
    static async searchOwners(req, res) {
        try {
            const { dni, email } = req.query;
            if (!dni?.trim() && !email?.trim()) {
                return res.status(400).json({ error: 'Proporcione DNI o correo para buscar' });
            }
            const result = await UserModel.findOwnerWithTenants(dni?.trim(), email?.trim());
            res.json({ success: true, data: result });
        } catch (error) {
            console.error('Search owners error:', error);
            res.status(500).json({ error: 'Error al buscar propietario' });
        }
    }

    /**
     * GET /api/admin/tenants
     * Listar todos los tenants con estadísticas
     */
    static async getAllTenants(req, res) {
        try {
            const pool = await connectDB();
            const result = await pool.request().query(`
                SELECT 
                    t.*,
                    (SELECT COUNT(*) FROM Properties WHERE tenant_id = t.id) as property_count,
                    (SELECT COUNT(DISTINCT po.user_id) 
                     FROM PropertyOwners po 
                     INNER JOIN Properties p ON po.property_id = p.id 
                     WHERE p.tenant_id = t.id) as user_count
                FROM Tenants t
                ORDER BY t.created_at DESC
            `);

            res.json({
                success: true,
                data: result.recordset
            });
        } catch (error) {
            console.error('Get all tenants error:', error);
            res.status(500).json({ error: 'Error al obtener condominios' });
        }
    }

    /**
     * GET /api/admin/tenants/:id
     * Obtener detalle de un tenant (API JSON)
     */
    static async getTenantById(req, res) {
        try {
            const { id } = req.params;
            const pool = await connectDB();

            // Info del tenant
            const tenantResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('SELECT * FROM Tenants WHERE id = @id');

            if (tenantResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Condominio no encontrado' });
            }

            const tenant = tenantResult.recordset[0];

            // Estadísticas
            const statsResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT 
                        (SELECT COUNT(*) FROM Properties WHERE tenant_id = @tenant_id) as properties,
                        (SELECT COUNT(DISTINCT po.user_id) 
                         FROM PropertyOwners po 
                         INNER JOIN Properties p ON po.property_id = p.id 
                         WHERE p.tenant_id = @tenant_id) as owners,
                        (SELECT COUNT(*) FROM Users u
                         INNER JOIN TenantAdmins ta ON u.id = ta.user_id
                         WHERE ta.tenant_id = @tenant_id) as admins
                `);

            // Admins de la junta
            const adminsResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT ta.*, u.first_name, u.last_name, u.email, u.dni
                    FROM TenantAdmins ta
                    INNER JOIN Users u ON ta.user_id = u.id
                    WHERE ta.tenant_id = @tenant_id
                    ORDER BY ta.created_at DESC
                `);

            res.json({
                success: true,
                data: {
                    ...tenant,
                    stats: statsResult.recordset[0],
                    admins: adminsResult.recordset
                }
            });
        } catch (error) {
            console.error('Get tenant by id error:', error);
            res.status(500).json({ error: 'Error al obtener condominio' });
        }
    }

    /**
     * Renderizar vista de gestión de propiedades/inmuebles
     */
    static async renderTenantProperties(req, res) {
        try {
            const { id } = req.params;
            const tenant = await TenantModel.findById(id);

            if (!tenant) {
                return res.status(404).render('error', { 
                    title: 'No encontrado',
                    message: 'Condominio no encontrado'
                });
            }

            res.render('admin/tenant-properties', {
                title: `Gestión de Inmuebles - ${tenant.name}`,
                layout: false,
                tenant
            });
        } catch (error) {
            console.error('Render tenant properties error:', error);
            res.status(500).render('error', { 
                title: 'Error',
                message: 'Error al cargar la gestión de inmuebles'
            });
        }
    }

    /**
     * Página de impersonación: abre en nueva pestaña, usa sessionStorage para no invalidar sesión superadmin
     */
    static async renderImpersonateTenant(req, res) {
        const { id } = req.params;
        res.render('admin/impersonate-tenant', { tenantId: id, layout: false });
    }

    /**
     * Renderizar vista de detalle de tenant
     */
    static async renderTenantDetail(req, res) {
        try {
            const { id } = req.params;
            const pool = await connectDB();

            // Info del tenant
            const tenantResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('SELECT * FROM Tenants WHERE id = @id');

            if (tenantResult.recordset.length === 0) {
                return res.status(404).render('error', { 
                    title: 'No encontrado',
                    message: 'Condominio no encontrado'
                });
            }

            const tenant = tenantResult.recordset[0];

            // Estadísticas
            const statsResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT 
                        (SELECT COUNT(*) FROM Properties WHERE tenant_id = @tenant_id) as properties,
                        (SELECT COUNT(DISTINCT po.user_id) 
                         FROM PropertyOwners po 
                         INNER JOIN Properties p ON po.property_id = p.id 
                         WHERE p.tenant_id = @tenant_id) as owners
                `);

            // Admins de la junta
            const adminsResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT ta.*
                    FROM TenantAdmins ta
                    WHERE ta.tenant_id = @tenant_id
                    ORDER BY ta.created_at DESC
                `);

            res.render('admin/tenant-detail', {
                title: tenant.name,
                layout: false,
                tenant,
                stats: statsResult.recordset[0],
                admins: adminsResult.recordset
            });
        } catch (error) {
            console.error('Render tenant detail error:', error);
            res.status(500).render('error', { 
                title: 'Error',
                message: 'Error al cargar el condominio'
            });
        }
    }

    /**
     * POST /api/admin/tenants
     * Crear un nuevo tenant básico
     */
    static async createTenant(req, res) {
        try {
            const { name, slug, address, settings } = req.body;

            // Validaciones básicas
            if (!name || !slug) {
                return res.status(400).json({ error: 'Nombre y slug son requeridos' });
            }

            // Validar formato de slug
            if (!/^[a-z0-9-]+$/.test(slug)) {
                return res.status(400).json({ error: 'Slug solo puede contener minúsculas, números y guiones' });
            }

            const newTenant = await TenantModel.create({
                name,
                slug: slug.toLowerCase(),
                address,
                settings
            });

            // Registrar en auditoría
            await AdminController.logAudit(req, 'CREATE', 'TENANT', newTenant.id, `Creó condominio: ${name}`, newTenant.id);

            res.status(201).json({
                success: true,
                message: 'Condominio creado exitosamente',
                data: newTenant
            });
        } catch (error) {
            console.error('Create tenant error:', error);
            if (error.message && error.message.includes('UNIQUE KEY')) {
                return res.status(409).json({ error: 'El slug ya existe. Elige otro identificador.' });
            }
            res.status(500).json({ error: 'Error al crear condominio' });
        }
    }

    /**
     * POST /api/admin/onboarding
     * Wizard completo: Crear tenant + admin principal + configuración inicial
     * 
     * NUEVO: Soporta configuración de:
     * - billing_type: 'FIXED' | 'ALICUOTA'
     * - building_type: 'SINGLE' | 'MULTIPLE'
     * - buildings: Array de edificios (si es MULTIPLE)
     * 
     * NOTA: Para admins de junta, el flujo es diferente a propietarios:
     * - No requieren DNI (no son propietarios)
     * - El SuperAdmin asigna la contraseña inicial
     * - Email de bienvenida con credenciales (no token de invitación)
     */
    static async onboardTenant(req, res) {
        const pool = await connectDB();
        const transaction = pool.transaction();
        let transactionStarted = false;
        let transactionCommitted = false;

        try {
            const { name, slug, address, billing_type, building_type, buildings, admin } = req.body;

            // Validaciones
            if (!name || !slug || !admin) {
                return res.status(400).json({ error: 'Faltan datos requeridos' });
            }

            if (!admin.display_name || !admin.email || !admin.password) {
                return res.status(400).json({ error: 'Nombre de usuario, email y contraseña son requeridos' });
            }

            // Validar billing_type
            if (!billing_type || !['FIXED', 'ALICUOTA'].includes(billing_type)) {
                return res.status(400).json({ error: 'Tipo de facturación inválido. Use FIXED o ALICUOTA' });
            }

            // Validar building_type
            if (!building_type || !['SINGLE', 'MULTIPLE'].includes(building_type)) {
                return res.status(400).json({ error: 'Tipo de edificio inválido. Use SINGLE o MULTIPLE' });
            }

            // Si es MULTIPLE, validar que hay edificios
            if (building_type === 'MULTIPLE' && (!buildings || buildings.length === 0)) {
                return res.status(400).json({ error: 'Debe especificar al menos un edificio para conjuntos multi-edificio' });
            }

            // Pre-validación: verificar slug y email ANTES de abrir transacción (evita crear datos parciales)
            const slugCheck = await pool.request()
                .input('slug', sql.NVarChar, (slug || '').toLowerCase())
                .query('SELECT 1 FROM Tenants WHERE slug = @slug');
            if (slugCheck.recordset.length > 0) {
                return res.status(409).json({ error: 'El identificador (slug) ya existe. Elige otro, por ejemplo: bcc-residencial, torre-bcc.' });
            }

            const emailCheck = await pool.request()
                .input('email', sql.NVarChar, admin.email)
                .query('SELECT 1 FROM Users WHERE email = @email');
            if (emailCheck.recordset.length > 0) {
                return res.status(409).json({ error: 'El email del administrador ya está registrado en el sistema. Usa otro correo o elimínalo del condominio anterior.' });
            }

            await transaction.begin();
            transactionStarted = true;

            // 1. Crear el tenant
            const tenantResult = await transaction.request()
                .input('name', sql.NVarChar, name)
                .input('slug', sql.NVarChar, slug.toLowerCase())
                .input('address', sql.NVarChar, address || null)
                .input('billing_type', sql.NVarChar, billing_type)
                .input('building_type', sql.NVarChar, building_type)
                .input('settings', sql.NVarChar, JSON.stringify({ 
                    onboarding_completed: false,
                    onboarding_step: 'buildings'
                }))
                .query(`
                    INSERT INTO Tenants (name, slug, address, billing_type, building_type, settings, active)
                    OUTPUT INSERTED.*
                    VALUES (@name, @slug, @address, @billing_type, @building_type, @settings, 1)
                `);

            const tenant = tenantResult.recordset[0];

            // 2. Crear edificios si es MULTIPLE
            let createdBuildings = [];
            if (building_type === 'MULTIPLE' && buildings && buildings.length > 0) {
                for (const building of buildings) {
                    const buildingResult = await transaction.request()
                        .input('tenant_id', sql.UniqueIdentifier, tenant.id)
                        .input('name', sql.NVarChar, building.name)
                        .input('code', sql.NVarChar, building.code || building.name.substring(0, 20))
                        .input('floors', sql.Int, building.floors || null)
                        .input('address_suffix', sql.NVarChar, building.address_suffix || null)
                        .query(`
                            INSERT INTO Buildings (tenant_id, name, code, floors, address_suffix, is_active)
                            OUTPUT INSERTED.*
                            VALUES (@tenant_id, @name, @code, @floors, @address_suffix, 1)
                        `);
                    createdBuildings.push(buildingResult.recordset[0]);
                }
            }
            // Si es SINGLE, crear un edificio por defecto
            else if (building_type === 'SINGLE') {
                const buildingResult = await transaction.request()
                    .input('tenant_id', sql.UniqueIdentifier, tenant.id)
                    .input('name', sql.NVarChar, 'Edificio Principal')
                    .input('code', sql.NVarChar, 'PRINCIPAL')
                    .query(`
                        INSERT INTO Buildings (tenant_id, name, code, is_active)
                        OUTPUT INSERTED.*
                        VALUES (@tenant_id, @name, @code, 1)
                    `);
                createdBuildings.push(buildingResult.recordset[0]);
            }

            // 2. Crear el usuario en tabla Users (con password dummy ya que es requerido)
            // Los admins de junta usan TenantAdmins para login, pero necesitamos un User para relaciones
            const dummyPassword = await require('bcrypt').hash(require('crypto').randomBytes(32).toString('hex'), 10);
            const userDni = 'ADMIN-' + Date.now(); // Identificador único para admins
            
            const userResult = await transaction.request()
                .input('first_name', sql.NVarChar, admin.display_name)
                .input('last_name', sql.NVarChar, 'Admin')
                .input('email', sql.NVarChar, admin.email)
                .input('dni', sql.NVarChar, userDni)
                .input('phone', sql.NVarChar, admin.phone || null)
                .input('password_hash', sql.NVarChar, dummyPassword)
                .query(`
                    INSERT INTO Users (first_name, last_name, email, dni, phone, password_hash, is_active, registration_status)
                    OUTPUT INSERTED.*
                    VALUES (@first_name, @last_name, @email, @dni, @phone, @password_hash, 1, 'ACTIVE')
                `);
            
            const user = userResult.recordset[0];

            // 3. Crear el TenantAdmin (aquí va la contraseña real para login)
            const password_hash = await require('bcrypt').hash(admin.password, 10);

            await transaction.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant.id)
                .input('user_id', sql.UniqueIdentifier, user.id)
                .input('email', sql.NVarChar, admin.email)
                .input('password_hash', sql.NVarChar, password_hash)
                .input('first_name', sql.NVarChar, admin.display_name)
                .input('last_name', sql.NVarChar, 'Admin')
                .input('phone', sql.NVarChar, admin.phone || null)
                .input('role', sql.NVarChar, 'ADMIN')
                .input('created_by', sql.UniqueIdentifier, req.user.userId)
                .query(`
                    INSERT INTO TenantAdmins 
                        (tenant_id, user_id, email, password_hash, first_name, last_name, phone, role, is_active, created_by, must_change_password)
                    VALUES 
                        (@tenant_id, @user_id, @email, @password_hash, @first_name, @last_name, @phone, @role, 1, @created_by, 1)
                `);

            await transaction.commit();
            transactionCommitted = true;

            // Enviar email de bienvenida con credenciales al admin de junta
            let welcomeSent = false;
            try {
                const EmailService = require('../services/EmailService');
                const loginUrl = `${process.env.APP_URL || 'http://localhost:3000'}/login`;
                await EmailService.sendWelcomeAdmin(admin.email, {
                    displayName: admin.display_name,
                    tenantName: tenant.name,
                    email: admin.email,
                    password: admin.password,
                    loginUrl
                });
                welcomeSent = true;
            } catch (emailErr) {
                console.error('Error enviando email de bienvenida:', emailErr);
            }

            // Registrar en auditoría
            await AdminController.logAudit(req, 'CREATE', 'TENANT', tenant.id, `Onboarding completo: ${name}`, tenant.id);

            res.status(201).json({
                success: true,
                message: 'Condominio y administrador creados exitosamente',
                data: {
                    tenant: {
                        id: tenant.id,
                        name: tenant.name,
                        slug: tenant.slug,
                        billing_type: tenant.billing_type,
                        building_type: tenant.building_type
                    },
                    buildings: createdBuildings,
                    admin: {
                        id: user.id,
                        displayName: admin.display_name,
                        email: admin.email,
                        welcome_sent: welcomeSent
                    }
                }
            });

        } catch (error) {
            if (transactionStarted && !transactionCommitted) {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    console.error('Rollback error:', rollbackError);
                }
            }
            console.error('Onboarding error:', error);
            
            const msg = (error.message || '').toLowerCase();
            if (msg.includes('unique key') || msg.includes('duplicate key')) {
                if (msg.includes('slug') || (msg.includes('tenants') && msg.includes('duplicate'))) {
                    return res.status(409).json({ error: 'El identificador (slug) ya existe. Elige otro, por ejemplo: bcc-residencial, torre-bcc.' });
                }
                if ((msg.includes('users') && msg.includes('duplicate')) || msg.includes('email')) {
                    return res.status(409).json({ error: 'El email del administrador ya está registrado. Usa otro correo.' });
                }
                if (msg.includes('dni')) {
                    return res.status(409).json({ error: 'La cédula ya está registrada.' });
                }
            }
            
            res.status(500).json({ error: 'Error en el proceso de onboarding' });
        }
    }

    /**
     * PUT /api/admin/tenants/:id
     * Actualizar tenant
     */
    static async updateTenant(req, res) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            const tenant = await TenantModel.update(id, updateData);

            if (!tenant) {
                return res.status(404).json({ error: 'Condominio no encontrado' });
            }

            await AdminController.logAudit(req, 'UPDATE', 'TENANT', id, `Tenant actualizado`, id);

            res.json({
                success: true,
                message: 'Condominio actualizado',
                data: tenant
            });
        } catch (error) {
            console.error('Update tenant error:', error);
            res.status(500).json({ error: 'Error al actualizar condominio' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/suspend
     * Suspender/activar tenant
     */
    static async toggleTenantStatus(req, res) {
        try {
            const { id } = req.params;
            const { active } = req.body;

            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('active', sql.Bit, active ? 1 : 0)
                .query(`
                    UPDATE Tenants 
                    SET active = @active, updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Condominio no encontrado' });
            }

            const action = active ? 'ACTIVATE' : 'SUSPEND';
            await AdminController.logAudit(req, action, 'TENANT', id, `Tenant ${active ? 'activado' : 'suspendido'}`, id);

            res.json({
                success: true,
                message: `Condominio ${active ? 'activado' : 'suspendido'}`,
                data: result.recordset[0]
            });
        } catch (error) {
            console.error('Toggle tenant status error:', error);
            res.status(500).json({ error: 'Error al cambiar estado del condominio' });
        }
    }

    /**
     * DELETE /api/admin/tenants/:id
     * Eliminar condominio SOLO si no tiene inmuebles ni propietarios asociados
     */
    static async deleteTenant(req, res) {
        const pool = await connectDB();
        const transaction = pool.transaction();
        const { id } = req.params;

        try {
            const checkResult = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT 
                        t.name as tenant_name,
                        (SELECT COUNT(*) FROM Properties WHERE tenant_id = @tenant_id) as property_count,
                        (SELECT COUNT(*) FROM PropertyOwners po 
                         INNER JOIN Properties p ON po.property_id = p.id 
                         WHERE p.tenant_id = @tenant_id) as owner_count
                    FROM Tenants t WHERE t.id = @tenant_id
                `);

            if (!checkResult.recordset[0]) {
                return res.status(404).json({ error: 'Condominio no encontrado' });
            }

            const { tenant_name, property_count, owner_count } = checkResult.recordset[0];

            if (property_count > 0) {
                return res.status(400).json({
                    error: `No se puede eliminar: el condominio tiene ${property_count} inmueble(s) asociado(s). Debe eliminar todos los inmuebles primero.`
                });
            }
            if (owner_count > 0) {
                return res.status(400).json({
                    error: `No se puede eliminar: hay ${owner_count} propietario(s) asociado(s) a inmuebles. Debe eliminar o reasignar los inmuebles primero.`
                });
            }

            await transaction.begin();

            const txRequest = () => transaction.request().input('tenant_id', sql.UniqueIdentifier, id);

            await txRequest().query('DELETE FROM VisitorLogs WHERE tenant_id = @tenant_id').catch(() => {});
            await txRequest().query('DELETE FROM VisitorPasses WHERE tenant_id = @tenant_id').catch(() => {});
            await txRequest().query('DELETE FROM Visitors WHERE tenant_id = @tenant_id');
            await txRequest().query('DELETE FROM ConsultationVotes WHERE tenant_id = @tenant_id').catch(() => {});
            await txRequest().query('DELETE FROM ConsultationOptions WHERE question_id IN (SELECT id FROM ConsultationQuestions WHERE consultation_id IN (SELECT id FROM Consultations WHERE tenant_id = @tenant_id))').catch(() => {});
            await txRequest().query('DELETE FROM ConsultationQuestions WHERE consultation_id IN (SELECT id FROM Consultations WHERE tenant_id = @tenant_id)').catch(() => {});
            await txRequest().query('DELETE FROM Consultations WHERE tenant_id = @tenant_id').catch(() => {});
            await txRequest().query('DELETE FROM Requests WHERE tenant_id = @tenant_id');
            await txRequest().query('DELETE FROM RequestTypes WHERE tenant_id = @tenant_id');
            await txRequest().query('DELETE FROM Properties WHERE tenant_id = @tenant_id');
            await txRequest().query('DELETE FROM Buildings WHERE tenant_id = @tenant_id');
            await txRequest().query('DELETE FROM TenantUsers WHERE tenant_id = @tenant_id');
            // Obtener user_ids de admins ANTES de borrarlos (para limpiar huérfanos después)
            const adminsResult = await txRequest().query(`
                SELECT user_id FROM TenantAdmins WHERE tenant_id = @tenant_id AND user_id IS NOT NULL
            `);
            const adminUserIds = (adminsResult.recordset || []).map(r => r.user_id).filter(Boolean);

            await txRequest().query('DELETE FROM TenantAdmins WHERE tenant_id = @tenant_id');

            try {
                await txRequest().query('DELETE FROM WhatsAppConfig WHERE tenant_id = @tenant_id');
            } catch (e) { /* tabla puede no existir */ }

            await txRequest().query('DELETE FROM Tenants WHERE id = @tenant_id');

            // Eliminar Users huérfanos (admins que solo estaban en este tenant y no son propietarios en otros)
            for (const uid of adminUserIds) {
                const orphanCheck = await transaction.request()
                    .input('user_id', sql.UniqueIdentifier, uid)
                    .query(`
                        SELECT 
                            (SELECT COUNT(*) FROM PropertyOwners WHERE user_id = @user_id) as prop_count,
                            (SELECT COUNT(*) FROM TenantAdmins WHERE user_id = @user_id) as admin_count,
                            (SELECT COUNT(*) FROM TenantUsers WHERE user_id = @user_id) as tu_count,
                            (SELECT is_superadmin FROM Users WHERE id = @user_id) as is_superadmin
                    `);
                const r = orphanCheck.recordset[0];
                if (r && r.prop_count === 0 && r.admin_count === 0 && r.tu_count === 0 && !r.is_superadmin) {
                    await transaction.request()
                        .input('id', sql.UniqueIdentifier, uid)
                        .query('DELETE FROM ConsultationVotes WHERE user_id = @id').catch(() => {});
                    await transaction.request()
                        .input('id', sql.UniqueIdentifier, uid)
                        .query('DELETE FROM Users WHERE id = @id');
                }
            }

            await transaction.commit();

            await AdminController.logAudit(req, 'DELETE', 'TENANT', id, `Eliminó condominio: ${tenant_name || 'N/A'}`, null);

            res.json({ success: true, message: 'Condominio eliminado correctamente' });
        } catch (error) {
            try { await transaction.rollback(); } catch (e) {}
            console.error('Delete tenant error:', error);
            res.status(500).json({ error: 'Error al eliminar condominio' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/billing-mode
     * Cambiar modo de facturación (FULL/SUPPORT) - SuperAdmin only
     */
    static async updateBillingMode(req, res) {
        try {
            const { id } = req.params;
            const { billing_mode, payment_info } = req.body;

            if (!billing_mode || !['FULL', 'SUPPORT'].includes(billing_mode)) {
                return res.status(400).json({ error: 'Modo de facturación inválido. Use FULL o SUPPORT' });
            }

            const pool = await connectDB();
            
            // Obtener configuración actual para auditoría
            const currentResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('SELECT billing_mode, name FROM Tenants WHERE id = @id');
            
            if (currentResult.recordset.length === 0) {
                return res.status(404).json({ error: 'Condominio no encontrado' });
            }

            const previousMode = currentResult.recordset[0].billing_mode;
            const tenantName = currentResult.recordset[0].name;

            // Actualizar modo de facturación
            const updateData = { billing_mode };
            if (payment_info !== undefined) {
                updateData.payment_info = typeof payment_info === 'string' ? payment_info : JSON.stringify(payment_info);
            }

            const tenant = await TenantModel.update(id, updateData);

            if (!tenant) {
                return res.status(404).json({ error: 'Condominio no encontrado' });
            }

            await AdminController.logAudit(
                req, 
                'UPDATE_BILLING_MODE', 
                'TENANT', 
                id, 
                `Modo de facturación cambiado de ${previousMode} a ${billing_mode} para ${tenantName}`,
                id
            );

            res.json({
                success: true,
                message: `Modo de facturación actualizado a ${billing_mode}`,
                data: {
                    id: tenant.id,
                    name: tenant.name,
                    billing_mode: tenant.billing_mode,
                    billing_type: tenant.billing_type,
                    payment_info: tenant.payment_info ? JSON.parse(tenant.payment_info) : null,
                    previous_mode: previousMode,
                    updated_at: tenant.updated_at
                }
            });
        } catch (error) {
            console.error('Update billing mode error:', error);
            res.status(500).json({ error: 'Error al actualizar modo de facturación' });
        }
    }

    /**
     * Mapeo de action a descripción legible (cuando description es null en AuditLogs)
     */
    static _getActivityDescription(log) {
        let desc;
        if (log.description) {
            desc = log.description;
        } else {
            const map = {
            VISIT_ENTRY_REGISTERED: 'Registró entrada de visitante',
            VISIT_EXIT_REGISTERED: 'Registró salida de visitante',
            FREQUENT_VISIT_ENTRY: 'Registró entrada de visitante frecuente',
            MANUAL_VISIT_CREATED: 'Creó pase de visita manual',
            OWNER_UPDATED: 'Actualizó datos de propietario',
            OWNER_PROPERTY_UPDATED: 'Actualizó asignación de propiedad',
            OWNER_PASSWORD_RESET: 'Restableció contraseña de propietario',
            SECURITY_USER_CREATED: 'Creó usuario de seguridad',
            SECURITY_USER_UPDATED: 'Actualizó usuario de seguridad',
            SECURITY_USER_PASSWORD_RESET: 'Restableció contraseña de vigilante',
            SECURITY_USER_DEACTIVATED: 'Desactivó usuario de seguridad',
            DELIVERY_ANNOUNCED: 'Anunció entrega',
            DELIVERY_ARRIVED: 'Registró llegada de entrega',
            DELIVERY_DELIVERED: 'Registró entrega completada',
            MANUAL_DELIVERY_CREATED: 'Creó registro de entrega manual',
            COMMUNICATION_CREATED: 'Creó comunicación',
            COMMUNICATION_UPDATED: 'Actualizó comunicación',
            COMMUNICATION_PUBLISHED: 'Publicó comunicación',
            COMMUNICATION_ARCHIVED: 'Archivó comunicación',
            COMMUNICATION_DELETED: 'Eliminó comunicación',
            PROPERTY_CREATED: 'Creó unidad inmobiliaria',
            PROPERTIES_CREATED_BULK: 'Creó unidades inmobiliarias en lote',
            PROPERTY_UPDATED: 'Actualizó unidad inmobiliaria',
            PROPERTY_DELETED: 'Eliminó unidad inmobiliaria',
            OWNER_ADDED: 'Asignó propietario a unidad',
            BUILDING_CREATED: 'Creó edificio',
            BUILDING_UPDATED: 'Actualizó edificio',
            BUILDING_DELETED: 'Eliminó edificio',
            COMMON_AREA_CREATED: 'Creó área común',
            COMMON_AREA_UPDATED: 'Actualizó área común',
            COMMON_AREA_DEACTIVATED: 'Desactivó área común',
            RESERVATION_APPROVED: 'Aprobó reservación',
            RESERVATION_REJECTED: 'Rechazó reservación',
            CREATE: 'Creó registro',
            UPDATE: 'Actualizó registro',
            DELETE: 'Eliminó registro',
            ACTIVATE: 'Activó condominio',
            SUSPEND: 'Suspendió condominio',
            UPDATE_BILLING_MODE: 'Cambió modo de facturación'
        };
            desc = map[log.action] || log.description || `Acción: ${log.action}`;
        }
        if (log.user_name && String(log.user_name).trim()) {
            desc = `${desc} — ${String(log.user_name).trim()}`;
        }
        return desc;
    }

    /**
     * GET /api/admin/activity
     * Actividad reciente global
     */
    static async getActivity(req, res) {
        try {
            const { limit = 10 } = req.query;
            const pool = await connectDB();

            const result = await pool.request()
                .input('limit', sql.Int, parseInt(limit))
                .query(`
                    SELECT TOP (@limit)
                        al.*,
                        t.name as tenant_name,
                        u.first_name + ' ' + u.last_name as user_name
                    FROM AuditLogs al
                    LEFT JOIN Tenants t ON al.tenant_id = t.id
                    LEFT JOIN Users u ON al.actor_id = u.id
                    ORDER BY al.created_at DESC
                `);

            const data = result.recordset.map(log => ({
                ...log,
                description: AdminController._getActivityDescription(log)
            }));

            res.json({
                success: true,
                data
            });
        } catch (error) {
            console.error('Get activity error:', error);
            res.status(500).json({ error: 'Error al obtener actividad' });
        }
    }

    /**
     * GET /api/admin/audit-logs
     * Logs de auditoría detallados
     */
    static async getAuditLogs(req, res) {
        try {
            const { limit = 50, offset = 0, tenantId, action } = req.query;
            const pool = await connectDB();

            let query = `
                SELECT 
                    al.*,
                    t.name as tenant_name,
                    u.first_name + ' ' + u.last_name as user_name
                FROM AuditLogs al
                LEFT JOIN Tenants t ON al.tenant_id = t.id
                LEFT JOIN Users u ON al.actor_id = u.id
                WHERE 1=1
            `;

            const request = pool.request()
                .input('limit', sql.Int, parseInt(limit))
                .input('offset', sql.Int, parseInt(offset));

            if (tenantId) {
                query += ` AND al.tenant_id = @tenantId`;
                request.input('tenantId', sql.UniqueIdentifier, tenantId);
            }

            if (action) {
                query += ` AND al.action = @action`;
                request.input('action', sql.NVarChar, action);
            }

            query += ` ORDER BY al.created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

            const result = await request.query(query);

            const data = result.recordset.map(log => ({
                ...log,
                description: AdminController._getActivityDescription(log)
            }));

            res.json({
                success: true,
                data
            });
        } catch (error) {
            console.error('Get audit logs error:', error);
            res.status(500).json({ error: 'Error al obtener logs de auditoría' });
        }
    }

    /**
     * Helper: Registrar en auditoría
     * @param {Object} req - Request
     * @param {string} action - CREATE, UPDATE, DELETE, etc.
     * @param {string} entityType - TENANT, BUILDING, PROPERTY, OWNER, SUPERADMIN, etc.
     * @param {string} entityId - ID de la entidad
     * @param {string} description - Descripción legible
     * @param {string} [tenantId] - ID del tenant (opcional, para acciones en contexto de condominio)
     */
    static async logAudit(req, action, entityType, entityId, description, tenantId = null) {
        try {
            const allowedTypes = ['USER', 'TENANT_ADMIN', 'SYSTEM', 'API'];
            const actorType = allowedTypes.includes(req.user?.type) ? req.user.type : 'USER';
            const pool = await connectDB();
            await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('actor_id', sql.UniqueIdentifier, req.user?.userId || null)
                .input('actor_type', sql.NVarChar, actorType)
                .input('action', sql.NVarChar, action)
                .input('entity_type', sql.NVarChar, entityType)
                .input('entity_id', sql.NVarChar, entityId)
                .input('description', sql.NVarChar, description)
                .input('ip_address', sql.NVarChar, req.ip || req.connection?.remoteAddress || null)
                .query(`
                    INSERT INTO AuditLogs (tenant_id, actor_id, actor_type, action, entity_type, entity_id, description, ip_address)
                    VALUES (@tenant_id, @actor_id, @actor_type, @action, @entity_type, @entity_id, @description, @ip_address)
                `);
        } catch (error) {
            console.error('Error logging audit:', error);
        }
    }

    // ============================================================
    // BUILDINGS MANAGEMENT
    // ============================================================

    /**
     * GET /api/admin/tenants/:id/buildings
     * Listar edificios de un tenant
     */
    static async getBuildings(req, res) {
        try {
            const { id } = req.params;
            console.log(`[DEBUG] getBuildings: tenantId=${id}`);
            const pool = await connectDB();
            
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT b.*, 
                        (SELECT COUNT(*) FROM Properties WHERE building_id = b.id) as property_count
                    FROM Buildings b
                    WHERE b.tenant_id = @tenant_id
                    ORDER BY b.name
                `);

            console.log(`[DEBUG] getBuildings: found ${result.recordset.length} buildings`);
            res.json({
                success: true,
                buildings: result.recordset
            });
        } catch (error) {
            console.error('Get buildings error:', error);
            res.status(500).json({ error: 'Error al obtener edificios' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/buildings
     * Crear edificio para un tenant
     */
    static async createBuilding(req, res) {
        try {
            const { id } = req.params;
            const { name, code, floors, address_suffix } = req.body;

            if (!name) {
                return res.status(400).json({ error: 'El nombre del edificio es requerido' });
            }

            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .input('name', sql.NVarChar, name)
                .input('code', sql.NVarChar, code || name.substring(0, 20))
                .input('floors', sql.Int, floors || null)
                .input('address_suffix', sql.NVarChar, address_suffix || null)
                .query(`
                    INSERT INTO Buildings (tenant_id, name, code, floors, address_suffix, is_active)
                    OUTPUT INSERTED.*
                    VALUES (@tenant_id, @name, @code, @floors, @address_suffix, 1)
                `);

            const building = result.recordset[0];
            await AdminController.logAudit(req, 'CREATE', 'BUILDING', building.id, `Creó edificio: ${name}`, id);

            res.status(201).json({
                success: true,
                building
            });
        } catch (error) {
            console.error('Create building error:', error);
            res.status(500).json({ error: 'Error al crear edificio' });
        }
    }

    /**
     * PUT /api/admin/buildings/:id
     * Actualizar edificio
     */
    static async updateBuilding(req, res) {
        try {
            const { id } = req.params;
            const { name, code, floors, address_suffix } = req.body;

            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('name', sql.NVarChar, name)
                .input('code', sql.NVarChar, code)
                .input('floors', sql.Int, floors)
                .input('address_suffix', sql.NVarChar, address_suffix)
                .query(`
                    UPDATE Buildings
                    SET 
                        name = COALESCE(@name, name),
                        code = COALESCE(@code, code),
                        floors = COALESCE(@floors, floors),
                        address_suffix = COALESCE(@address_suffix, address_suffix),
                        updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Edificio no encontrado' });
            }

            const building = result.recordset[0];
            await AdminController.logAudit(req, 'UPDATE', 'BUILDING', id, `Actualizó edificio: ${building.name}`, building.tenant_id);

            res.json({
                success: true,
                building
            });
        } catch (error) {
            console.error('Update building error:', error);
            res.status(500).json({ error: 'Error al actualizar edificio' });
        }
    }

    /**
     * DELETE /api/admin/buildings/:id
     * Eliminar edificio
     */
    static async deleteBuilding(req, res) {
        try {
            const { id } = req.params;
            const pool = await connectDB();

            // Check if building has properties
            const propertyCheck = await pool.request()
                .input('building_id', sql.UniqueIdentifier, id)
                .query('SELECT COUNT(*) as count FROM Properties WHERE building_id = @building_id');

            if (propertyCheck.recordset[0].count > 0) {
                return res.status(400).json({ 
                    error: 'No se puede eliminar un edificio con inmuebles asociados. Desasocie los inmuebles primero.' 
                });
            }

            const buildingResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('SELECT name, tenant_id FROM Buildings WHERE id = @id');
            const building = buildingResult.recordset[0];

            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('DELETE FROM Buildings WHERE id = @id');

            if (building) {
                await AdminController.logAudit(req, 'DELETE', 'BUILDING', id, `Eliminó edificio: ${building.name}`, building.tenant_id);
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Delete building error:', error);
            res.status(500).json({ error: 'Error al eliminar edificio' });
        }
    }

    // ============================================================
    // PROPERTIES MANAGEMENT
    // ============================================================

    /**
     * GET /api/admin/tenants/:id/properties
     * Listar propiedades de un tenant
     */
    static async getProperties(req, res) {
        try {
            const { id } = req.params;
            const { building_id, page = 1 } = req.query;
            const rawLimit = parseInt(req.query.limit, 10);
            const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100, 10000);

            const pool = await connectDB();
            let query = `
                SELECT 
                    p.*,
                    b.name as building_name,
                    b.code as building_code,
                    (SELECT COUNT(*) FROM PropertyOwners WHERE property_id = p.id) as owner_count
                FROM Properties p
                LEFT JOIN Buildings b ON p.building_id = b.id
                WHERE p.tenant_id = @tenant_id
            `;
            
            const request = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .input('offset', sql.Int, (parseInt(page) - 1) * parseInt(limit))
                .input('limit', sql.Int, parseInt(limit));

            if (building_id) {
                query += ` AND p.building_id = @building_id`;
                request.input('building_id', sql.UniqueIdentifier, building_id);
            }

            query += ` ORDER BY b.name, p.name OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

            const result = await request.query(query);

            // Count total
            let countQuery = `SELECT COUNT(*) as total FROM Properties WHERE tenant_id = @tenant_id`;
            if (building_id) countQuery += ` AND building_id = @building_id`;
            const countResult = await request.query(countQuery);

            res.json({
                success: true,
                properties: result.recordset,
                pagination: {
                    total: countResult.recordset[0].total,
                    page: parseInt(page),
                    limit: parseInt(limit)
                }
            });
        } catch (error) {
            console.error('Get properties error:', error);
            res.status(500).json({ error: 'Error al obtener inmuebles' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/properties
     * Crear propiedad para un tenant
     */
    static async createProperty(req, res) {
        try {
            const { id } = req.params;
            const { name, type, building_id, floor, alicuota, area_sqm, nickname } = req.body;

            if (!name) {
                return res.status(400).json({ error: 'El nombre del inmueble es requerido' });
            }

            let nicknameNorm = null;
            let nicknameHash = null;
            if (nickname && typeof nickname === 'string' && nickname.trim()) {
                nicknameNorm = nickname.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
                if (nicknameNorm.length < 3) {
                    return res.status(400).json({ error: 'El nickname debe tener al menos 3 caracteres (letras, números, guión bajo)' });
                }
                nicknameHash = await bcrypt.hash(nicknameNorm, 10);
            }

            // Get tenant billing type
            const pool = await connectDB();
            const tenantResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('SELECT billing_type, building_type FROM Tenants WHERE id = @id');
            
            const tenant = tenantResult.recordset[0];

            // Validate alicuota if required
            if (tenant?.billing_type === 'ALICUOTA' && !alicuota) {
                return res.status(400).json({ error: 'La alícuota es requerida para condominios con facturación por alícuota' });
            }

            // Generate slug from name
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

            // If multi-building and no building_id, try to find default
            let finalBuildingId = building_id;
            if (tenant?.building_type === 'MULTIPLE' && !building_id) {
                return res.status(400).json({ error: 'Debe seleccionar un edificio para este inmueble' });
            }
            if (tenant?.building_type === 'SINGLE' && !building_id) {
                const buildingResult = await pool.request()
                    .input('tenant_id', sql.UniqueIdentifier, id)
                    .query('SELECT TOP 1 id FROM Buildings WHERE tenant_id = @tenant_id');
                if (buildingResult.recordset.length > 0) {
                    finalBuildingId = buildingResult.recordset[0].id;
                }
            }

            const req2 = pool.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .input('building_id', sql.UniqueIdentifier, finalBuildingId)
                .input('name', sql.NVarChar, name)
                .input('slug', sql.NVarChar, slug)
                .input('type', sql.NVarChar, type || 'APARTAMENTO')
                .input('floor', sql.NVarChar, floor || null)
                .input('alicuota', sql.Decimal(10, 4), alicuota || null)
                .input('area_sqm', sql.Decimal(10, 2), area_sqm || null)
                .input('nickname', sql.NVarChar, nicknameNorm)
                .input('nickname_password_hash', sql.NVarChar, nicknameHash);
            const result = await req2.query(`
                INSERT INTO Properties (tenant_id, building_id, name, slug, type, floor, alicuota, area_sqm, nickname, nickname_password_hash)
                OUTPUT INSERTED.*
                VALUES (@tenant_id, @building_id, @name, @slug, @type, @floor, @alicuota, @area_sqm, @nickname, @nickname_password_hash)
            `);

            const property = result.recordset[0];
            await AdminController.logAudit(req, 'CREATE', 'PROPERTY', property.id, `Creó inmueble: ${name}`, id);

            res.status(201).json({
                success: true,
                property
            });
        } catch (error) {
            console.error('Create property error:', error);
            res.status(500).json({ error: 'Error al crear inmueble' });
        }
    }

    /**
     * PUT /api/admin/properties/:id
     * Actualizar propiedad
     */
    static async updateProperty(req, res) {
        try {
            const { id } = req.params;
            const { name, building_id, floor, alicuota, area_sqm, type, nickname } = req.body;

            const pool = await connectDB();
            
            // Generate new slug if name changed
            let slug = null;
            if (name) {
                slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            }

            let nicknameNorm = undefined;
            let nicknameHash = undefined;
            if (nickname !== undefined) {
                if (nickname && typeof nickname === 'string' && nickname.trim()) {
                    nicknameNorm = nickname.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
                    if (nicknameNorm.length < 3) {
                        return res.status(400).json({ error: 'El nickname debe tener al menos 3 caracteres (letras, números, guión bajo)' });
                    }
                    nicknameHash = await bcrypt.hash(nicknameNorm, 10);
                } else {
                    nicknameNorm = null;
                    nicknameHash = null;
                }
            }

            const updates = [];
            const req2 = pool.request().input('id', sql.UniqueIdentifier, id);
            if (name) { updates.push('name = @name'); req2.input('name', sql.NVarChar, name); }
            if (slug) { updates.push('slug = @slug'); req2.input('slug', sql.NVarChar, slug); }
            if (building_id !== undefined) { updates.push('building_id = @building_id'); req2.input('building_id', sql.UniqueIdentifier, building_id || null); }
            if (floor !== undefined) { updates.push('floor = @floor'); req2.input('floor', sql.NVarChar, floor || null); }
            if (alicuota !== undefined) { updates.push('alicuota = @alicuota'); req2.input('alicuota', sql.Decimal(10, 4), alicuota === '' || alicuota === null ? null : alicuota); }
            if (area_sqm !== undefined) { updates.push('area_sqm = @area_sqm'); req2.input('area_sqm', sql.Decimal(10, 2), area_sqm === '' || area_sqm === null ? null : area_sqm); }
            if (type) { updates.push('type = @type'); req2.input('type', sql.NVarChar, type); }
            if (nicknameNorm !== undefined) { updates.push('nickname = @nickname'); req2.input('nickname', sql.NVarChar, nicknameNorm); }
            if (nicknameHash !== undefined) { updates.push('nickname_password_hash = @nickname_password_hash'); req2.input('nickname_password_hash', sql.NVarChar, nicknameHash); }
            updates.push('updated_at = SYSDATETIME()');

            const result = await req2.query(`
                UPDATE Properties
                SET ${updates.join(', ')}
                OUTPUT INSERTED.*
                WHERE id = @id
            `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Inmueble no encontrado' });
            }

            const property = result.recordset[0];
            await AdminController.logAudit(req, 'UPDATE', 'PROPERTY', id, `Actualizó inmueble: ${property.name}`, property.tenant_id);

            res.json({
                success: true,
                property
            });
        } catch (error) {
            console.error('Update property error:', error);
            res.status(500).json({ error: 'Error al actualizar inmueble' });
        }
    }

    /**
     * DELETE /api/admin/properties/:id
     * Eliminar propiedad
     */
    static async deleteProperty(req, res) {
        try {
            const { id } = req.params;
            const pool = await connectDB();

            // Check if property has owners
            const ownerCheck = await pool.request()
                .input('property_id', sql.UniqueIdentifier, id)
                .query('SELECT COUNT(*) as count FROM PropertyOwners WHERE property_id = @property_id');

            if (ownerCheck.recordset[0].count > 0) {
                return res.status(400).json({ error: 'No se puede eliminar un inmueble con propietarios asignados' });
            }

            const propResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('SELECT name, tenant_id FROM Properties WHERE id = @id');
            const property = propResult.recordset[0];

            await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('DELETE FROM Properties WHERE id = @id');

            if (property) {
                await AdminController.logAudit(req, 'DELETE', 'PROPERTY', id, `Eliminó inmueble: ${property.name}`, property.tenant_id);
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Delete property error:', error);
            res.status(500).json({ error: 'Error al eliminar inmueble' });
        }
    }

    // ============================================================
    // OWNERS MANAGEMENT
    // ============================================================

    /**
     * Renderizar vista de gestión de propietarios
     */
    static async renderTenantOwners(req, res) {
        try {
            const { id } = req.params;
            const tenant = await TenantModel.findById(id);

            if (!tenant) {
                return res.status(404).render('error', { 
                    title: 'No encontrado',
                    message: 'Condominio no encontrado'
                });
            }

            res.render('admin/tenant-owners', {
                title: `Gestión de Propietarios - ${tenant.name}`,
                layout: false,
                tenant
            });
        } catch (error) {
            console.error('Render tenant owners error:', error);
            res.status(500).render('error', { 
                title: 'Error',
                message: 'Error al cargar la gestión de propietarios'
            });
        }
    }

    /**
     * GET /api/admin/tenants/:id/owners
     * Listar propietarios de un tenant
     */
    static async getOwners(req, res) {
        try {
            const { id } = req.params;
            console.log(`[DEBUG] getOwners: tenantId=${id}`);
            const pool = await connectDB();

            // Propietarios: TenantUsers (OWNER) + solo PropertyOwners de propiedades de ESTE tenant
            // PropsInTenant evita filas fantasma (propietario con inmueble en otro condominio)
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .query(`
                    WITH PropsInTenant AS (
                        SELECT po.user_id, po.property_id, p.name as property_name, p.building_id
                        FROM PropertyOwners po
                        INNER JOIN Properties p ON po.property_id = p.id AND p.tenant_id = @tenant_id
                    )
                    SELECT
                        u.id,
                        u.first_name + ' ' + u.last_name as display_name,
                        u.email,
                        u.phone,
                        u.dni as document_number,
                        'DNI' as document_type,
                        pit.property_id,
                        pit.property_name,
                        b.name as building_name
                    FROM Users u
                    INNER JOIN TenantUsers tu ON u.id = tu.user_id AND tu.tenant_id = @tenant_id AND tu.role = 'OWNER' AND tu.status = 'ACTIVE'
                    LEFT JOIN PropsInTenant pit ON u.id = pit.user_id
                    LEFT JOIN Buildings b ON pit.building_id = b.id
                    ORDER BY display_name, pit.property_name
                `);

            console.log(`[DEBUG] getOwners: found ${result.recordset.length} owners`);
            res.json({
                success: true,
                owners: result.recordset
            });
        } catch (error) {
            console.error('Get owners error:', error);
            res.status(500).json({ error: 'Error al obtener propietarios' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/owners
     * Crear propietario y asignar a propiedad
     */
    static async createOwner(req, res) {
        const pool = await connectDB();
        const transaction = pool.transaction();
        let transactionStarted = false;

        try {
            const { id } = req.params;
            const { display_name, email, phone, document_type, document_number, address, property_id, property_ids } = req.body;
            const propertyIds = Array.isArray(property_ids) ? property_ids.filter(Boolean) : (property_id ? [property_id] : []);

            if (!display_name || !email) {
                return res.status(400).json({ error: 'Nombre y email son requeridos' });
            }

            await transaction.begin();
            transactionStarted = true;

            // Priority: DNI is the unique identifier, then email
            let user = null;
            let isNewUser = false;
            let foundByDni = false;
            let foundByEmail = false;

            // 1. First, try to find by DNI (document number) - this is the primary identifier
            if (document_number) {
                const userByDniResult = await transaction.request()
                    .input('dni', sql.NVarChar, document_number)
                    .query('SELECT * FROM Users WHERE dni = @dni');
                
                if (userByDniResult.recordset.length > 0) {
                    user = userByDniResult.recordset[0];
                    foundByDni = true;
                }
            }

            // 2. If not found by DNI, try by email (Users.email o UserEmails)
            if (!user && email) {
                const userByEmailResult = await transaction.request()
                    .input('email', sql.NVarChar, email)
                    .query(`
                        SELECT u.* FROM Users u
                        WHERE u.email = @email
                        OR EXISTS (SELECT 1 FROM UserEmails ue WHERE ue.user_id = u.id AND ue.email = @email)
                    `);
                
                if (userByEmailResult.recordset.length > 0) {
                    user = userByEmailResult.recordset[0];
                    foundByEmail = true;
                }
            }

            if (user) {
                // Usuario existe: si DNI/email coincide pero los datos (nombre, email, teléfono) son DIFERENTES, error
                const nameParts = display_name ? display_name.trim().split(/\s+/).filter(Boolean) : [];
                const incomingFirst = (nameParts[0] || '').trim();
                const incomingLast = (nameParts.slice(1).join(' ') || '').trim();
                const incomingEmail = (email || '').trim().toLowerCase();
                const incomingPhone = (phone || '').trim();
                const incomingDni = (document_number || '').trim();

                const dbFirst = (user.first_name || '').trim();
                const dbLast = (user.last_name || '').trim();
                const dbPhone = (user.phone || '').trim();
                const dbDni = (user.dni || '').trim();
                const dbEmail = (user.email || '').trim().toLowerCase();
                const dbEmailsResult = await transaction.request()
                    .input('user_id', sql.UniqueIdentifier, user.id)
                    .query('SELECT email FROM UserEmails WHERE user_id = @user_id');
                const dbEmails = (dbEmailsResult.recordset || []).map(r => (r.email || '').trim().toLowerCase()).filter(Boolean);
                const dbPrimaryEmail = dbEmail || (dbEmails[0] || '');
                const fullDbName = `${dbFirst} ${dbLast}`.trim();

                const nameMatch = !display_name?.trim() ||
                    (incomingFirst === dbFirst && incomingLast === dbLast) ||
                    (display_name.trim() === fullDbName) ||
                    (AdminController._normOwnerName(display_name) === AdminController._normOwnerName(fullDbName));
                const emailMatch = !incomingEmail ||
                    incomingEmail === dbPrimaryEmail ||
                    dbEmails.includes(incomingEmail);
                let phoneMatch = !incomingPhone || incomingPhone === dbPhone;
                const dniMatch = !incomingDni || incomingDni === dbDni;
                const emailMatchesExistingAccount = incomingEmail && (
                    incomingEmail === dbPrimaryEmail ||
                    dbEmails.includes(incomingEmail)
                );
                if (!phoneMatch && dniMatch && emailMatchesExistingAccount && nameMatch) {
                    phoneMatch = true;
                }

                if (!nameMatch || !emailMatch || !phoneMatch || !dniMatch) {
                    if (emailMatchesExistingAccount && incomingDni && dbDni && incomingDni !== dbDni) {
                        throw new Error(
                            `El correo ${incomingEmail} ya está asignado a ${dbFirst} ${dbLast} (documento ${dbDni || 'N/A'}). ` +
                            `Los datos de esta carga corresponden a otra persona (${display_name?.trim() || '—'}, documento ${incomingDni}). ` +
                            `En el sistema cada propietario tiene un correo único: no puede haber dos personas distintas con el mismo correo. ` +
                            `Si son copropietarios del mismo inmueble, use un correo distinto para cada uno.`
                        );
                    }
                    throw new Error(`El documento ${document_number || 'N/A'} ya pertenece a otro propietario (${dbFirst} ${dbLast}, ${dbPrimaryEmail || 'sin email'}). Los datos cargados no coinciden. No se puede sobrescribir.`);
                }

                // User exists - verificar conflicto de email: ningún otro propietario puede tener este correo
                if (email) {
                    const emailTaken = await UserModel.emailExistsForOtherUser(email, user.id);
                    if (emailTaken) {
                        throw new Error('Este correo ya pertenece a otro propietario. Cada correo solo puede estar asignado a una persona.');
                    }
                    // Si el usuario aún no tiene este correo (ni primario ni secundario), agregarlo como secundario
                    const hasEmail = await UserModel.userHasEmail(user.id, email);
                    if (!hasEmail) {
                        try {
                            await UserModel.addSecondaryEmail(user.id, email);
                        } catch (e) {
                            if (e.message?.includes('ya está registrado')) throw e;
                            throw new Error('No se pudo agregar el correo secundario: ' + (e.message || ''));
                        }
                    }
                }

                // Actualizar datos básicos (solo si coinciden; ya validamos arriba)
                const newFirstName = incomingFirst || user.first_name;
                const newLastName = incomingLast || user.last_name;
                const newPhone = phone || user.phone;
                const newDni = document_number || user.dni;

                await transaction.request()
                    .input('user_id', sql.UniqueIdentifier, user.id)
                    .input('first_name', sql.NVarChar, newFirstName)
                    .input('last_name', sql.NVarChar, newLastName)
                    .input('phone', sql.NVarChar, newPhone)
                    .input('dni', sql.NVarChar, newDni)
                    .query(`
                        UPDATE Users 
                        SET first_name = @first_name, last_name = @last_name, 
                            phone = @phone, dni = @dni, updated_at = SYSDATETIME()
                        WHERE id = @user_id
                    `);
                
                // Refresh user data
                const updatedUserResult = await transaction.request()
                    .input('user_id', sql.UniqueIdentifier, user.id)
                    .query('SELECT * FROM Users WHERE id = @user_id');
                user = updatedUserResult.recordset[0];

            } else {
                // Create new user (invitación: INVITED + token, envío de correo post-commit)
                if (email) {
                    const emailTaken = await UserModel.emailExistsForOtherUser(email, null);
                    if (emailTaken) {
                        throw new Error('Este correo ya pertenece a otro propietario. Cada correo solo puede estar asignado a una persona.');
                    }
                }
                isNewUser = true;
                const userDni = document_number || `OWN-${Date.now()}`;
                const invitationToken = require('crypto').randomBytes(32).toString('hex');
                const dummyPassword = await require('bcrypt').hash(require('crypto').randomBytes(32).toString('hex'), 10);

                const nameParts = display_name.split(' ');
                const firstName = nameParts[0] || display_name;
                const lastName = nameParts.slice(1).join(' ') || '';

                const userResult = await transaction.request()
                    .input('first_name', sql.NVarChar, firstName)
                    .input('last_name', sql.NVarChar, lastName)
                    .input('email', sql.NVarChar, email || null)
                    .input('dni', sql.NVarChar, userDni)
                    .input('phone', sql.NVarChar, phone || null)
                    .input('password_hash', sql.NVarChar, dummyPassword)
                    .input('invitation_token', sql.NVarChar, invitationToken)
                    .query(`
                        INSERT INTO Users (first_name, last_name, email, dni, phone, password_hash, invitation_token, invited_at, is_active, registration_status)
                        OUTPUT INSERTED.*
                        VALUES (@first_name, @last_name, @email, @dni, @phone, @password_hash, @invitation_token, SYSDATETIME(), 1, 'INVITED')
                    `);

                user = userResult.recordset[0];
                user.invitation_token = invitationToken;

                if (email) {
                    await transaction.request()
                        .input('user_id', sql.UniqueIdentifier, user.id)
                        .input('email', sql.NVarChar, email)
                        .query(`
                            INSERT INTO UserEmails (user_id, email, is_primary)
                            VALUES (@user_id, @email, 1)
                        `).catch(() => {});
                }
            }

            // Siempre asociar al condominio (TenantUsers) para evitar propietarios huérfanos
            await transaction.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .input('user_id', sql.UniqueIdentifier, user.id)
                .query(`
                    INSERT INTO TenantUsers (user_id, tenant_id, role, status)
                    SELECT @user_id, @tenant_id, 'OWNER', 'ACTIVE'
                    WHERE NOT EXISTS (SELECT 1 FROM TenantUsers WHERE user_id = @user_id AND tenant_id = @tenant_id)
                `);

            // Asignar a inmuebles si se proporcionaron
            for (const pid of propertyIds) {
                const propertyCheck = await transaction.request()
                    .input('property_id', sql.UniqueIdentifier, pid)
                    .input('tenant_id', sql.UniqueIdentifier, id)
                    .query('SELECT id FROM Properties WHERE id = @property_id AND tenant_id = @tenant_id');

                if (propertyCheck.recordset.length === 0) {
                    throw new Error('La propiedad no existe o no pertenece a este condominio');
                }

                const existingAssignment = await transaction.request()
                    .input('property_id', sql.UniqueIdentifier, pid)
                    .input('user_id', sql.UniqueIdentifier, user.id)
                    .query('SELECT * FROM PropertyOwners WHERE property_id = @property_id AND user_id = @user_id');

                if (existingAssignment.recordset.length === 0) {
                    await transaction.request()
                        .input('property_id', sql.UniqueIdentifier, pid)
                        .input('user_id', sql.UniqueIdentifier, user.id)
                        .input('percentage_ownership', sql.Decimal(5, 2), 100)
                        .query(`
                            INSERT INTO PropertyOwners (property_id, user_id, percentage_ownership, is_primary_owner)
                            VALUES (@property_id, @user_id, @percentage_ownership, 1)
                        `);
                }
            }

            await transaction.commit();

            const displayLabel = `${user.first_name} ${user.last_name} (${user.email})`;
            await AdminController.logAudit(req, 'CREATE', 'OWNER', user.id,
                isNewUser ? `Creó propietario: ${displayLabel}` : `Asignó propietario existente: ${displayLabel}`,
                id);

            // Enviar correos (después del commit)
            const ownerEmail = user.email || (email ? email : null);
            if (ownerEmail) {
                const tenant = await TenantModel.findById(id);
                const tenantName = tenant?.name || 'Condominio';
                let propertyLabel = null;
                if (propertyIds.length > 0) {
                    const prop = await PropertyModel.findById(propertyIds[0]);
                    if (prop) {
                        propertyLabel = prop.building_name ? `${prop.building_name}, ${prop.name}` : prop.name;
                    }
                }
                const baseUrl = process.env.APP_URL || (req.protocol + '://' + (req.get('host') || 'localhost:3000'));

                try {
                    if (isNewUser && user.invitation_token) {
                        const invitationLink = `${baseUrl}/auth/complete-registration?token=${user.invitation_token}`;
                        await EmailService.sendOwnerInvitation(ownerEmail, user.first_name, tenantName, invitationLink, propertyLabel);
                    } else if (!isNewUser) {
                        const loginUrl = `${baseUrl}/login`;
                        await EmailService.sendOwnerAddedToCondominio(ownerEmail, user.first_name, tenantName, propertyLabel, loginUrl);
                    }
                } catch (mailErr) {
                    console.error('Error enviando email a propietario:', mailErr);
                }
            }

            // Build appropriate message - clarificar cuando se reutiliza
            let message;
            if (isNewUser) {
                message = 'Propietario creado exitosamente';
            } else if (foundByDni) {
                message = 'Propietario ya existe en otro conjunto. Se reutilizará y tendrá acceso a todos sus inmuebles en los condominios donde participe. Asignado correctamente.';
            } else if (foundByEmail) {
                message = 'Propietario ya existe en otro conjunto. Se reutilizará y tendrá acceso a todos sus inmuebles en los condominios donde participe. Asignado correctamente.';
            } else {
                message = 'Propietario existente asignado a la propiedad';
            }

            res.status(201).json({
                success: true,
                isNewUser: isNewUser,
                foundByDni: foundByDni,
                foundByEmail: foundByEmail,
                message: message,
                owner: {
                    ...user,
                    property_id: propertyIds[0] || null
                }
            });
        } catch (error) {
            if (transactionStarted) {
                try { await transaction.rollback(); } catch (e) {}
            }
            console.error('Create owner error:', error);
            res.status(500).json({ error: error.message || 'Error al crear propietario' });
        }
    }

    /** Normaliza nombre para comparar (mismo titular en varias filas del CSV). */
    static _normOwnerName(s) {
        return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /**
     * Pre-carga masiva: mismo documento en varias filas con distintos inmuebles → requiere confirmación.
     * Mismo documento con distinto correo o nombre entre filas → error (no se confirma).
     */
    static validateBulkOwnersPreflight(owners) {
        const errors = [];
        const warnings = [];
        const byDni = new Map();
        for (let i = 0; i < owners.length; i++) {
            const row = owners[i];
            const dni = (row.numero_documento || row.document_number || '').trim();
            if (!dni) continue;
            const name = AdminController._normOwnerName(row.nombre || row.display_name || '');
            const email = (row.email || '').trim().toLowerCase();
            const slug = (row.inmueble_slug || '').trim();
            if (!byDni.has(dni)) byDni.set(dni, []);
            byDni.get(dni).push({ rowIndex: i + 1, name, email, slug });
        }
        for (const [dni, rows] of byDni) {
            if (rows.length < 2) continue;
            const emails = new Set(rows.map((r) => r.email).filter(Boolean));
            const names = new Set(rows.map((r) => r.name).filter(Boolean));
            const slugs = [...new Set(rows.map((r) => r.slug).filter(Boolean))];
            if (emails.size > 1) {
                errors.push(
                    `Documento ${dni}: el correo no coincide entre filas (${rows.map((r) => r.rowIndex).join(', ')}). Cada persona debe tener un único correo.`
                );
                continue;
            }
            if (names.size > 1) {
                errors.push(
                    `Documento ${dni}: el nombre no coincide entre filas (${rows.map((r) => r.rowIndex).join(', ')}). Unifique el texto o revise el archivo.`
                );
                continue;
            }
            if (slugs.length > 1) {
                warnings.push({
                    type: 'SAME_OWNER_MULTIPLE_PROPERTIES',
                    documentNumber: dni,
                    rowNumbers: rows.map((r) => r.rowIndex),
                    propertySlugs: slugs
                });
            }
        }
        return { errors, warnings };
    }

    /**
     * POST /api/admin/tenants/:id/owners/bulk
     * Carga masiva de propietarios. Una sola transacción: todo OK o rollback (nada se guarda).
     * Los correos de bienvenida NO se envían aquí: quedan en cola hasta que el Super Admin
     * confirme con POST .../owners/bulk/send-welcome-emails.
     */
    static async createOwnersBulk(req, res) {
        const pool = await connectDB();
        const transaction = pool.transaction();
        let transactionStarted = false;

        try {
            const { id } = req.params;
            const { owners, confirmMultiPropertyWarnings } = req.body;

            if (!Array.isArray(owners) || owners.length === 0) {
                return res.status(400).json({ error: 'Se requiere un array de propietarios' });
            }

            const preflight = AdminController.validateBulkOwnersPreflight(owners);
            if (preflight.errors.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: preflight.errors.join(' '),
                    errorDetails: preflight.errors
                });
            }
            if (preflight.warnings.length > 0 && !confirmMultiPropertyWarnings) {
                return res.status(409).json({
                    success: false,
                    requiresConfirmation: true,
                    warnings: preflight.warnings,
                    message:
                        'Hay titulares que aparecen en varias filas con distintos inmuebles. Confirme para continuar con la carga.'
                });
            }

            await transaction.begin();
            transactionStarted = true;

            const tenantResult = await transaction.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .query('SELECT building_type FROM Tenants WHERE id = @tenant_id');
            const buildingType = tenantResult.recordset[0]?.building_type || 'SINGLE';

            const propsResult = await transaction.request()
                .input('tenant_id', sql.UniqueIdentifier, id)
                .query(`
                    SELECT p.id, p.name, p.slug, b.name as building_name
                    FROM Properties p
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    WHERE p.tenant_id = @tenant_id
                `);
            const tenantProperties = propsResult.recordset || [];

            const toSlug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

            const results = { success: [], errors: [] };
            const pendingEmails = [];

            for (let i = 0; i < owners.length; i++) {
                const row = owners[i];
                const rowLabel = row.numero_documento || row.document_number || row.nombre || row.display_name || `Fila ${i + 1}`;

                try {
                    const display_name = row.nombre || row.display_name;
                    const email = row.email;
                    const phone = row.telefono || row.phone || '';
                    const document_number = (row.numero_documento || row.document_number || '').trim();
                    let property_id = row.property_id || null;
                    const inmueble_slug = (row.inmueble_slug || '').trim();

                    if (!display_name || !email) {
                        throw new Error('Nombre y email son requeridos');
                    }

                    if (inmueble_slug) {
                        const matched = tenantProperties.find(p => {
                            const pSlug = p.slug || toSlug(p.name);
                            const buildingSlug = p.building_name ? toSlug(p.building_name) : null;
                            const fullSlug = buildingType === 'MULTIPLE' && buildingSlug
                                ? `${buildingSlug}-${pSlug}` : pSlug;
                            return fullSlug === inmueble_slug || pSlug === inmueble_slug;
                        });
                        if (!matched) {
                            throw new Error(`El slug del inmueble "${inmueble_slug}" no existe en este condominio. Verifique que coincida con la plantilla.`);
                        }
                        property_id = matched.id;
                    }

                    let user = null;
                    let isNewUser = false;

                    if (document_number) {
                        const userByDniResult = await transaction.request()
                            .input('dni', sql.NVarChar, document_number)
                            .query('SELECT * FROM Users WHERE dni = @dni');
                        if (userByDniResult.recordset.length > 0) {
                            user = userByDniResult.recordset[0];
                        }
                    }

                    if (!user && email) {
                        const userByEmailResult = await transaction.request()
                            .input('email', sql.NVarChar, email)
                            .query(`
                                SELECT u.* FROM Users u
                                WHERE u.email = @email
                                OR EXISTS (SELECT 1 FROM UserEmails ue WHERE ue.user_id = u.id AND ue.email = @email)
                            `);
                        if (userByEmailResult.recordset.length > 0) {
                            user = userByEmailResult.recordset[0];
                        }
                    }

                    if (user) {
                        const nameParts = display_name ? display_name.trim().split(/\s+/).filter(Boolean) : [];
                        const incomingFirst = (nameParts[0] || '').trim();
                        const incomingLast = (nameParts.slice(1).join(' ') || '').trim();
                        const incomingEmail = (email || '').trim().toLowerCase();
                        const incomingPhone = (phone || '').trim();
                        const incomingDni = (document_number || '').trim();

                        const dbFirst = (user.first_name || '').trim();
                        const dbLast = (user.last_name || '').trim();
                        const dbPhone = (user.phone || '').trim();
                        const dbDni = (user.dni || '').trim();
                        const dbEmail = (user.email || '').trim().toLowerCase();
                        const dbEmailsResult = await transaction.request()
                            .input('user_id', sql.UniqueIdentifier, user.id)
                            .query('SELECT email FROM UserEmails WHERE user_id = @user_id');
                        const dbEmails = (dbEmailsResult.recordset || []).map(r => (r.email || '').trim().toLowerCase()).filter(Boolean);
                        const dbPrimaryEmail = dbEmail || (dbEmails[0] || '');
                        const fullDbName = `${dbFirst} ${dbLast}`.trim();

                        const nameMatch = !display_name?.trim() ||
                            (incomingFirst === dbFirst && incomingLast === dbLast) ||
                            (display_name.trim() === fullDbName) ||
                            (AdminController._normOwnerName(display_name) === AdminController._normOwnerName(fullDbName));
                        const emailMatch = !incomingEmail ||
                            incomingEmail === dbPrimaryEmail ||
                            dbEmails.includes(incomingEmail);
                        let phoneMatch = !incomingPhone || incomingPhone === dbPhone;
                        const dniMatch = !incomingDni || incomingDni === dbDni;
                        const emailMatchesExistingAccount = incomingEmail && (
                            incomingEmail === dbPrimaryEmail ||
                            dbEmails.includes(incomingEmail)
                        );
                        // Mismo titular en otra fila (otro inmueble): no exigir mismo teléfono si documento+correo+nombre coinciden
                        if (!phoneMatch && dniMatch && emailMatchesExistingAccount && nameMatch) {
                            phoneMatch = true;
                        }

                        if (!nameMatch || !emailMatch || !phoneMatch || !dniMatch) {
                            if (emailMatchesExistingAccount && incomingDni && dbDni && incomingDni !== dbDni) {
                                throw new Error(
                                    `El correo ${incomingEmail} ya está asignado a ${dbFirst} ${dbLast} (documento ${dbDni || 'N/A'}). ` +
                                    `Los datos de esta fila corresponden a otra persona (${display_name?.trim() || '—'}, documento ${incomingDni}). ` +
                                    `En el sistema cada propietario tiene un correo único: no puede haber dos personas distintas con el mismo correo. ` +
                                    `Si son copropietarios del mismo inmueble, use un correo distinto para cada uno.`
                                );
                            }
                            throw new Error(`El documento ${document_number || 'N/A'} ya pertenece a otro propietario (${dbFirst} ${dbLast}, ${dbPrimaryEmail || 'sin email'}). Los datos cargados no coinciden. No se puede sobrescribir.`);
                        }

                        if (email) {
                            const emailTakenResult = await transaction.request()
                                .input('email', sql.NVarChar, email)
                                .input('excludeId', sql.UniqueIdentifier, user.id)
                                .query(`
                                    SELECT 1 as found WHERE EXISTS (
                                        SELECT 1 FROM Users WHERE email = @email AND id != @excludeId AND is_active = 1
                                    ) OR EXISTS (
                                        SELECT 1 FROM UserEmails WHERE email = @email AND user_id != @excludeId
                                    )
                                `);
                            if (emailTakenResult.recordset.length > 0) {
                                throw new Error('Este correo ya pertenece a otro propietario.');
                            }
                            const hasEmailResult = await transaction.request()
                                .input('user_id', sql.UniqueIdentifier, user.id)
                                .input('email', sql.NVarChar, email)
                                .query(`
                                    SELECT 1 as found WHERE EXISTS (
                                        SELECT 1 FROM Users WHERE id = @user_id AND email = @email
                                    ) OR EXISTS (
                                        SELECT 1 FROM UserEmails WHERE user_id = @user_id AND email = @email
                                    )
                                `);
                            if (hasEmailResult.recordset.length === 0) {
                                await transaction.request()
                                    .input('user_id', sql.UniqueIdentifier, user.id)
                                    .input('email', sql.NVarChar, email)
                                    .query(`
                                        INSERT INTO UserEmails (user_id, email, is_primary)
                                        SELECT @user_id, @email, 0
                                        WHERE NOT EXISTS (SELECT 1 FROM UserEmails WHERE email = @email)
                                    `);
                            }
                        }

                        await transaction.request()
                            .input('user_id', sql.UniqueIdentifier, user.id)
                            .input('first_name', sql.NVarChar, incomingFirst || user.first_name)
                            .input('last_name', sql.NVarChar, incomingLast || user.last_name)
                            .input('phone', sql.NVarChar, phone || user.phone)
                            .input('dni', sql.NVarChar, document_number || user.dni)
                            .query(`
                                UPDATE Users SET first_name = @first_name, last_name = @last_name, phone = @phone, dni = @dni, updated_at = SYSDATETIME()
                                WHERE id = @user_id
                            `);

                        const refreshed = await transaction.request()
                            .input('user_id', sql.UniqueIdentifier, user.id)
                            .query('SELECT * FROM Users WHERE id = @user_id');
                        user = refreshed.recordset[0];
                    } else {
                        if (email) {
                            const emailTakenResult = await transaction.request()
                                .input('email', sql.NVarChar, email)
                                .query(`
                                    SELECT 1 as found WHERE EXISTS (SELECT 1 FROM Users WHERE email = @email AND is_active = 1)
                                    OR EXISTS (SELECT 1 FROM UserEmails WHERE email = @email)
                                `);
                            if (emailTakenResult.recordset.length > 0) {
                                throw new Error('Este correo ya pertenece a otro propietario.');
                            }
                        }
                        isNewUser = true;
                        const userDni = document_number || `OWN-${Date.now()}-${i}`;
                        const invitationToken = require('crypto').randomBytes(32).toString('hex');
                        const dummyPassword = await require('bcrypt').hash(require('crypto').randomBytes(32).toString('hex'), 10);
                        const nameParts = display_name.split(' ');
                        const firstName = nameParts[0] || display_name;
                        const lastName = nameParts.slice(1).join(' ') || '';

                        const userResult = await transaction.request()
                            .input('first_name', sql.NVarChar, firstName)
                            .input('last_name', sql.NVarChar, lastName)
                            .input('email', sql.NVarChar, email || null)
                            .input('dni', sql.NVarChar, userDni)
                            .input('phone', sql.NVarChar, phone || null)
                            .input('password_hash', sql.NVarChar, dummyPassword)
                            .input('invitation_token', sql.NVarChar, invitationToken)
                            .query(`
                                INSERT INTO Users (first_name, last_name, email, dni, phone, password_hash, invitation_token, invited_at, is_active, registration_status)
                                OUTPUT INSERTED.*
                                VALUES (@first_name, @last_name, @email, @dni, @phone, @password_hash, @invitation_token, SYSDATETIME(), 1, 'INVITED')
                            `);
                        user = userResult.recordset[0];
                        user.invitation_token = invitationToken;

                        if (email) {
                            await transaction.request()
                                .input('user_id', sql.UniqueIdentifier, user.id)
                                .input('email', sql.NVarChar, email)
                                .query(`
                                    INSERT INTO UserEmails (user_id, email, is_primary)
                                    VALUES (@user_id, @email, 1)
                                `).catch(() => {});
                        }
                    }

                    await transaction.request()
                        .input('tenant_id', sql.UniqueIdentifier, id)
                        .input('user_id', sql.UniqueIdentifier, user.id)
                        .query(`
                            INSERT INTO TenantUsers (user_id, tenant_id, role, status)
                            SELECT @user_id, @tenant_id, 'OWNER', 'ACTIVE'
                            WHERE NOT EXISTS (SELECT 1 FROM TenantUsers WHERE user_id = @user_id AND tenant_id = @tenant_id)
                        `);

                    if (property_id) {
                        const propertyCheck = await transaction.request()
                            .input('property_id', sql.UniqueIdentifier, property_id)
                            .input('tenant_id', sql.UniqueIdentifier, id)
                            .query('SELECT id FROM Properties WHERE id = @property_id AND tenant_id = @tenant_id');
                        if (propertyCheck.recordset.length === 0) {
                            throw new Error('La propiedad no existe o no pertenece a este condominio');
                        }
                        const existingAssignment = await transaction.request()
                            .input('property_id', sql.UniqueIdentifier, property_id)
                            .input('user_id', sql.UniqueIdentifier, user.id)
                            .query('SELECT * FROM PropertyOwners WHERE property_id = @property_id AND user_id = @user_id');
                        if (existingAssignment.recordset.length === 0) {
                            await transaction.request()
                                .input('property_id', sql.UniqueIdentifier, property_id)
                                .input('user_id', sql.UniqueIdentifier, user.id)
                                .input('percentage_ownership', sql.Decimal(5, 2), 100)
                                .query(`
                                    INSERT INTO PropertyOwners (property_id, user_id, percentage_ownership, is_primary_owner)
                                    VALUES (@property_id, @user_id, @percentage_ownership, 1)
                                `);
                        }
                    }

                    results.success.push({ row: i + 1, label: rowLabel });
                    const ownerEmail = user.email || email;
                    if (ownerEmail) {
                        pendingEmails.push({
                            userId: user.id,
                            email: ownerEmail,
                            firstName: user.first_name,
                            isNewUser,
                            invitationToken: user.invitation_token,
                            property_id
                        });
                    }
                } catch (rowError) {
                    results.errors.push({ row: i + 1, label: rowLabel, error: rowError.message });
                    await transaction.rollback();
                    transactionStarted = false;
                    return res.status(400).json({
                        success: false,
                        error: 'Error en la carga masiva. No se creó ningún propietario.',
                        successCount: 0,
                        errorCount: results.errors.length,
                        total: owners.length,
                        errorDetails: results.errors.map(e => `${e.label}: ${e.error}`)
                    });
                }
            }

            await transaction.commit();
            transactionStarted = false;

            let batchId = null;
            let welcomeEmailsPending = 0;
            if (pendingEmails.length > 0) {
                batchId = uuidv4();
                const items = pendingEmails.map((p) => ({
                    userId: String(p.userId),
                    propertyId: p.property_id != null ? String(p.property_id) : null,
                    isNewUser: Boolean(p.isNewUser)
                }));
                await BulkOwnerWelcomeBatchModel.create({
                    id: batchId,
                    tenant_id: id,
                    created_by: req.user.userId,
                    items_json: JSON.stringify(items),
                    total_items: items.length
                });
                welcomeEmailsPending = items.length;
            }

            for (const s of results.success) {
                await AdminController.logAudit(req, 'CREATE', 'OWNER', null, `Carga masiva: ${s.label}`, id);
            }

            res.status(201).json({
                success: true,
                message: welcomeEmailsPending > 0
                    ? 'Carga masiva completada. Puedes enviar las invitaciones por correo cuando verifiques los datos.'
                    : 'Carga masiva completada.',
                successCount: results.success.length,
                errorCount: 0,
                total: owners.length,
                batchId,
                welcomeEmailsPending
            });
        } catch (error) {
            if (transactionStarted) {
                try { await transaction.rollback(); } catch (e) {}
            }
            console.error('Create owners bulk error:', error);
            res.status(500).json({ error: error.message || 'Error en la carga masiva' });
        }
    }

    /**
     * POST /api/admin/tenants/:id/owners/bulk/send-welcome-emails
     * Encola el envío de correos de bienvenida de un lote creado tras carga masiva (lotes en PENDING_SEND).
     */
    static async sendBulkWelcomeEmails(req, res) {
        try {
            const { id } = req.params;
            const { batchId } = req.body || {};

            if (!batchId || typeof batchId !== 'string') {
                return res.status(400).json({ success: false, error: 'batchId es requerido' });
            }

            const batch = await BulkOwnerWelcomeBatchModel.findById(batchId);
            const norm = (g) => String(g || '').replace(/[{}]/g, '').toLowerCase();
            if (!batch || norm(batch.tenant_id) !== norm(id)) {
                return res.status(404).json({ success: false, error: 'Lote no encontrado' });
            }

            if (batch.status !== 'PENDING_SEND') {
                return res.status(400).json({
                    success: false,
                    error: 'Este lote ya fue procesado o está en envío. No se puede repetir.'
                });
            }

            OwnerBulkWelcomeEmailService.queueProcess(batchId);

            await AdminController.logAudit(
                req,
                'UPDATE',
                'BULK_OWNER_WELCOME',
                batchId,
                `Encoló envío de correos de bienvenida (${batch.total_items} notificaciones)`,
                id
            );

            res.json({
                success: true,
                message: 'Envío de correos en cola. Se enviarán en lotes con pausa entre lotes.'
            });
        } catch (error) {
            console.error('sendBulkWelcomeEmails error:', error);
            res.status(500).json({ success: false, error: error.message || 'Error al encolar correos' });
        }
    }

    /**
     * PUT /api/admin/owners/:id
     * Actualizar propietario
     */
    static async updateOwner(req, res) {
        try {
            const { id } = req.params;
            const { display_name, email, phone, document_type, document_number, address, property_id, property_ids, tenant_id } = req.body;
            const propertyIds = Array.isArray(property_ids) ? property_ids.filter(Boolean) : (property_id !== undefined ? (property_id ? [property_id] : []) : undefined);

            const pool = await connectDB();

            const nameParts = display_name ? display_name.split(' ') : ['', ''];
            const firstName = nameParts[0];
            const lastName = nameParts.slice(1).join(' ');

            // Si se cambia el email, validar que no pertenezca a otro propietario
            if (email) {
                const emailTaken = await UserModel.emailExistsForOtherUser(email, id);
                if (emailTaken) {
                    return res.status(400).json({
                        error: 'Este correo ya pertenece a otro propietario. Cada correo solo puede estar asignado a una persona.'
                    });
                }
            }

            // Update user
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('first_name', sql.NVarChar, firstName || null)
                .input('last_name', sql.NVarChar, lastName || null)
                .input('email', sql.NVarChar, email || null)
                .input('phone', sql.NVarChar, phone || null)
                .input('dni', sql.NVarChar, document_number || null)
                .query(`
                    UPDATE Users
                    SET 
                        first_name = COALESCE(@first_name, first_name),
                        last_name = COALESCE(@last_name, last_name),
                        email = COALESCE(@email, email),
                        phone = COALESCE(@phone, phone),
                        dni = COALESCE(@dni, dni)
                    OUTPUT INSERTED.*
                    WHERE id = @id
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ error: 'Propietario no encontrado' });
            }

            const updated = result.recordset[0];
            await AdminController.logAudit(req, 'UPDATE', 'OWNER', id, 
                `Actualizó propietario: ${updated.first_name} ${updated.last_name} (${updated.email})`, 
                tenant_id || null);

            // Update property assignment if provided (solo afecta a ESTE tenant)
            if (propertyIds !== undefined) {
                let scopeTenantId = tenant_id;
                if (!scopeTenantId && propertyIds.length > 0) {
                    const propCheck = await pool.request().input('pid', sql.UniqueIdentifier, propertyIds[0])
                        .query('SELECT tenant_id FROM Properties WHERE id = @pid');
                    scopeTenantId = propCheck.recordset[0]?.tenant_id;
                }
                if (!scopeTenantId) {
                    return res.status(400).json({ error: 'Se requiere tenant_id para cambiar asignación de propiedad (evitar borrar en otros condominios)' });
                }
                await pool.request()
                    .input('user_id', sql.UniqueIdentifier, id)
                    .input('tenant_id', sql.UniqueIdentifier, scopeTenantId)
                    .query(`
                        DELETE FROM PropertyOwners
                        WHERE user_id = @user_id
                        AND property_id IN (SELECT id FROM Properties WHERE tenant_id = @tenant_id)
                    `);

                for (const pid of propertyIds) {
                    const propCheck = await pool.request()
                        .input('property_id', sql.UniqueIdentifier, pid)
                        .input('tenant_id', sql.UniqueIdentifier, scopeTenantId)
                        .query('SELECT id FROM Properties WHERE id = @property_id AND tenant_id = @tenant_id');
                    if (propCheck.recordset.length === 0) {
                        return res.status(400).json({ error: 'La propiedad no pertenece a este condominio' });
                    }
                    await pool.request()
                        .input('property_id', sql.UniqueIdentifier, pid)
                        .input('user_id', sql.UniqueIdentifier, id)
                        .input('percentage_ownership', sql.Decimal(5, 2), 100)
                        .query(`
                            INSERT INTO PropertyOwners (property_id, user_id, percentage_ownership, is_primary_owner)
                            VALUES (@property_id, @user_id, @percentage_ownership, 1)
                        `);
                }
            }

            res.json({
                success: true,
                owner: result.recordset[0]
            });
        } catch (error) {
            console.error('Update owner error:', error);
            res.status(500).json({ error: 'Error al actualizar propietario' });
        }
    }

    /**
     * DELETE /api/admin/tenants/:id/owners/:ownerId
     * Eliminar propietario DE UN CONDOMINIO (quitar su asignación a unidades de este tenant).
     * NUNCA se elimina el User: los propietarios "huérfanos" son normales y se reciclan
     * cuando se asignan a otro condominio (createOwner encuentra por DNI/email y reutiliza).
     */
    static async deleteOwner(req, res) {
        try {
            const { id: tenantId, ownerId } = req.params;
            const pool = await connectDB();
            const transaction = pool.transaction();

            await transaction.begin();

            try {
                const reqT = () => transaction.request()
                    .input('tenant_id', sql.UniqueIdentifier, tenantId)
                    .input('owner_id', sql.UniqueIdentifier, ownerId);

                // 1. Eliminar PropertyOwners solo de propiedades de ESTE tenant
                await reqT().query(`
                    DELETE FROM PropertyOwners
                    WHERE user_id = @owner_id
                    AND property_id IN (SELECT id FROM Properties WHERE tenant_id = @tenant_id)
                `);

                // 2. Eliminar TenantUsers para este tenant+user
                await reqT().query(`
                    DELETE FROM TenantUsers WHERE user_id = @owner_id AND tenant_id = @tenant_id
                `);

                // 3. ConsultationVotes de este tenant
                await reqT().query(`
                    DELETE FROM ConsultationVotes
                    WHERE user_id = @owner_id
                    AND consultation_id IN (SELECT id FROM Consultations WHERE tenant_id = @tenant_id)
                `).catch(() => {});

                // 4. Auditoría (antes de commit para tener contexto)
                const userResult = await transaction.request()
                    .input('owner_id', sql.UniqueIdentifier, ownerId)
                    .query('SELECT first_name, last_name, email FROM Users WHERE id = @owner_id');
                const ownerUser = userResult.recordset[0];
                const ownerLabel = ownerUser ? `${ownerUser.first_name} ${ownerUser.last_name} (${ownerUser.email})` : ownerId;

                await transaction.commit();

                await AdminController.logAudit(req, 'DELETE', 'OWNER', ownerId, 
                    `Quitó propietario del condominio: ${ownerLabel}`, tenantId);

                res.json({ success: true });
            } catch (err) {
                await transaction.rollback();
                throw err;
            }
        } catch (error) {
            console.error('Delete owner error:', error);
            res.status(500).json({ error: 'Error al eliminar propietario' });
        }
    }

    /**
     * POST /api/admin/owners/:id/password
     * Establecer/resetear contraseña de propietario (SuperAdmin)
     */
    static async setOwnerPassword(req, res) {
        try {
            const { id } = req.params;
            const { password } = req.body;

            // Validar que se proporcionó una contraseña
            if (!password || password.length < 6) {
                return res.status(400).json({ 
                    success: false,
                    error: 'La contraseña debe tener al menos 6 caracteres' 
                });
            }

            // Verificar que el usuario existe
            const pool = await connectDB();
            const userResult = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .query('SELECT id, first_name, last_name, email FROM Users WHERE id = @id');

            if (userResult.recordset.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Propietario no encontrado' 
                });
            }

            const user = userResult.recordset[0];

            // Actualizar la contraseña
            await UserModel.updatePassword(id, password);

            // Registrar en auditoría
            await AdminController.logAudit(
                req, 
                'OWNER_PASSWORD_RESET', 
                'USER', 
                id, 
                `Contraseña establecida para ${user.first_name} ${user.last_name} (${user.email})`
            );

            res.json({ 
                success: true, 
                message: 'Contraseña actualizada exitosamente' 
            });
        } catch (error) {
            console.error('Error setting owner password:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Error al establecer contraseña' 
            });
        }
    }

    /**
     * GET /api/admin/bcv-settings
     * Estado de la clave API DolarVzla (enmascarada) y recordatorio de renovación (~48h)
     */
    static async getBcvSettings(req, res) {
        try {
            const row = await SystemSettingsModel.getRow();
            const dbKey = await SystemSettingsModel.getBcvApiKey();
            const envKey = (process.env.BCV_API_KEY || '').trim();
            const source = dbKey ? 'database' : (envKey ? 'environment' : 'none');
            const activeKey = dbKey || envKey || null;
            const keyMasked = activeKey ? SystemSettingsModel.maskKey(activeKey) : null;
            const updatedAt = row?.bcv_api_key_updated_at || null;

            let reminderLevel = 'none';
            let reminderMessage = '';
            if (!activeKey) {
                reminderLevel = 'urgent';
                reminderMessage = 'No hay clave API BCV configurada. Obtén un token en DolarVzla y guárdalo aquí (o usa BCV_API_KEY en .env como respaldo).';
            } else if (updatedAt && dbKey) {
                const hours = (Date.now() - new Date(updatedAt).getTime()) / 3600000;
                if (hours >= 48) {
                    reminderLevel = 'urgent';
                    reminderMessage = 'Han pasado más de 2 días desde la última vez que guardaste la clave API. El token de DolarVzla suele caducar; renueva y actualiza aquí para evitar errores 401.';
                } else if (hours >= 36) {
                    reminderLevel = 'warning';
                    reminderMessage = 'Pronto cumplirás 2 días con la misma clave API. Renueva el token en DolarVzla y actualízalo aquí.';
                }
            } else if (source === 'environment' && envKey) {
                reminderLevel = 'info';
                reminderMessage = 'La clave se lee desde variables de entorno. Guárdala en este panel para cambiarla sin reiniciar el servidor.';
            }

            res.json({
                success: true,
                data: {
                    hasKey: !!activeKey,
                    keyMasked,
                    source,
                    updatedAt,
                    reminderLevel,
                    reminderMessage
                }
            });
        } catch (error) {
            console.error('getBcvSettings error:', error);
            res.status(500).json({ success: false, error: 'Error al obtener configuración BCV' });
        }
    }

    /**
     * PUT /api/admin/bcv-settings
     * body: { api_key: string }
     */
    static async updateBcvSettings(req, res) {
        try {
            const { api_key: apiKey } = req.body || {};
            if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
                return res.status(400).json({ success: false, error: 'La clave API es requerida' });
            }
            if (apiKey.trim().length < 24) {
                return res.status(400).json({ success: false, error: 'La clave API parece inválida' });
            }
            const userId = req.user.userId;
            await SystemSettingsModel.updateBcvApiKey(apiKey.trim(), userId);
            BCVService.invalidateApiKeyCache();

            // Una consulta inmediata con la nueva clave (el cron diario / horario no se modifica)
            const rateRefresh = await BCVService.fetchAndSave();

            await AdminController.logAudit(req, 'UPDATE', 'SYSTEM_SETTINGS', 'BCV_API_KEY',
                'Actualizó clave API DolarVzla (BCV) en configuración global', null);

            const message = rateRefresh
                ? 'Clave API guardada y tasas BCV actualizadas desde la API'
                : 'Clave API guardada. No se pudo obtener la tasa desde la API ahora; verifica la clave o inténtalo más tarde. La actualización automática seguirá según el horario configurado.';

            res.json({
                success: true,
                message,
                data: { bcvRateRefreshed: !!rateRefresh }
            });
        } catch (error) {
            console.error('updateBcvSettings error:', error);
            res.status(500).json({ success: false, error: 'Error al guardar la clave API' });
        }
    }

    /**
     * GET /api/admin/tenants/:id/properties/export
     * Excel: todos los inmuebles del condominio con detalle
     */
    static async exportPropertiesExcel(req, res) {
        try {
            const { id } = req.params;
            const tenant = await TenantModel.findById(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Condominio no encontrado' });
            }
            const rows = await PropertyModel.findAllForExport(id);
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Condominio360';
            const sheet = workbook.addWorksheet('Inmuebles');
            sheet.columns = [
                { header: 'Unidad', key: 'name', width: 22 },
                { header: 'Slug', key: 'slug', width: 18 },
                { header: 'Tipo', key: 'type', width: 14 },
                { header: 'Edificio', key: 'edificio', width: 22 },
                { header: 'Código edificio', key: 'edificio_codigo', width: 14 },
                { header: 'Piso', key: 'piso', width: 10 },
                { header: 'Área (m²)', key: 'area_m2', width: 12 },
                { header: 'Alícuota (%)', key: 'alicuota', width: 12 },
                { header: 'Nickname', key: 'nickname', width: 14 },
                { header: 'Nickname activo', key: 'nickname_activo', width: 14 },
                { header: 'Nº propietarios', key: 'num_propietarios', width: 14 },
                { header: 'Propietarios (detalle)', key: 'propietarios_detalle', width: 60 },
                { header: 'Creado', key: 'created_at', width: 20 },
                { header: 'Actualizado', key: 'updated_at', width: 20 },
                { header: 'ID inmueble', key: 'id', width: 38 }
            ];
            sheet.getRow(1).font = { bold: true };
            rows.forEach((r) => {
                sheet.addRow({
                    name: r.name,
                    slug: r.slug || '',
                    type: r.type,
                    edificio: r.edificio || '',
                    edificio_codigo: r.edificio_codigo || '',
                    piso: r.piso || '',
                    area_m2: r.area_m2 != null ? parseFloat(r.area_m2) : '',
                    alicuota: r.alicuota != null ? parseFloat(r.alicuota) : '',
                    nickname: r.nickname || '',
                    nickname_activo: r.nickname_activo || '',
                    num_propietarios: r.num_propietarios,
                    propietarios_detalle: r.propietarios_detalle || '',
                    created_at: r.created_at ? new Date(r.created_at) : '',
                    updated_at: r.updated_at ? new Date(r.updated_at) : '',
                    id: r.id
                });
            });
            const safeName = (tenant.name || 'condominio').replace(/[^\w\s-]/g, '').slice(0, 40);
            const filename = `inmuebles-${safeName}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            await workbook.xlsx.write(res);
        } catch (error) {
            console.error('Export properties excel error:', error);
            res.status(500).json({ error: 'Error al exportar inmuebles' });
        }
    }

    /**
     * GET /api/admin/tenants/:id/owners/export
     * Excel: propietarios y asignación a inmuebles en el condominio
     */
    static async exportOwnersExcel(req, res) {
        try {
            const { id } = req.params;
            const tenant = await TenantModel.findById(id);
            if (!tenant) {
                return res.status(404).json({ error: 'Condominio no encontrado' });
            }
            const rows = await UserModel.findOwnersForExport(id);
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Condominio360';
            const sheet = workbook.addWorksheet('Propietarios');
            sheet.columns = [
                { header: 'Nombre', key: 'first_name', width: 18 },
                { header: 'Apellido', key: 'last_name', width: 18 },
                { header: 'Email', key: 'email', width: 28 },
                { header: 'Teléfono', key: 'phone', width: 16 },
                { header: 'DNI / Documento', key: 'dni', width: 16 },
                { header: 'Usuario activo', key: 'is_active', width: 12 },
                { header: 'Inmueble', key: 'inmueble', width: 22 },
                { header: 'Edificio', key: 'edificio', width: 18 },
                { header: 'Principal', key: 'is_primary_owner', width: 10 },
                { header: '% participación', key: 'porcentaje_participacion', width: 14 },
                { header: 'ID propietario', key: 'user_id', width: 38 },
                { header: 'ID inmueble', key: 'property_id', width: 38 }
            ];
            sheet.getRow(1).font = { bold: true };
            rows.forEach((r) => {
                sheet.addRow({
                    first_name: r.first_name,
                    last_name: r.last_name,
                    email: r.email,
                    phone: r.phone || '',
                    dni: r.dni || '',
                    is_active: r.is_active ? 'Sí' : 'No',
                    inmueble: r.inmueble || '(sin inmueble en este conjunto)',
                    edificio: r.edificio || '',
                    is_primary_owner: r.is_primary_owner === true || r.is_primary_owner === 1 ? 'Sí' : (r.property_id ? 'No' : ''),
                    porcentaje_participacion: r.porcentaje_participacion != null ? parseFloat(r.porcentaje_participacion) : '',
                    user_id: r.user_id,
                    property_id: r.property_id || ''
                });
            });
            const safeName = (tenant.name || 'condominio').replace(/[^\w\s-]/g, '').slice(0, 40);
            const filename = `propietarios-${safeName}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            await workbook.xlsx.write(res);
        } catch (error) {
            console.error('Export owners excel error:', error);
            res.status(500).json({ error: 'Error al exportar propietarios' });
        }
    }
}

module.exports = AdminController;
