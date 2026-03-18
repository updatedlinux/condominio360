const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Sistema de Edificios para segmentación de conjuntos
 * - Buildings: Edificios/Torres del conjunto
 * - Actualiza Properties para relacionarse con Buildings
 * - Tenant.building_type: 'SINGLE' | 'MULTIPLE'
 */
class CreateBuildings extends Migration {
    async up() {
        // 1. Agregar campo building_type a Tenants
        if (!await this.columnExists('Tenants', 'building_type')) {
            await this.query(`
                ALTER TABLE Tenants 
                ADD building_type NVARCHAR(20) DEFAULT 'SINGLE' 
                CHECK (building_type IN ('SINGLE', 'MULTIPLE'))
            `);
            console.log('   ✅ Columna building_type agregada a Tenants');
        }

        // 2. Crear tabla Buildings
        if (!await this.tableExists('Buildings')) {
            await this.query(`
                CREATE TABLE Buildings (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    tenant_id UNIQUEIDENTIFIER NOT NULL,
                    name NVARCHAR(100) NOT NULL, -- "Torre A", "Edificio Principal"
                    code NVARCHAR(20), -- Código corto "A", "B", "TPRINCIPAL"
                    floors INT, -- Número de pisos
                    units_per_floor INT, -- Unidades por piso (para referencia)
                    address_suffix NVARCHAR(255), -- Dirección específica del edificio
                    is_active BIT DEFAULT 1,
                    created_at DATETIME2 DEFAULT SYSDATETIME(),
                    updated_at DATETIME2 DEFAULT SYSDATETIME(),
                    CONSTRAINT FK_Buildings_Tenants FOREIGN KEY (tenant_id) 
                        REFERENCES Tenants(id) ON DELETE CASCADE
                )
            `);
            console.log('   ✅ Tabla Buildings creada');
        }

        // 3. Agregar building_id a Properties
        if (!await this.columnExists('Properties', 'building_id')) {
            await this.query(`
                ALTER TABLE Properties 
                ADD building_id UNIQUEIDENTIFIER NULL
            `);
            
            await this.query(`
                ALTER TABLE Properties 
                ADD CONSTRAINT FK_Properties_Buildings 
                FOREIGN KEY (building_id) REFERENCES Buildings(id) ON DELETE SET NULL
            `);
            console.log('   ✅ Columna building_id agregada a Properties');
        }

        // 4. Crear índices
        await this.query(`
            CREATE INDEX IX_Buildings_Tenant ON Buildings(tenant_id, is_active)
        `);

        await this.query(`
            CREATE INDEX IX_Properties_Building ON Properties(building_id) WHERE building_id IS NOT NULL
        `);

        console.log('   ✅ Índices creados');

        // 5. Migración de datos: Convertir valores existentes de building a Buildings
        await this.migrateExistingBuildings();
    }

    async migrateExistingBuildings() {
        try {
            // Obtener tenants con múltiples edificios (basado en valores únicos de building)
            const tenantsResult = await this.query(`
                SELECT DISTINCT tenant_id, building 
                FROM Properties 
                WHERE building IS NOT NULL AND building != ''
            `);

            const tenantBuildings = {};
            tenantsResult.recordset.forEach(row => {
                if (!tenantBuildings[row.tenant_id]) {
                    tenantBuildings[row.tenant_id] = new Set();
                }
                tenantBuildings[row.tenant_id].add(row.building);
            });

            // Crear Buildings y actualizar Properties
            for (const [tenantId, buildings] of Object.entries(tenantBuildings)) {
                const buildingArray = Array.from(buildings);
                
                // Si tiene más de un edificio, marcar como MULTIPLE
                if (buildingArray.length > 1) {
                    await this.query(`
                        UPDATE Tenants SET building_type = 'MULTIPLE' WHERE id = @tenant_id
                    `, { tenant_id: tenantId });
                }

                // Crear cada edificio y actualizar propiedades
                for (const buildingName of buildingArray) {
                    const buildingResult = await this.query(`
                        INSERT INTO Buildings (tenant_id, name, code)
                        OUTPUT INSERTED.id
                        VALUES (@tenant_id, @name, @code)
                    `, { 
                        tenant_id: tenantId, 
                        name: buildingName,
                        code: buildingName.substring(0, 20)
                    });

                    const buildingId = buildingResult.recordset[0].id;

                    // Actualizar propiedades que tengan este building
                    await this.query(`
                        UPDATE Properties 
                        SET building_id = @building_id
                        WHERE tenant_id = @tenant_id AND building = @building_name
                    `, { 
                        building_id: buildingId, 
                        tenant_id: tenantId, 
                        building_name: buildingName 
                    });
                }
            }

            console.log('   ✅ Datos migrados a tabla Buildings');
        } catch (error) {
            console.log('   ⚠️ Error en migración de datos (puede ser normal si no hay datos):', error.message);
        }
    }

    async down() {
        // Remover FK primero
        if (await this.columnExists('Properties', 'building_id')) {
            await this.query(`
                ALTER TABLE Properties DROP CONSTRAINT FK_Properties_Buildings
            `).catch(() => {});
            
            await this.query(`
                ALTER TABLE Properties DROP COLUMN building_id
            `);
            console.log('   ✅ Columna building_id removida');
        }

        if (await this.tableExists('Buildings')) {
            await this.query(`DROP TABLE IF EXISTS Buildings`);
            console.log('   ✅ Tabla Buildings eliminada');
        }

        if (await this.columnExists('Tenants', 'building_type')) {
            await this.query(`
                ALTER TABLE Tenants DROP COLUMN building_type
            `);
            console.log('   ✅ Columna building_type removida');
        }
    }
}

module.exports = CreateBuildings;
