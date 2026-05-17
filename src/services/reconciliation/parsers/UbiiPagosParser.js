const pdf = require('pdf-parse');
const BankStatementParser = require('./BankStatementParser');

const MONTHS_ES = {
    'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
    'julio': 7, 'agosto': 8, 'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
};

/**
 * Driver para "Estado de cuenta" UbiiPagos (fintech, PDF).
 *
 * Particularidades:
 *   - El estado solo trae "DÍA" (1-31), no la fecha completa. El mes/año vienen
 *     en el header como "Período: Mayo 2026".
 *   - Cada movimiento ocupa una línea como:
 *       "05RECARGA POR TRANSFERENCIA INMEDIATA000000033134200,00880,28"
 *     que se descompone en:
 *       DÍA + CONCEPTO + REFERENCIA + (CRÉDITOS o DÉBITOS) + SALDO
 *     (solo 2 montos finales, según corresponda a crédito o débito; no traen
 *      siempre las dos columnas).
 *   - Los conceptos relevantes para conciliación son las RECARGA POR
 *     TRANSFERENCIA INMEDIATA. Las COMISIÓN se descartan del matching.
 */
class UbiiPagosParser extends BankStatementParser {
    get bankCode() { return 'UBIIPAGOS'; }
    get parserKey() { return 'ubiipagos-pdf'; }
    get supportedMimes() { return ['application/pdf']; }

    async parse(buffer /* , mimeType, fileName */) {
        const data = await pdf(buffer);
        const text = data.text || '';
        const allLines = text.split('\n').map(l => l.trim()).filter(Boolean);

        const warnings = [];
        const movements = [];

        let accountHolder = null;
        let accountMask = null;
        let period = { month: null, year: null };
        let initialBalance = null;

        for (const line of allLines) {
            if (/^ARSYS|^[A-ZÁÉÍÓÚÑ0-9 .,&-]{5,}$/.test(line)
                && !accountHolder
                && !/^DÍA|^SALDO|^CONCEPTO|^Estado de cuenta|^Fecha emisi|^Moneda:|^Tarjetas:|^Período:/i.test(line)) {
                accountHolder = line;
            }
            const mT = line.match(/Tarjetas:\s*([0-9X]+)/i);
            if (mT) accountMask = mT[1];

            const mP = line.match(/Per[íi]odo:\s*([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{4})/i);
            if (mP) {
                const monthName = mP[1].toLowerCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (MONTHS_ES[monthName]) {
                    period.month = MONTHS_ES[monthName];
                    period.year = parseInt(mP[2], 10);
                }
            }

            const mIni = line.match(/^SALDO INICIAL\s*([\d.,]+)$/i);
            if (mIni) initialBalance = BankStatementParser.parseVesAmount(mIni[1]);
        }

        if (!period.month || !period.year) {
            warnings.push('No se pudo determinar el período del estado UbiiPagos. Se omiten fechas.');
        }

        const startIdx = allLines.findIndex(l => /^DÍACONCEPTOREFERENCIA/i.test(l));
        const endIdx = allLines.findIndex(l => /^RESUMEN DE MOVIMIENTOS/i.test(l));
        const rangeStart = startIdx >= 0 ? startIdx + 1 : 0;
        const rangeEnd = endIdx >= 0 ? endIdx : allLines.length;

        const A = BankStatementParser.VES_AMOUNT_PATTERN;
        const amountRe = new RegExp(A, 'g');
        const prefixRe = /^(\d{1,2})([\s\S]+?)(\d{6,})$/;

        const periodFrom = (period.month && period.year)
            ? new Date(period.year, period.month - 1, 1)
            : null;
        const periodTo = (period.month && period.year)
            ? new Date(period.year, period.month, 0)
            : null;

        let prevBalance = initialBalance != null ? initialBalance : 0;

        for (let i = rangeStart; i < rangeEnd; i++) {
            const line = allLines[i];
            if (!line) continue;
            if (/^SALDO INICIAL/i.test(line)) continue;

            const allAmountMatches = [...line.matchAll(amountRe)];
            if (allAmountMatches.length === 0 || !/,\d{2}$/.test(line)) {
                if (/^\d{1,2}[A-ZÁÉÍÓÚÑ]/.test(line)) {
                    warnings.push(`No se pudo extraer el saldo UbiiPagos: "${line.slice(0, 120)}"`);
                }
                continue;
            }
            const balanceMatch = allAmountMatches[allAmountMatches.length - 1];
            if (balanceMatch.index + balanceMatch[0].length !== line.length) {
                warnings.push(`Saldo no anclado al final UbiiPagos: "${line.slice(0, 120)}"`);
                continue;
            }
            const balance = BankStatementParser.parseVesAmount(balanceMatch[0]);
            const prefixWithAmount = line.slice(0, balanceMatch.index);

            const delta = balance - prevBalance;
            const direction = delta >= 0 ? 'CREDIT' : 'DEBIT';
            const amount = Math.abs(delta);

            const formattedAmount = this._formatVes(amount);
            let prefix = prefixWithAmount;
            if (prefix.endsWith(formattedAmount)) {
                prefix = prefix.slice(0, -formattedAmount.length);
            } else {
                warnings.push(`Monto calculado (${formattedAmount}) no coincide con el sufijo del prefijo UbiiPagos: "${line.slice(0, 120)}"`);
            }

            const pre = prefix.match(prefixRe);
            if (!pre) {
                warnings.push(`No se pudo parsear cabecera UbiiPagos: "${line.slice(0, 120)}"`);
                prevBalance = balance;
                continue;
            }
            const dayStr = pre[1];
            const conceptRaw = pre[2];
            const refRaw = pre[3];

            const day = parseInt(dayStr, 10);
            const concept = conceptRaw.trim();
            const reference = refRaw.trim();

            let movementDate = null;
            if (period.month && period.year) {
                movementDate = new Date(period.year, period.month - 1, day);
            }

            movements.push({
                movement_date: movementDate,
                reference,
                description: concept,
                amount_ves: amount,
                direction,
                balance_ves: balance,
                raw_line: line,
                is_relevant_for_match: direction === 'CREDIT' && this._isRelevantCreditConcept(concept)
            });

            prevBalance = balance;
        }

        const finalBalance = movements.length > 0
            ? movements[movements.length - 1].balance_ves
            : initialBalance;

        return {
            bankCode: this.bankCode,
            accountHolder,
            accountMask,
            periodFrom,
            periodTo,
            initialBalance,
            finalBalance,
            movements,
            warnings
        };
    }

    _formatVes(n) {
        const fixed = Math.abs(n).toFixed(2);
        const [intPart, dec] = fixed.split('.');
        const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return `${withSep},${dec}`;
    }

    _isRelevantCreditConcept(concept) {
        if (!concept) return false;
        return /RECARGA POR TRANSFERENCIA/i.test(concept);
    }
}

module.exports = UbiiPagosParser;
