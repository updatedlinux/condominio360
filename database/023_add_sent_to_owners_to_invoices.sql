-- Agregar campo sent_to_owners a BillingInvoices
IF NOT EXISTS (SELECT * FROM sys.columns 
               WHERE Name = 'sent_to_owners' 
               AND Object_ID = Object_ID(N'BillingInvoices'))
BEGIN
    ALTER TABLE BillingInvoices
    ADD sent_to_owners BIT DEFAULT 0,
        sent_at DATETIME2;
    
    PRINT 'Columnas sent_to_owners y sent_at agregadas a BillingInvoices';
END
ELSE
BEGIN
    PRINT 'Las columnas ya existen';
END
GO
