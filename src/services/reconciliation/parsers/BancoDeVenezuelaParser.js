const pdf = require('pdf-parse');
const BankStatementParser = require('./BankStatementParser');

/**
 * Estado de cuenta PDF — Banco de Venezuela (0102).
 *
 * Columnas: Referencia | Descripción | Fecha | Débito | Crédito | Saldo
 * Sentido: NC = crédito (recibido), ND = débito (enviado), SI = saldo inicial.
 *
 * El PDF concatena campos; las descripciones multilínea incluyen cédula (V########),
 * teléfono (04XXXXXXXXX) y código de banco contraparte en transferencias interbancarias.
 */
class BancoDeVenezuelaParser extends BankStatementParser {
    get bankCode() { return 'BDV'; }
    get parserKey() { return 'bdv-pdf'; }
    get supportedMimes() { return ['application/pdf']; }

    async parse(buffer) {
        const data = await pdf(buffer);
        const text = data.text || '';
        const allLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        const lines = allLines.filter((l) => !this._isNoise(l));

        const warnings = [];
        const movements = [];
        let initialBalance = null;
        let finalBalance = null;

        for (const line of allLines) {
            const mInit = line.match(/SALDO\s+INICIAL[\s\S]*?(\d{2}\/\d{2}\/\d{4})SI((?:-?\d[\d.,]*)+)/i);
            if (mInit) {
                const amounts = this._extractVesAmounts(mInit[2]);
                if (amounts.length >= 1) {
                    initialBalance = amounts[amounts.length - 1];
                }
            }
        }

        const groups = this._groupMovementLines(lines);

        for (const g of groups) {
            const joined = g.join(' ').replace(/\s+/g, ' ').trim();
            if (/^SALDO\s+INICIAL/i.test(joined)) {
                const parsed = this._parseMovementLine(joined, warnings);
                if (parsed && parsed.balance_ves != null) {
                    initialBalance = parsed.balance_ves;
                }
                continue;
            }
            const parsed = this._parseMovementLine(joined, warnings);
            if (parsed) {
                parsed.raw_line = g.join(' ').slice(0, 2000);
                movements.push(parsed);
            }
        }

        if (movements.length > 0) {
            const withBalance = movements.filter((m) => m.balance_ves != null);
            if (withBalance.length > 0) {
                finalBalance = withBalance[withBalance.length - 1].balance_ves;
            }
        }

        const dates = movements.map((m) => m.movement_date).filter(Boolean).sort((a, b) => a - b);
        const periodFrom = dates[0] || null;
        const periodTo = dates[dates.length - 1] || null;

        return {
            bankCode: this.bankCode,
            accountHolder: null,
            accountMask: null,
            periodFrom,
            periodTo,
            initialBalance,
            finalBalance,
            movements,
            warnings
        };
    }

    _isMovementStart(line) {
        if (/^SALDO\s+INICIAL/i.test(line)) return true;
        if (/^04\d{9}$/.test(line)) return false;
        if (/^V\d{6,10}$/i.test(line)) return false;
        return /^\d{10,13}/.test(line);
    }

    _isNoise(line) {
        if (/^ReferenciaDescripciónFecha/i.test(line)) return true;
        if (/^Pagina:\s*\d+\/\d+/i.test(line)) return true;
        if (/^Banco de Venezuela/i.test(line)) return true;
        if (/^RIF\s+G-/i.test(line)) return true;
        return false;
    }

    _groupMovementLines(lines) {
        const groups = [];
        let current = null;
        const terminalRe = /(\d{2}\/\d{2}\/\d{4})(ND|NC|SI)((?:-?\d{1,3}(?:\.\d{3})*,\d{2},?)+)\s*$/i;

        const flush = () => {
            if (current && current.length) {
                groups.push(current);
            }
            current = null;
        };

        for (const line of lines) {
            const isStart = this._isMovementStart(line);

            if (isStart) {
                flush();
                current = [line];
            } else if (current) {
                current.push(line);
            }

            if (current) {
                const joined = current.join(' ');
                if (terminalRe.test(joined)) {
                    groups.push(current);
                    current = null;
                }
            }
        }
        flush();
        return groups;
    }

