const BancamigaParser = require('./BancamigaParser');
const BancoDeVenezuelaParser = require('./BancoDeVenezuelaParser');
const UbiiPagosParser = require('./UbiiPagosParser');

/**
 * Registro global de drivers de bancos.
 *
 * Para añadir un banco nuevo:
 *   1. Crear el archivo `XxxxxParser.js` extendiendo BankStatementParser.
 *   2. Importarlo aquí y registrar en el array `REGISTERED`.
 *   3. Agregar el banco a la tabla `Banks` (vía migración o insert manual)
 *      con el mismo `parser_key`.
 */
const REGISTERED = [
    new BancamigaParser(),
    new BancoDeVenezuelaParser(),
    new UbiiPagosParser()
];

class BankParserRegistry {
    static getByParserKey(parserKey) {
        return REGISTERED.find(p => p.parserKey === parserKey) || null;
    }

    static getByBankCode(bankCode) {
        return REGISTERED.find(p => p.bankCode === bankCode) || null;
    }

    static listKeys() {
        return REGISTERED.map(p => ({ bankCode: p.bankCode, parserKey: p.parserKey }));
    }
}

module.exports = BankParserRegistry;
