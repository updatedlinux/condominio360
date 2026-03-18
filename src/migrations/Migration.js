const { sql, connectDB } = require('../config/database');

/**
 * Clase base para migraciones
 * Todas las migraciones deben extender esta clase
 */
class Migration {
    constructor() {
        this.sql = sql;
        this.connectDB = connectDB;
    }

    /**
     * Ejecuta una query SQL
     * @param {string} query - Query SQL a ejecutar
     * @param {Object} inputs - Objeto con parámetros { nombre: { tipo, valor } }
     */
    async query(queryString, inputs = {}) {
        const pool = await connectDB();
        const request = pool.request();
        
        // Agregar parámetros si existen
        for (const [key, config] of Object.entries(inputs)) {
            request.input(key, config.type, config.value);
        }
        
        return await request.query(queryString);
    }

    /**
     * Verifica si una tabla existe
     * @param {string} tableName - Nombre de la tabla
     */
    async tableExists(tableName) {
        const result = await this.query(`
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = '${tableName}'
        `);
        return result.recordset[0].count > 0;
    }

    /**
     * Verifica si una columna existe en una tabla
     * @param {string} tableName - Nombre de la tabla
     * @param {string} columnName - Nombre de la columna
     */
    async columnExists(tableName, columnName) {
        const result = await this.query(`
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = '${columnName}'
        `);
        return result.recordset[0].count > 0;
    }

    /**
     * Verifica si un índice existe
     * @param {string} tableName - Nombre de la tabla
     * @param {string} indexName - Nombre del índice
     */
    async indexExists(tableName, indexName) {
        const result = await this.query(`
            SELECT COUNT(*) as count 
            FROM sys.indexes 
            WHERE name = '${indexName}' AND object_id = OBJECT_ID('${tableName}')
        `);
        return result.recordset[0].count > 0;
    }

    /**
     * Verifica si una constraint existe
     * @param {string} tableName - Nombre de la tabla
     * @param {string} constraintName - Nombre de la constraint
     */
    async constraintExists(tableName, constraintName) {
        const result = await this.query(`
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
            WHERE TABLE_NAME = '${tableName}' AND CONSTRAINT_NAME = '${constraintName}'
        `);
        return result.recordset[0].count > 0;
    }

    /**
     * Método UP - Debe ser implementado por cada migración
     * Contiene los cambios a aplicar
     */
    async up() {
        throw new Error('Método up() debe ser implementado');
    }

    /**
     * Método DOWN - Opcional
     * Revierte los cambios realizados en up()
     */
    async down() {
        console.log('⚠️ Esta migración no tiene método de rollback');
    }
}

module.exports = Migration;
