-- =============================================
-- BASE DE DATOS MAESTRA - CONDOMINIO360 V2
-- =============================================

-- =============================================
-- TABLA: Tenants (Condominios/Conjuntos)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Tenants]') AND type in (N'U'))
CREATE TABLE Tenants (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    name NVARCHAR(100) NOT NULL,
    slug NVARCHAR(50) NOT NULL UNIQUE, -- Para subdominio o identificación en URL
    address NVARCHAR(255),
    logo_url NVARCHAR(255),
    billing_type NVARCHAR(20) DEFAULT 'FIXED', -- "FIXED" (Monto fijo), "ALICUOTA" (% de gasto total)
    active BIT DEFAULT 1,
    settings NVARCHAR(MAX), -- JSON con configuración específica (colores, reglas, etc.)
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME()
);

-- =============================================
-- TABLA: Users (Usuarios Globales)
-- NOTA: Eliminado tenant_id para permitir login unificado.
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND type in (N'U'))
CREATE TABLE Users (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    first_name NVARCHAR(100) NOT NULL,
    last_name NVARCHAR(100) NOT NULL,
    email NVARCHAR(150) NOT NULL UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    phone NVARCHAR(20),
    avatar_url NVARCHAR(255),
    is_superadmin BIT DEFAULT 0, -- Solo para staff de Condominio360
    is_active BIT DEFAULT 1,
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME()
);

-- =============================================
-- TABLA: TenantUsers (Relación Usuario - Condominio)
-- Define el rol de un usuario DENTRO de un condominio específico.
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TenantUsers]') AND type in (N'U'))
CREATE TABLE TenantUsers (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    user_id UNIQUEIDENTIFIER NOT NULL,
    role NVARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'OWNER', 'RESIDENT', 'SECURITY')),
    status NVARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, PENDING, BLOCKED
    created_at DATETIME2 DEFAULT SYSDATETIME(),

    CONSTRAINT FK_TenantUsers_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
    CONSTRAINT FK_TenantUsers_Users FOREIGN KEY (user_id) REFERENCES Users(id),
    CONSTRAINT UQ_TenantUsers_User_Tenant UNIQUE (user_id, tenant_id)
);

-- =============================================
-- TABLA: Properties (Unidades Inmobiliarias / Aptos)
-- Pertenecen obligatoriamente a un Tenant.
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Properties]') AND type in (N'U'))
CREATE TABLE Properties (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(50) NOT NULL, -- "Apto 101", "Casa 5"
    type NVARCHAR(50) NOT NULL, -- "Apartment", "House", "Store", "Lot"
    building NVARCHAR(50), -- "Torre A"
    floor NVARCHAR(10),
    area_sqm DECIMAL(10,2),
    alicuota DECIMAL(10,4) DEFAULT 0, -- Porcentaje de participación (0.0000 a 100.0000)
    
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Properties_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id)
);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Properties_Tenant' AND object_id = OBJECT_ID('Properties'))
CREATE INDEX IX_Properties_Tenant ON Properties(tenant_id);

-- =============================================
-- TABLA: PropertyOwners (Relación Propiedad - Propietario)
-- M:N -> Una propiedad puede tener varios dueños, un dueño varias propiedades.
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PropertyOwners]') AND type in (N'U'))
CREATE TABLE PropertyOwners (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    property_id UNIQUEIDENTIFIER NOT NULL,
    user_id UNIQUEIDENTIFIER NOT NULL,
    is_primary_owner BIT DEFAULT 0, -- Para identificar al contacto principal
    percentage_ownership DECIMAL(5,2) DEFAULT 100.00,
    
    created_at DATETIME2 DEFAULT SYSDATETIME(),

    CONSTRAINT FK_PropertyOwners_Properties FOREIGN KEY (property_id) REFERENCES Properties(id),
    CONSTRAINT FK_PropertyOwners_Users FOREIGN KEY (user_id) REFERENCES Users(id),
    CONSTRAINT UQ_PropertyOwners_Prop_User UNIQUE (property_id, user_id)
);

-- =============================================
-- TABLA: RequestTypes (Tipos de Solicitud Configurables)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[RequestTypes]') AND type in (N'U'))
CREATE TABLE RequestTypes (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(100) NOT NULL, -- "Mudanza Entrada", "Sugerencias"
    description NVARCHAR(255),
    form_schema NVARCHAR(MAX), -- JSON con la definición de campos (labels, types, required, etc.)
    is_active BIT DEFAULT 1,
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME(),

    CONSTRAINT FK_RequestTypes_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id)
);

