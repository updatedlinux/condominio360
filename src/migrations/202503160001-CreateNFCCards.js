const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tabla NFC_Cards
 * Relación: 1 NFC Card = 1 Inmueble (Property)
 * 1 Inmueble puede tener N NFC Cards
 * El UID se escanea via WebNFC y se valida contra la unidad
 */
class CreateNFCCards extends Migration {
    async up() {
        const tableExists = await this.tableExists('NFC_Cards');
        
        if (tableExists) {
            console.log('   ⚠️ Tabla NFC_Cards ya existe, omitiendo...');
            return;
        }

        await this.query(`
            CREATE TABLE NFC_Cards (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                property_id UNIQUEIDENTIFIER NOT NULL,
                
                -- UID de la tarjeta NFC (escaneado via WebNFC)
                card_uid NVARCHAR(50) NOT NULL,
                
                -- Información de la tarjeta
                card_name NVARCHAR(100) NULL, -- Ej: "Tarjeta Principal", "Tarjeta Familiar"
                description NVARCHAR(255) NULL,
                
                -- Estado
                is_active BIT DEFAULT 1,
                is_blocked BIT DEFAULT 0,
                block_reason NVARCHAR(255) NULL,
                
                -- Fechas
                issued_at DATETIME2 DEFAULT SYSDATETIME(),
                expires_at DATETIME2 NULL, -- NULL = sin expiración
                last_used_at DATETIME2 NULL,
                
                -- Quién registró la tarjeta
                created_by UNIQUEIDENTIFIER NOT NULL,
                created_by_type NVARCHAR(20) DEFAULT 'ADMIN' CHECK (created_by_type IN ('ADMIN', 'OWNER', 'SYSTEM')),
                
                -- Auditoría
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                
                -- Constraints
                CONSTRAINT UQ_NFC_Cards_UID_Tenant UNIQUE (card_uid, tenant_id),
                CONSTRAINT FK_NFC_Cards_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_NFC_Cards_Properties FOREIGN KEY (property_id) 
                    REFERENCES Properties(id) ON DELETE CASCADE
            )
        `);

        // Índices importantes
        await this.query(`
            CREATE INDEX IX_NFC_Cards_Property ON NFC_Cards(property_id) 
            WHERE is_active = 1
        `);

        await this.query(`
            CREATE INDEX IX_NFC_Cards_Tenant_Active ON NFC_Cards(tenant_id, is_active, is_blocked)
            INCLUDE (card_uid, property_id, card_name)
        `);

        await this.query(`
            CREATE INDEX IX_NFC_Cards_UID ON NFC_Cards(card_uid)
        `);

        console.log('   ✅ Tabla NFC_Cards creada exitosamente');
    }

    async down() {
        const tableExists = await this.tableExists('NFC_Cards');
        
        if (!tableExists) {
            console.log('   ⚠️ Tabla NFC_Cards no existe');
            return;
        }

        await this.query('DROP TABLE IF EXISTS NFC_Cards');
        console.log('   ✅ Tabla NFC_Cards eliminada');
    }
}

module.exports = CreateNFCCards;
