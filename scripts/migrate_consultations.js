const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { sql, connectDB } = require('../src/config/database');

async function migrateConsultations() {
    try {
        console.log('🔄 Starting Consultations Migration...');
        const pool = await connectDB();

        // 1. Drop Tables if they exist (Reverse Order)
        console.log('🗑️  Dropping existing Consultation tables...');
        await pool.query(`IF OBJECT_ID('dbo.ConsultationVotes', 'U') IS NOT NULL DROP TABLE dbo.ConsultationVotes;`);
        await pool.query(`IF OBJECT_ID('dbo.ConsultationOptions', 'U') IS NOT NULL DROP TABLE dbo.ConsultationOptions;`);
        await pool.query(`IF OBJECT_ID('dbo.ConsultationQuestions', 'U') IS NOT NULL DROP TABLE dbo.ConsultationQuestions;`);
        await pool.query(`IF OBJECT_ID('dbo.Consultations', 'U') IS NOT NULL DROP TABLE dbo.Consultations;`);

        // 2. Create Consultations Table
        console.log('✨ Creating Consultations table...');
        await pool.query(`
            CREATE TABLE Consultations (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                created_by UNIQUEIDENTIFIER NOT NULL, -- Admin/User who created it
                
                title NVARCHAR(255) NOT NULL,
                description NVARCHAR(MAX),
                
                start_date DATETIME2 NOT NULL,
                end_date DATETIME2 NOT NULL,
                
                status NVARCHAR(20) DEFAULT 'OPEN', -- 'OPEN', 'CLOSED', 'DRAFT'
                
                target_building NVARCHAR(50) NULL, -- 'Torre A', or NULL for ALL
                
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),

                CONSTRAINT FK_Consultations_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                CONSTRAINT FK_Consultations_Users FOREIGN KEY (created_by) REFERENCES Users(id)
            );
        `);

        // 3. Create Questions Table
        console.log('✨ Creating ConsultationQuestions table...');
        await pool.query(`
            CREATE TABLE ConsultationQuestions (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                consultation_id UNIQUEIDENTIFIER NOT NULL,
                
                text NVARCHAR(500) NOT NULL,
                order_index INT DEFAULT 0,
                
                created_at DATETIME2 DEFAULT SYSDATETIME(),

                CONSTRAINT FK_Questions_Consultations FOREIGN KEY (consultation_id) REFERENCES Consultations(id) ON DELETE CASCADE
            );
        `);

        // 4. Create Options Table
        console.log('✨ Creating ConsultationOptions table...');
        await pool.query(`
            CREATE TABLE ConsultationOptions (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                question_id UNIQUEIDENTIFIER NOT NULL,
                
                text NVARCHAR(255) NOT NULL,
                order_index INT DEFAULT 0,
                
                created_at DATETIME2 DEFAULT SYSDATETIME(),

                CONSTRAINT FK_Options_Questions FOREIGN KEY (question_id) REFERENCES ConsultationQuestions(id) ON DELETE CASCADE
            );
        `);

        // 5. Create Votes Table
        console.log('✨ Creating ConsultationVotes table...');
        await pool.query(`
            CREATE TABLE ConsultationVotes (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                consultation_id UNIQUEIDENTIFIER NOT NULL,
                question_id UNIQUEIDENTIFIER NOT NULL,
                option_id UNIQUEIDENTIFIER NOT NULL,
                user_id UNIQUEIDENTIFIER NOT NULL, -- Voter

                created_at DATETIME2 DEFAULT SYSDATETIME(),

                CONSTRAINT FK_Votes_Tenants FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                CONSTRAINT FK_Votes_Consultations FOREIGN KEY (consultation_id) REFERENCES Consultations(id), -- No Cascade Delete to preserve history? Or Cascade? Lets Cascade for now to clean up easier.
                CONSTRAINT FK_Votes_Questions FOREIGN KEY (question_id) REFERENCES ConsultationQuestions(id),
                CONSTRAINT FK_Votes_Options FOREIGN KEY (option_id) REFERENCES ConsultationOptions(id),
                CONSTRAINT FK_Votes_Users FOREIGN KEY (user_id) REFERENCES Users(id),

                CONSTRAINT UQ_Vote_User_Question UNIQUE (user_id, question_id) -- One vote per question per user
            );
        `);
        // Note: constraint FK_Votes_Consultations should arguably be NO ACTION if we want to keep votes of deleted consultations, but deleting a consultation usually means wiping it. CASCADE is fine for this stage.
        // Actually, if we delete a question, votes should go. So cascading from Question down to Votes (via Question relation) or Option relation.
        // I added FK to Consultation, Question, Option. If Question is deleted, Option is deleted (Cascade). 
        // We need ON DELETE CASCADE on Votes FKs to Questions/Options if we want cleanup.

        // Let's refine Votes Foreign Keys for cleanup:
        // We already have ON DELETE CASCADE in Questions -> Consultations
        // And Options -> Questions.
        // So simply adding ON DELETE CASCADE to Votes -> Options (or Questions) would work.
        // However, standard is usually to keep votes if possible? But if the option is gone, the vote is meaningless.

        // I will add ON DELETE CASCADE to Votes -> Consultation (Safety net) and others.
        // Actually, MSSQL multiple cascade paths can cause cycles.
        // Safest is to just have FKs without Cascade for Votes, or select ONE main path.
        // Detailed constraints:
        // Voter -> User (No cascade usually, or cascade if user deleted? User delete is rare/soft.)
        // Vote -> Option (Cascade if option deleted?)

        // For simpler dev workflow, I'll relies on manual cleanup or simple constraints.
        // The script above uses default (NO ACTION) for Votes. That's safer but requires deleting votes before deleting consultations.
        // I'll add ON DELETE CASCADE to FK_Votes_Consultations for ease of dev.

        await pool.query(`
            ALTER TABLE ConsultationVotes DROP CONSTRAINT FK_Votes_Consultations;
            ALTER TABLE ConsultationVotes ADD CONSTRAINT FK_Votes_Consultations FOREIGN KEY (consultation_id) REFERENCES Consultations(id) ON DELETE CASCADE;
        `);


        console.log('✅ Consultations Migration Completed Successfully!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Migration Failed:', error);
        process.exit(1);
    }
}

migrateConsultations();
