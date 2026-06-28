const PDFDocument = require('pdfkit');
const { formatDamageLabels } = require('../constants/earthquakeCensusDamages');
const EarthquakeCensusPhotoZipService = require('./EarthquakeCensusPhotoZipService');

const COLORS = {
    slate900: '#0F172A',
    slate700: '#334155',
    slate500: '#64748B',
    slate200: '#E2E8F0',
    slate100: '#F1F5F9',
    slate50: '#F8FAFC',
    orange500: '#F97316',
    rose600: '#E11D48',
    rose50: '#FFF1F2'
};

const MARGINS = { top: 44, left: 40, right: 40, bottom: 48 };

const TABLE_COLS = {
    num: 22,
    name: 112,
    cedula: 72,
    age: 32,
    birth: 58,
    occupation: 88,
    disability: 90
};

function formatDisabilityCell(member) {
    if (!member.has_disability) return 'No';
    const notes = String(member.disability_notes || '').trim();
    return notes ? `Sí — ${notes}` : 'Sí';
}

function formatDateEs(val) {
    if (!val) return '—';
    try {
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return String(val);
        const pad = (n) => String(n).padStart(2, '0');
        const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        return `${pad(d.getDate())}/${months[d.getMonth()]}/${d.getFullYear()}`;
    } catch {
        return String(val);
    }
}

function formatDateTimeEs() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${pad(d.getDate())} de ${months[d.getMonth()]} de ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function safeFilenamePart(name) {
    return String(name || 'condominio').replace(/[^a-z0-9-]+/gi, '_').slice(0, 50);
}

function compareLabel(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'es', { numeric: true, sensitivity: 'base' });
}

function groupSubmissionsByBuilding(submissions) {
    const map = new Map();
    for (const s of submissions) {
        const key = (s.building_label || 'Sin edificio / calle').trim();
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(s);
    }
    for (const list of map.values()) {
        list.sort((a, b) => compareLabel(a.apartment_label, b.apartment_label));
    }
    return [...map.entries()].sort((a, b) => compareLabel(a[0], b[0]));
}

class EarthquakeCensusPdfService {
    static groupSubmissionsByBuilding(submissions) {
        return groupSubmissionsByBuilding(submissions);
    }

