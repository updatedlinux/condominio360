/**
 * Algoritmo de matching entre movimientos del extracto bancario y reportes
 * de pago de propietarios (BillingPaymentReports).
 *
 * Score ponderado (máx. 100 pts):
 *   - Referencia exacta:                        50
 *   - Referencia con sufijo coincidente (≥6):   30
 *   - Monto exacto (tolerancia ±0,01):          30
 *   - Monto aproximado (±1%):                   15
 *   - Fecha exacta:                             10
 *   - Fecha ±2 días:                             5
 *
 * Umbrales:
 *   - score ≥ 90 → CONFIRMED (auto-match)
 *   - score 70-89 → SUGGESTED
 *   - score < 70 → UNMATCHED
 */
class ReconciliationMatcher {
    static get THRESHOLD_CONFIRMED() { return 90; }
    static get THRESHOLD_SUGGESTED() { return 70; }

    /**
     * @param {Array} movements  movimientos relevantes (CREDIT y is_relevant_for_match)
     * @param {Array} reports    BillingPaymentReports candidatos (status=PENDING_CONFIRMATION o todos)
     * @returns {{
     *   matches: Array<{movementIndex, reportIndex, score, status}>,
     *   unmatchedMovementIndices: number[],
     *   unmatchedReportIndices: number[]
     * }}
     */
    static run(movements, reports) {
        const movs = (movements || []).map((m, idx) => ({ idx, ref: this._normalizeRef(m.reference), date: m.movement_date, amount: Number(m.amount_ves || 0) }));
        const reps = (reports || []).map((r, idx) => ({
            idx,
            ref: this._normalizeRef(r.ref_transferencia),
            date: this._parseReportDate(r.fecha_transferencia),
            amount: Number(r.monto_abonado_ves || 0)
        }));

        const pairs = [];
        for (const m of movs) {
            for (const r of reps) {
                const score = this._scorePair(m, r);
                if (score > 0) {
                    pairs.push({ movementIndex: m.idx, reportIndex: r.idx, score });
                }
            }
        }

        pairs.sort((a, b) => b.score - a.score);

        const usedMov = new Set();
        const usedRep = new Set();
        const matches = [];

        for (const p of pairs) {
            if (p.score < this.THRESHOLD_SUGGESTED) break;
            if (usedMov.has(p.movementIndex) || usedRep.has(p.reportIndex)) continue;
            matches.push({
                movementIndex: p.movementIndex,
                reportIndex: p.reportIndex,
                score: p.score,
                status: p.score >= this.THRESHOLD_CONFIRMED ? 'CONFIRMED' : 'SUGGESTED'
            });
            usedMov.add(p.movementIndex);
            usedRep.add(p.reportIndex);
        }

        const unmatchedMovementIndices = movs.map(m => m.idx).filter(i => !usedMov.has(i));
        const unmatchedReportIndices = reps.map(r => r.idx).filter(i => !usedRep.has(i));

        return { matches, unmatchedMovementIndices, unmatchedReportIndices };
    }

    static _scorePair(m, r) {
        let score = 0;

        if (m.ref && r.ref) {
            if (m.ref === r.ref) {
                score += 50;
            } else {
                const suffix = this._longestCommonSuffix(m.ref, r.ref);
                if (suffix.length >= 6) score += 30;
            }
        }

        if (Number.isFinite(m.amount) && Number.isFinite(r.amount) && r.amount > 0) {
            const diff = Math.abs(m.amount - r.amount);
            if (diff <= 0.01) {
                score += 30;
            } else if (r.amount > 0 && diff / r.amount <= 0.01) {
                score += 15;
            }
        }

        if (m.date && r.date) {
            const sameDay = m.date.getFullYear() === r.date.getFullYear()
                && m.date.getMonth() === r.date.getMonth()
                && m.date.getDate() === r.date.getDate();
            if (sameDay) {
                score += 10;
            } else {
                const dayDiff = Math.abs(m.date.getTime() - r.date.getTime()) / 86400000;
                if (dayDiff <= 2.5) score += 5;
            }
        }

        return score;
    }

    static _normalizeRef(ref) {
        if (!ref) return '';
        const s = String(ref).trim();
        return s.replace(/\D/g, '');
    }

    static _longestCommonSuffix(a, b) {
        let i = 0;
        const min = Math.min(a.length, b.length);
        while (i < min && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
        return a.slice(a.length - i);
    }

    static _parseReportDate(raw) {
        if (!raw) return null;
        const s = String(raw).trim();
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }
}

module.exports = ReconciliationMatcher;
