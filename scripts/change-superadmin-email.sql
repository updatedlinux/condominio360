/*
  Cambia el correo del usuario superadmin en Users (y UserEmails si aplica).

  Ejecutar en SQL Server Management Studio o:
    sqlcmd -S servidor -d DB_NAME -U user -P pass -i scripts/change-superadmin-email.sql

  Ajusta @old / @new si hace falta.
*/

DECLARE @old NVARCHAR(255) = N'superadmin@condominio360.com';
DECLARE @new NVARCHAR(255) = N'superadm-c360@arsysintela.com';

DECLARE @uid UNIQUEIDENTIFIER;

SELECT @uid = id
FROM Users
WHERE ISNULL(is_superadmin, 0) = 1
  AND LOWER(LTRIM(RTRIM(email))) = LOWER(@old);

IF @uid IS NULL
BEGIN
    RAISERROR(N'No hay superadmin con el correo indicado en @old.', 16, 1);
    RETURN;
END;

IF EXISTS (
    SELECT 1 FROM Users
    WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(@new) AND id <> @uid
)
BEGIN
    RAISERROR(N'El correo nuevo ya está en uso por otro usuario.', 16, 1);
    RETURN;
END;

UPDATE Users
SET email = @new,
    updated_at = SYSDATETIME()
WHERE id = @uid;

IF OBJECT_ID(N'UserEmails', N'U') IS NOT NULL
BEGIN
    UPDATE UserEmails
    SET email = @new
    WHERE user_id = @uid
      AND LOWER(LTRIM(RTRIM(email))) = LOWER(@old);
END;

PRINT N'Correo del superadmin actualizado.';
