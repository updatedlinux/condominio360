const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Crear tablas para Sistema de Consultas/Votaciones
 * - Consultations: Consultas de la junta
 * - ConsultationQuestions: Preguntas dentro de una consulta
 * - ConsultationOptions: Opciones de respuesta
 * - ConsultationVotes: Votos registrados
 */
class CreateConsultations extends Migration {
    async up() {
        const tables = ['ConsultationVotes', 'ConsultationOptions', 'ConsultationQuestions', 'Consultations'];
        
        for (const table of tables) {
            if (await this.tableExists(table)) {
                console.log(`   ⚠️ Tabla ${table} ya existe, omitiendo...`);
                return;
            }
        }

        // 1. Tabla Consultations
        await this.query(`
            CREATE TABLE Consultations (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                created_by UNIQUEIDENTIFIER NOT NULL,
                title NVARCHAR(200) NOT NULL,
                description NVARCHAR(MAX) NULL,
                start_date DATETIME2 NOT NULL,
                end_date DATETIME2 NOT NULL,
                target_building NVARCHAR(100) NULL, -- NULL = todas las torres
                status NVARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'DRAFT')),
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_Consultations_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_Consultations_Users FOREIGN KEY (created_by) 
                    REFERENCES Users(id)
            )
        `);

        // 2. Tabla ConsultationQuestions
        await this.query(`
            CREATE TABLE ConsultationQuestions (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                consultation_id UNIQUEIDENTIFIER NOT NULL,
                text NVARCHAR(500) NOT NULL,
                order_index INT DEFAULT 0,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_ConsultationQuestions_Consultations FOREIGN KEY (consultation_id) 
                    REFERENCES Consultations(id) ON DELETE CASCADE
            )
        `);

        // 3. Tabla ConsultationOptions
        await this.query(`
            CREATE TABLE ConsultationOptions (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                question_id UNIQUEIDENTIFIER NOT NULL,
                text NVARCHAR(200) NOT NULL,
                order_index INT DEFAULT 0,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_ConsultationOptions_Questions FOREIGN KEY (question_id) 
                    REFERENCES ConsultationQuestions(id) ON DELETE CASCADE
            )
        `);

        // 4. Tabla ConsultationVotes (1 voto por propietario por consulta)
        await this.query(`
            CREATE TABLE ConsultationVotes (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                consultation_id UNIQUEIDENTIFIER NOT NULL,
                question_id UNIQUEIDENTIFIER NOT NULL,
                option_id UNIQUEIDENTIFIER NOT NULL,
                user_id UNIQUEIDENTIFIER NOT NULL,
                voted_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT UQ_ConsultationVotes_User_Question UNIQUE (tenant_id, consultation_id, question_id, user_id),
                CONSTRAINT FK_ConsultationVotes_Tenants FOREIGN KEY (tenant_id) 
                    REFERENCES Tenants(id),
                CONSTRAINT FK_ConsultationVotes_Consultations FOREIGN KEY (consultation_id) 
                    REFERENCES Consultations(id),
                CONSTRAINT FK_ConsultationVotes_Questions FOREIGN KEY (question_id) 
                    REFERENCES ConsultationQuestions(id),
                CONSTRAINT FK_ConsultationVotes_Options FOREIGN KEY (option_id) 
                    REFERENCES ConsultationOptions(id),
                CONSTRAINT FK_ConsultationVotes_Users FOREIGN KEY (user_id) 
                    REFERENCES Users(id)
            )
        `);

        // Índices
        await this.query(`
            CREATE INDEX IX_Consultations_Tenant_Status ON Consultations(tenant_id, status, end_date)
        `);

        await this.query(`
            CREATE INDEX IX_Consultations_Target_Building ON Consultations(target_building) 
            WHERE target_building IS NOT NULL
        `);

        await this.query(`
            CREATE INDEX IX_ConsultationVotes_Consultation ON ConsultationVotes(consultation_id)
        `);

        await this.query(`
            CREATE INDEX IX_ConsultationVotes_User ON ConsultationVotes(user_id, consultation_id)
        `);

        console.log('   ✅ Tablas de Consultations creadas exitosamente');
    }

    async down() {
        const tables = ['ConsultationVotes', 'ConsultationOptions', 'ConsultationQuestions', 'Consultations'];
        
        for (const table of tables) {
            if (await this.tableExists(table)) {
                await this.query(`DROP TABLE IF EXISTS ${table}`);
                console.log(`   ✅ Tabla ${table} eliminada`);
            }
        }
    }
}

module.exports = CreateConsultations;
