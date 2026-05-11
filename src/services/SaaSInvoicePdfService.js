const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');

const ASSETS_DIR = path.join(__dirname, '..', 'public', 'assets', 'images');
const CONDO_LOGO_BLACK_SVG = path.join(ASSETS_DIR, 'CONDOMINIO360-blacklogo.svg');
const INTELA_LOGO_PNG = path.join(ASSETS_DIR, 'png', 'main-intelawhite.png');
const FIRMA_PNG = path.join(ASSETS_DIR, 'Firma-JM.png');

const MONTH_NAMES_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

let intelaPngCache = null;
function getIntelaPngBuffer() {
    if (intelaPngCache !== null) return intelaPngCache || null;
    try {
        intelaPngCache = fs.readFileSync(INTELA_LOGO_PNG);
        return intelaPngCache;
    } catch (e) {
        console.error('No se pudo cargar logo Arsys Intela:', e.message);
        intelaPngCache = false;
        return null;
    }
}

let condoLogoSvgCache = null;
function getCondoLogoSvg() {
    if (condoLogoSvgCache !== null) return condoLogoSvgCache;
    try {
        condoLogoSvgCache = fs.readFileSync(CONDO_LOGO_BLACK_SVG, 'utf8');
    } catch (e) {
        condoLogoSvgCache = '';
    }
    return condoLogoSvgCache;
}

