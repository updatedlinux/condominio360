-- Script para eliminar un preliminar en estado FINALIZED
-- Solo usar en casos especiales como este

-- Primero, buscar el ID del preliminar a eliminar
-- Reemplazar 'Marzo 2026' con el nombre exacto si es diferente

DECLARE @preliminary_id UNIQUEIDENTIFIER;
DECLARE @tenant_id UNIQUEIDENTIFIER = 'AB1449E4-AB72-489C-974C-70E94DA215BF'; -- Tenant del usuario

-- Buscar el preliminar por nombre y tenant
SELECT @preliminary_id = id 
FROM BillingPreliminaries 
WHERE tenant_id = @tenant_id 
AND name LIKE '%Marzo 2026%'
AND status = 'FINALIZED';

-- Verificar que se encontró
IF @preliminary_id IS NULL
BEGIN
    PRINT 'No se encontro el preliminar Marzo 2026 en estado FINALIZED';
    SELECT id, name, status, total_amount_usd, total_amount_ves 
    FROM BillingPreliminaries 
    WHERE tenant_id = @tenant_id
    AND name LIKE '%Marzo%';
END
ELSE
BEGIN
    PRINT 'Preliminar encontrado: ' + CAST(@preliminary_id AS VARCHAR(36));
    
    -- Eliminar items del preliminar
    DELETE FROM BillingPreliminaryItems WHERE preliminary_id = @preliminary_id;
    PRINT 'Items eliminados';
    
    -- Eliminar recibos asociados (si existen)
    DELETE FROM BillingInvoiceItems 
    WHERE invoice_id IN (SELECT id FROM BillingInvoices WHERE preliminary_id = @preliminary_id);
    
    DELETE FROM BillingInvoices WHERE preliminary_id = @preliminary_id;
    PRINT 'Recibos asociados eliminados';
    
    -- Eliminar el preliminar
    DELETE FROM BillingPreliminaries WHERE id = @preliminary_id;
    PRINT 'Preliminar eliminado exitosamente';
END
