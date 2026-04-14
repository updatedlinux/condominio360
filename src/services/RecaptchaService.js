/**
 * Google reCAPTCHA v3 - Verificación server-side
 * Si RECAPTCHA_SECRET_KEY no está configurado, la verificación se omite (desarrollo)
 */
function minScoreForAction(action) {
    const base = parseFloat(process.env.RECAPTCHA_MIN_SCORE || '0.5');
    const byActionKey = `RECAPTCHA_MIN_SCORE_${String(action || '').toUpperCase()}`;
    const byAction = process.env[byActionKey];
    if (byAction != null && String(byAction).trim() !== '') {
        const v = parseFloat(String(byAction));
        if (!Number.isNaN(v)) return v;
    }
    return Number.isNaN(base) ? 0.5 : base;
}

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
            secret: secret.trim(),
            response: token.trim()
        });

        const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        const data = await res.json();

        if (!data.success) {
            return {
                ok: false,
                error: 'Verificación reCAPTCHA fallida',
                details: data['error-codes'],
                hostname: data.hostname,
                challengeTs: data.challenge_ts
            };
        }

        if (expectedAction && data.action !== expectedAction) {
            return { ok: false, error: 'Acción reCAPTCHA inválida', action: data.action, hostname: data.hostname };
        }

        const score = data.score ?? 0;
        const minScore = minScoreForAction(expectedAction);
        if (score < minScore) {
            return {
                ok: false,
                error: 'Score reCAPTCHA demasiado bajo',
                score,
                minScore,
                action: data.action,
                hostname: data.hostname,
                challengeTs: data.challenge_ts
            };
        }

        return { ok: true, score };
    } catch (err) {
        console.error('Recaptcha verify error:', err);
        return { ok: false, error: 'Error al verificar reCAPTCHA' };
    }
}

module.exports = { verifyRecaptcha, minScoreForAction };
