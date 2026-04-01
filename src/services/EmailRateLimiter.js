const HOUR_MS = 60 * 60 * 1000;

/**
 * Cola global de envíos SMTP (p. ej. Mailgun): ventana deslizante de 1 h.
 * Aplica a todo el SaaS: comunicados por tenant/admin de junta, carga masiva de propietarios,
 * notificaciones y cualquier otro correo que use EmailService — un solo pool por proceso Node.
 * Cada `acquire()` espera hasta haber cupo; así la app no supera el tope y el proveedor no corta la cuenta.
 * Nota: un solo proceso Node = un solo contador. Si escalas varias instancias con el mismo SMTP,
 * cada una tendría su propio límite (habría que coordinar con Redis u otro store compartido).
 * Serializa acquire() para que el conteo sea correcto bajo concurrencia.
 */
class EmailRateLimiter {
    constructor() {
        this._reloadFromEnv();
        this.timestamps = [];
        this._chain = Promise.resolve();
    }

    _reloadFromEnv() {
        const raw = parseInt(process.env.SMTP_MAX_EMAILS_PER_HOUR || '100', 10);
        this.maxPerHour = Number.isFinite(raw) && raw > 0 ? raw : 100;
        this.windowMs = HOUR_MS;
    }

    /**
     * Espera hasta que haya cupo para un envío (debe llamarse justo antes de sendMail).
     */
    acquire() {
        this._reloadFromEnv();
        return new Promise((resolve, reject) => {
            this._chain = this._chain.then(async () => {
                try {
                    await this._waitForSlot();
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _waitForSlot() {
        for (;;) {
            const now = Date.now();
            this.timestamps = this.timestamps.filter((ts) => now - ts < this.windowMs);
            if (this.timestamps.length < this.maxPerHour) {
                this.timestamps.push(Date.now());
                return;
            }
            const oldest = this.timestamps[0];
            const waitMs = Math.max(0, this.windowMs - (now - oldest) + 5);
            await new Promise((r) => setTimeout(r, waitMs));
        }
    }
}

module.exports = new EmailRateLimiter();
