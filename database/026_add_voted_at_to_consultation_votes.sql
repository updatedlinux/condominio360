-- Verificar qué columnas existen actualmente en ConsultationVotes
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'ConsultationVotes'
ORDER BY ORDINAL_POSITION;
GO

-- Si NO existe voted_at NI created_at, agregar voted_at
IF NOT EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE Name = 'voted_at' 
    AND Object_ID = Object_ID(N'ConsultationVotes')
) AND NOT EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE Name = 'created_at' 
    AND Object_ID = Object_ID(N'ConsultationVotes')
)
BEGIN
    ALTER TABLE ConsultationVotes ADD voted_at DATETIME2 DEFAULT SYSDATETIME();
    PRINT 'Columna voted_at agregada a ConsultationVotes';
END
GO

-- Si existe created_at pero NO voted_at, agregar voted_at como computed o renombrar
IF EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE Name = 'created_at' 
    AND Object_ID = Object_ID(N'ConsultationVotes')
) AND NOT EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE Name = 'voted_at' 
    AND Object_ID = Object_ID(N'ConsultationVotes')
)
BEGIN
    ALTER TABLE ConsultationVotes ADD voted_at DATETIME2;
    EXEC('UPDATE ConsultationVotes SET voted_at = created_at');
    ALTER TABLE ConsultationVotes ALTER COLUMN voted_at DATETIME2 NOT NULL;
    PRINT 'Columna voted_at agregada y poblada desde created_at';
END
GO

-- Verificar estructura final
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'ConsultationVotes'
ORDER BY ORDINAL_POSITION;
GO
