require('dotenv').config();
const { connectDB } = require('../src/config/database');

async function fixTables() {
    try {
        console.log('🔧 Verificando y reparando tablas de comunicados...');
        const pool = await connectDB();
        
        // Eliminar tablas si existen (en orden de dependencias)
        console.log('   Eliminando tablas existentes si hay problemas...');
        try {
            await pool.request().query(`DROP TABLE IF EXISTS CommuniqueReads`);
            await pool.request().query(`DROP TABLE IF EXISTS CommuniqueNotifications`);
            await pool.request().query(`DROP TABLE IF EXISTS CommuniqueEmailQueue`);
            await pool.request().query(`DROP TABLE IF EXISTS Communiques`);
            console.log('   ✅ Tablas anteriores eliminadas');
        } catch (e) {
            console.log('   ℹ️ No había tablas que eliminar');
        }
        
        // Crear Communiques
        console.log('   Creando tabla Communiques...');
        await pool.request().query(`
            CREATE TABLE Communiques (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                created_by UNIQUEIDENTIFIER NOT NULL,
                title NVARCHAR(500) NOT NULL,
                description NVARCHAR(MAX) NULL,
                original_filename NVARCHAR(500) NOT NULL,
                file_type VARCHAR(10) NOT NULL CHECK (file_type IN ('docx', 'pdf')),
                html_content NVARCHAR(MAX) NULL,
                storage_path NVARCHAR(1000) NULL,
                status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
                published_at DATETIME2 NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_Communique_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id),
                CONSTRAINT FK_Communique_User FOREIGN KEY (created_by) REFERENCES Users(id)
            )
        `);
        await pool.request().query(`CREATE INDEX idx_communiques_tenant ON Communiques(tenant_id)`);
        await pool.request().query(`CREATE INDEX idx_communiques_status ON Communiques(status)`);
        await pool.request().query(`CREATE INDEX idx_communiques_created ON Communiques(created_at DESC)`);
        console.log('   ✅ Communiques creada');

        // Crear CommuniqueNotifications
        console.log('   Creando tabla CommuniqueNotifications...');
        await pool.request().query(`
            CREATE TABLE CommuniqueNotifications (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                communique_id UNIQUEIDENTIFIER NOT NULL,
                user_id UNIQUEIDENTIFIER NOT NULL,
                email NVARCHAR(255) NOT NULL,
                status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'sent', 'error', 'read')),
                message NVARCHAR(MAX) NULL,
                sent_at DATETIME2 NULL,
                read_at DATETIME2 NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_Notification_Communique FOREIGN KEY (communique_id) REFERENCES Communiques(id) ON DELETE CASCADE,
                CONSTRAINT FK_Notification_User FOREIGN KEY (user_id) REFERENCES Users(id)
            )
        `);
        await pool.request().query(`CREATE INDEX idx_notifications_communique ON CommuniqueNotifications(communique_id)`);
        await pool.request().query(`CREATE INDEX idx_notifications_user ON CommuniqueNotifications(user_id)`);
        console.log('   ✅ CommuniqueNotifications creada');

        // Crear CommuniqueEmailQueue
        console.log('   Creando tabla CommuniqueEmailQueue...');
        await pool.request().query(`
            CREATE TABLE CommuniqueEmailQueue (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                communique_id UNIQUEIDENTIFIER NOT NULL,
                batch_number INT NOT NULL DEFAULT 1,
                total_batches INT NOT NULL DEFAULT 1,
                recipients_count INT NOT NULL DEFAULT 0,
                status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
                processed_at DATETIME2 NULL,
                error_message NVARCHAR(MAX) NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_Queue_Communique FOREIGN KEY (communique_id) REFERENCES Communiques(id) ON DELETE CASCADE
            )
        `);
        await pool.request().query(`CREATE INDEX idx_queue_status ON CommuniqueEmailQueue(status)`);
        await pool.request().query(`CREATE INDEX idx_queue_communique ON CommuniqueEmailQueue(communique_id)`);
        console.log('   ✅ CommuniqueEmailQueue creada');

        // Crear CommuniqueReads
        console.log('   Creando tabla CommuniqueReads...');
        await pool.request().query(`
            CREATE TABLE CommuniqueReads (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                communique_id UNIQUEIDENTIFIER NOT NULL,
                user_id UNIQUEIDENTIFIER NOT NULL,
                read_at DATETIME2 DEFAULT SYSDATETIME(),
                ip_address VARCHAR(50) NULL,
                user_agent NVARCHAR(500) NULL,
                CONSTRAINT FK_Read_Communique FOREIGN KEY (communique_id) REFERENCES Communiques(id) ON DELETE CASCADE,
                CONSTRAINT FK_Read_User FOREIGN KEY (user_id) REFERENCES Users(id),
                CONSTRAINT UQ_CommuniqueRead UNIQUE (communique_id, user_id)
            )
        `);
        await pool.request().query(`CREATE INDEX idx_reads_communique ON CommuniqueReads(communique_id)`);
        await pool.request().query(`CREATE INDEX idx_reads_user ON CommuniqueReads(user_id)`);
        console.log('   ✅ CommuniqueReads creada');

        console.log('\n✅ Todas las tablas reparadas exitosamente!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

fixTables();
