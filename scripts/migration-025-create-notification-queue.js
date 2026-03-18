#!/usr/bin/env node
/**
 * Migración 025: Crear tabla NotificationQueue
 */

require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');

async function migrate() {
    try {
        console.log('🔌 Conectando a la base de datos...');
        const pool = await connectDB();
        
        // Verificar si la tabla existe
        const checkResult = await pool.request()
            .query(`
                SELECT COUNT(*) as count 
                FROM sys.tables 
                WHERE name = 'NotificationQueue'
            `);
        
        if (checkResult.recordset[0].count > 0) {
            console.log('✅ La tabla NotificationQueue ya existe');
            process.exit(0);
        }
        
        console.log('➕ Creando tabla NotificationQueue...');
        
        await pool.request().query(`
            CREATE TABLE NotificationQueue (
                id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                tenant_id UNIQUEIDENTIFIER NOT NULL,
                user_id UNIQUEIDENTIFIER NULL,
                type VARCHAR(50) NOT NULL,
                title NVARCHAR(255) NOT NULL,
                message NVARCHAR(MAX) NOT NULL,
                data NVARCHAR(MAX) NULL,
                status VARCHAR(20) DEFAULT 'PENDING',
                sent_at DATETIME2 NULL,
                error_message NVARCHAR(MAX) NULL,
                created_at DATETIME2 DEFAULT SYSDATETIME(),
                updated_at DATETIME2 DEFAULT SYSDATETIME(),
                CONSTRAINT FK_NotificationQueue_Tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(id) ON DELETE CASCADE,
                CONSTRAINT FK_NotificationQueue_User FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE SET NULL
            )
        `);
        
        console.log('➕ Creando índices...');
        
        await pool.request().query(`
            CREATE INDEX idx_notification_queue_status ON NotificationQueue(status, created_at);
            CREATE INDEX idx_notification_queue_user ON NotificationQueue(user_id, status);
            CREATE INDEX idx_notification_queue_tenant ON NotificationQueue(tenant_id, status);
        `);
        
        console.log('➕ Creando trigger...');
        
        await pool.request().query(`
            CREATE TRIGGER tr_NotificationQueue_updated_at
            ON NotificationQueue
            AFTER UPDATE
            AS
            BEGIN
                UPDATE NotificationQueue
                SET updated_at = SYSDATETIME()
                FROM NotificationQueue n
                INNER JOIN inserted i ON n.id = i.id
            END
        `);
        
        console.log('✅ Tabla NotificationQueue creada exitosamente');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

migrate();
