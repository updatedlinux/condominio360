require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');

async function migrateVisitors() {
    try {
        const pool = await connectDB();
        console.log('Starting migration for Visitors module...');

        // Dropping existing tables to recreate with new schema (DEV environment assumption)
        // IN PRODUCTION THIS WOULD BE AN ALTER TABLE

        await pool.query(`
            IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[VisitorLogs]') AND type in (N'U'))
                DROP TABLE VisitorLogs;
            
            IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[VisitorPasses]') AND type in (N'U'))
                DROP TABLE VisitorPasses;

            IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Visitors]') AND type in (N'U'))
                DROP TABLE Visitors;
        `);

        console.log('Dropped existing Visitor tables.');

        // Recreating tables using the logic from 01_init.sql
        // Copied here for immediate execution via script

        await pool.query(`
            -- Visitors
            CREATE TABLE Visitors (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                
                first_name NVARCHAR(100) NOT NULL,
                last_name NVARCHAR(100) NOT NULL,
                dni NVARCHAR(20) NOT NULL,
                phone NVARCHAR(20),
                photo_url NVARCHAR(255),
                
                is_banned BIT DEFAULT 0,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),

                CONSTRAINT FK_Visitors_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                CONSTRAINT UQ_Visitors_Tenant_DNI UNIQUE (tenant_id, dni)
            );

            -- VisitorPasses
            CREATE TABLE VisitorPasses (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                visitor_id UNIQUEIDENTIFIER NOT NULL,
                user_id UNIQUEIDENTIFIER NOT NULL, 
                property_id UNIQUEIDENTIFIER NULL, 

                type NVARCHAR(20) NOT NULL, 
                alias NVARCHAR(50), 
                
                valid_from DATETIME2 DEFAULT SYSDATETIME(),
                valid_until DATETIME2 NULL, 
                
                status NVARCHAR(20) DEFAULT 'ACTIVE', 
                created_at DATETIME2 DEFAULT SYSDATETIME(),

                CONSTRAINT FK_VisitorPasses_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                CONSTRAINT FK_VisitorPasses_Visitors FOREIGN KEY (visitor_id) REFERENCES Visitors(id),
                CONSTRAINT FK_VisitorPasses_Users FOREIGN KEY (user_id) REFERENCES Users(id),
                CONSTRAINT FK_VisitorPasses_Properties FOREIGN KEY (property_id) REFERENCES Properties(id)
            );

            -- VisitorLogs
            CREATE TABLE VisitorLogs (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                visitor_id UNIQUEIDENTIFIER NOT NULL,
                pass_id UNIQUEIDENTIFIER NULL, 
                
                property_id UNIQUEIDENTIFIER NULL, 
                user_id UNIQUEIDENTIFIER NULL, 

                access_method NVARCHAR(20) DEFAULT 'PEDESTRIAN', 
                vehicle_plate NVARCHAR(20),
                
                entry_time DATETIME2 DEFAULT SYSDATETIME(),
                exit_time DATETIME2 NULL,
                notes NVARCHAR(500),

                CONSTRAINT FK_VisitorLogs_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                CONSTRAINT FK_VisitorLogs_Visitors FOREIGN KEY (visitor_id) REFERENCES Visitors(id),
                CONSTRAINT FK_VisitorLogs_Passes FOREIGN KEY (pass_id) REFERENCES VisitorPasses(id),
                CONSTRAINT FK_VisitorLogs_Properties FOREIGN KEY (property_id) REFERENCES Properties(id),
                CONSTRAINT FK_VisitorLogs_Users FOREIGN KEY (user_id) REFERENCES Users(id)
            );
            
            CREATE INDEX IX_VisitorLogs_Tenant_Date ON VisitorLogs(tenant_id, entry_time);
        `);

        console.log('Migration completed successfully.');
        process.exit(0);

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrateVisitors();