    /**
     * @param {{ tenantName: string, submissions: Array, baseUrl?: string }} payload
     * @returns {Promise<Buffer>}
     */
    static generate(payload) {
        const { tenantName, submissions = [] } = payload;
        const groups = groupSubmissionsByBuilding(submissions);
        const totalMembers = submissions.reduce((acc, s) => acc + (s.members?.length || 0), 0);
        const withDisability = submissions.reduce(
            (acc, s) => acc + (s.members || []).filter((m) => m.has_disability).length,
            0
        );
        const withPhotos = submissions.filter((s) => (s.photo_count || s.photos?.length || 0) > 0).length;

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'LETTER', margins: MARGINS, bufferPages: true });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const pageWidth = doc.page.width - MARGINS.left - MARGINS.right;
            let y = MARGINS.top;

            const ensureSpace = (needed) => {
                if (y + needed > doc.page.height - MARGINS.bottom) {
                    doc.addPage();
                    y = MARGINS.top;
                }
            };

            // Portada / resumen
            doc.fillColor(COLORS.orange500).fontSize(10).font('Helvetica-Bold')
                .text('CONDOMINIO360 — CENSO DE EMERGENCIA', MARGINS.left, y);
            y += 14;
            doc.fillColor(COLORS.slate900).fontSize(18).font('Helvetica-Bold')
                .text('Reporte Protección Civil', MARGINS.left, y);
            y += 24;
            doc.fillColor(COLORS.slate700).fontSize(11).font('Helvetica').text(tenantName, MARGINS.left, y);
            y += 16;
            doc.fillColor(COLORS.slate500).fontSize(9).text(`Generado: ${formatDateTimeEs()}`, MARGINS.left, y);
            y += 20;

            doc.moveTo(MARGINS.left, y).lineTo(MARGINS.left + pageWidth, y)
                .strokeColor(COLORS.orange500).lineWidth(2).stroke();
            y += 16;

            doc.fillColor(COLORS.slate700).fontSize(10).font('Helvetica-Bold');
            doc.text(`Unidades: ${submissions.length}`, MARGINS.left, y);
            doc.text(`Personas: ${totalMembers}`, MARGINS.left + 120, y);
            doc.text(`Discapacidad: ${withDisability}`, MARGINS.left + 220, y);
            doc.text(`Con fotos: ${withPhotos}`, MARGINS.left + 340, y);
            y += 22;

            if (!submissions.length) {
                doc.fillColor(COLORS.slate500).fontSize(11).font('Helvetica')
                    .text('No hay registros de censo todavía.', MARGINS.left, y);
                doc.end();
                return;
            }

            // Índice por edificio
            doc.fillColor(COLORS.slate900).fontSize(11).font('Helvetica-Bold').text('Índice por edificio / calle', MARGINS.left, y);
            y += 16;
            doc.font('Helvetica').fontSize(9).fillColor(COLORS.slate700);
            for (const [building, units] of groups) {
                ensureSpace(14);
                const people = units.reduce((n, u) => n + (u.members?.length || 0), 0);
                doc.text(`• ${building} — ${units.length} unidad(es), ${people} persona(s)`, MARGINS.left + 8, y);
                y += 13;
            }
            y += 10;

            // Detalle por edificio
            for (const [building, units] of groups) {
                ensureSpace(36);
                doc.addPage();
                y = MARGINS.top;

                doc.rect(MARGINS.left, y, pageWidth, 28).fill(COLORS.slate900);
                doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold')
                    .text(building, MARGINS.left + 10, y + 8, { width: pageWidth - 20 });
                y += 38;

                doc.fillColor(COLORS.slate500).fontSize(9).font('Helvetica')
                    .text(`${units.length} apartamento(s) registrado(s)`, MARGINS.left, y);
                y += 18;

                for (const s of units) {
                    const memberCount = s.members?.length || 0;
                    const blockMin = 70 + Math.max(memberCount, 1) * 16 + 20;
                    ensureSpace(blockMin);

                    doc.fillColor(COLORS.orange500).fontSize(11).font('Helvetica-Bold')
                        .text(`Apartamento ${s.apartment_label}`, MARGINS.left, y);
                    y += 16;

                    doc.fillColor(COLORS.slate700).fontSize(8.5).font('Helvetica');
                    doc.text(
                        `Tel: ${s.contact_phone || '—'}  |  Email: ${s.contact_email || '—'}  |  Actualizado: ${formatDateEs(s.updated_at || s.submitted_at)}`,
                        MARGINS.left, y, { width: pageWidth }
                    );
                    y += 14;

                    const damageLabels = formatDamageLabels(s.damage_types || []);
                    if (damageLabels.length || s.damage_notes) {
                        doc.fillColor(COLORS.rose600).font('Helvetica-Bold').fontSize(8.5)
                            .text(`Daños: ${damageLabels.join('; ') || '—'}${s.damage_notes ? ` — ${s.damage_notes}` : ''}`, MARGINS.left, y, { width: pageWidth });
                        y += doc.heightOfString('x', { width: pageWidth }) + 4;
                    }

                    if (s.notes) {
                        doc.fillColor(COLORS.slate500).font('Helvetica').fontSize(8)
                            .text(`Notas: ${s.notes}`, MARGINS.left, y, { width: pageWidth });
                        y += doc.heightOfString(`Notas: ${s.notes}`, { width: pageWidth }) + 4;
                    }

                    const photoCount = s.photo_count || s.photos?.length || 0;
                    if (photoCount > 0 && s.photos_zip_token) {
                        const url = EarthquakeCensusPhotoZipService.getPublicUrl(s.photos_zip_token);
                        doc.fillColor(COLORS.rose600).font('Helvetica-Bold').fontSize(8.5)
                            .text(`Fotos de daños (${photoCount}): descargar ZIP — ${url}`, MARGINS.left, y, { width: pageWidth, link: url, underline: true });
                        y += doc.heightOfString(url, { width: pageWidth }) + 6;
                    }

                    // Tabla integrantes
                    y = this._drawMembersTable(doc, s.members || [], MARGINS.left, y, pageWidth, ensureSpace);
                    y += 16;

                    doc.moveTo(MARGINS.left, y).lineTo(MARGINS.left + pageWidth, y)
                        .strokeColor(COLORS.slate200).lineWidth(0.5).stroke();
                    y += 12;
                }
            }

            const range = doc.bufferedPageRange();
            for (let p = range.start; p < range.start + range.count; p++) {
                doc.switchToPage(p);
                doc.fillColor(COLORS.slate500).fontSize(8).font('Helvetica')
                    .text(
                        `Censo terremoto — ${tenantName} — Pág. ${p + 1}/${range.count}`,
                        MARGINS.left,
                        doc.page.height - MARGINS.bottom + 16,
                        { width: pageWidth, align: 'center' }
                    );
            }

            doc.end();
        });
    }

    static _drawMembersTable(doc, members, x, startY, pageWidth, ensureSpace) {
        let y = startY;
        if (!members.length) {
            doc.fillColor(COLORS.slate500).fontSize(8.5).font('Helvetica')
                .text('Sin integrantes registrados.', x, y);
            return y + 14;
        }

        const rowH = 15;
        const headerH = 18;
        ensureSpace(headerH + rowH * Math.min(members.length, 3));

        doc.fillColor(COLORS.slate100).rect(x, y, pageWidth, headerH).fill();
        doc.fillColor(COLORS.slate700).fontSize(7.5).font('Helvetica-Bold');
        let cx = x + 4;
        doc.text('#', cx, y + 5, { width: TABLE_COLS.num - 4 });
        cx += TABLE_COLS.num;
        doc.text('Nombre y apellido', cx, y + 5, { width: TABLE_COLS.name - 4 });
        cx += TABLE_COLS.name;
        doc.text('Cédula', cx, y + 5, { width: TABLE_COLS.cedula - 4 });
        cx += TABLE_COLS.cedula;
        doc.text('Edad', cx, y + 5, { width: TABLE_COLS.age - 4 });
        cx += TABLE_COLS.age;
        doc.text('Nac.', cx, y + 5, { width: TABLE_COLS.birth - 4 });
        cx += TABLE_COLS.birth;
        doc.text('Ocupación / instrucción', cx, y + 5, { width: TABLE_COLS.occupation - 4 });
        cx += TABLE_COLS.occupation;
        doc.text('Discapacidad', cx, y + 5, { width: TABLE_COLS.disability - 4 });
        y += headerH;

        doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.slate900);
        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const discText = formatDisabilityCell(m);
            const discW = TABLE_COLS.disability - 4;
            const rowH = Math.max(15, doc.heightOfString(discText, { width: discW, lineBreak: true }) + 8);

            ensureSpace(rowH + 4);
            if (i % 2 === 1) {
                doc.fillColor(COLORS.slate50).rect(x, y, pageWidth, rowH).fill();
            }
            doc.fillColor(COLORS.slate900);

            cx = x + 4;
            doc.text(String(i + 1), cx, y + 3, { width: TABLE_COLS.num - 4 });
            cx += TABLE_COLS.num;
            doc.text(`${m.first_name} ${m.last_name}`.trim(), cx, y + 3, { width: TABLE_COLS.name - 4, lineBreak: false, ellipsis: true });
            cx += TABLE_COLS.name;
            doc.text(m.no_cedula || !m.cedula ? 'Sin CI' : m.cedula, cx, y + 3, { width: TABLE_COLS.cedula - 4, lineBreak: false, ellipsis: true });
            cx += TABLE_COLS.cedula;
            doc.text(m.age != null ? String(m.age) : '—', cx, y + 3, { width: TABLE_COLS.age - 4 });
            cx += TABLE_COLS.age;
            doc.text(formatDateEs(m.birth_date), cx, y + 3, { width: TABLE_COLS.birth - 4, lineBreak: false, ellipsis: true });
            cx += TABLE_COLS.birth;
            doc.text(m.occupation_education || '—', cx, y + 3, { width: TABLE_COLS.occupation - 4, lineBreak: false, ellipsis: true });
            cx += TABLE_COLS.occupation;
            if (m.has_disability) {
                doc.fillColor(COLORS.rose600);
            }
            doc.text(discText, cx, y + 3, { width: discW, lineBreak: true });
            doc.fillColor(COLORS.slate900);
            y += rowH;
        }

        return y + 4;
    }

    static buildFilename(tenantName) {
        const date = new Date().toISOString().slice(0, 10);
        return `censo-terremoto-${safeFilenamePart(tenantName)}-${date}.pdf`;
    }
}

module.exports = EarthquakeCensusPdfService;
