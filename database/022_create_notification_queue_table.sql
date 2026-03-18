-- Create NotificationQueue table for async notifications
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NotificationQueue')
BEGIN
    CREATE TABLE NotificationQueue (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        tenant_id UNIQUEIDENTIFIER NOT NULL,
        user_id UNIQUEIDENTIFIER NULL,  -- NULL for broadcast notifications
        type VARCHAR(50) NOT NULL,      -- INVOICE_READY, PAYMENT_REMINDER, etc.
        title NVARCHAR(255) NOT NULL,
        message NVARCHAR(MAX) NOT NULL,
        data NVARCHAR(MAX) NULL,        -- JSON with additional data
        status VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, SENT, FAILED
        sent_at DATETIME2 NULL,
        error_message NVARCHAR(MAX) NULL,
        created_at DATETIME2 DEFAULT SYSDATETIME(),
        updated_at DATETIME2 DEFAULT SYSDATETIME(),
        CONSTRAINT FK_NotificationQueue_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id) ON DELETE CASCADE,
        CONSTRAINT FK_NotificationQueue_User FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE SET NULL
    );

    -- Index for pending notifications
    CREATE INDEX idx_notification_queue_status ON NotificationQueue(status, created_at);
    
    -- Index for user notifications
    CREATE INDEX idx_notification_queue_user ON NotificationQueue(user_id, status);
    
    -- Index for tenant notifications
    CREATE INDEX idx_notification_queue_tenant ON NotificationQueue(tenant_id, status);
    
    PRINT 'NotificationQueue table created successfully';
END
ELSE
BEGIN
    PRINT 'NotificationQueue table already exists';
END
GO

-- Add updated_at trigger
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'NotificationQueue')
AND NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_NotificationQueue_updated_at')
BEGIN
    EXEC('
    CREATE TRIGGER tr_NotificationQueue_updated_at
    ON NotificationQueue
    AFTER UPDATE
    AS
    BEGIN
        UPDATE NotificationQueue
        SET updated_at = SYSDATETIME()
        FROM NotificationQueue n
        INNER JOIN inserted i ON n.id = i.id
    END
    ');
    PRINT 'Trigger tr_NotificationQueue_updated_at created';
END
GO
