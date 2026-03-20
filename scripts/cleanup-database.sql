-- =============================================================================
-- Script de limpieza total de la base de datos - Condominio360
-- =============================================================================
-- Elimina TODOS los datos excepto el SuperAdmin (Users con is_superadmin = 1)
-- Ejecutar en SSMS conectado a la base de datos del proyecto
--
-- Uso: Abrir en SSMS, seleccionar la base de datos correcta, ejecutar (F5)
-- =============================================================================

BEGIN TRANSACTION;

BEGIN TRY
    -- 1. Tablas hijas primero (respeta FKs)
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CommunicationRecipients') DELETE FROM CommunicationRecipients;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Communications') DELETE FROM Communications;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ConsultationVotes') DELETE FROM ConsultationVotes;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ConsultationOptions') DELETE FROM ConsultationOptions;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ConsultationQuestions') DELETE FROM ConsultationQuestions;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Consultations') DELETE FROM Consultations;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RequestAttachments') DELETE FROM RequestAttachments;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Requests') DELETE FROM Requests;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CommonAreaReservations') DELETE FROM CommonAreaReservations;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CommonAreas') DELETE FROM CommonAreas;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CommuniqueReads') DELETE FROM CommuniqueReads;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CommuniqueEmailQueue') DELETE FROM CommuniqueEmailQueue;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CommuniqueNotifications') DELETE FROM CommuniqueNotifications;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Communiques') DELETE FROM Communiques;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'NFC_AccessLogs') DELETE FROM NFC_AccessLogs;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'NFC_Cards') DELETE FROM NFC_Cards;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BillingPaymentReports') DELETE FROM BillingPaymentReports;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BillingInvoiceItems') DELETE FROM BillingInvoiceItems;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BillingInvoices') DELETE FROM BillingInvoices;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BillingPreliminaryItems') DELETE FROM BillingPreliminaryItems;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BillingPreliminaries') DELETE FROM BillingPreliminaries;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BillingExtraordinaryTemplates') DELETE FROM BillingExtraordinaryTemplates;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'VendorContracts') DELETE FROM VendorContracts;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Vendors') DELETE FROM Vendors;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaaSPaymentReports') DELETE FROM SaaSPaymentReports;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaaSInvoiceItems') DELETE FROM SaaSInvoiceItems;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaaSInvoices') DELETE FROM SaaSInvoices;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'NotificationQueue') DELETE FROM NotificationQueue;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'InAppNotifications') DELETE FROM InAppNotifications;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DeliveryAnnouncements') DELETE FROM DeliveryAnnouncements;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'VisitorDeliveries') DELETE FROM VisitorDeliveries;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'VisitorLogs') DELETE FROM VisitorLogs;    -- Antes de VisitorPasses (FK pass_id)
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'VisitorPasses') DELETE FROM VisitorPasses;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Visitors') DELETE FROM Visitors;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PropertyOwners') DELETE FROM PropertyOwners;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TenantUsers') DELETE FROM TenantUsers;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TenantAdmins') DELETE FROM TenantAdmins;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SecurityUsers') DELETE FROM SecurityUsers;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TenantMoveConfig') DELETE FROM TenantMoveConfig;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RequestTypes') DELETE FROM RequestTypes;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AuditLogs') DELETE FROM AuditLogs;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DataUpdateRequests') DELETE FROM DataUpdateRequests;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ExchangeRates') DELETE FROM ExchangeRates;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PasswordResets') DELETE FROM PasswordResets;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Properties') DELETE FROM Properties;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Buildings') DELETE FROM Buildings;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WhatsAppConfig') DELETE FROM WhatsAppConfig;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Tenants') DELETE FROM Tenants;
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserEmails') DELETE FROM UserEmails;

    -- 2. Usuarios (excepto SuperAdmin)
    DELETE FROM Users WHERE ISNULL(is_superadmin, 0) = 0;

    PRINT 'Limpieza completada. Solo SuperAdmin(es) preservado(s).';
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    PRINT 'Error: ' + ERROR_MESSAGE();
    ROLLBACK TRANSACTION;
    THROW;
END CATCH;
