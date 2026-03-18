-- =============================================
-- Migration: Create ExchangeRates table for BCV rates
-- =============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ExchangeRates')
BEGIN
    CREATE TABLE ExchangeRates (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        rate_date DATE NOT NULL UNIQUE,
        usd_rate DECIMAL(12,4) NOT NULL,
        eur_rate DECIMAL(12,4) NOT NULL,
        change_percentage_usd DECIMAL(5,2) NULL,
        change_percentage_eur DECIMAL(5,2) NULL,
        source VARCHAR(50) DEFAULT 'BCV_API',
        created_at DATETIME2 DEFAULT SYSDATETIME(),
        updated_at DATETIME2 DEFAULT SYSDATETIME()
    );

    -- Index for date lookups
    CREATE INDEX idx_exchange_rates_date ON ExchangeRates(rate_date DESC);
    
    PRINT 'ExchangeRates table created successfully';
END
ELSE
BEGIN
    PRINT 'ExchangeRates table already exists';
END
GO

-- Add updated_at trigger
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'ExchangeRates')
AND NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_ExchangeRates_updated_at')
BEGIN
    EXEC('
    CREATE TRIGGER tr_ExchangeRates_updated_at
    ON ExchangeRates
    AFTER UPDATE
    AS
    BEGIN
        UPDATE ExchangeRates
        SET updated_at = SYSDATETIME()
        FROM ExchangeRates er
        INNER JOIN inserted i ON er.id = i.id;
    END
    ');
    PRINT 'Trigger tr_ExchangeRates_updated_at created';
END
GO
