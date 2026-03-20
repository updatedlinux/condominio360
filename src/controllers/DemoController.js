/**
 * Controlador para solicitudes de demo desde el landing
 * POST /api/demo-request - Envía acuse de recibo al solicitante y notifica a superadmins
 */
const EmailService = require('../services/EmailService');
const UserModel = require('../models/UserModel');

class DemoController {
    /**
     * POST /api/demo-request
     * Body: { email: string }
     */
    static async requestDemo(req, res) {
        try {
            const { email } = req.body;
            const emailTrim = (email || '').trim().toLowerCase();

            if (!emailTrim) {
                return res.status(400).json({ success: false, error: 'El correo es obligatorio' });
            }

            // Validación básica de email
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(emailTrim)) {
                return res.status(400).json({ success: false, error: 'Correo electrónico inválido' });
            }

            // 1. Enviar acuse de recibo al solicitante (Arsys Intela branding)
            await EmailService.sendDemoAcknowledgement(emailTrim).catch((err) => {
                console.error('Error enviando acuse demo a solicitante:', err);
                // No fallar - el superadmin puede contactar igual
            });

            // 2. Notificar a superadmins (Arsys Intela branding)
            const superadmins = await UserModel.findAllSuperAdmins();
            for (const sa of superadmins) {
                if (sa.email && sa.email.trim()) {
                    await EmailService.sendDemoRequestToSuperAdmins(sa.email, emailTrim).catch((err) => {
                        console.error(`Error notificando demo a superadmin ${sa.email}:`, err);
                    });
                }
            }

            return res.json({ success: true, message: 'Recibirás un correo de confirmación en breve.' });
        } catch (error) {
            console.error('Demo request error:', error);
            return res.status(500).json({ success: false, error: 'Error al procesar la solicitud. Intenta más tarde.' });
        }
    }
}

module.exports = DemoController;
