/**
 * Interfaz base para un driver de banco.
 *
 * Cada driver debe extender esta clase e implementar:
 *   - parse(buffer, mimeType, fileName): Promise<NormalizedStatement>
 *
 * Modelo de retorno (NormalizedStatement):
 * {
 *   bankCode: string,                 // "BANCAMIGA" | "UBIIPAGOS" | ...
 *   accountHolder?: string,           // titular detectado en el header
 *   accountMask?: string,             // últimos 4 dígitos o cuenta enmascarada
 *   periodFrom?: Date | null,         // YYYY-MM-DD
 *   periodTo?: Date | null,           // YYYY-MM-DD
 *   initialBalance?: number | null,
 *   finalBalance?: number | null,
 *   movements: Array<NormalizedMovement>,
 *   warnings: Array<string>
 * }
 *
 * NormalizedMovement:
 * {
 *   movement_date: Date | null,       // fecha del movimiento
 *   reference: string,                // referencia bancaria (numérica usual)
 *   description: string,              // glosa del movimiento
 *   amount_ves: number,               // siempre positivo
 *   direction: 'CREDIT' | 'DEBIT',
 *   balance_ves: number | null,
 *   raw_line: string,                 // línea original tal cual del PDF
 *   is_relevant_for_match: boolean,   // true si es candidato a matchear contra pagos de propietarios
 *   payer_document?: string | null,  // cédula del pagador (ej. V12345678) — BDV y similares
 *   payer_phone?: string | null,       // teléfono pagomóvil (04XXXXXXXXX)
 *   payment_method?: string | null,    // PAGO_MOVIL | TRANSFERENCIA | COMISION | PAGO_SALIENTE | OTRO
 *   counterparty_bank_code?: string | null  // código SUDEBAN 4 dígitos del banco origen
 * }
 */
class BankStatementParser {
    /**
     * @returns {string} código del banco (BANCAMIGA, UBIIPAGOS…)
     */
    get bankCode() { throw new Error('bankCode getter must be implemented'); }

    /**
     * @returns {string} parser_key registrado en la tabla Banks
     */
    get parserKey() { throw new Error('parserKey getter must be implemented'); }

    /**
     * Lista de tipos MIME aceptados por el driver.
     */
    get supportedMimes() { return ['application/pdf']; }

    /**
     * Parsea un buffer y retorna un NormalizedStatement.
     */
    async parse(/* buffer, mimeType, fileName */) {
        throw new Error('parse() must be implemented');
    }

    // -------- helpers compartidos --------

    /** Convierte "1.234,56" → 1234.56 (formato venezolano). */
    static parseVesAmount(raw) {
        if (raw == null) return 0;
        const s = String(raw).trim();
        if (!s) return 0;
        const normalized = s.replace(/\./g, '').replace(/,/g, '.');
        const n = parseFloat(normalized);
        return Number.isFinite(n) ? n : 0;
    }

    /** Convierte "DD-MM-YYYY" → Date. */
    static parseDdMmYyyy(raw) {
        if (!raw) return null;
        const m = String(raw).match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (!m) return null;
        const [_, d, mm, y] = m;
        const d2 = new Date(Number(y), Number(mm) - 1, Number(d));
        return Number.isNaN(d2.getTime()) ? null : d2;
    }

    /** Convierte "DD/MM/YYYY" → Date. */
    static parseDdSlashMmSlashYyyy(raw) {
        if (!raw) return null;
        const m = String(raw).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!m) return null;
        const [_, d, mm, y] = m;
        const d2 = new Date(Number(y), Number(mm) - 1, Number(d));
        return Number.isNaN(d2.getTime()) ? null : d2;
    }

    /**
     * Fuente de la subexpresión que captura un monto venezolano "1.234,56" o "23,45".
     * No se devuelve con anclas para poder componer regex más grandes.
     */
    static get VES_AMOUNT_PATTERN() {
        return '\\d{1,3}(?:\\.\\d{3})*,\\d{2}';
    }
}

module.exports = BankStatementParser;
