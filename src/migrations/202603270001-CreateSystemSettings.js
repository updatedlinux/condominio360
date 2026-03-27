const Migration = require('./Migration');

/**
 * Reservado: la tabla SystemSettings ya se crea en 202503230001 (key-value).
 * La clave API DolarVzla se guarda con setting_key = 'bcv_dolarvzla_api_key' (ver SystemSettingsModel).
 */
class CreateSystemSettings extends Migration {
    async up() {
        console.log('   ℹ️ SystemSettings (key-value): clave BCV vía bcv_dolarvzla_api_key — sin cambios de esquema.');
    }

    async down() {
        // No se elimina SystemSettings (compartida con SaaS)
    }
}

module.exports = CreateSystemSettings;
