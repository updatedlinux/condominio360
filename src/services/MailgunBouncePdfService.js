const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');

const ASSETS_DIR = path.join(__dirname, '..', 'public', 'assets', 'images');
const CONDO_LOGO_BLACK_SVG = path.join(ASSETS_DIR, 'CONDOMINIO360-blacklogo.svg');
const INTELA_LOGO_PNG = path.join(ASSETS_DIR, 'png', 'main-intelawhite.png');

const COLORS = {
    slate900: '#0F172A',
    slate700: '#334155',
    slate500: '#64748B',
    slate200: '#E2E8F0',
    slate50: '#F8FAFC',
    rose600: '#E11D48',
    rose50: '#FFF1F2',
    emerald700: '#047857',
    emerald50: '#ECFDF5',
    amber700: '#B45309',
    amber50: '#FFFBEB',
    orange500: '#F97316'
};

const MARGINS = { top: 40, left: 40, right: 40, bottom: 52 };
const HEADER_H = 88;
const ACCENT_H = 4;
const FOOTER_H = 36;

let condoLogoSvgCache = null;
let intelaPngCache = null;

function getCondoLogoSvg() {
    if (condoLogoSvgCache !== null) return condoLogoSvgCache;
    try {
        condoLogoSvgCache = fs.readFileSync(CONDO_LOGO_BLACK_SVG, 'utf8');
    } catch {
        condoLogoSvgCache = '';
    }
    return condoLogoSvgCache;
}

function getIntelaPng() {
    if (intelaPngCache !== null) return intelaPngCache || null;
    try {
        intelaPngCache = fs.readFileSync(INTELA_LOGO_PNG);
        return intelaPngCache;
    } catch {
        intelaPngCache = false;
        return null;
    }
}

