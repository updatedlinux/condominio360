-- Script para eliminar el preliminar específico
-- ID: 4D175D4D-363F-4280-84F6-E3797CC7E654

DECLARE @preliminary_id UNIQUEIDENTIFIER = '4D175D4D-363F-4280-84F6-E3797CC7E654';
DECLARE @tenant_id UNIQUEIDENTIFIER = 'AB1449E4-AB72-489C-974C-70E94DA215BF';

-- Verificar que existe
IF NOT EXISTS (SELECT 1 FROM BillingPreliminaries WHERE id = @preliminary_id AND tenant_id = @tenant_id)
BEGIN
    PRINT 'ERROR: Preliminar no encontrado';
    SELECT id, name, status FROM BillingPreliminaries WHERE id = @preliminary_id;
END
ELSE
BEGIN
    PRINT 'Preliminar encontrado, procediendo a eliminar...';
    
    -- Mostrar info antes de eliminar
    SELECT name, status, total_amount_usd, total_amount_ves, 
           billing_month, billing_year, exchange_rate_usd
    FROM BillingPreliminaries 
    WHERE id = @preliminary_id;
    
    -- Eliminar items del preliminar
    DELETE FROM BillingPreliminaryItems WHERE preliminary_id = @preliminary_id;
    PRINT '✓ Items del preliminar eliminados';
    
    -- Eliminar items de recibos asociados
    DELETE FROM BillingInvoiceItems 
    WHERE invoice_id IN (SELECT id FROM BillingInvoices WHERE preliminary_id = @preliminary_id);
    PRINT '✓ Items de recibos eliminados';
    
    -- Eliminar recibos asociados
    DELETE FROM BillingInvoices WHERE preliminary_id = @preliminary_id;
    PRINT '✓ Recibos asociados eliminados';
    
    -- Eliminar el preliminar
    DELETE FROM BillingPreliminaries WHERE id = @preliminary_id AND tenant_id = @tenant_id;
    PRINT '✓ Preliminar eliminado exitosamente';
END
