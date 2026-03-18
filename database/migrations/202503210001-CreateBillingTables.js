const { sql, connectDB } = require('../../src/config/database');

/**
 * Migration: Sistema de Facturación de Condominios
 * - Vendors (Proveedores)
 * - VendorContracts (Contratos con costos)
 * - BillingPreliminaries (Preliminares de facturación)
 * - BillingPreliminaryItems (Items del preliminar)
 * - BillingInvoices (Recibos por inmueble)
 * - BillingInvoiceItems (Items desglosados por recibo)
 * - BillingExtraordinaryTemplates (Plantillas reusables)
 * - Campos adicionales en Tenants (billing_type, billing_mode, payment_info)
 */

class Migration {
    static async up() {
        try {
            console.log('🔄 Iniciando migración de sistema de facturación...');
            const pool = await connectDB();

            // 1. Agregar campos a Tenants
            console.log('➕ Agregando campos de facturación a Tenants...');
            
            const tenantColumns = [
                { name: 'billing_type', type: 'NVARCHAR(20)', default: 'ALICUOTA' },
                { name: 'billing_mode', type: 'NVARCHAR(20)', default: 'FULL' },
                { name: 'payment_info', type: 'NVARCHAR(MAX)', default: null }
            ];

            for (const col of tenantColumns) {
                const checkResult = await pool.request()
                    .query(`
                        SELECT COLUMN_NAME 
                        FROM INFORMATION_SCHEMA.COLUMNS 
                        WHERE TABLE_NAME = 'Tenants' AND COLUMN_NAME = '${col.name}'
                    `);
                
                if (checkResult.recordset.length === 0) {
                    const defaultValue = col.default ? `DEFAULT '${col.default}'` : '';
                    await pool.request().query(`
                        ALTER TABLE Tenants 
                        ADD ${col.name} ${col.type} ${defaultValue}
                    `);
                    console.log(`  ✅ Columna ${col.name} agregada`);
                }
            }

            // Actualizar tenants existentes a modo FULL
            await pool.request().query(`
                UPDATE Tenants 
                SET billing_mode = 'FULL', billing_type = 'ALICUOTA'
                WHERE billing_mode IS NULL OR billing_type IS NULL
            `);
            console.log('  ✅ Tenants existentes actualizados a modo FULL');

            // 2. Tabla Vendors (Proveedores)
            console.log('➕ Creando tabla Vendors...');
            await pool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Vendors')
                CREATE TABLE Vendors (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    name NVARCHAR(255) NOT NULL,
                    description NVARCHAR(500),
                    contact_name NVARCHAR(255),
                    contact_email NVARCHAR(255),
                    contact_phone NVARCHAR(50),
                    service_type NVARCHAR(100),
                    status NVARCHAR(20) DEFAULT 'ACTIVE',
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_Vendors_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id) ON DELETE CASCADE
                )
            `);

            // 3. Tabla VendorContracts (Contratos con costos)
            console.log('➕ Creando tabla VendorContracts...');
            await pool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VendorContracts')
                CREATE TABLE VendorContracts (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    vendor_id UNIQUEIDENTIFIER NOT NULL,
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    description NVARCHAR(255) NOT NULL,
                    amount DECIMAL(15,2) NOT NULL,
                    currency NVARCHAR(3) NOT NULL DEFAULT 'VES',
                    billing_frequency NVARCHAR(20) DEFAULT 'MONTHLY',
                    start_date DATE NOT NULL,
                    end_date DATE,
                    status NVARCHAR(20) DEFAULT 'ACTIVE',
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_VendorContracts_Vendors FOREIGN KEY (vendor_id) REFERENCES Vendors(id),
                    CONSTRAINT FK_VendorContracts_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id)
                )
            `);