    _parseMovementLine(joined, warnings) {
        const A = BankStatementParser.VES_AMOUNT_PATTERN;
        const re = new RegExp(
            `^(\\d{10,13}|SALDO\\s+INICIAL[\\s\\S]*?)([\\s\\S]*?)(\\d{2}\\/\\d{2}\\/\\d{4})(ND|NC|SI)((?:-?${A},?)+)$`,
            'i'
        );

        let m = joined.match(re);
        if (!m && /^SALDO\s+INICIAL/i.test(joined)) {
            const reInit = new RegExp(`^(SALDO\\s+INICIAL[\\s\\S]*?)(\\d{2}\\/\\d{2}\\/\\d{4})(SI)((?:-?${A},?)+)$`, 'i');
            m = joined.match(reInit);
            if (m) {
                const amounts = this._parseAmountTriplet(m[4], 'SI');
                return {
                    movement_date: BankStatementParser.parseDdSlashMmSlashYyyy(m[2]),
                    reference: 'SALDO-INICIAL',
                    description: 'Saldo inicial',
                    amount_ves: 0,
                    direction: 'CREDIT',
                    balance_ves: amounts.balance,
                    payment_method: null,
                    payer_document: null,
                    payer_phone: null,
                    counterparty_bank_code: null,
                    is_relevant_for_match: false
                };
            }
        }

        if (!m) {
            warnings.push(`No se pudo parsear movimiento BDV: "${joined.slice(0, 120)}…"`);
            return null;
        }

        const [, refRaw, descRaw, dateStr, sentido, amountsTail] = m;
        const reference = /^\d{10,13}$/.test(refRaw) ? refRaw : refRaw.replace(/\D/g, '').slice(0, 13) || refRaw.trim();
        const description = (descRaw || '').replace(/\s+/g, ' ').trim();
        const amounts = this._parseAmountTriplet(amountsTail, sentido);

        const isCredit = sentido.toUpperCase() === 'NC';
        const isDebit = sentido.toUpperCase() === 'ND';
        const amount = isCredit ? amounts.credit : amounts.debit;

        const enriched = this._enrichDescription(description);

        return {
            movement_date: BankStatementParser.parseDdSlashMmSlashYyyy(dateStr),
            reference,
            description: description || enriched.normalizedDescription,
            amount_ves: Math.abs(amount),
            direction: isCredit ? 'CREDIT' : 'DEBIT',
            balance_ves: amounts.balance,
            payment_method: enriched.payment_method,
            payer_document: enriched.payer_document,
            payer_phone: enriched.payer_phone,
            counterparty_bank_code: enriched.counterparty_bank_code,
            is_relevant_for_match: isCredit && this._isRelevantCreditDescription(description)
        };
    }

    _extractVesAmounts(tail) {
        const A = BankStatementParser.VES_AMOUNT_PATTERN;
        const re = new RegExp(`-?${A}`, 'g');
        const found = tail.match(re) || [];
        return found.map((s) => BankStatementParser.parseVesAmount(s));
    }

    _parseAmountTriplet(tail, sentido) {
        const amounts = this._extractVesAmounts(tail);
        let debit = 0;
        let credit = 0;
        let balance = null;

        if (amounts.length >= 3) {
            debit = Math.abs(amounts[0]);
            credit = Math.abs(amounts[1]);
            balance = amounts[2];
        } else if (amounts.length === 2) {
            debit = Math.abs(amounts[0]);
            credit = 0;
            balance = amounts[1];
        } else if (amounts.length === 1) {
            balance = amounts[0];
        }

        if (sentido.toUpperCase() === 'NC' && credit === 0 && debit > 0) {
            credit = debit;
            debit = 0;
        }

        return { debit, credit, balance };
    }

    _enrichDescription(description) {
        const upper = (description || '').toUpperCase();
        let payment_method = 'OTRO';

        if (/PAGOMOVIL|PAGO\s*MOVIL/i.test(upper)) {
            payment_method = 'PAGO_MOVIL';
        } else if (/TRANSF\s+RECIBIDA|PAGO\s+RECIBIDO|TRANSFERENCIA/i.test(upper)) {
            payment_method = 'TRANSFERENCIA';
        } else if (/COMISION|COM\s+MANTENIMIENTO|COBRO\s+COM/i.test(upper)) {
            payment_method = 'COMISION';
        } else if (/PAGO\s+A\s+(OTROS\s+BANCOS|PROVEEDORES)|PAGO\s+CORPOELEC/i.test(upper)) {
            payment_method = 'PAGO_SALIENTE';
        }

        const docMatch = description.match(/\bV\s*(\d{6,9})\b/i);
        const payer_document = docMatch ? `V${docMatch[1]}` : null;

        const phoneMatch = description.match(/\b(04\d{9})\b/);
        const payer_phone = phoneMatch ? phoneMatch[1] : null;

        let counterparty_bank_code = null;
        const bankInDesc = description.match(/OTROS\s+BANCOS\s+(\d{4})/i);
        if (bankInDesc) {
            counterparty_bank_code = bankInDesc[1];
        } else {
            const bankBeforePhone = description.match(/\b(\d{4})\s+04\d{9}/);
            if (bankBeforePhone) counterparty_bank_code = bankBeforePhone[1];
        }

        return {
            payment_method,
            payer_document,
            payer_phone,
            counterparty_bank_code,
            normalizedDescription: description
        };
    }

    _isRelevantCreditDescription(desc) {
        if (!desc) return false;
        const u = desc.toUpperCase();
        if (/PAGOMOVIL\s+BDV|PAGOMOVIL\s+OTROS/i.test(u)) return true;
        if (/TRANSF\s+RECIBIDA/i.test(u)) return true;
        if (/PAGO\s+RECIBIDO\s+OTROS\s+BANCOS/i.test(u)) return true;
        return false;
    }
}

module.exports = BancoDeVenezuelaParser;
