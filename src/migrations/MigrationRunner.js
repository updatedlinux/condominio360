const { sql, connectDB } = require('../config/database');
const fs = require('fs');
const path = require('path');

/**
 * Sistema de Migraciones para SQL Server
 * Similar a TypeORM/Laravel migrations
 */
class MigrationRunner {
    constructor() {
        this.migrationsTable = 'migrations';
        this.migrationsDir = __dirname;
    }

    /**
     * Inicializa la tabla de control de migraciones
     */
    async initialize() {
        const pool = await connectDB();
        
        // Verificar si existe la tabla migrations
        const checkResult = await pool.request().query(`
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = '${this.migrationsTable}'
        `);

        if (checkResult.recordset[0].count === 0) {
            console.log('📋 Creando tabla de control de migraciones...');
            await pool.request().query(`
                CREATE TABLE ${this.migrationsTable} (
                    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                    name NVARCHAR(255) NOT NULL UNIQUE,
                    executed_at DATETIME2 DEFAULT SYSDATETIME(),
                    batch INT NOT NULL
                )
            `);
            console.log('✅ Tabla de migraciones creada');
        }
    }

    /**
     * Obtiene todas las migraciones ejecutadas
     */
    async getExecutedMigrations() {
        const pool = await connectDB();
        const result = await pool.request().query(`
            SELECT name FROM ${this.migrationsTable} ORDER BY executed_at ASC
        `);
        return result.recordset.map(r => r.name);
    }

    /**
     * Obtiene el último batch number
     */
    async getLastBatch() {
        const pool = await connectDB();
        const result = await pool.request().query(`
            SELECT MAX(batch) as lastBatch FROM ${this.migrationsTable}
        `);
        return result.recordset[0].lastBatch || 0;
    }

    /**
     * Registra una migración como ejecutada
     */
    async recordMigration(name, batch) {
        const pool = await connectDB();
        await pool.request()
            .input('name', sql.NVarChar, name)
            .input('batch', sql.Int, batch)
            .query(`
                INSERT INTO ${this.migrationsTable} (name, batch) 
                VALUES (@name, @batch)
            `);
    }

    /**
     * Elimina el registro de una migración
     */
    async removeMigration(name) {
        const pool = await connectDB();
        await pool.request()
            .input('name', sql.NVarChar, name)
            .query(`DELETE FROM ${this.migrationsTable} WHERE name = @name`);
    }

    /**
     * Obtiene todos los archivos de migración disponibles
     */
    getMigrationFiles() {
        const excludedFiles = [
            'MigrationRunner.js', 
            'index.js', 
            'Migration.js'
        ];
        const files = fs.readdirSync(this.migrationsDir)
            .filter(f => f.endsWith('.js') && !excludedFiles.includes(f))
            .sort(); // Orden alfabético (timestamp al inicio)
        return files;
    }

    /**
     * Ejecuta todas las migraciones pendientes
     */
    async run() {
        await this.initialize();
        
        const executed = await this.getExecutedMigrations();
        const files = this.getMigrationFiles();
        const pending = files.filter(f => !executed.includes(f));

        if (pending.length === 0) {
            console.log('✅ No hay migraciones pendientes');
            return;
        }

        const batch = await this.getLastBatch() + 1;
        console.log(`\n🚀 Ejecutando ${pending.length} migración(es) (batch: ${batch})...\n`);

        for (const file of pending) {
            try {
                console.log(`⏳ Ejecutando: ${file}`);
                
                // Importar y ejecutar migración
                const MigrationClass = require(path.join(this.migrationsDir, file));
                const migration = new MigrationClass();
                
                await migration.up();
                await this.recordMigration(file, batch);
                
                console.log(`✅ Completada: ${file}\n`);
            } catch (error) {
                console.error(`❌ Error en migración ${file}:`, error.message);
                throw error;
            }
        }

        console.log('🎉 Migraciones completadas exitosamente');
    }

    /**
     * Revierte el último batch de migraciones
     */
    async rollback() {
        await this.initialize();
        
        const lastBatch = await this.getLastBatch();
        
        if (lastBatch === 0) {
            console.log('⚠️ No hay migraciones para revertir');
            return;
        }

        const pool = await connectDB();
        const result = await pool.request()
            .input('batch', sql.Int, lastBatch)
            .query(`SELECT name FROM ${this.migrationsTable} WHERE batch = @batch ORDER BY executed_at DESC`);
        
        const migrations = result.recordset.map(r => r.name);

        console.log(`\n⏪ Revirtiendo ${migrations.length} migración(es) del batch ${lastBatch}...\n`);

        for (const file of migrations) {
            try {
                console.log(`⏳ Revirtiendo: ${file}`);
                
                const MigrationClass = require(path.join(this.migrationsDir, file));
                const migration = new MigrationClass();
                
                if (migration.down) {
                    await migration.down();
                    await this.removeMigration(file);
                    console.log(`✅ Revertida: ${file}\n`);
                } else {
                    console.log(`⚠️ ${file} no tiene método down\n`);
                }
            } catch (error) {
                console.error(`❌ Error al revertir ${file}:`, error.message);
                throw error;
            }
        }

        console.log('🎉 Rollback completado');
    }

    /**
     * Muestra el estado de las migraciones
     */
    async status() {
        await this.initialize();
        
        const executed = await this.getExecutedMigrations();
        const files = this.getMigrationFiles();
        
        console.log('\n📊 ESTADO DE MIGRACIONES\n');
        console.log('========================================');
        
        for (const file of files) {
            const isExecuted = executed.includes(file);
            const icon = isExecuted ? '✅' : '⏳';
            const status = isExecuted ? 'Ejecutada' : 'Pendiente';
            console.log(`${icon} ${file} - ${status}`);
        }
        
        const pending = files.length - executed.length;
        console.log('\n========================================');
        console.log(`Total: ${files.length} | Ejecutadas: ${executed.length} | Pendientes: ${pending}`);
        
        if (pending > 0) {
            console.log('\n⚠️ Hay migraciones pendientes. Ejecuta: npm run migrate');
        }
    }

    /**
     * Ejecuta una migración específica (para desarrollo)
     */
    async runSingle(filename) {
        await this.initialize();
        
        const executed = await this.getExecutedMigrations();
        
        if (executed.includes(filename)) {
            console.log(`⚠️ ${filename} ya fue ejecutada`);
            return;
        }

        const batch = await this.getLastBatch() + 1;
        
        console.log(`⏳ Ejecutando: ${filename}`);
        
        const MigrationClass = require(path.join(this.migrationsDir, filename));
        const migration = new MigrationClass();
        
        await migration.up();
        await this.recordMigration(filename, batch);
        
        console.log(`✅ Completada: ${filename}`);
    }
}

module.exports = MigrationRunner;
