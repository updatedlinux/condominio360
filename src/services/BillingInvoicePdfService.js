const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');

const TENANT_LOGO = require('../constants/tenantLogo');
const { normalizeRateDate } = require('../utils/bcvFiscalCalendar');
const ASSETS_DIR = path.join(__dirname, '..', 'public', 'assets', 'images');
const CONDOMINIO360_WHITE_LOGO_SVG = path.join(ASSETS_DIR, 'CONDOMINIO360-whitelogo.svg');

const MONTH_NAMES_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const ITEM_TYPE_LABELS = {
    ORDINARY: 'Gasto Ordinario',
    EXTRAORDINARY: 'Gasto Extraordinario',
    FUND: 'Fondo de Reserva',
    ADJUSTMENT: 'Ajuste'
};

function formatVes(amount) {
    const n = Number(amount || 0);
    return 'Bs. ' + n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatUsd(amount) {
    const n = Number(amount || 0);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRateDate(val) {
    const ymd = normalizeRateDate(val);
    if (!ymd) return null;
    const [y, m, d] = ymd.split('-');
    return `${parseInt(d, 10)} de ${MONTH_NAMES_ES[parseInt(m, 10) - 1].toLowerCase()} de ${y}`;
}

/** Fecha de emisión del recibo (generación / creación del documento). */
function formatEmissionDate(invoice) {
    const candidates = [
        invoice.created_at,
        invoice.sent_at,
        invoice.finalized_at,
        invoice.preliminary_finalized_at
    ];
    for (const val of candidates) {
        const formatted = formatRateDate(val);
        if (formatted) return formatted;
    }
    return '—';
}

function formatDateTime(val) {
    if (!val) return '';
    try {
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
        return '';
    }
}

function resolveTenantLogoFile(tenant) {
    if (!tenant || !tenant.logo_path) return null;
    const rel = String(tenant.logo_path).replace(/^\/+/, '').replace(/^uploads\//, '');
    const full = path.join(process.cwd(), 'uploads', rel);
    return fs.existsSync(full) ? full : null;
}

let whiteLogoSvgCache = null;
function getCondominio360WhiteLogoSvg() {
    if (whiteLogoSvgCache !== null) return whiteLogoSvgCache;
    try {
        whiteLogoSvgCache = fs.readFileSync(CONDOMINIO360_WHITE_LOGO_SVG, 'utf8');
    } catch {
        whiteLogoSvgCache = '';
    }
    return whiteLogoSvgCache;
}

function printableBottomY(doc) {
    return doc.page.height - doc.page.margins.bottom;
}

function footerReservePt(doc) {
    return TENANT_LOGO.brandPdfHeight + 28;
}

class BillingInvoicePdfService {
    static streamOwnerReceipt(res, ctx) {
        const { invoice, tenant, displayStatus, paymentReport } = ctx;
        const safeName = (invoice.property_name || 'inmueble').replace(/[^a-z0-9-]+/gi, '_');
        const filename = `Recibo-${invoice.invoice_number || 'recibo'}-${safeName}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');

        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 40, left: 40, right: 40, bottom: 56 }
        });
        doc.on('error', (err) => {
            console.error('BillingInvoicePdf error:', err);
            try { res.end(); } catch (_) { /* noop */ }
        });
        doc.pipe(res);

        this._drawHeader(doc, tenant, displayStatus);
        this._drawTitleAndMeta(doc, invoice, tenant, displayStatus);
        if (invoice.invoice_kind === 'LEGACY_DEBT') {
            this._drawLegacySummary(doc, invoice);
        }
        this._drawItemsTable(doc, invoice, ctx);
        this._drawRateInfo(doc, invoice);
        if (invoice.status === 'PAID') {
            this._ensureSpace(doc, 58);
            this._drawPaymentConfirmed(doc, invoice, paymentReport);
        } else if (invoice.has_pending_payment_report) {
            this._ensureSpace(doc, 42);
            this._drawPendingVerification(doc);
        }
        if (displayStatus.stamp) {
            this._ensureSpace(doc, 108);
            this._drawPaidStamp(doc, invoice, tenant, paymentReport);
        }
        this._drawBranding(doc);

        doc.end();
    }

    static _ensureSpace(doc, neededHeight) {
        const limit = printableBottomY(doc) - footerReservePt(doc);
        if (doc.y + neededHeight > limit) {
            doc.addPage();
        }
    }

    static _drawHeader(doc, tenant, displayStatus) {
        const startX = 40;
        let y = 40;
        const logoPath = resolveTenantLogoFile(tenant);

        if (logoPath) {
            try {
                const boxW = TENANT_LOGO.pdfWidth;
                const boxH = TENANT_LOGO.pdfHeight;
                doc.image(logoPath, startX, y, {
                    fit: [boxW, boxH],
                    align: 'left',
                    valign: 'top'
                });
                y += boxH + 10;
            } catch (e) {
                console.error('Error cargando logo del conjunto:', e.message);
                doc.fillColor('#111827').font('Helvetica-Bold').fontSize(16)
                    .text(tenant.name || 'Condominio', startX, y);
                y += 28;
            }
        } else {
            doc.fillColor('#111827').font('Helvetica-Bold').fontSize(18)
                .text(tenant.name || 'Condominio', startX, y, { width: 320 });
            y += 28;
        }

        const statusColors = {
            PAID: '#059669',
            PARTIAL: '#7C3AED',
            PENDING: '#D97706'
        };
        const statusBg = {
            PAID: '#D1FAE5',
            PARTIAL: '#EDE9FE',
            PENDING: '#FEF3C7'
        };
        const key = displayStatus.key || 'PENDING';
        const badgeW = 160;
        const badgeX = doc.page.width - 40 - badgeW;
        const badgeY = 44;

        doc.save();
        doc.roundedRect(badgeX, badgeY, badgeW, 28, 6).fill(statusBg[key] || '#F3F4F6');
        doc.restore();
        doc.fillColor(statusColors[key] || '#374151').font('Helvetica-Bold').fontSize(10)
            .text(displayStatus.label.toUpperCase(), badgeX, badgeY + 9, { width: badgeW, align: 'center' });

        doc.y = Math.max(y + 8, badgeY + 40);
        doc.save();
        doc.strokeColor('#E5E7EB').lineWidth(0.5);
        doc.moveTo(startX, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
        doc.restore();
        doc.y += 14;
    }

    static _drawTitleAndMeta(doc, invoice, tenant, displayStatus) {
        const startX = 40;
        const pageWidth = doc.page.width;
        const contentW = pageWidth - 80;
        let y = doc.y;

        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(20)
            .text('Recibo de cobro', startX, y);
        y += 28;

        doc.fillColor('#6B7280').font('Helvetica').fontSize(11)
            .text(`Recibo #${invoice.invoice_number || '-'}`, startX, y);
        y += 16;
        if (invoice.property_invoice_code) {
            doc.fillColor('#6B7280').font('Helvetica').fontSize(10)
                .text(`Código inmueble: ${invoice.property_invoice_code}`, startX, y);
            y += 16;
        }
        y += 2;

        const rate = invoice._rateCurrent || invoice.current_exchange_rate || invoice.exchange_rate_at_creation || 1;
        const totalUsd = invoice._totalUsd != null
            ? invoice._totalUsd
            : (parseFloat(invoice.total_amount_usd) || parseFloat(invoice.assigned_amount_ves) / rate);

        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(22)
            .text(formatVes(invoice.assigned_amount_ves), startX, y);
        y += 26;
        doc.fillColor('#6B7280').font('Helvetica').fontSize(14)
            .text(`${formatUsd(totalUsd)} USD`, startX, y);
        y += 24;

        const periodLabel = invoice.invoice_kind === 'LEGACY_DEBT'
            ? 'Deuda histórica pre-sistema'
            : `${MONTH_NAMES_ES[(invoice.billing_month || 1) - 1]} ${invoice.billing_year || ''}`;

        const propertyCode = invoice.property_invoice_code;
        const rows = [
            ['Conjunto', tenant.name || '-'],
            ['Inmueble', invoice.property_name || '-'],
            ...(propertyCode ? [['Código inmueble', propertyCode]] : []),
            ['Período', periodLabel],
            ['Tasa aplicada', `${Number(rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} VES/USD`],
            ['Fecha de emisión', formatEmissionDate(invoice)]
        ];

        if (invoice.invoice_kind === 'LEGACY_DEBT') {
            rows.push(['Tipo', 'Deuda histórica pre-sistema']);
        }

        const colW = contentW / 2;
        rows.forEach((row, idx) => {
            const col = idx % 2;
            const rowIdx = Math.floor(idx / 2);
            const rx = startX + col * colW;
            const ry = y + rowIdx * 36;
            doc.fillColor('#6B7280').font('Helvetica').fontSize(9).text(row[0], rx, ry, { width: colW - 12 });
            doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text(row[1], rx, ry + 12, { width: colW - 12 });
        });

        doc.y = y + Math.ceil(rows.length / 2) * 36 + 12;

        if (invoice.invoice_kind === 'LEGACY_DEBT') {
            doc.save();
            doc.roundedRect(startX, doc.y, contentW, 36, 6).fill('#F5F3FF');
            doc.restore();
            doc.fillColor('#5B21B6').font('Helvetica').fontSize(9)
                .text('Deuda histórica pre-sistema: puede abonar en Bs. de forma parcial. El saldo pendiente se lleva en USD.', startX + 10, doc.y + 12, { width: contentW - 20 });
            doc.y += 48;
        }

        if (displayStatus.key === 'PARTIAL') {
            doc.save();
            doc.roundedRect(startX, doc.y, contentW, 28, 6).fill('#EDE9FE');
            doc.restore();
            doc.fillColor('#6D28D9').font('Helvetica-Bold').fontSize(9)
                .text('Pago parcial registrado — saldo pendiente en USD', startX + 10, doc.y + 9, { width: contentW - 20 });
            doc.y += 38;
        }
    }

    static _drawLegacySummary(doc, invoice) {
        const startX = 40;
        const contentW = doc.page.width - 80;
        const y = doc.y;
        doc.save();
        doc.roundedRect(startX, y, contentW, 44, 6).fill('#FAF5FF');
        doc.strokeColor('#DDD6FE').lineWidth(0.5);
        doc.roundedRect(startX, y, contentW, 44, 6).stroke();
        doc.restore();

        const half = contentW / 2;
        doc.fillColor('#6D28D9').font('Helvetica').fontSize(9).text('Deuda original', startX + 12, y + 10);
        doc.fillColor('#4C1D95').font('Helvetica-Bold').fontSize(11)
            .text(`${formatUsd(invoice.total_amount_usd)} USD`, startX + 12, y + 22);

        doc.fillColor('#6D28D9').font('Helvetica').fontSize(9).text('Saldo pendiente', startX + half + 12, y + 10);
        doc.fillColor('#4C1D95').font('Helvetica-Bold').fontSize(11)
            .text(`${formatUsd(invoice.assigned_amount_usd)} USD`, startX + half + 12, y + 22);

        if (parseFloat(invoice.paid_amount_usd) > 0) {
            doc.fillColor('#6D28D9').font('Helvetica').fontSize(8)
                .text(`Abonado: ${formatUsd(invoice.paid_amount_usd)} USD`, startX + 12, y + 34, { width: contentW - 24 });
        }

        doc.y = y + 54;
    }

    static _drawItemsTable(doc, invoice, ctx) {
        const startX = 40;
        const pageWidth = doc.page.width;
        const tableWidth = pageWidth - 80;
        let y = doc.y + 4;

        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12)
            .text('Desglose de cobros', startX, y);
        y += 22;

        const headerH = 24;
        doc.save();
        doc.rect(startX, y, tableWidth, headerH).fill('#F9FAFB');
        doc.restore();

        const colDesc = startX;
        const colVes = startX + tableWidth * 0.55;
        const colUsd = startX + tableWidth * 0.78;

        doc.fillColor('#6B7280').font('Helvetica-Bold').fontSize(9);
        doc.text('Concepto', colDesc + 8, y + 7, { width: tableWidth * 0.52 });
        doc.text('Bs.', colVes, y + 7, { width: tableWidth * 0.2, align: 'right' });
        doc.text('USD', colUsd, y + 7, { width: tableWidth * 0.18 - 8, align: 'right' });
        y += headerH;

        const rate = invoice._rateCurrent || 1;
        const items = invoice.items || [];
        const totalUsd = invoice._totalUsd != null
            ? invoice._totalUsd
            : (parseFloat(invoice.total_amount_usd) || parseFloat(invoice.assigned_amount_ves) / rate);

        items.forEach((it) => {
            const rowHeight = 32;
            const pageLimit = printableBottomY(doc) - footerReservePt(doc) - 80;
            if (y + rowHeight > pageLimit) {
                doc.addPage();
                y = doc.page.margins.top;
            }
            const itemUsd = it.currency === 'USD'
                ? (parseFloat(it.base_amount) || 0)
                : ((parseFloat(it.assigned_amount_ves) || 0) / rate);
            const typeLabel = ITEM_TYPE_LABELS[it.item_type] || it.item_type || '';

            doc.fillColor('#111827').font('Helvetica').fontSize(10);
            doc.text(it.description || '-', colDesc + 8, y + 5, { width: tableWidth * 0.52 - 8, ellipsis: true });
            doc.fillColor('#9CA3AF').font('Helvetica').fontSize(8)
                .text(typeLabel, colDesc + 8, y + 18, { width: tableWidth * 0.52 - 8, ellipsis: true });
            doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10)
                .text(formatVes(it.assigned_amount_ves), colVes, y + 8, { width: tableWidth * 0.2, align: 'right' });
            doc.fillColor('#6B7280').font('Helvetica').fontSize(9)
                .text(formatUsd(itemUsd), colUsd, y + 9, { width: tableWidth * 0.18 - 8, align: 'right' });
            y += rowHeight;

            doc.save();
            doc.strokeColor('#F3F4F6').lineWidth(0.5);
            doc.moveTo(startX, y - 4).lineTo(startX + tableWidth, y - 4).stroke();
            doc.restore();
        });

        if (!items.length) {
            doc.fillColor('#9CA3AF').font('Helvetica').fontSize(10)
                .text('Sin desglose disponible', startX + 8, y + 8);
            y += 24;
        }

        y += 4;
        const totalsH = 48;
        const boxX = startX + tableWidth * 0.45;
        const boxWidth = tableWidth * 0.55;
        doc.save();
        doc.roundedRect(boxX, y, boxWidth, totalsH, 4).fill('#F9FAFB');
        doc.restore();
        doc.fillColor('#6B7280').font('Helvetica').fontSize(9)
            .text('Total a pagar (Bs.)', boxX + 10, y + 8, { width: boxWidth / 2 });
        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12)
            .text(formatVes(invoice.assigned_amount_ves), boxX + boxWidth / 2, y + 6, { width: boxWidth / 2 - 10, align: 'right' });
        doc.fillColor('#6B7280').font('Helvetica').fontSize(9)
            .text('Equivalente USD', boxX + 10, y + 28, { width: boxWidth / 2 });
        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11)
            .text(formatUsd(totalUsd), boxX + boxWidth / 2, y + 26, { width: boxWidth / 2 - 10, align: 'right' });

        doc.y = y + totalsH + 6;
    }

    static _drawRateInfo(doc, invoice) {
        const ri = invoice.rate_info || {};
        if (invoice.has_pending_payment_report) {
            const startX = 40;
            const w = doc.page.width - 80;
            const y = doc.y;
            doc.save();
            doc.roundedRect(startX, y, w, 48, 6).fill('#EFF6FF');
            doc.restore();
            doc.fillColor('#1E40AF').font('Helvetica').fontSize(9)
                .text(
                    'Su pago está en verificación por la junta. El monto de este recibo no cambia por demoras de confirmación.',
                    startX + 10, y + 12, { width: w - 20 }
                );
            doc.y = y + 58;
            return;
        }

        if (!ri.rate_preliminary && !ri.rate_today && !ri.freeze_label) return;

        const startX = 40;
        const w = doc.page.width - 80;
        let y = doc.y;

        this._ensureSpace(doc, 72);

        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10)
            .text('Información de tasas', startX, y);
        y += 14;

        if (ri.freeze_label) {
            doc.fillColor('#3730A3').font('Helvetica').fontSize(7.5)
                .text(ri.freeze_label, startX, y, { width: w });
            y += 12;
        }

        const line = (label, value) => {
            doc.fillColor('#6B7280').font('Helvetica').fontSize(8).text(label, startX, y, { width: w * 0.55 });
            doc.fillColor('#111827').font('Helvetica-Bold').fontSize(8)
                .text(value, startX + w * 0.55, y, { width: w * 0.45, align: 'right' });
            y += 11;
        };

        if (ri.rate_preliminary != null) {
            const prelimDate = formatRateDate(ri.rate_preliminary_date);
            const datePart = prelimDate ? ` (${prelimDate})` : '';
            line(
                `Monto a pagar (tasa${datePart})`,
                `${Number(ri.rate_preliminary).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} VES/USD · ${formatVes(ri.contravalue_preliminary_ves)}`
            );
        }
        if (ri.show_rate_differential && ri.rate_today != null) {
            const todayDate = formatRateDate(ri.rate_today_date);
            const datePart = todayDate ? ` (${todayDate})` : '';
            line(
                `Referencia hoy${datePart}`,
                `${Number(ri.rate_today).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} VES/USD · ${formatVes(ri.contravalue_today_ves)}`
            );
        }
        if (ri.show_rate_differential && ri.spread_pct != null && ri.spread_pct !== 0) {
            line(
                'Diferencial cambiario (vs preliminar)',
                `${ri.spread_pct > 0 ? '+' : ''}${Number(ri.spread_pct).toFixed(2)}%`
            );
        }

        doc.y = y + 4;
    }

    static _drawPaymentConfirmed(doc, invoice, paymentReport) {
        const startX = 40;
        const w = doc.page.width - 80;
        const y = doc.y;
        doc.save();
        doc.roundedRect(startX, y, w, 52, 6).fill('#ECFDF5');
        doc.strokeColor('#A7F3D0').lineWidth(0.5);
        doc.roundedRect(startX, y, w, 52, 6).stroke();
        doc.restore();

        doc.fillColor('#065F46').font('Helvetica-Bold').fontSize(10)
            .text('Pago registrado', startX + 12, y + 10);
        doc.fillColor('#047857').font('Helvetica').fontSize(9)
            .text(`Monto pagado: ${formatVes(invoice.paid_amount_ves)}`, startX + 12, y + 24);
        if (invoice.paid_at) {
            doc.text(`Fecha: ${formatDateTime(invoice.paid_at)}`, startX + 12, y + 36);
        }
        if (invoice.payment_method) {
            doc.text(`Método: ${invoice.payment_method}`, startX + w / 2, y + 24, { width: w / 2 - 12 });
        }

        doc.y = y + 62;
    }

    static _drawPendingVerification(doc) {
        const startX = 40;
        const w = doc.page.width - 80;
        const y = doc.y;
        doc.save();
        doc.roundedRect(startX, y, w, 36, 6).fill('#EFF6FF');
        doc.restore();
        doc.fillColor('#1D4ED8').font('Helvetica').fontSize(9)
            .text('Reporte de pago pendiente de confirmación por la junta.', startX + 10, y + 12, { width: w - 20 });
        doc.y = y + 46;
    }

    static _drawPaidStamp(doc, invoice, tenant, paymentReport) {
        const pageWidth = doc.page.width;
        const startX = 40;
        const stampX = startX;
        const stampY = doc.y + 8;
        const stampW = 230;
        const stampH = 100;
        const inkColor = '#059669';
        const tenantName = (tenant.name || 'Condominio').substring(0, 48);

        const rand = this._seedRandom(invoice && invoice.id ? String(invoice.id) : 'seed-default');

        doc.save();
        doc.translate(stampX + stampW / 2, stampY + stampH / 2);
        doc.rotate(-7 + (rand() - 0.5) * 2);

        const outerX = -stampW / 2 + 4;
        const outerY = -stampH / 2 + 4;
        const outerW = stampW - 8;
        const outerH = stampH - 8;

        this._drawWornBorder(doc, outerX, outerY, outerW, outerH, 6, {
            color: inkColor, baseOpacity: 0.88, segments: 36, wobble: 0.7, rand
        });
        this._drawWornBorder(doc, outerX + 4, outerY + 4, outerW - 8, outerH - 8, 4, {
            color: inkColor, baseOpacity: 0.75, segments: 28, wobble: 0.5, rand, lineWidth: 0.6
        });

        this._drawInkText(doc, 'PAGADO', -stampW / 2, -22, {
            width: stampW, fontSize: 32, color: inkColor, rand
        });

        doc.save();
        doc.lineWidth(0.6).strokeColor(inkColor);
        const divX1 = outerX + 18;
        const divX2 = outerX + outerW - 18;
        let cursor = divX1;
        while (cursor < divX2) {
            const seg = 4 + rand() * 8;
            const gap = rand() < 0.18 ? 2 + rand() * 3 : 0;
            const x2 = Math.min(cursor + seg, divX2);
            const yOff = (rand() - 0.5) * 0.6;
            doc.opacity(0.55 + rand() * 0.3);
            doc.moveTo(cursor, 8 + yOff).lineTo(x2, 8 + yOff).stroke();
            cursor = x2 + gap;
        }
        doc.restore();

        this._drawInkText(doc, tenantName, -stampW / 2, 12, {
            width: stampW, fontSize: 8, color: inkColor, rand, jitter: 0.4
        });

        this._drawInkSplatter(doc, outerX, outerY, outerW, outerH, inkColor, rand);
        doc.opacity(1);
        doc.restore();

        if (paymentReport && paymentReport.status === 'CONFIRMED') {
            const sideX = stampX + stampW + 20;
            const sideY = stampY + 4;
            const sideW = pageWidth - sideX - 40;
            doc.fillColor('#374151').font('Helvetica-Bold').fontSize(10)
                .text('Detalle del pago confirmado', sideX, sideY, { width: sideW });
            const detail = [
                ['Banco emisor', paymentReport.banco_emisor || '-'],
                ['Referencia', paymentReport.ref_transferencia || '-'],
                ['Fecha de transferencia', paymentReport.fecha_transferencia || '-'],
                ['Monto abonado', formatVes(paymentReport.monto_abonado_ves != null ? paymentReport.monto_abonado_ves : invoice.paid_amount_ves)]
            ];
            detail.forEach((line, idx) => {
                const rowY = sideY + 16 + idx * 13;
                doc.fillColor('#6B7280').font('Helvetica').fontSize(8)
                    .text(line[0], sideX, rowY, { width: sideW * 0.48 });
                doc.fillColor('#111827').font('Helvetica-Bold').fontSize(8)
                    .text(line[1], sideX + sideW * 0.48, rowY, { width: sideW * 0.52, align: 'right' });
            });
        }

        doc.y = stampY + stampH + 20;
    }

    static _drawBranding(doc) {
        const range = doc.bufferedPageRange();
        const firstPage = range.start;
        doc.switchToPage(firstPage);

        const page = doc.page;
        const marginL = page.margins.left;
        const marginR = page.margins.right;
        const bottom = printableBottomY(doc);
        const brandW = TENANT_LOGO.brandPdfWidth;
        const brandH = TENANT_LOGO.brandPdfHeight;
        const logoX = page.width - marginR - brandW;
        const logoY = bottom - brandH - 2;

        const svg = getCondominio360WhiteLogoSvg();
        if (svg) {
            try {
                doc.save();
                doc.opacity(0.85);
                SVGtoPDF(doc, svg, logoX, logoY, {
                    width: brandW,
                    height: brandH,
                    preserveAspectRatio: 'xMidYMid meet'
                });
                doc.restore();
            } catch {
                doc.fillColor('#9CA3AF').font('Helvetica').fontSize(7)
                    .text('Condominio360', logoX, logoY + 6, { width: brandW, align: 'right' });
            }
        }

        const textY = bottom - brandH - 12;
        doc.fillColor('#D1D5DB').font('Helvetica').fontSize(6.5)
            .text(
                'Documento generado electrónicamente por Condominio360.',
                marginL, textY,
                { width: page.width - marginL - marginR, align: 'center', lineBreak: false }
            );
    }

    static _seedRandom(seedStr) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < seedStr.length; i++) {
            h ^= seedStr.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        let state = h >>> 0;
        return function () {
            state ^= state << 13; state >>>= 0;
            state ^= state >>> 17;
            state ^= state << 5; state >>>= 0;
            return ((state >>> 0) % 1000000) / 1000000;
        };
    }

    static _drawWornBorder(doc, x, y, w, h, r, opts = {}) {
        const {
            color = '#059669',
            baseOpacity = 0.85,
            segments = 32,
            wobble = 0.6,
            rand = Math.random,
            lineWidth
        } = opts;

        const pts = [];
        const top = [{ x: x + r, y }, { x: x + w - r, y }];
        const right = [{ x: x + w, y: y + r }, { x: x + w, y: y + h - r }];
        const bottom = [{ x: x + w - r, y: y + h }, { x: x + r, y: y + h }];
        const left = [{ x, y: y + h - r }, { x, y: y + r }];

        const sample = (a, b, n) => {
            for (let i = 0; i < n; i++) {
                const t = i / n;
                pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
            }
        };

        const arc = (cx, cy, startAng, endAng, n) => {
            for (let i = 0; i < n; i++) {
                const t = i / n;
                const ang = startAng + (endAng - startAng) * t;
                pts.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
            }
        };

        const perSide = Math.max(4, Math.floor(segments / 4));
        sample(top[0], top[1], perSide);
        arc(x + w - r, y + r, -Math.PI / 2, 0, Math.max(3, Math.floor(perSide / 3)));
        sample(right[0], right[1], perSide);
        arc(x + w - r, y + h - r, 0, Math.PI / 2, Math.max(3, Math.floor(perSide / 3)));
        sample(bottom[0], bottom[1], perSide);
        arc(x + r, y + h - r, Math.PI / 2, Math.PI, Math.max(3, Math.floor(perSide / 3)));
        sample(left[0], left[1], perSide);
        arc(x + r, y + r, Math.PI, Math.PI * 1.5, Math.max(3, Math.floor(perSide / 3)));

        doc.save();
        doc.strokeColor(color);

        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            if (rand() < 0.16) continue;
            const jitterAx = (rand() - 0.5) * wobble * 2;
            const jitterAy = (rand() - 0.5) * wobble * 2;
            const jitterBx = (rand() - 0.5) * wobble * 2;
            const jitterBy = (rand() - 0.5) * wobble * 2;
            doc.lineWidth(lineWidth != null ? lineWidth : (1.6 + rand() * 1.6));
            doc.opacity(Math.max(0.18, Math.min(1, baseOpacity * (0.55 + rand() * 0.7))));
            doc.moveTo(a.x + jitterAx, a.y + jitterAy)
                .lineTo(b.x + jitterBx, b.y + jitterBy)
                .stroke();
        }

        for (let i = 0; i < 14; i++) {
            const idx = Math.floor(rand() * pts.length);
            const p = pts[idx];
            doc.fillColor(color).opacity(0.25 + rand() * 0.4);
            const rr = 0.4 + rand() * 1.2;
            doc.circle(p.x + (rand() - 0.5) * 1.5, p.y + (rand() - 0.5) * 1.5, rr).fill();
        }

        doc.restore();
    }

    static _drawInkText(doc, text, x, y, opts = {}) {
        const {
            width = 200,
            fontSize = 12,
            color = '#059669',
            rand = Math.random,
            jitter = 0.7
        } = opts;

        doc.save();
        doc.font('Helvetica-Bold').fontSize(fontSize).fillColor(color);
        doc.opacity(0.18);
        doc.text(text, x + (rand() - 0.5) * jitter * 1.4, y + (rand() - 0.5) * jitter * 1.4,
            { width, align: 'center', lineBreak: false });
        doc.opacity(0.35);
        doc.text(text, x + (rand() - 0.5) * jitter, y + (rand() - 0.5) * jitter,
            { width, align: 'center', lineBreak: false });
        doc.opacity(0.92);
        doc.text(text, x, y, { width, align: 'center', lineBreak: false });
        doc.opacity(0.55);
        doc.text(text, x + jitter * 0.4, y + jitter * 0.3, { width, align: 'center', lineBreak: false });
        doc.restore();
    }

    static _drawInkSplatter(doc, x, y, w, h, color, rand) {
        doc.save();
        doc.fillColor(color);
        const drops = 14 + Math.floor(rand() * 10);
        for (let i = 0; i < drops; i++) {
            const edgePick = rand();
            let px; let py;
            if (edgePick < 0.25) {
                px = x - 4 - rand() * 18;
                py = y + rand() * h;
            } else if (edgePick < 0.5) {
                px = x + w + 4 + rand() * 18;
                py = y + rand() * h;
            } else if (edgePick < 0.75) {
                px = x + rand() * w;
                py = y - 4 - rand() * 14;
            } else {
                px = x + rand() * w;
                py = y + h + 4 + rand() * 14;
            }
            const r = 0.3 + rand() * 1.6;
            doc.opacity(0.2 + rand() * 0.5);
            doc.circle(px, py, r).fill();
        }
        doc.restore();
    }
}

module.exports = BillingInvoicePdfService;
