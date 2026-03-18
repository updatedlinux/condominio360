-- =============================================
-- Migration: Create Communiques table
-- =============================================

-- Tabla principal de comunicados
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Communiques')
BEGIN
    CREATE TABLE Communiques (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        tenant_id UNIQUEIDENTIFIER NOT NULL,
        created_by UNIQUEIDENTIFIER NOT NULL,
        title NVARCHAR(500) NOT NULL,
        description NVARCHAR(MAX) NULL,
        original_filename NVARCHAR(500) NOT NULL,
        file_type VARCHAR(10) NOT NULL CHECK (file_type IN ('docx', 'pdf')),
        html_content NVARCHAR(MAX) NULL,  -- Contenido HTML generado del Word
        storage_path NVARCHAR(1000) NULL,  -- Ruta donde se guarda el archivo
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
        published_at DATETIME2 NULL,
        created_at DATETIME2 DEFAULT SYSDATETIME(),
        updated_at DATETIME2 DEFAULT SYSDATETIME(),
        CONSTRAINT FK_Communique_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
        CONSTRAINT FK_Communique_User FOREIGN KEY (created_by) REFERENCES Users(id)
    );

    CREATE INDEX idx_communiques_tenant ON Communiques(tenant_id);
    CREATE INDEX idx_communiques_status ON Communiques(status);
    CREATE INDEX idx_communiques_created ON Communiques(created_at DESC);
    CREATE INDEX idx_communiques_published ON Communiques(published_at DESC);
    
    PRINT 'Communiques table created successfully';
END
ELSE
BEGIN
    PRINT 'Communiques table already exists';
END
GO

-- Tabla de notificaciones enviadas
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CommuniqueNotifications')
BEGIN
    CREATE TABLE CommuniqueNotifications (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        communique_id UNIQUEIDENTIFIER NOT NULL,
        user_id UNIQUEIDENTIFIER NOT NULL,
        email NVARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'sent', 'error', 'read')),
        message NVARCHAR(MAX) NULL,
        sent_at DATETIME2 NULL,
        read_at DATETIME2 NULL,
        created_at DATETIME2 DEFAULT SYSDATETIME(),
        CONSTRAINT FK_Notification_Communique FOREIGN KEY (communique_id) REFERENCES Communiques(id) ON DELETE CASCADE,
        CONSTRAINT FK_Notification_User FOREIGN KEY (user_id) REFERENCES Users(id)
    );

    CREATE INDEX idx_notifications_communique ON CommuniqueNotifications(communique_id);
    CREATE INDEX idx_notifications_user ON CommuniqueNotifications(user_id);
    CREATE INDEX idx_notifications_status ON CommuniqueNotifications(status);
    CREATE INDEX idx_notifications_sent ON CommuniqueNotifications(sent_at);
    
    PRINT 'CommuniqueNotifications table created successfully';
END
ELSE
BEGIN
    PRINT 'CommuniqueNotifications table already exists';
END
GO

-- Tabla para cola de envío de correos (por lotes)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CommuniqueEmailQueue')
BEGIN
    CREATE TABLE CommuniqueEmailQueue (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        communique_id UNIQUEIDENTIFIER NOT NULL,
        batch_number INT NOT NULL DEFAULT 1,
        total_batches INT NOT NULL DEFAULT 1,
        recipients_count INT NOT NULL DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        processed_at DATETIME2 NULL,
        error_message NVARCHAR(MAX) NULL,
        created_at DATETIME2 DEFAULT SYSDATETIME(),
        CONSTRAINT FK_Queue_Communique FOREIGN KEY (communique_id) REFERENCES Communiques(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_queue_status ON CommuniqueEmailQueue(status);
    CREATE INDEX idx_queue_communique ON CommuniqueEmailQueue(communique_id);
    CREATE INDEX idx_queue_created ON CommuniqueEmailQueue(created_at);
    
    PRINT 'CommuniqueEmailQueue table created successfully';
END
ELSE
BEGIN
    PRINT 'CommuniqueEmailQueue table already exists';
END
GO

-- Tabla de tracking de lectura por propietario
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CommuniqueReads')
BEGIN
    CREATE TABLE CommuniqueReads (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        communique_id UNIQUEIDENTIFIER NOT NULL,
        user_id UNIQUEIDENTIFIER NOT NULL,
        read_at DATETIME2 DEFAULT SYSDATETIME(),
        ip_address VARCHAR(50) NULL,
        user_agent NVARCHAR(500) NULL,
        CONSTRAINT FK_Read_Communique FOREIGN KEY (communique_id) REFERENCES Communiques(id) ON DELETE CASCADE,
        CONSTRAINT FK_Read_User FOREIGN KEY (user_id) REFERENCES Users(id),
        CONSTRAINT UQ_CommuniqueRead UNIQUE (communique_id, user_id)
    );

    CREATE INDEX idx_reads_communique ON CommuniqueReads(communique_id);
    CREATE INDEX idx_reads_user ON CommuniqueReads(user_id);
    
    PRINT 'CommuniqueReads table created successfully';
END
ELSE
BEGIN
    PRINT 'CommuniqueReads table already exists';
END
GO

-- Trigger para actualizar updated_at
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'Communiques')
AND NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_Communique_updated_at')
BEGIN
    EXEC('
    CREATE TRIGGER tr_Communique_updated_at
    ON Communiques
    AFTER UPDATE
    AS
    BEGIN
        UPDATE Communiques
        SET updated_at = SYSDATETIME()
        FROM Communiques c
        INNER JOIN inserted i ON c.id = i.id;
    END
    ');
    PRINT 'Trigger tr_Communique_updated_at created';
END
GO
