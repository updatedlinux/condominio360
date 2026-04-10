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
                const apiDetail = data.error || data.message || res.statusText || `HTTP ${res.status}`;
                const detailStr = typeof apiDetail === 'string' ? apiDetail : JSON.stringify(apiDetail);
                let msg = detailStr;
                if (res.status === 404) {
                    msg =
                        `HTTP 404 al POST ${url}. Suele indicar URL base incorrecta: debe apuntar al prefijo donde vive el API ` +
                        `(p. ej. terminar en /api para que la petición sea …/api/send-message). Respuesta: ${detailStr}`;
                } else {
                    msg = `HTTP ${res.status} ${url}: ${detailStr}`;
                }
                console.warn('[WhatsApp API] Fallo envío', { url, status: res.status, detail: detailStr.slice(0, 500) });
                throw new Error(msg.slice(0, 4000));
            }
            if (data.success === false) {
                console.warn('[WhatsApp API] success=false', { url, error: data.error });
                throw new Error(data.error || 'Envío rechazado por el API');
            }
            return data;
        } catch (e) {
            if (e.response?.data) {
                const d = e.response.data;
                const msg = d.error || d.message || e.message;
                const out = typeof msg === 'string' ? msg : JSON.stringify(d);
                console.warn('[WhatsApp API] Excepción axios', {
                    url,
                    status: e.response.status,
                    detail: out.slice(0, 500)
                });
                throw new Error(
                    e.response.status === 404
                        ? `HTTP 404 al POST ${url}. Revise la URL base (p. ej. …/api). ${out}`.slice(0, 4000)
                        : out.slice(0, 4000)
                );
            }
            if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
                console.warn('[WhatsApp API] DNS/red', { url, code: e.code, message: e.message });
                throw new Error(`No se pudo resolver o conectar con el host del API (${e.code || 'red'}). Revise URL y DNS del servidor.`);
            }
            console.warn('[WhatsApp API] Error', { url, message: e.message });
            throw e;
        }
    }
}

module.exports = WhatsAppExternalApiService;
