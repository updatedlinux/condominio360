const Migration = require('./Migration');

/**
 * Mayor precisión en montos y tasas para evitar redondeo en SQL Server.
 */
class IncreaseBillingMonetaryPrecision extends Migration {
    async up() {
        const amountCol = 'DECIMAL(18,6)';
        const rateCol = 'DECIMAL(18,6)';

        const alters = [
            ['BillingPreliminaries', 'exchange_rate_usd', rateCol],
            ['BillingPreliminaries', 'total_amount_usd', amountCol],
            ['BillingPreliminaries', 'total_amount_ves', amountCol],
            ['BillingPreliminaryItems', 'base_amount', amountCol],
            ['BillingPreliminaryItems', 'converted_amount_ves', amountCol],
            ['BillingInvoices', 'total_amount_usd', amountCol],
            ['BillingInvoices', 'total_amount_ves', amountCol],
            ['BillingInvoices', 'assigned_amount_usd', amountCol],
            ['BillingInvoices', 'assigned_amount_ves', amountCol],
            ['BillingInvoices', 'exchange_rate_at_creation', rateCol],
            ['BillingInvoices', 'current_exchange_rate', rateCol],
            ['BillingInvoices', 'paid_amount_ves', amountCol],
            ['BillingInvoiceItems', 'base_amount', amountCol],
            ['BillingInvoiceItems', 'converted_amount_ves', amountCol],
            ['BillingInvoiceItems', 'assigned_amount_ves', amountCol]
        ];

        for (const [table, column, sqlType] of alters) {
            if (!(await this.tableExists(table))) continue;
            if (!(await this.columnExists(table, column))) continue;
            await this.query(`ALTER TABLE ${table} ALTER COLUMN ${column} ${sqlType}`);
            console.log(`   ✅ ${table}.${column} → ${sqlType}`);
        }

        if (await this.tableExists('BillingPaymentReports')) {
            if (await this.columnExists('BillingPaymentReports', 'monto_abonado_ves')) {
                await this.query(`ALTER TABLE BillingPaymentReports ALTER COLUMN monto_abonado_ves ${amountCol}`);
                console.log('   ✅ BillingPaymentReports.monto_abonado_ves');
            }
        }

        if (await this.tableExists('ExchangeRates')) {
            if (await this.columnExists('ExchangeRates', 'usd_rate')) {
                await this.query(`ALTER TABLE ExchangeRates ALTER COLUMN usd_rate ${rateCol}`);
                console.log('   ✅ ExchangeRates.usd_rate');
            }
        }

        if (await this.tableExists('VendorContracts')) {
            if (await this.columnExists('VendorContracts', 'amount')) {
                await this.query(`ALTER TABLE VendorContracts ALTER COLUMN amount ${amountCol}`);
                console.log('   ✅ VendorContracts.amount');
            }
        }
    }
}

module.exports = IncreaseBillingMonetaryPrecision;