-- =============================================
-- TABLA: Requests (Solicitudes / PQRS)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Requests]') AND type in (N'U'))
CREATE TABLE Requests (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    user_id UNIQUEIDENTIFIER NOT NULL, -- Quien crea la solicitud
    property_id UNIQUEIDENTIFIER NULL, -- Relacionada a qué propiedad (opcional si es área común)
    request_type_id UNIQUEIDENTIFIER NULL, -- FK a RequestTypes (NULL para permitir migración suave o tipos legacy por ahora)
    
    title NVARCHAR(150), -- Opcional, puede generarse aut. basado en el tipo
    description NVARCHAR(MAX), -- Opcional si los datos están en 'data'
    data NVARCHAR(MAX), -- JSON con los valores de los campos dinámicos
    
    status NVARCHAR(20) DEFAULT 'OPEN', -- "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"
    priority NVARCHAR(20) DEFAULT 'MEDIUM', -- "LOW", "MEDIUM", "HIGH", "URGENT"
    resolution_notes NVARCHAR(MAX),
    
    created_at DATETIME2 DEFAULT SYSDATETIME(),
    updated_at DATETIME2 DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Requests_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
    CONSTRAINT FK_Requests_Users FOREIGN KEY (user_id) REFERENCES Users(id),
    CONSTRAINT FK_Requests_Properties FOREIGN KEY (property_id) REFERENCES Properties(id),
    CONSTRAINT FK_Requests_RequestTypes FOREIGN KEY (request_type_id) REFERENCES RequestTypes(id)
);

-- =============================================
-- TABLA: Visitors (Identidad del Visitante)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Visitors]') AND type in (N'U'))
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
    CONSTRAINT UQ_Visitors_Tenant_DNI UNIQUE (tenant_id, dni) -- Un visitante es único por DNI dentro de un tenant
);

-- =============================================
-- TABLA: VisitorPasses (Autorizaciones de Acceso)
-- =============================================
-- Define si un visitante es "Frecuente" o "Único" para una propiedad/usuario
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[VisitorPasses]') AND type in (N'U'))
CREATE TABLE VisitorPasses (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    visitor_id UNIQUEIDENTIFIER NOT NULL,
    user_id UNIQUEIDENTIFIER NOT NULL, -- Quien autoriza/crea el pase (residente)
    property_id UNIQUEIDENTIFIER NULL, -- Relacionado a la unidad

    type NVARCHAR(20) NOT NULL, -- "ONE_TIME" (Única), "FREQUENT" (Frecuente)
    alias NVARCHAR(50), -- "Papá", "Transporte", etc. (Solo frecuentes)
    
    valid_from DATETIME2 DEFAULT SYSDATETIME(),
    valid_until DATETIME2 NULL, -- Para ONE_TIME es la fecha de visita. Para FREQUENT puede ser NULL (indefinido) o fecha fin.
    
    status NVARCHAR(20) DEFAULT 'ACTIVE', -- "ACTIVE", "EXPIRED", "REVOKED", "USED" (para one_time)
    created_at DATETIME2 DEFAULT SYSDATETIME(),

    CONSTRAINT FK_VisitorPasses_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
    CONSTRAINT FK_VisitorPasses_Visitors FOREIGN KEY (visitor_id) REFERENCES Visitors(id),
    CONSTRAINT FK_VisitorPasses_Users FOREIGN KEY (user_id) REFERENCES Users(id),
    CONSTRAINT FK_VisitorPasses_Properties FOREIGN KEY (property_id) REFERENCES Properties(id)
);

-- =============================================
-- TABLA: VisitorLogs (Bitácora de Accesos)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[VisitorLogs]') AND type in (N'U'))
CREATE TABLE VisitorLogs (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    visitor_id UNIQUEIDENTIFIER NOT NULL,
    pass_id UNIQUEIDENTIFIER NULL, -- Relación con el pase utilizado (opcional si es entrada ad-hoc)
    
    property_id UNIQUEIDENTIFIER NULL, -- A quien visitan
    user_id UNIQUEIDENTIFIER NULL, -- Guardia que registra

    access_method NVARCHAR(20) DEFAULT 'PEDESTRIAN', -- "PEDESTRIAN", "VEHICLE"
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

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_VisitorLogs_Tenant_Date' AND object_id = OBJECT_ID('VisitorLogs'))
CREATE INDEX IX_VisitorLogs_Tenant_Date ON VisitorLogs(tenant_id, entry_time);

-- =============================================
-- TABLA: WhatsAppConfig (Configuración por Tenant)
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[WhatsAppConfig]') AND type in (N'U'))
CREATE TABLE WhatsAppConfig (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL UNIQUE,
    session_data NVARCHAR(MAX), 
    is_connected BIT DEFAULT 0,
    last_qr NVARCHAR(MAX), 
    updated_at DATETIME2 DEFAULT SYSDATETIME(),

    CONSTRAINT FK_WhatsAppConfig_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id)
);