function formatVes(amount) {
    const n = Number(amount || 0);
    return 'Bs. ' + n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatUsd(amount) {
    const n = Number(amount || 0);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatRateDate(val) {
    if (!val) return 'N/A';
    const s = String(val).split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return 'N/A';
    const [y, m, d] = s.split('-');
    return `${parseInt(d, 10)} de ${MONTH_NAMES_ES[parseInt(m, 10) - 1].toLowerCase()} de ${y}`;
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

class SaaSInvoicePdfService {
    /**
     * Genera y envía el PDF de comprobante de pago al `res` de Express.
     * Estructura:
     *  - Header: logo Condominio360 | logo Arsys Intela
     *  - Datos de la factura y del condominio
     *  - Tabla de ítems
     *  - Totales (USD / VES + tasa BCV)
     *  - Sello PAGADO en verde
     *  - Firma + nombre del CEO
     */
    static streamPaidInvoice(res, invoice, paymentReport) {
        const filename = `Condominio360-Comprobante-${invoice.period_year}-${String(invoice.period_month).padStart(2, '0')}-${(invoice.tenant_name || 'condominio').replace(/[^a-z0-9-]+/gi, '_')}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');

        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 40, left: 40, right: 40, bottom: 8 }
        });
        doc.on('error', (err) => {
            console.error('PDFDocument error:', err);
            try { res.end(); } catch (_) { /* noop */ }
        });
        doc.pipe(res);

        this._drawHeader(doc);
        this._drawTitleAndMeta(doc, invoice);
        this._drawItemsTable(doc, invoice);
        this._drawTotals(doc, invoice);
        this._drawPaidStamp(doc, invoice, paymentReport);
        this._drawSignature(doc);

        doc.end();
    }

    static _drawHeader(doc) {
        const pageWidth = doc.page.width;
        const headerHeight = 90;

        doc.save();
        doc.rect(0, 0, pageWidth, headerHeight).fill('#0F172A');
        doc.restore();

        const padX = 40;
        const innerY = 18;
        const innerHeight = headerHeight - 36;

        const condoSvg = getCondoLogoSvg();
        const intelaPng = getIntelaPngBuffer();

        const condoMaxW = 200;
        const condoX = padX;
        const condoY = innerY;

        if (condoSvg) {
            try {
                SVGtoPDF(doc, condoSvg, condoX, condoY, {
                    width: condoMaxW,
                    height: innerHeight,
                    preserveAspectRatio: 'xMinYMid meet',
                    useCSS: false
                });
            } catch (e) {
                doc.save();
                doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20)
                    .text('Condominio360', condoX, condoY + 12);
                doc.restore();
            }
        }

        const sepX = pageWidth / 2 + 20;
        doc.save();
        doc.strokeColor('#FFFFFF').lineWidth(1).opacity(0.5);
        doc.moveTo(sepX, innerY).lineTo(sepX, innerY + innerHeight).stroke();
        doc.restore();

        if (intelaPng) {
            try {
                const intelaX = sepX + 20;
                const intelaMaxW = pageWidth - intelaX - padX;
                doc.image(intelaPng, intelaX, innerY + 4, {
                    fit: [intelaMaxW, innerHeight - 8],
                    align: 'left',
                    valign: 'center'
                });
            } catch (e) {
                doc.save();
                doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16)
                    .text('Arsys Intela', sepX + 20, innerY + 14);
                doc.restore();
            }
        } else {
            doc.save();
            doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16)
                .text('Arsys Intela', sepX + 20, innerY + 14);
            doc.restore();
        }

        doc.y = headerHeight + 24;
    }

    static _drawTitleAndMeta(doc, invoice) {
        const startX = 40;
        const pageWidth = doc.page.width;
        const rightX = pageWidth - 40;

        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(18)
            .text('Comprobante de Pago', startX, doc.y, { width: pageWidth - 80 });

        doc.moveDown(0.2);
        doc.fillColor('#6B7280').font('Helvetica').fontSize(10)
            .text('Cobros de plataforma Condominio360 — Documento generado tras la confirmación del pago', startX, doc.y, { width: pageWidth - 80 });

        doc.moveDown(0.8);

        const blockY = doc.y;
        const colWidth = (pageWidth - 80) / 2 - 10;

        const leftLines = [
            ['Condominio', invoice.tenant_name || '-'],
            ['Período facturado', `${MONTH_NAMES_ES[(invoice.period_month || 1) - 1]} ${invoice.period_year}`],
            ['Unidades cobradas', String(invoice.property_count || 0)],
            ['Tipo de cobro', invoice.billing_document_type === 'FISCAL' ? 'Factura fiscal (IVA + envío)' : 'Comprobante de cobro']
        ];
        const rightLines = [
            ['N° de factura', String(invoice.id).slice(0, 8).toUpperCase()],
            ['Tasa BCV aplicada', `Bs. ${Number(invoice.bcv_rate || 0).toLocaleString('es-VE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} / USD`],
            ['Fecha de la tasa', formatRateDate(invoice.bcv_rate_date)],
            ['Fecha de confirmación', formatDateTime(invoice.paid_at) || '-']
        ];

        this._drawMetaColumn(doc, leftLines, startX, blockY, colWidth);
        this._drawMetaColumn(doc, rightLines, startX + colWidth + 20, blockY, colWidth);

        const linesUsed = Math.max(leftLines.length, rightLines.length);
        doc.y = blockY + linesUsed * 16 + 18;
    }

    static _drawMetaColumn(doc, lines, x, y, width) {
        lines.forEach((line, idx) => {
            const [label, value] = line;
            const rowY = y + idx * 16;
            doc.fillColor('#6B7280').font('Helvetica').fontSize(9)
                .text(label, x, rowY, { width: width });
            doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10)
                .text(value, x, rowY + 0, { width: width, align: 'right' });
        });
    }

    static _drawItemsTable(doc, invoice) {
        const startX = 40;
        const pageWidth = doc.page.width;
        const tableWidth = pageWidth - 80;

        const colDesc = startX;
        const colQty = startX + tableWidth * 0.58;
        const colUnit = startX + tableWidth * 0.72;
        const colTotal = startX + tableWidth * 0.86;

        const headerY = doc.y;
        doc.save();
        doc.rect(startX, headerY, tableWidth, 22).fill('#F3F4F6');
        doc.restore();

        doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9);
        doc.text('Descripción', colDesc + 8, headerY + 7, { width: tableWidth * 0.58 - 8 });
        doc.text('Cant.', colQty, headerY + 7, { width: tableWidth * 0.14 - 4, align: 'right' });
        doc.text('P. unit.', colUnit, headerY + 7, { width: tableWidth * 0.14 - 4, align: 'right' });
        doc.text('Total', colTotal, headerY + 7, { width: tableWidth * 0.14 - 8, align: 'right' });

        let y = headerY + 22;
        const items = Array.isArray(invoice.items) ? invoice.items : [];

        doc.fillColor('#111827').font('Helvetica').fontSize(10);
        items.forEach((it, idx) => {
            const rowHeight = 22;
            if (idx % 2 === 1) {
                doc.save();
                doc.rect(startX, y, tableWidth, rowHeight).fill('#FAFAFA');
                doc.restore();
            }
            doc.fillColor('#111827').font('Helvetica').fontSize(10);
            doc.text(it.description || '-', colDesc + 8, y + 6, { width: tableWidth * 0.58 - 8, ellipsis: true });
            doc.text(Number(it.quantity || 0).toLocaleString('es-VE'), colQty, y + 6, { width: tableWidth * 0.14 - 4, align: 'right' });
            doc.text(formatUsd(it.unit_price_usd), colUnit, y + 6, { width: tableWidth * 0.14 - 4, align: 'right' });
            doc.text(formatUsd(it.total_usd), colTotal, y + 6, { width: tableWidth * 0.14 - 8, align: 'right' });
            y += rowHeight;
        });

        doc.save();
        doc.strokeColor('#E5E7EB').lineWidth(0.5);
        doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
        doc.restore();

        doc.y = y + 12;
    }

    static _drawTotals(doc, invoice) {
        const startX = 40;
        const pageWidth = doc.page.width;
        const tableWidth = pageWidth - 80;
        const boxX = startX + tableWidth * 0.5;
        const boxWidth = tableWidth * 0.5;
        let y = doc.y;

        doc.save();
        doc.rect(boxX, y, boxWidth, 60).fill('#F9FAFB');
        doc.restore();

        doc.fillColor('#6B7280').font('Helvetica').fontSize(10)
            .text('Total USD', boxX + 12, y + 10, { width: boxWidth / 2 - 12 });
        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12)
            .text(formatUsd(invoice.total_usd), boxX + boxWidth / 2, y + 8, { width: boxWidth / 2 - 12, align: 'right' });

        doc.fillColor('#6B7280').font('Helvetica').fontSize(10)
            .text('Total Bs.', boxX + 12, y + 34, { width: boxWidth / 2 - 12 });
        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12)
            .text(formatVes(invoice.total_ves), boxX + boxWidth / 2, y + 32, { width: boxWidth / 2 - 12, align: 'right' });

        doc.y = y + 78;
    }

    static _drawPaidStamp(doc, invoice, paymentReport) {
        const pageWidth = doc.page.width;
        const startX = 40;
        const stampX = startX;
        const stampY = doc.y;
        const stampW = 230;
        const stampH = 110;

        const inkColor = '#1E3A8A';

        const rand = this._seedRandom(invoice && invoice.id ? String(invoice.id) : 'seed-default');

        doc.save();
        doc.translate(stampX + stampW / 2, stampY + stampH / 2);
        doc.rotate(-7 + (rand() - 0.5) * 2);

        const outerX = -stampW / 2 + 4;
        const outerY = -stampH / 2 + 4;
        const outerW = stampW - 8;
        const outerH = stampH - 8;

        this._drawWornBorder(doc, outerX, outerY, outerW, outerH, 6, {
            color: inkColor,
            baseOpacity: 0.88,
            segments: 36,
            wobble: 0.7,
            rand
        });
        this._drawWornBorder(doc, outerX + 4, outerY + 4, outerW - 8, outerH - 8, 4, {
            color: inkColor,
            baseOpacity: 0.75,
            segments: 28,
            wobble: 0.5,
            rand,
            lineWidth: 0.6
        });

        this._drawInkText(doc, 'PAGADO', -stampW / 2, -24, {
            width: stampW, fontSize: 34, color: inkColor, rand
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
            doc.moveTo(cursor, 10 + yOff).lineTo(x2, 10 + yOff).stroke();
            cursor = x2 + gap;
        }
        doc.restore();

        this._drawInkText(doc, 'Confirmado por Arsys Intela', -stampW / 2, 14, {
            width: stampW, fontSize: 8.5, color: inkColor, rand, jitter: 0.4
        });
        this._drawInkText(doc, 'RIF J-502314547', -stampW / 2, 27, {
            width: stampW, fontSize: 8, color: inkColor, rand, jitter: 0.4
        });

        this._drawInkSplatter(doc, outerX, outerY, outerW, outerH, inkColor, rand);

        doc.opacity(1);
        doc.restore();

        const sideX = stampX + stampW + 24;
        const sideY = stampY + 6;
        const sideW = pageWidth - sideX - 40;

        doc.fillColor('#374151').font('Helvetica-Bold').fontSize(11)
            .text('Detalle del pago confirmado', sideX, sideY, { width: sideW });

        const r = paymentReport || {};
        const detail = [
            ['Banco emisor', r.banco_emisor || '-'],
            ['Referencia', r.ref_transferencia || '-'],
            ['Fecha de transferencia', r.fecha_transferencia || '-'],
            ['Monto abonado', formatVes(r.monto_abonado_ves != null ? r.monto_abonado_ves : invoice.paid_amount_ves)]
        ];
        detail.forEach((line, idx) => {
            const rowY = sideY + 18 + idx * 14;
            doc.fillColor('#6B7280').font('Helvetica').fontSize(9)
                .text(line[0], sideX, rowY, { width: sideW * 0.5 });
            doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9)
                .text(line[1], sideX + sideW * 0.5, rowY, { width: sideW * 0.5, align: 'right' });
        });

        doc.y = stampY + stampH + 24;
    }

    static _drawSignature(doc) {
        const startX = 40;
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        const sigBoxW = 320;
        const sigBoxX = pageWidth - 40 - sigBoxW;

        const firmaW = 190;
        const firmaH = 66;

        const footerHeight = 28;
        const footerGap = 10;
        const labelsHeight = 32;
        const blockBottom = pageHeight - footerHeight - footerGap;
        const firmaTop = blockBottom - labelsHeight - firmaH + 6;

        const firmaPath = FIRMA_PNG;
        let firmaPlaced = false;
        if (fs.existsSync(firmaPath)) {
            try {
                const fx = sigBoxX + (sigBoxW - firmaW) / 2;
                const fy = firmaTop;
                doc.save();
                doc.opacity(0.85);
                doc.image(firmaPath, fx,         fy,         { fit: [firmaW, firmaH], align: 'center' });
                doc.image(firmaPath, fx + 0.6,   fy,         { fit: [firmaW, firmaH], align: 'center' });
                doc.image(firmaPath, fx,         fy + 0.6,   { fit: [firmaW, firmaH], align: 'center' });
                doc.image(firmaPath, fx + 0.6,   fy + 0.6,   { fit: [firmaW, firmaH], align: 'center' });
                doc.restore();
                firmaPlaced = true;
            } catch (e) {
                firmaPlaced = false;
            }
        }

        const lineY = firmaTop + (firmaPlaced ? firmaH - 6 : 28);
        doc.save();
        doc.strokeColor('#111827').lineWidth(0.8);
        doc.moveTo(sigBoxX + 24, lineY).lineTo(sigBoxX + sigBoxW - 24, lineY).stroke();
        doc.restore();

        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10)
            .text('JONATHAN ALEXANDER MELÉNDEZ DURÁN', sigBoxX, lineY + 4, {
                width: sigBoxW, align: 'center', lineBreak: false
            });
        doc.fillColor('#6B7280').font('Helvetica').fontSize(9)
            .text('CEO — Arsys Intela', sigBoxX, lineY + 17, {
                width: sigBoxW, align: 'center', lineBreak: false
            });

        const footerY = pageHeight - footerHeight;
        doc.save();
        doc.strokeColor('#E5E7EB').lineWidth(0.5);
        doc.moveTo(startX, footerY - 8).lineTo(pageWidth - startX, footerY - 8).stroke();
        doc.restore();

        doc.fillColor('#9CA3AF').font('Helvetica').fontSize(8)
            .text(
                'Documento generado electrónicamente por la plataforma Condominio360.   |   ©2022 Arsys Technology 1122 C.A — RIF J-502314547',
                startX, footerY,
                { width: pageWidth - 80, align: 'center', lineBreak: false }
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
            state ^= state << 5;  state >>>= 0;
            return ((state >>> 0) % 1000000) / 1000000;
        };
    }

    static _drawWornBorder(doc, x, y, w, h, r, opts = {}) {
        const {
            color = '#1E3A8A',
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
            color = '#1E3A8A',
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
        doc.text(text, x, y,
            { width, align: 'center', lineBreak: false });

        doc.opacity(0.55);
        doc.text(text, x + jitter * 0.4, y + jitter * 0.3,
            { width, align: 'center', lineBreak: false });

        doc.restore();
    }

    static _drawInkSplatter(doc, x, y, w, h, color, rand) {
        doc.save();
        doc.fillColor(color);

        const drops = 14 + Math.floor(rand() * 10);
        for (let i = 0; i < drops; i++) {
            const edgePick = rand();
            let px, py;
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

            if (rand() < 0.45) {
                const tail = 2 + rand() * 5;
                const ang = rand() * Math.PI * 2;
                doc.opacity(0.18 + rand() * 0.25);
                doc.circle(px + Math.cos(ang) * tail, py + Math.sin(ang) * tail, r * 0.4).fill();
            }
        }

        const interior = 18 + Math.floor(rand() * 16);
        for (let i = 0; i < interior; i++) {
            const px = x + 4 + rand() * (w - 8);
            const py = y + 4 + rand() * (h - 8);
            const r = 0.2 + rand() * 0.7;
            doc.opacity(0.06 + rand() * 0.18);
            doc.circle(px, py, r).fill();
        }

        for (let i = 0; i < 6; i++) {
            const startEdge = rand() < 0.5 ? 'top' : 'side';
            let sx, sy, ex, ey;
            if (startEdge === 'top') {
                sx = x + 10 + rand() * (w - 20);
                sy = y + 1;
                ex = sx + (rand() - 0.5) * 2;
                ey = sy + 6 + rand() * 14;
            } else {
                const left = rand() < 0.5;
                sx = left ? x + 1 : x + w - 1;
                sy = y + 10 + rand() * (h - 20);
                ex = sx + (left ? -1 : 1) * (4 + rand() * 10);
                ey = sy + (rand() - 0.5) * 3;
            }
            doc.opacity(0.12 + rand() * 0.18);
            doc.lineWidth(0.4 + rand() * 0.5).strokeColor(color);
            doc.moveTo(sx, sy).lineTo(ex, ey).stroke();
        }

        doc.restore();
    }
}

module.exports = SaaSInvoicePdfService;
