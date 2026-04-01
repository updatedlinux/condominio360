const EmailService = require('./EmailService');
const TenantModel = require('../models/TenantModel');
const PropertyModel = require('../models/PropertyModel');
const UserModel = require('../models/UserModel');
const BulkOwnerWelcomeBatchModel = require('../models/BulkOwnerWelcomeBatchModel');
const { sql, connectDB } = require('../config/database');

/**
 * Envío diferido y por lotes de correos de bienvenida tras carga masiva CSV.
 * No bloquea el hilo HTTP: se programa con setImmediate.
 */
class OwnerBulkWelcomeEmailService {
    constructor() {
        this.chunkSize = parseInt(process.env.BULK_WELCOME_EMAIL_CHUNK || '30', 10);
        this.delayMs = parseInt(
            process.env.BULK_WELCOME_EMAIL_CHUNK_DELAY_MS || process.env.BULK_WELCOME_EMAIL_DELAY_MS || '30000',
            10
        );
    }

    /**
     * Encola el procesamiento (no await en el controlador).
     */
    queueProcess(batchId) {
        setImmediate(() => {
            this.processBatch(batchId).catch((err) => {
                console.error('[BulkWelcomeEmail] processBatch fatal:', batchId, err);
            });
        });
    }

    async processBatch(batchId) {
        const claimed = await BulkOwnerWelcomeBatchModel.claimForProcessing(batchId);
        if (!claimed) {
            const b = await BulkOwnerWelcomeBatchModel.findById(batchId);
            if (b && b.status === 'COMPLETED') {
                console.log('[BulkWelcomeEmail] Lote ya completado:', batchId);
            }
            return;
        }

        const batch = await BulkOwnerWelcomeBatchModel.findById(batchId);
        if (!batch) {
            return;
        }

        try {
        const tenantId = batch.tenant_id;
        const tenant = await TenantModel.findById(tenantId);
        const tenantName = tenant?.name || 'Condominio';
        const baseUrl = process.env.APP_URL || 'http://localhost:3000';

        let items;
        try {
            items = JSON.parse(batch.items_json || '[]');
        } catch (e) {
            await BulkOwnerWelcomeBatchModel.setFailed(batchId, 'JSON inválido en lote');
            return;
        }

        const errors = [];

        for (let i = 0; i < items.length; i += this.chunkSize) {
            const chunk = items.slice(i, i + this.chunkSize);
            for (const item of chunk) {
                try {
                    await this.sendOne({
                        tenantId,
                        tenantName,
                        baseUrl,
                        userId: item.userId,
                        propertyId: item.propertyId || null,
                        isNewUser: !!item.isNewUser
                    });
                } catch (err) {
                    console.error('[BulkWelcomeEmail] Error enviando:', item, err.message);
                    errors.push(`${item.userId}: ${err.message}`);
                }
            }
            if (i + this.chunkSize < items.length && this.delayMs > 0) {
                await new Promise((r) => setTimeout(r, this.delayMs));
            }
        }

        if (errors.length > 0) {
            await BulkOwnerWelcomeBatchModel.setCompletedWithNotes(
                batchId,
                errors.slice(0, 80).join('\n')
            );
        } else {
            await BulkOwnerWelcomeBatchModel.setCompleted(batchId);
        }
        } catch (fatal) {
            console.error('[BulkWelcomeEmail] Error fatal en lote:', batchId, fatal);
            await BulkOwnerWelcomeBatchModel.setFailed(batchId, fatal.message || String(fatal));
        }
    }

    async sendOne({ tenantId, tenantName, baseUrl, userId, propertyId, isNewUser }) {
        const pool = await connectDB();
        const tu = await pool.request()
            .input('user_id', sql.UniqueIdentifier, userId)
            .input('tenant_id', sql.UniqueIdentifier, tenantId)
            .query(`
                SELECT 1 AS ok FROM TenantUsers
                WHERE user_id = @user_id AND tenant_id = @tenant_id AND role = 'OWNER' AND status = 'ACTIVE'
            `);
        if (!tu.recordset.length) {
            throw new Error('Usuario no es propietario activo de este condominio');
        }

        const user = await UserModel.findById(userId);
        if (!user) {
            throw new Error('Usuario no encontrado');
        }

        const email = (user.email || '').trim();
        if (!email) {
            throw new Error('Sin email en cuenta');
        }

        let propertyLabel = null;
        if (propertyId) {
            const prop = await PropertyModel.findById(propertyId);
            if (prop && prop.tenant_id === tenantId) {
                propertyLabel = prop.building_name ? `${prop.building_name}, ${prop.name}` : prop.name;
            }
        }

        const firstName = user.first_name || 'Propietario';

        if (isNewUser && user.invitation_token && user.registration_status === 'INVITED') {
            const invitationLink = `${baseUrl.replace(/\/$/, '')}/auth/complete-registration?token=${user.invitation_token}`;
            await EmailService.sendOwnerInvitation(email, firstName, tenantName, invitationLink, propertyLabel);
        } else {
            const loginUrl = `${baseUrl.replace(/\/$/, '')}/login`;
            await EmailService.sendOwnerAddedToCondominio(email, firstName, tenantName, propertyLabel, loginUrl);
        }
    }
}

module.exports = new OwnerBulkWelcomeEmailService();
