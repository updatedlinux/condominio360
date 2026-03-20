const UserModel = require('../models/UserModel');
const PropertyModel = require('../models/PropertyModel');
const DataUpdateRequestModel = require('../models/DataUpdateRequestModel');
const EmailService = require('../services/EmailService');
const AdminController = require('./AdminController');

/**
 * Owner Profile Controller
 * Perfil del propietario y solicitudes de actualización de datos
 */
class OwnerProfileController {
    /**
     * GET /api/owner/profile
     * Obtener datos del perfil del propietario
     */
    static async getProfile(req, res) {
        try {
            const userId = req.user.userId;
            const user = await UserModel.findById(userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            const properties = await PropertyModel.getByOwner(userId);
            const tenants = [...new Map(properties.map(p => [p.tenant_id, { id: p.tenant_id, name: p.tenant_name }])).values()];

            res.json({
                success: true,
                profile: {
                    first_name: user.first_name,
                    last_name: user.last_name,
                    dni: user.dni,
                    email: user.email,
                    phone: user.phone
                },
                tenants,
                properties,
                pendingRequest: await DataUpdateRequestModel.getPendingByUser(userId)
            });
        } catch (error) {
            console.error('Get profile error:', error);
            res.status(500).json({ error: 'Error al obtener perfil' });
        }
    }

    /**
     * POST /api/owner/profile/update-request
     * Enviar solicitud de actualización de datos al Super Admin
     */
    static async submitUpdateRequest(req, res) {
        try {
            const userId = req.user.userId;
            const { first_name, last_name, dni, email, phone } = req.body;

            const user = await UserModel.findById(userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            const pending = await DataUpdateRequestModel.getPendingByUser(userId);
            if (pending) {
                return res.status(400).json({ error: 'Ya tienes una solicitud de actualización pendiente. Espera a que sea revisada.' });
            }

            const oldData = {
                first_name: user.first_name,
                last_name: user.last_name,
                dni: user.dni,
                email: user.email,
                phone: user.phone
            };

            const newData = {
                first_name: (first_name || user.first_name || '').trim(),
                last_name: (last_name || user.last_name || '').trim(),
                dni: (dni || user.dni || '').trim(),
                email: (email || user.email || '').trim(),
                phone: (phone || user.phone || '').trim() || null
            };

            if (!newData.first_name || !newData.last_name || !newData.dni || !newData.email) {
                return res.status(400).json({ error: 'Nombre, apellido, cédula y correo son obligatorios' });
            }

            const request = await DataUpdateRequestModel.create(userId, oldData, newData);

            await AdminController.logAudit(req, 'CREATE', 'DATA_UPDATE_REQUEST', request.id,
                `Solicitud de actualización de datos: ${user.first_name} ${user.last_name}`, null);

            const superadmins = await UserModel.findAllSuperAdmins();
            const adminUrl = `${process.env.APP_URL || 'http://localhost:3000'}/admin`;

            try {
                // Enviar al correo NUEVO indicado en la solicitud
                await EmailService.sendDataUpdateRequestToOwner(newData.email, newData.first_name);
                for (const sa of superadmins) {
                    if (sa.email) {
                        await EmailService.sendDataUpdateRequestToSuperAdmin(
                            sa.email,
                            newData.first_name,
                            newData.last_name,
                            newData.email,
                            adminUrl
                        ).catch(e => console.error('Email to superadmin:', e));
                    }
                }
            } catch (emailErr) {
                console.error('Error sending emails:', emailErr);
            }

            res.status(201).json({
                success: true,
                message: 'Solicitud enviada. Serás contactado para ratificar los datos.',
                request: { id: request.id, status: 'PENDING' }
            });
        } catch (error) {
            console.error('Submit update request error:', error);
            res.status(500).json({ error: 'Error al enviar solicitud' });
        }
    }
}

module.exports = OwnerProfileController;
