const PDFDocument = require('pdfkit');
const { formatDamageLabels } = require('../constants/earthquakeCensusDamages');

const COLORS = {
    slate900: '#0F172A',
    slate700: '#334155',
    slate500: '#64748B',
    slate200: '#E2E8F0',
    slate50: '#F8FAFC',
    orange500: '#F97316',
    rose600: '#E11D48'
};

const MARGINS = { top: 44, left: 44, right: 44, bottom: 48 };

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

class EarthquakeCensusPdfService {
    /**
     * @param {{ tenantName: string, submissions: Array }} payload
     * @returns {Promise<Buffer>}
     */
    static generate(payload) {
        const { tenantName, submissions = [] } = payload;
        const totalMembers = submissions.reduce((acc, s) => acc + (s.members?.length || 0), 0);
        const withDisability = submissions.reduce(
            (acc, s) => acc + (s.members || []).filter((m) => m.has_disability).length,
            0
        );

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'LETTER', margins: MARGINS, bufferPages: true });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const pageWidth = doc.page.width - MARGINS.left - MARGINS.right;

            // Header
            doc.fillColor(COLORS.orange500).fontSize(10).font('Helvetica-Bold')
                .text('CONDOMINIO360 — CENSO DE EMERGENCIA', MARGINS.left, MARGINS.top);
            doc.fillColor(COLORS.slate900).fontSize(18).font('Helvetica-Bold')
                .text('Reporte Protección Civil', MARGINS.left, MARGINS.top + 16);
            doc.fillColor(COLORS.slate700).fontSize(11).font('Helvetica')
                .text(tenantName, MARGINS.left, MARGINS.top + 42);
            doc.fillColor(COLORS.slate500).fontSize(9)
                .text(`Generado: ${formatDateTimeEs()}`, MARGINS.left, MARGINS.top + 58);

            doc.moveTo(MARGINS.left, MARGINS.top + 78)
                .lineTo(MARGINS.left + pageWidth, MARGINS.top + 78)
                .strokeColor(COLORS.orange500).lineWidth(3).stroke();

            let y = MARGINS.top + 92;
            doc.fillColor(COLORS.slate700).fontSize(10).font('Helvetica-Bold')
                .text(`Unidades registradas: ${submissions.length}`, MARGINS.left, y);
            doc.text(`Personas censadas: ${totalMembers}`, MARGINS.left + 180, y);
            doc.text(`Con discapacidad: ${withDisability}`, MARGINS.left + 340, y);
            y += 28;

            if (!submissions.length) {
                doc.fillColor(COLORS.slate500).fontSize(11).font('Helvetica')
                    .text('No hay registros de censo todavía.', MARGINS.left, y);
                doc.end();
                return;
            }

            for (let i = 0; i < submissions.length; i++) {
                const s = submissions[i];
                const blockHeight = 80 + (s.members?.length || 0) * 52;
                if (y + blockHeight > doc.page.height - MARGINS.bottom) {
                    doc.addPage();
                    y = MARGINS.top;
                }

                doc.roundedRect(MARGINS.left, y, pageWidth, 4, 1).fill(COLORS.orange500);
                y += 12;

                doc.fillColor(COLORS.slate900).fontSize(12).font('Helvetica-Bold')
                    .text(`${s.building_label} — Apto ${s.apartment_label}`, MARGINS.left, y);
                y += 18;

                doc.fillColor(COLORS.slate500).fontSize(9).font('Helvetica')
                    .text(`Teléfono contacto: ${s.contact_phone || '—'}  |  Registrado: ${formatDateEs(s.updated_at || s.submitted_at)}`, MARGINS.left, y);
                y += 16;

                if (s.notes) {
                    doc.fillColor(COLORS.slate700).fontSize(9)
                        .text(`Notas: ${s.notes}`, MARGINS.left, y, { width: pageWidth });
                    y += doc.heightOfString(`Notas: ${s.notes}`, { width: pageWidth }) + 8;
                }

                const damageLabels = formatDamageLabels(s.damage_types || []);
                if (damageLabels.length || s.damage_notes) {
                    if (y + 40 > doc.page.height - MARGINS.bottom) {
                        doc.addPage();
                        y = MARGINS.top;
                    }
                    doc.fillColor(COLORS.rose600).fontSize(9).font('Helvetica-Bold')
                        .text('Daños reportados:', MARGINS.left, y);
                    y += 14;
                    if (damageLabels.length) {
                        doc.fillColor(COLORS.slate700).fontSize(8.5).font('Helvetica')
                            .text(`• ${damageLabels.join('  •  ')}`, MARGINS.left, y, { width: pageWidth });
                        y += doc.heightOfString(`• ${damageLabels.join('  •  ')}`, { width: pageWidth }) + 6;
                    }
                    if (s.damage_notes) {
                        doc.fillColor(COLORS.slate500).fontSize(8.5)
                            .text(`Detalle: ${s.damage_notes}`, MARGINS.left, y, { width: pageWidth });
                        y += doc.heightOfString(`Detalle: ${s.damage_notes}`, { width: pageWidth }) + 8;
                    }
                }

                const members = s.members || [];
                for (let j = 0; j < members.length; j++) {
                    const m = members[j];
                    if (y + 50 > doc.page.height - MARGINS.bottom) {
                        doc.addPage();
                        y = MARGINS.top;
                    }

                    doc.roundedRect(MARGINS.left, y, pageWidth, 46, 4)
                        .fillAndStroke(COLORS.slate50, COLORS.slate200);

                    const fullName = `${m.first_name} ${m.last_name}`.trim();
                    doc.fillColor(COLORS.slate900).fontSize(10).font('Helvetica-Bold')
                        .text(`${j + 1}. ${fullName}`, MARGINS.left + 10, y + 8);

                    const cedula = m.cedula || '—';
                    const age = m.age != null ? `${m.age} años` : '—';
                    const birth = formatDateEs(m.birth_date);
                    doc.fillColor(COLORS.slate700).fontSize(8.5).font('Helvetica')
                        .text(`Cédula: ${cedula}  |  Edad: ${age}  |  Nacimiento: ${birth}`, MARGINS.left + 10, y + 22);

                    const occupation = m.occupation_education || '—';
                    const disability = m.has_disability
                        ? `Sí${m.disability_notes ? ` (${m.disability_notes})` : ''}`
                        : 'No';
                    doc.text(`Ocupación/Instrucción: ${occupation}  |  Discapacidad: ${disability}`, MARGINS.left + 10, y + 34, { width: pageWidth - 20 });

                    y += 52;
                }

                y += 14;
            }

            const range = doc.bufferedPageRange();
            for (let p = range.start; p < range.start + range.count; p++) {
                doc.switchToPage(p);
                doc.fillColor(COLORS.slate500).fontSize(8).font('Helvetica')
                    .text(
                        `Censo terremoto — ${tenantName} — Página ${p + 1} de ${range.count}`,
                        MARGINS.left,
                        doc.page.height - MARGINS.bottom + 16,
                        { width: pageWidth, align: 'center' }
                    );
            }

            doc.end();
        });
    }

    static buildFilename(tenantName) {
        const date = new Date().toISOString().slice(0, 10);
        return `censo-terremoto-${safeFilenamePart(tenantName)}-${date}.pdf`;
    }
}

module.exports = EarthquakeCensusPdfService;