            // 4. Tabla BillingPreliminaries (Preliminares de facturación)
            console.log('➕ Creando tabla BillingPreliminaries...');
            await pool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BillingPreliminaries')
                CREATE TABLE BillingPreliminaries (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    billing_month INT NOT NULL,
                    billing_year INT NOT NULL,
                    name NVARCHAR(255),
                    status NVARCHAR(20) DEFAULT 'DRAFT',
                    exchange_rate_usd DECIMAL(10,2) NOT NULL,
                    total_amount_usd DECIMAL(15,2) DEFAULT 0,
                    total_amount_ves DECIMAL(15,2) DEFAULT 0,
                    created_by UNIQUEIDENTIFIER NOT NULL,
                    finalized_at DATETIME2,
                    sent_to_owners BIT DEFAULT 0,
                    sent_at DATETIME2,
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_BillingPreliminaries_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id) ON DELETE CASCADE
                )
            `);

            // 5. Tabla BillingPreliminaryItems (Items del preliminar)
            console.log('➕ Creando tabla BillingPreliminaryItems...');
            await pool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BillingPreliminaryItems')
                CREATE TABLE BillingPreliminaryItems (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    preliminary_id UNIQUEIDENTIFIER NOT NULL,
                    item_type NVARCHAR(20) NOT NULL,
                    description NVARCHAR(255) NOT NULL,
                    vendor_contract_id UNIQUEIDENTIFIER NULL,
                    base_amount DECIMAL(15,2) NOT NULL,
                    currency NVARCHAR(3) NOT NULL DEFAULT 'VES',
                    converted_amount_ves DECIMAL(15,2) NOT NULL,
                    notes NVARCHAR(500),
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_BillingPreliminaryItems_Preliminaries FOREIGN KEY (preliminary_id) REFERENCES BillingPreliminaries(id) ON DELETE CASCADE,
                    CONSTRAINT FK_BillingPreliminaryItems_Contracts FOREIGN KEY (vendor_contract_id) REFERENCES VendorContracts(id)
                )
            `);

            // 6. Tabla BillingInvoices (Recibos por inmueble)
            console.log('➕ Creando tabla BillingInvoices...');
            await pool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BillingInvoices')
                CREATE TABLE BillingInvoices (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    preliminary_id UNIQUEIDENTIFIER NOT NULL,
                    property_id UNIQUEIDENTIFIER NOT NULL,
                    owner_id UNIQUEIDENTIFIER,
                    invoice_number NVARCHAR(50),
                    status NVARCHAR(20) DEFAULT 'PENDING',
                    total_amount_usd DECIMAL(15,2) NOT NULL,
                    total_amount_ves DECIMAL(15,2) NOT NULL,
                    assigned_amount_usd DECIMAL(15,2) NOT NULL,
                    assigned_amount_ves DECIMAL(15,2) NOT NULL,
                    proportion_type NVARCHAR(20),
                    proportion_value DECIMAL(10,4),
                    exchange_rate_at_creation DECIMAL(10,2) NOT NULL,
                    current_exchange_rate DECIMAL(10,2) NOT NULL,
                    paid_amount_ves DECIMAL(15,2) DEFAULT 0,
                    paid_at DATETIME2,
                    payment_method NVARCHAR(50),
                    payment_reference NVARCHAR(255),
                    payment_notes NVARCHAR(500),
                    last_rate_update DATETIME2 DEFAULT SYSDATETIME(),
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_BillingInvoices_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                    CONSTRAINT FK_BillingInvoices_Preliminaries FOREIGN KEY (preliminary_id) REFERENCES BillingPreliminaries(id),
                    CONSTRAINT FK_BillingInvoices_Properties FOREIGN KEY (property_id) REFERENCES Properties(id),
                    CONSTRAINT UQ_BillingInvoices_Preliminary_Property UNIQUE (preliminary_id, property_id)
                )
            `);

            // 7. Tabla BillingInvoiceItems (Items desglosados por recibo)
            console.log('➕ Creando tabla BillingInvoiceItems...');
            await pool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BillingInvoiceItems')
                CREATE TABLE BillingInvoiceItems (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    invoice_id UNIQUEIDENTIFIER NOT NULL,
                    item_type NVARCHAR(20) NOT NULL,
                    description NVARCHAR(255) NOT NULL,
                    base_amount DECIMAL(15,2) NOT NULL,
                    currency NVARCHAR(3) NOT NULL,
                    converted_amount_ves DECIMAL(15,2) NOT NULL,
                    assigned_amount_ves DECIMAL(15,2) NOT NULL,
                    notes NVARCHAR(500),
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_BillingInvoiceItems_Invoices FOREIGN KEY (invoice_id) REFERENCES BillingInvoices(id) ON DELETE CASCADE
                )
            `);

            // 8. Tabla BillingExtraordinaryTemplates (Plantillas reusables)
            console.log('➕ Creando tabla BillingExtraordinaryTemplates...');
            await pool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BillingExtraordinaryTemplates')
                CREATE TABLE BillingExtraordinaryTemplates (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    name NVARCHAR(255) NOT NULL,
                    description NVARCHAR(500),
                    default_amount DECIMAL(15,2),
                    default_currency NVARCHAR(3) DEFAULT 'VES',
                    category NVARCHAR(100),
                    is_active BIT DEFAULT 1,
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_BillingExtraordinaryTemplates_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id) ON DELETE CASCADE
                )
            `);

            // 9. Crear índices
            console.log('➕ Creando índices...');
            
            const indexes = [
                { table: 'Vendors', column: 'tenant_id', name: 'IX_Vendors_Tenant' },
                { table: 'Vendors', column: 'status', name: 'IX_Vendors_Status' },
                { table: 'VendorContracts', column: 'vendor_id', name: 'IX_VendorContracts_Vendor' },
                { table: 'VendorContracts', column: 'tenant_id', name: 'IX_VendorContracts_Tenant' },
                { table: 'VendorContracts', column: 'status', name: 'IX_VendorContracts_Status' },
                { table: 'BillingPreliminaries', column: 'tenant_id', name: 'IX_BillingPreliminaries_Tenant' },
                { table: 'BillingPreliminaries', column: 'status', name: 'IX_BillingPreliminaries_Status' },
                { table: 'BillingPreliminaryItems', column: 'preliminary_id', name: 'IX_BillingPreliminaryItems_Preliminary' },
                { table: 'BillingInvoices', column: 'tenant_id', name: 'IX_BillingInvoices_Tenant' },
                { table: 'BillingInvoices', column: 'preliminary_id', name: 'IX_BillingInvoices_Preliminary' },
                { table: 'BillingInvoices', column: 'property_id', name: 'IX_BillingInvoices_Property' },
                { table: 'BillingInvoices', column: 'status', name: 'IX_BillingInvoices_Status' },
                { table: 'BillingInvoices', column: 'owner_id', name: 'IX_BillingInvoices_Owner' },
                { table: 'BillingInvoiceItems', column: 'invoice_id', name: 'IX_BillingInvoiceItems_Invoice' },
                { table: 'BillingExtraordinaryTemplates', column: 'tenant_id', name: 'IX_BillingExtraordinaryTemplates_Tenant' }
            ];

            for (const idx of indexes) {
                await pool.request().query(`
                    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = '${idx.name}' AND object_id = OBJECT_ID('${idx.table}'))
                    CREATE INDEX ${idx.name} ON ${idx.table}(${idx.column})
                `);
            }

            console.log('✅ Migración de sistema de facturación completada exitosamente');
            return true;

        } catch (error) {
            console.error('❌ Error en migración de facturación:', error);
            throw error;
        }
    }

    static async down() {
        try {
            console.log('🔄 Revirtiendo migración de sistema de facturación...');
            const pool = await connectDB();

            const tables = [
                'BillingInvoiceItems',
                'BillingInvoices',
                'BillingPreliminaryItems',
                'BillingPreliminaries',
                'BillingExtraordinaryTemplates',
                'VendorContracts',
                'Vendors'
            ];

            for (const table of tables) {
                await pool.request().query(`
                    IF EXISTS (SELECT * FROM sys.tables WHERE name = '${table}')
                    DROP TABLE ${table}
                `);
                console.log(`  ✅ Tabla ${table} eliminada`);
            }

            const columns = ['billing_type', 'billing_mode', 'payment_info'];
            for (const col of columns) {
                const checkResult = await pool.request()
                    .query(`
                        SELECT COLUMN_NAME 
                        FROM INFORMATION_SCHEMA.COLUMNS 
                        WHERE TABLE_NAME = 'Tenants' AND COLUMN_NAME = '${col}'
                    `);
                
                if (checkResult.recordset.length > 0) {
                    await pool.request().query(`
                        ALTER TABLE Tenants DROP COLUMN ${col}
                    `);
                    console.log(`  ✅ Columna ${col} eliminada de Tenants`);
                }
            }

            console.log('✅ Reversión completada');
            return true;

        } catch (error) {
            console.error('❌ Error revirtiendo migración:', error);
            throw error;
        }
    }
}

if (require.main === module) {
    Migration.up()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = Migration;
