/**
 * Google reCAPTCHA v3 - Verificación server-side
 * Si RECAPTCHA_SECRET_KEY no está configurado, la verificación se omite (desarrollo)
 */
async function verifyRecaptcha(token, expectedAction = 'login') {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) {
        return { ok: true, skipped: true, score: 1 };
    }

    if (!token || typeof token !== 'string') {
        return { ok: false, error: 'Token reCAPTCHA requerido' };
    }

    try {
        const params = new URLSearchParams({
            secret,
            response: token,
            remoteip: null
        });

        const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        const data = await res.json();

        if (!data.success) {
            return { ok: false, error: 'Verificación reCAPTCHA fallida', details: data['error-codes'] };
        }

        if (expectedAction && data.action !== expectedAction) {
            return { ok: false, error: 'Acción reCAPTCHA inválida' };
        }

        const score = data.score ?? 0;
        const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE || '0.5');
        if (score < minScore) {
            return { ok: false, error: 'Score reCAPTCHA demasiado bajo', score };
        }

        return { ok: true, score };
    } catch (err) {
        console.error('Recaptcha verify error:', err);
        return { ok: false, error: 'Error al verificar reCAPTCHA' };
    }
}

module.exports = { verifyRecaptcha };
