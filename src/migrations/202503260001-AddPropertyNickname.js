const Migration = require('./Migration');

/**
 * Migración: Agregar nickname a Properties para login alternativo
 * nickname: identificador único global (usuario y clave = mismo valor)
 * nickname_active: se desactiva cuando todos los propietarios actualizan datos
 */
class AddPropertyNickname extends Migration {
    async up() {
        const nicknameExists = await this.columnExists('Properties', 'nickname');
        if (!nicknameExists) {
            await this.query(`
                ALTER TABLE Properties 
                ADD nickname NVARCHAR(100) NULL
            `);
            await this.query(`
                CREATE UNIQUE INDEX IX_Properties_Nickname 
                ON Properties(nickname) 
                WHERE nickname IS NOT NULL
            `);
            console.log('   ✅ Columna nickname agregada a Properties');
        }

        const hashExists = await this.columnExists('Properties', 'nickname_password_hash');
        if (!hashExists) {
            await this.query(`
                ALTER TABLE Properties 
                ADD nickname_password_hash NVARCHAR(255) NULL
            `);
            console.log('   ✅ Columna nickname_password_hash agregada a Properties');
        }

        const activeExists = await this.columnExists('Properties', 'nickname_active');
        if (!activeExists) {
            await this.query(`
                ALTER TABLE Properties 
                ADD nickname_active BIT DEFAULT 1
            `);
            console.log('   ✅ Columna nickname_active agregada a Properties');
        }
    }

    async down() {
        if (await this.columnExists('Properties', 'nickname')) {
            if (await this.indexExists('Properties', 'IX_Properties_Nickname')) {
                await this.query(`DROP INDEX IX_Properties_Nickname ON Properties`);
            }
            await this.query(`ALTER TABLE Properties DROP COLUMN nickname`);
            console.log('   ✅ Columna nickname eliminada');
        }
        if (await this.columnExists('Properties', 'nickname_password_hash')) {
            await this.query(`ALTER TABLE Properties DROP COLUMN nickname_password_hash`);
            console.log('   ✅ Columna nickname_password_hash eliminada');
        }
        if (await this.columnExists('Properties', 'nickname_active')) {
            await this.query(`ALTER TABLE Properties DROP COLUMN nickname_active`);
            console.log('   ✅ Columna nickname_active eliminada');
        }
    }
}

module.exports = AddPropertyNickname;