function formatDateTimeEs() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${pad(d.getDate())} de ${months[d.getMonth()]} de ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatUtcShort(val) {
    if (!val) return '—';
    try {
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return String(val);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} UTC`;
    } catch {
        return String(val);
    }
}

function safeFilenamePart(name) {
    return String(name || 'condominio').replace(/[^a-z0-9-]+/gi, '_').slice(0, 60);
}

class MailgunBouncePdfService {
    /**
     * Genera PDF estilizado del reporte de rebotes Mailgun.
     * @param {import('express').Response} res
     * @param {{ tenantName: string, summary: object, rows: object[], includeUnmatched?: boolean }} payload
     */
    static streamReport(res, payload) {
        const tenantName = payload.tenantName || 'Condominio';
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        const summary = payload.summary || {};
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `Rebotes-Mailgun-${safeFilenamePart(tenantName)}-${stamp}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');

        const doc = new PDFDocument({
            size: 'A4',
            margins: MARGINS,
            bufferPages: true
        });
        doc.on('error', (err) => {
            console.error('MailgunBouncePdf error:', err);
            try { res.end(); } catch (_) { /* noop */ }
        });
        doc.pipe(res);

        const ctx = {
            tenantName,
            summary,
            rows,
            includeUnmatched: !!payload.includeUnmatched,
            tableHeaderY: null
        };

        this._drawPageHeader(doc, ctx);
        this._drawTitleBlock(doc, ctx);
        this._drawSummaryCards(doc, ctx);
        this._drawTable(doc, ctx);
        this._drawFooters(doc, ctx);

        doc.end();
    }

    static _contentWidth(doc) {
        return doc.page.width - MARGINS.left - MARGINS.right;
    }

    static _contentBottom(doc) {
        return doc.page.height - MARGINS.bottom - FOOTER_H;
    }

    static _drawPageHeader(doc, ctx) {
        const pageWidth = doc.page.width;

        doc.save();
        doc.rect(0, 0, pageWidth, HEADER_H).fill(COLORS.slate900);
        doc.rect(0, HEADER_H, pageWidth, ACCENT_H).fill(COLORS.orange500);
        doc.restore();

        const padX = MARGINS.left;
        const innerY = 16;
        const innerH = HEADER_H - 32;

        const condoSvg = getCondoLogoSvg();
        if (condoSvg) {
            try {
                SVGtoPDF(doc, condoSvg, padX, innerY, {
                    width: 190,
                    height: innerH,
                    preserveAspectRatio: 'xMinYMid meet',
                    useCSS: false
                });
            } catch {
                doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18)
                    .text('Condominio360', padX, innerY + 10);
            }
        }

        const sepX = pageWidth / 2 + 16;
        doc.save();
        doc.strokeColor('#FFFFFF').lineWidth(0.8).opacity(0.35);
        doc.moveTo(sepX, innerY).lineTo(sepX, innerY + innerH).stroke();
        doc.restore();

        const intelaPng = getIntelaPng();
        const intelaX = sepX + 18;
        if (intelaPng) {
            try {
                doc.image(intelaPng, intelaX, innerY + 2, {
                    fit: [pageWidth - intelaX - padX, innerH - 4],
                    align: 'left',
                    valign: 'center'
                });
            } catch {
                doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15)
                    .text('Arsys Intela', intelaX, innerY + 12);
            }
        } else {
            doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15)
                .text('Arsys Intela', intelaX, innerY + 12);
        }

        doc.y = HEADER_H + ACCENT_H + 22;
    }

    static _drawTitleBlock(doc, ctx) {
        const startX = MARGINS.left;
        const width = this._contentWidth(doc);

        doc.fillColor(COLORS.slate900).font('Helvetica-Bold').fontSize(20)
            .text('Reporte de correos rebotados', startX, doc.y, { width });

        doc.moveDown(0.15);
        doc.fillColor(COLORS.rose600).font('Helvetica-Bold').fontSize(11)
            .text('Mailgun · Entregabilidad', startX, doc.y, { width });

        doc.moveDown(0.35);
        doc.fillColor(COLORS.slate700).font('Helvetica').fontSize(10)
            .text(`Condominio: ${ctx.tenantName}`, startX, doc.y, { width });

        const periodLabel = ctx.summary?.date_range?.label;
        if (periodLabel) {
            doc.moveDown(0.15);
            doc.fillColor(COLORS.slate700).font('Helvetica-Bold').fontSize(9.5)
                .text(`Período analizado (CSV Mailgun): ${periodLabel}`, startX, doc.y, { width });
        }

        doc.moveDown(0.15);
        doc.fillColor(COLORS.slate500).font('Helvetica').fontSize(9)
            .text(`Reporte generado el ${formatDateTimeEs()}`, startX, doc.y, { width });

        if (ctx.includeUnmatched) {
            doc.moveDown(0.15);
            doc.fillColor(COLORS.amber700).font('Helvetica-Oblique').fontSize(8.5)
                .text('Incluye correos no asociados a propietarios de este condominio.', startX, doc.y, { width });
        }

        doc.moveDown(0.9);
    }

    static _drawSummaryCards(doc, ctx) {
        const s = ctx.summary;
        const startX = MARGINS.left;
        const width = this._contentWidth(doc);
        const gap = 8;
        const cardW = (width - gap * 3) / 4;
        const cardH = 52;
        const y = doc.y;

        const cards = [
            { label: 'Filas CSV', value: s.total_csv_rows ?? '—', bg: COLORS.slate50, fg: COLORS.slate900, sub: COLORS.slate500 },
            { label: 'Correos fallidos', value: s.unique_failed_emails ?? '—', bg: COLORS.rose50, fg: COLORS.rose600, sub: COLORS.rose600 },
            { label: 'En este condominio', value: s.matched_in_tenant ?? '—', bg: COLORS.emerald50, fg: COLORS.emerald700, sub: COLORS.emerald700 },
            { label: 'Fuera del condominio', value: s.not_in_tenant ?? '—', bg: COLORS.amber50, fg: COLORS.amber700, sub: COLORS.amber700 }
        ];

        cards.forEach((card, i) => {
            const x = startX + i * (cardW + gap);
            doc.save();
            doc.roundedRect(x, y, cardW, cardH, 6).fill(card.bg);
            doc.restore();
            doc.save();
            doc.roundedRect(x, y, cardW, cardH, 6).lineWidth(0.5).strokeColor(COLORS.slate200).stroke();
            doc.restore();

            doc.fillColor(card.sub).font('Helvetica').fontSize(7.5)
                .text(card.label, x + 8, y + 8, { width: cardW - 16 });
            doc.fillColor(card.fg).font('Helvetica-Bold').fontSize(16)
                .text(String(card.value), x + 8, y + 22, { width: cardW - 16 });
        });

        doc.y = y + cardH + 18;
    }

    static _tableColumns(doc) {
        const startX = MARGINS.left;
        const w = this._contentWidth(doc);
        return {
            startX,
            tableW: w,
            cols: [
                { key: 'email', label: 'Correo fallido', x: startX, w: w * 0.20 },
                { key: 'owner', label: 'Propietario', x: startX + w * 0.20, w: w * 0.22 },
                { key: 'props', label: 'Inmueble(s)', x: startX + w * 0.42, w: w * 0.18 },
                { key: 'phone', label: 'Teléfono', x: startX + w * 0.60, w: w * 0.12 },
                { key: 'error', label: 'Qué pasó', x: startX + w * 0.72, w: w * 0.28 }
            ]
        };
    }

    static _drawTableHeader(doc) {
        const { startX, tableW, cols } = this._tableColumns(doc);
        const headerY = doc.y;
        const headerH = 22;

        doc.save();
        doc.rect(startX, headerY, tableW, headerH).fill(COLORS.rose600);
        doc.restore();

        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
        cols.forEach((col) => {
            doc.text(col.label, col.x + 6, headerY + 7, { width: col.w - 10, lineBreak: false });
        });

        doc.y = headerY + headerH;
        return headerY;
    }

    static _rowCellTexts(row) {
        const owner = row.owner;
        const ownerLines = owner
            ? [owner.name || '—', owner.dni ? `CI: ${owner.dni}` : null, owner.primary_email && owner.primary_email.toLowerCase() !== row.email
                ? owner.primary_email : null].filter(Boolean).join('\n')
            : 'No registrado en este condominio';
        const otherNote = owner && owner.other_tenants && owner.other_tenants.length
            ? `\nTambién en: ${owner.other_tenants.join(', ')}`
            : '';
        const errorText = [
            row.error?.summary || '—',
            row.error?.technical ? `(${row.error.technical})` : null,
            row.last_failure_at ? formatUtcShort(row.last_failure_at) : null
        ].filter(Boolean).join('\n');

        return {
            email: row.email || '—',
            owner: ownerLines + otherNote,
            props: owner ? (owner.properties_label || '—') : '—',
            phone: owner?.phone || '—',
            error: errorText
        };
    }

    static _measureRowHeight(doc, texts, cols, minH = 28) {
        let maxH = minH;
        const keys = ['email', 'owner', 'props', 'phone', 'error'];
        keys.forEach((key, idx) => {
            const h = doc.heightOfString(texts[key], {
                width: cols[idx].w - 12,
                align: 'left'
            });
            maxH = Math.max(maxH, h + 14);
        });
        return maxH;
    }

    static _ensureTableSpace(doc, ctx, neededH) {
        if (doc.y + neededH <= this._contentBottom(doc)) return;

        doc.addPage();
        this._drawMiniHeader(doc, ctx);
        this._drawTableHeader(doc);
    }

    static _drawMiniHeader(doc, ctx) {
        const pageWidth = doc.page.width;
        doc.save();
        doc.rect(0, 0, pageWidth, 28).fill(COLORS.slate900);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
            .text(`Rebotes Mailgun — ${ctx.tenantName}`, MARGINS.left, 9, {
                width: this._contentWidth(doc),
                align: 'left',
                lineBreak: false
            });
        doc.restore();
        doc.y = 38;
    }

    static _drawTable(doc, ctx) {
        if (!ctx.rows.length) {
            doc.fillColor(COLORS.slate500).font('Helvetica-Oblique').fontSize(10)
                .text('No hay registros para mostrar en este reporte.', MARGINS.left, doc.y);
            return;
        }

        this._drawTableHeader(doc);
        const { startX, tableW, cols } = this._tableColumns(doc);

        ctx.rows.forEach((row, idx) => {
            const texts = this._rowCellTexts(row);
            const rowH = this._measureRowHeight(doc, texts, cols);
            this._ensureTableSpace(doc, ctx, rowH);

            const y = doc.y;
            const bg = !row.matched_in_tenant
                ? COLORS.amber50
                : (idx % 2 === 1 ? COLORS.slate50 : '#FFFFFF');

            doc.save();
            doc.rect(startX, y, tableW, rowH).fill(bg);
            doc.restore();

            const keys = ['email', 'owner', 'props', 'phone', 'error'];
            keys.forEach((key, i) => {
                const col = cols[i];
                const isEmail = key === 'email';
                doc.fillColor(isEmail ? COLORS.slate700 : COLORS.slate900)
                    .font(isEmail ? 'Helvetica' : 'Helvetica')
                    .fontSize(isEmail ? 7.5 : 8)
                    .text(texts[key], col.x + 6, y + 7, {
                        width: col.w - 12,
                        align: 'left',
                        lineGap: 1
                    });
            });

            doc.save();
            doc.strokeColor(COLORS.slate200).lineWidth(0.4);
            doc.moveTo(startX, y + rowH).lineTo(startX + tableW, y + rowH).stroke();
            doc.restore();

            doc.y = y + rowH;
        });

        doc.moveDown(0.6);
        doc.fillColor(COLORS.slate500).font('Helvetica').fontSize(7.5)
            .text(
                `${ctx.rows.length} registro(s) en este reporte. Documento generado electrónicamente por Condominio360 en alianza con Arsys Intela.`,
                MARGINS.left,
                doc.y,
                { width: this._contentWidth(doc), align: 'left' }
            );
    }

    static _drawFooters(doc) {
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            const pageWidth = doc.page.width;
            const pageHeight = doc.page.height;
            const y = pageHeight - MARGINS.bottom + 8;

            doc.save();
            doc.strokeColor(COLORS.slate200).lineWidth(0.5);
            doc.moveTo(MARGINS.left, y - 6).lineTo(pageWidth - MARGINS.right, y - 6).stroke();
            doc.restore();

            doc.fillColor(COLORS.slate500).font('Helvetica').fontSize(7)
                .text('Condominio360 · Arsys Intela', MARGINS.left, y, {
                    width: this._contentWidth(doc) / 2,
                    align: 'left',
                    lineBreak: false
                });

            doc.fillColor(COLORS.slate500).font('Helvetica').fontSize(7)
                .text(`Página ${i - range.start + 1} de ${range.count}`, MARGINS.left, y, {
                    width: this._contentWidth(doc),
                    align: 'right',
                    lineBreak: false
                });
        }
    }
}

module.exports = MailgunBouncePdfService;
