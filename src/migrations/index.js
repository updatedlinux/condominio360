/**
 * Sistema de Migraciones - Condominio360
 * 
 * Este módulo exporta todas las migraciones disponibles.
 * Las migraciones se ejecutan en orden alfabético por nombre de archivo.
 * 
 * Convención de nombres: YYYYMMDDHHMM-DescripcionMigracion.js
 * Ejemplo: 202503130001-CreateTenantAdmins.js
 */

const Migration = require('./Migration');
const MigrationRunner = require('./MigrationRunner');

module.exports = {
    Migration,
    MigrationRunner
};

// Exportar migraciones específicas si se necesitan importar individualmente
// const CreateTenantAdmins = require('./202503130001-CreateTenantAdmins');
// module.exports.CreateTenantAdmins = CreateTenantAdmins;
