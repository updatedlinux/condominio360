require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');
const bcrypt = require('bcrypt');

const seed = async () => {
    let pool;
    try {
        pool = await connectDB();
        console.log('🌱 Starting Seeder (Unified Login)...');

        // 1. Create Tenant (Condominio Demo)
        const tenantSlug = 'demo';
        let tenantId;

        const tenantCheck = await pool.request()
            .input('slug', sql.NVarChar, tenantSlug)
            .query('SELECT id FROM Tenants WHERE slug = @slug');

        if (tenantCheck.recordset.length > 0) {
            console.log('ℹ️ Demo tenant already exists.');
            tenantId = tenantCheck.recordset[0].id;
        } else {
            const tenantResult = await pool.request()
                .input('name', sql.NVarChar, 'Condominio Demo')
                .input('slug', sql.NVarChar, tenantSlug)
                .input('address', sql.NVarChar, 'Calle Falsa 123')
                .query(`
                    INSERT INTO Tenants (name, slug, address)
                    OUTPUT INSERTED.id
                    VALUES (@name, @slug, @address)
                `);
            tenantId = tenantResult.recordset[0].id;
            console.log('✅ Created Demo Tenant:', tenantSlug);
        }

        // 2. Create Global Admin User
        const adminEmail = 'admin@demo.com';
        let userId;

        const userCheck = await pool.request()
            .input('email', sql.NVarChar, adminEmail)
            .query('SELECT id FROM Users WHERE email = @email');

        if (userCheck.recordset.length > 0) {
            console.log('ℹ️ Admin user already exists.');
            userId = userCheck.recordset[0].id;
        } else {
            const passwordHash = await bcrypt.hash('123456', 10);

            const userResult = await pool.request()
                .input('firstName', sql.NVarChar, 'Super')
                .input('lastName', sql.NVarChar, 'Admin')
                .input('email', sql.NVarChar, adminEmail)
                .input('password', sql.NVarChar, passwordHash)
                .input('isSuperAdmin', sql.Bit, 1)
                .query(`
                    INSERT INTO Users (first_name, last_name, email, password_hash, is_superadmin)
                    OUTPUT INSERTED.id
                    VALUES (@firstName, @lastName, @email, @password, @isSuperAdmin)
                `);
            userId = userResult.recordset[0].id;
            console.log('✅ Created Global Admin User:', adminEmail);
        }

        // 3. Assign User to Tenant (TenantUsers)
        const membershipCheck = await pool.request()
            .input('userId', sql.UniqueIdentifier, userId)
            .input('tenantId', sql.UniqueIdentifier, tenantId)
            .query('SELECT id FROM TenantUsers WHERE user_id = @userId AND tenant_id = @tenantId');

        if (membershipCheck.recordset.length === 0) {
            await pool.request()
                .input('userId', sql.UniqueIdentifier, userId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('role', sql.NVarChar, 'ADMIN')
                .query(`
                    INSERT INTO TenantUsers (user_id, tenant_id, role)
                    VALUES (@userId, @tenantId, @role)
                `);
            console.log('✅ Assigned User to Demo Tenant as ADMIN');
        } else {
            console.log('ℹ️ User is already a member of Demo Tenant.');
        }

        // 3.1 Create Tenant Admin User (tenant@demo.com)
        const tenantAdminEmail = 'tenant@demo.com';
        const tenantUserCheck = await pool.request()
            .input('email', sql.NVarChar, tenantAdminEmail)
            .query('SELECT id FROM Users WHERE email = @email');

        if (tenantUserCheck.recordset.length === 0) {
            const pwHash = await bcrypt.hash('123456', 10);
            const userRes = await pool.request()
                .input('firstName', sql.NVarChar, 'Tenant')
                .input('lastName', sql.NVarChar, 'Admin')
                .input('email', sql.NVarChar, tenantAdminEmail)
                .input('password', sql.NVarChar, pwHash)
                .input('isSuperAdmin', sql.Bit, 0)
                .query(`
                    INSERT INTO Users (first_name, last_name, email, password_hash, is_superadmin)
                    OUTPUT INSERTED.id
                    VALUES (@firstName, @lastName, @email, @password, @isSuperAdmin)
                `);
            const tUserId = userRes.recordset[0].id;

            await pool.request()
                .input('userId', sql.UniqueIdentifier, tUserId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('role', sql.NVarChar, 'ADMIN')
                .query(`INSERT INTO TenantUsers (user_id, tenant_id, role) VALUES (@userId, @tenantId, @role)`);

            console.log('✅ Created Tenant Admin User:', tenantAdminEmail);
        }

        // 3.2 Create Resident User (resident@demo.com)
        const residentEmail = 'resident@demo.com';
        const residentCheck = await pool.request()
            .input('email', sql.NVarChar, residentEmail)
            .query('SELECT id FROM Users WHERE email = @email');

        if (residentCheck.recordset.length === 0) {
            const pwHash = await bcrypt.hash('123456', 10);
            const userRes = await pool.request()
                .input('firstName', sql.NVarChar, 'Juan')
                .input('lastName', sql.NVarChar, 'Residente')
                .input('email', sql.NVarChar, residentEmail)
                .input('password', sql.NVarChar, pwHash)
                .input('isSuperAdmin', sql.Bit, 0)
                .query(`
                    INSERT INTO Users (first_name, last_name, email, password_hash, is_superadmin)
                    OUTPUT INSERTED.id
                    VALUES (@firstName, @lastName, @email, @password, @isSuperAdmin)
                `);
            const rUserId = userRes.recordset[0].id;

            await pool.request()
                .input('userId', sql.UniqueIdentifier, rUserId)
                .input('tenantId', sql.UniqueIdentifier, tenantId)
                .input('role', sql.NVarChar, 'RESIDENT')
                .query(`INSERT INTO TenantUsers (user_id, tenant_id, role) VALUES (@userId, @tenantId, @role)`);

            console.log('✅ Created Resident User:', residentEmail);
        }

        // 4. Create Request Types for Demo Tenant
        // Mudanza Entrada
        const mudanzaSchema = JSON.stringify([
            { name: 'date', label: 'Fecha de Mudanza', type: 'date', required: true },
            { name: 'transporter_name', label: 'Nombre del Transportista', type: 'text', required: true },
            { name: 'transporter_id', label: 'Cédula del Transportista', type: 'text', required: true },
            { name: 'vehicle_brand', label: 'Marca del Vehículo', type: 'text', required: true },
            { name: 'vehicle_plate', label: 'Placa del Vehículo', type: 'text', required: true },
            { name: 'driver_name', label: 'Nombre del Chofer', type: 'text', required: true }
        ]);

        const sugerenciaSchema = JSON.stringify([
            { name: 'details', label: 'Detalles de la Solicitud', type: 'textarea', required: true, placeholder: 'Describa su solicitud...' }
        ]);

        // Check if types exist
        const typeCheck = await pool.request()
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query('SELECT id FROM RequestTypes WHERE tenant_id = @tenant_id');

        if (typeCheck.recordset.length === 0) {
            await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .input('name1', sql.NVarChar, 'Mudanza - Entrada')
                .input('schema1', sql.NVarChar, mudanzaSchema)
                .input('name2', sql.NVarChar, 'Sugerencias')
                .input('schema2', sql.NVarChar, sugerenciaSchema)
                .query(`
                    INSERT INTO RequestTypes (tenant_id, name, form_schema)
                    VALUES 
                    (@tenant_id, @name1, @schema1),
                    (@tenant_id, @name2, @schema2)
                `);
            console.log('✅ Created default Request Types (Mudanza, Sugerencias)');
        }

        console.log('✨ Seeding completed successfully!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
};

seed();
