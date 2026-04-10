const axios = require('axios');

/**
 * Cliente del API externo de mensajería (POST /send-message).
 * baseUrl ejemplo: https://wsapiback.arsystech.net/api (sin barra final)
 */

function joinUrl(baseUrl, path) {
    const b = (baseUrl || '').trim().replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${b}${p}`;
}

class WhatsAppExternalApiService {
    /**
     * @param {{ baseUrl: string, secretKey: string, countryCode: string, phoneNumber: string, message: string }} opts
     */
    static async sendWhatsApp(opts) {
        const { baseUrl, secretKey, countryCode, phoneNumber, message } = opts;
        if (!baseUrl || !secretKey) {
            throw new Error('Configuración de API incompleta');
        }
        const url = joinUrl(baseUrl, 'send-message');
        const body = {
            countryCode,
            phoneNumber,
            channel: 'WHATSAPP',
            message,
            secretKey
        };
        try {
            const res = await axios.post(url, body, {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-API-Key': secretKey
                },
                timeout: 45000,
                validateStatus: () => true
            });
            const data = res.data || {};
            if (res.status >= 400) {
                const err = data.error || data.message || res.statusText || `HTTP ${res.status}`;
                throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
            }
            if (data.success === false) {
                throw new Error(data.error || 'Envío rechazado por el API');
            }
            return data;
        } catch (e) {
            if (e.response?.data) {
                const d = e.response.data;
                const msg = d.error || d.message || e.message;
                throw new Error(typeof msg === 'string' ? msg : JSON.stringify(d));
            }
            throw e;
        }
    }
}

module.exports = WhatsAppExternalApiService;
