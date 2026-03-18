const Migration = require('./Migration');
const { sql } = require('../config/database');

/**
 * Migración: Cambiar sistema de votos de usuarios a inmuebles
 * 1 voto = 1 inmueble (no por propietario)
 */
class UpdateConsultationVotesToProperty extends Migration {
    async up() {
        // 1. Agregar columna property_id a ConsultationVotes
        const hasPropertyId = await this.columnExists('ConsultationVotes', 'property_id');
        if (!hasPropertyId) {
            await this.query(`
                ALTER TABLE ConsultationVotes 
                ADD property_id UNIQUEIDENTIFIER NULL
            `);
            console.log('   ✅ Columna property_id agregada');
        }

        // 2. Crear constraint FK
        try {
            await this.query(`
                ALTER TABLE ConsultationVotes 
                ADD CONSTRAINT FK_ConsultationVotes_Properties 
                FOREIGN KEY (property_id) REFERENCES Properties(id)
            `);
            console.log('   ✅ FK constraint creada');
        } catch (e) {
            console.log('   ⚠️ FK constraint ya existe o error:', e.message);
        }

        // 3. Actualizar constraint unique para ser por property_id en lugar de user_id
        // Primero eliminar el constraint viejo si existe
        try {
            await this.query(`
                ALTER TABLE ConsultationVotes 
                DROP CONSTRAINT UQ_ConsultationVotes_User_Question
            `);
            console.log('   ✅ Constraint único viejo eliminado');
        } catch (e) {
            console.log('   ⚠️ Constraint viejo no existe o ya fue eliminado');
        }

        // 4. Crear nuevo constraint único por property_id
        try {
            await this.query(`
                ALTER TABLE ConsultationVotes 
                ADD CONSTRAINT UQ_ConsultationVotes_Property_Question 
                UNIQUE (tenant_id, consultation_id, question_id, property_id)
            `);
            console.log('   ✅ Constraint único nuevo creado (por inmueble)');
        } catch (e) {
            console.log('   ⚠️ Constraint nuevo ya existe:', e.message);
        }

        // 5. Agregar columna de notificación enviada a Consultations
        const hasNotified = await this.columnExists('Consultations', 'activation_notified');
        if (!hasNotified) {
            await this.query(`
                ALTER TABLE Consultations 
                ADD activation_notified BIT DEFAULT 0
            `);
            console.log('   ✅ Columna activation_notified agregada');
        }

        // 6. Agregar índice para property_id
        try {
            await this.query(`
                CREATE INDEX IX_ConsultationVotes_Property 
                ON ConsultationVotes(property_id, consultation_id)
            `);
            console.log('   ✅ Índice en property_id creado');
        } catch (e) {
            console.log('   ⚠️ Índice ya existe');
        }

        console.log('   ✅ Migración completada: Votos ahora son por inmueble');
    }

    async down() {
        // Revertir cambios
        try {
            await this.query(`
                ALTER TABLE ConsultationVotes 
                DROP CONSTRAINT UQ_ConsultationVotes_Property_Question
            `);
        } catch (e) {}

        try {
            await this.query(`
                ALTER TABLE ConsultationVotes 
                ADD CONSTRAINT UQ_ConsultationVotes_User_Question 
                UNIQUE (tenant_id, consultation_id, question_id, user_id)
            `);
        } catch (e) {}

        const hasPropertyId = await this.columnExists('ConsultationVotes', 'property_id');
        if (hasPropertyId) {
            await this.query(`ALTER TABLE ConsultationVotes DROP COLUMN property_id`);
        }

        const hasNotified = await this.columnExists('Consultations', 'activation_notified');
        if (hasNotified) {
            await this.query(`ALTER TABLE Consultations DROP COLUMN activation_notified`);
        }

        console.log('   ✅ Rollback completado');
    }
}

module.exports = UpdateConsultationVotesToProperty;
