const pdf = require('pdf-parse');
const BankStatementParser = require('./BankStatementParser');

/**
 * Driver para "Estado de cuenta corriente amiga" de Bancamiga (PDF).
 *
 * Cada línea del PDF tiene los campos pegados (sin separadores), por ejemplo:
 *   "01-04-2026174307010273NC Fondos Recib. Terceros Otros Bancos0,0015.500,0018.136,47"
 *
 * Estrategia:
 *   1. Tomar el texto plano del PDF.
 *   2. Limpiar líneas de pie de página y marcadores ("En Bancamiga…", "Número de Páginas…").
 *   3. Detectar inicio de movimiento por fecha "DD-MM-YYYY" al inicio.
 *   4. Si una línea de movimiento no termina con 3 montos formato venezolano,
 *      acumular las líneas siguientes hasta encontrar los 3 montos finales.
 *   5. Extraer referencia + descripción + débito + crédito + saldo con regex.
 *
 * Movimientos relevantes para conciliación (créditos entrantes):
 *   - "NC Fondos Recib. Terceros Otros Bancos"
 *   - "NC Credito Inmediato"
 *   - "Transf. Terc. Otros Bancos" recibida (poco frecuente; quedan como CREDIT si la columna crédito > 0)
 */
class BancamigaParser extends BankStatementParser {
    get bankCode() { return 'BANCAMIGA'; }
    get parserKey() { return 'bancamiga-pdf'; }
    get supportedMimes() { return ['application/pdf']; }

    async parse(buffer /* , mimeType, fileName */) {
        const data = await pdf(buffer);
        const text = data.text || '';
        const allLines = text.split('\n').map(l => l.trim());

        const filtered = allLines.filter(l => l && !this._isNoise(l));

        const groups = this._groupMovementLines(filtered);

        const warnings = [];
        const movements = [];

        let accountHolder = null;
        let accountMask = null;
        let initialBalance = null;
        let finalBalance = null;

        for (const line of allLines) {
            if (/^JONATHAN|^[A-ZÁÉÍÓÚÑ ]{5,}$/.test(line) && !accountHolder) {
                if (!/Estado de cuenta|Detalle de Movimientos/i.test(line)) {
                    accountHolder = line;
                }
            }
            const mAcc = line.match(/Código Cuenta:\s*([\d*\-]+)/i);
            if (mAcc) accountMask = mAcc[1];
            const mInit = line.match(/Saldo Inicial:\s*([\d.,]+)/i);
            if (mInit) initialBalance = BankStatementParser.parseVesAmount(mInit[1]);
            const mFinal = line.match(/Saldo Final del Período\s*([\d.,]+)/i);
            if (mFinal) finalBalance = BankStatementParser.parseVesAmount(mFinal[1]);
        }

        for (const g of groups) {
            const joined = g.join('');
            const parsed = this._parseMovementLine(joined, warnings);
            if (parsed) {
                parsed.raw_line = g.join(' ');
                movements.push(parsed);
            }
        }

        const dates = movements.map(m => m.movement_date).filter(Boolean).sort((a, b) => a - b);
        const periodFrom = dates[0] || null;
        const periodTo = dates[dates.length - 1] || null;

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

    _isNoise(line) {
        if (/^En Bancamiga Hacemos Equipo/i.test(line)) return true;
        if (/^servicios y la atención/i.test(line)) return true;
        if (/^que tu quieras/i.test(line)) return true;
        if (/^Número de Paginas\s*->/i.test(line)) return true;
        if (/^-- \d+ of \d+ --$/.test(line)) return true;
        if (/^Estado de cuenta corriente amiga$/i.test(line)) return true;
        if (/^Centro de Atención Bancamiga/i.test(line)) return true;
        if (/TUBANCA/i.test(line)) return true;
        if (/^www\.bancamiga\.com$/i.test(line)) return true;
        if (/^Detalle de Movimientos$/i.test(line)) return true;
        if (/^FechaReferenciaDescripción/i.test(line)) return true;
        if (/^Dirección:/i.test(line)) return true;
        if (/^Ruperto Lugo/i.test(line)) return true;
        if (/^Código Cuenta:/i.test(line)) return true;
        if (/^Saldo Inicial:/i.test(line)) return true;
        if (/^Resumen$/i.test(line)) return true;
        if (/^Total Débitos\b/i.test(line)) return true;
        if (/^Total Créditos\b/i.test(line)) return true;
        if (/^Saldo Final del Período/i.test(line)) return true;
        return false;
    }

    /**
     * Agrupa líneas que pertenecen a un mismo movimiento.
     * Un movimiento empieza con DD-MM-YYYY y puede partirse en varias líneas si
     * la descripción tiene texto extra. Termina cuando la línea concatenada
     * cierra con 3 montos formato venezolano.
     */
    _groupMovementLines(lines) {
        const A = BankStatementParser.VES_AMOUNT_PATTERN;
        const groups = [];
        const dateRe = /^(\d{2}-\d{2}-\d{4})/;
        const endRe = new RegExp(`(${A})\\s*(${A})\\s*(${A})$`);
        let current = null;
        for (const line of lines) {
            if (dateRe.test(line)) {
                if (current) groups.push(current);
                current = [line];
            } else if (current) {
                current.push(line);
            }
            if (current) {
                const joined = current.join('');
                if (endRe.test(joined)) {
                    groups.push(current);
                    current = null;
                }
            }
        }
        if (current) groups.push(current);
        return groups;
    }

    _parseMovementLine(joined, warnings) {
        const A = BankStatementParser.VES_AMOUNT_PATTERN;
        const re = new RegExp(`^(\\d{2}-\\d{2}-\\d{4})(\\d+)([\\s\\S]+?)(${A})(${A})(${A})$`);
        const m = joined.match(re);
        if (!m) {
            warnings.push(`No se pudo parsear línea Bancamiga: "${joined.slice(0, 120)}…"`);
            return null;
        }
        const [, dateStr, reference, description, debitStr, creditStr, balanceStr] = m;
        const debit = BankStatementParser.parseVesAmount(debitStr);
        const credit = BankStatementParser.parseVesAmount(creditStr);
        const balance = BankStatementParser.parseVesAmount(balanceStr);
        const isCredit = credit > 0;
        const desc = description.trim();
        return {
            movement_date: BankStatementParser.parseDdMmYyyy(dateStr),
            reference: reference.trim(),
            description: desc,
            amount_ves: isCredit ? credit : debit,
            direction: isCredit ? 'CREDIT' : 'DEBIT',
            balance_ves: balance,
            raw_line: joined,
            is_relevant_for_match: isCredit && this._isRelevantCreditDescription(desc)
        };
    }

    _isRelevantCreditDescription(desc) {
        if (!desc) return false;
        if (/NC Fondos Recib\. Terceros/i.test(desc)) return true;
        if (/NC Credito Inmediato/i.test(desc)) return true;
        if (/Recib\. Pago Movil/i.test(desc)) return true;
        return false;
    }
}

module.exports = BancamigaParser;
