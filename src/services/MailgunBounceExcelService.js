const ExcelJS = require('exceljs');

const COLORS = {
    slate900: 'FF0F172A',
    slate700: 'FF334155',
    slate200: 'FFE2E8F0',
    rose600: 'FFE11D48',
    rose50: 'FFFFF1F2',
    emerald700: 'FF047857',
    emerald50: 'FFECFDF5',
    amber700: 'FFB45309',
    amber50: 'FFFFFBEB',
    white: 'FFFFFFFF'
};

function safeFilenamePart(name) {
    return String(name || 'condominio').replace(/[^a-z0-9-]+/gi, '_').slice(0, 60);
}

function formatDateTimeEs() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${pad(d.getDate())} de ${months[d.getMonth()]} de ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatUtcShort(val) {
    if (!val) return '';
    try {
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return String(val);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} UTC`;
    } catch {
        return String(val);
    }
}

function styleHeaderRow(row, fillArgb) {
    row.font = { bold: true, color: { argb: COLORS.white } };
    row.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    row.height = 24;
    row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
        cell.border = { bottom: { style: 'thin', color: { argb: COLORS.slate900 } } };
    });
}

class MailgunBounceExcelService {
    static buildWorkbook({ tenantName, summary, rows, includeUnmatched }) {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Condominio360 · Arsys Intela';
        workbook.created = new Date();

        const resumen = workbook.addWorksheet('Resumen', {
            views: [{ showGridLines: false }]
        });
        resumen.columns = [
            { width: 22 },
            { width: 28 },
            { width: 4 },
            { width: 22 },
            { width: 28 }
        ];

        resumen.mergeCells('A1:E1');
        const titleCell = resumen.getCell('A1');
        titleCell.value = 'Reporte de correos rebotados — Mailgun';
        titleCell.font = { bold: true, size: 16, color: { argb: COLORS.slate900 } };
        titleCell.alignment = { vertical: 'middle' };

        resumen.mergeCells('A2:E2');
        resumen.getCell('A2').value = 'Condominio360 · Arsys Intela';
        resumen.getCell('A2').font = { size: 10, color: { argb: COLORS.rose600 } };

        resumen.getCell('A4').value = 'Condominio';
        resumen.getCell('A4').font = { bold: true, color: { argb: COLORS.slate700 } };
        resumen.mergeCells('B4:E4');
        resumen.getCell('B4').value = tenantName || '—';

        const periodLabel = summary?.date_range?.label;
        resumen.getCell('A5').value = 'Período del CSV';
        resumen.getCell('A5').font = { bold: true, color: { argb: COLORS.slate700 } };
        resumen.mergeCells('B5:E5');
        resumen.getCell('B5').value = periodLabel || '—';
        if (periodLabel) {
            resumen.getCell('B5').font = { bold: true, color: { argb: COLORS.slate900 } };
        }

        resumen.getCell('A6').value = 'Reporte generado';
        resumen.getCell('A6').font = { bold: true, color: { argb: COLORS.slate700 } };
        resumen.mergeCells('B6:E6');
        resumen.getCell('B6').value = formatDateTimeEs();

        if (includeUnmatched) {
            resumen.mergeCells('A7:E7');
            resumen.getCell('A7').value = 'Incluye correos no asociados a propietarios de este condominio.';
            resumen.getCell('A7').font = { italic: true, color: { argb: COLORS.amber700 } };
        }

        const s = summary || {};
        const cards = [
            { label: 'Filas CSV', value: s.total_csv_rows ?? '—', fill: COLORS.slate200, fg: COLORS.slate900 },
            { label: 'Correos fallidos', value: s.unique_failed_emails ?? '—', fill: COLORS.rose50, fg: COLORS.rose600 },
            { label: 'En este condominio', value: s.matched_in_tenant ?? '—', fill: COLORS.emerald50, fg: COLORS.emerald700 },
            { label: 'Fuera del condominio', value: s.not_in_tenant ?? '—', fill: COLORS.amber50, fg: COLORS.amber700 }
        ];

        const cardRow = includeUnmatched ? 9 : 8;
        cards.forEach((card, i) => {
            const col = i * 2 + 1;
            const labelCell = resumen.getCell(cardRow, col);
            const valueCell = resumen.getCell(cardRow + 1, col);
            resumen.mergeCells(cardRow, col, cardRow, col + 1);
            resumen.mergeCells(cardRow + 1, col, cardRow + 1, col + 1);

            labelCell.value = card.label;
            labelCell.font = { size: 9, color: { argb: card.fg } };
            labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: card.fill } };
            labelCell.alignment = { horizontal: 'left', vertical: 'bottom' };
            labelCell.border = {
                top: { style: 'thin', color: { argb: COLORS.slate200 } },
                left: { style: 'thin', color: { argb: COLORS.slate200 } },
                right: { style: 'thin', color: { argb: COLORS.slate200 } }
            };

            valueCell.value = card.value;
            valueCell.font = { bold: true, size: 14, color: { argb: card.fg } };
            valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: card.fill } };
            valueCell.alignment = { horizontal: 'left', vertical: 'top' };
            valueCell.border = {
                bottom: { style: 'thin', color: { argb: COLORS.slate200 } },
                left: { style: 'thin', color: { argb: COLORS.slate200 } },
                right: { style: 'thin', color: { argb: COLORS.slate200 } }
            };
        });

        const sheet = workbook.addWorksheet('Rebotes', {
            views: [{ state: 'frozen', ySplit: 1 }]
        });

        sheet.columns = [
            { header: 'Correo fallido', key: 'email', width: 30 },
            { header: 'En este condominio', key: 'en_condominio', width: 16 },
            { header: 'Propietario', key: 'propietario', width: 24 },
            { header: 'Cédula', key: 'cedula', width: 14 },
            { header: 'Correo principal', key: 'correo_principal', width: 28 },
            { header: 'Teléfono', key: 'telefono', width: 16 },
            { header: 'Inmueble(s)', key: 'inmuebles', width: 24 },
            { header: 'Otros condominios', key: 'otros_condominios', width: 28 },
            { header: 'Qué pasó', key: 'que_paso', width: 36 },
            { header: 'Detalle técnico', key: 'detalle_tecnico', width: 36 },
            { header: 'Último fallo (UTC)', key: 'ultimo_fallo', width: 22 }
        ];

        styleHeaderRow(sheet.getRow(1), COLORS.rose600);

        (rows || []).forEach((r) => {
            const o = r.owner;
            const added = sheet.addRow({
                email: r.email || '',
                en_condominio: r.matched_in_tenant ? 'Sí' : 'No',
                propietario: o ? (o.name || '') : '',
                cedula: o ? (o.dni || '') : '',
                correo_principal: o ? (o.primary_email || '') : '',
                telefono: o ? (o.phone || '') : '',
                inmuebles: o ? (o.properties_label || '') : '',
                otros_condominios: o && o.other_tenants?.length ? o.other_tenants.join('; ') : '',
                que_paso: r.error?.summary || '',
                detalle_tecnico: r.error?.technical || '',
                ultimo_fallo: formatUtcShort(r.last_failure_at)
            });

            if (!r.matched_in_tenant) {
                added.eachCell({ includeEmpty: true }, (cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amber50 } };
                    cell.font = { color: { argb: COLORS.amber700 } };
                });
            }
        });

        if ((rows || []).length > 0) {
            sheet.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: rows.length + 1, column: sheet.columns.length }
            };
        }

        return workbook;
    }

    static async streamReport(res, payload) {
        const tenantName = payload.tenantName || 'Condominio';
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `Rebotes-Mailgun-${safeFilenamePart(tenantName)}-${stamp}.xlsx`;

        const workbook = this.buildWorkbook(payload);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Cache-Control', 'no-store');
        await workbook.xlsx.write(res);
    }
}

module.exports = MailgunBounceExcelService;
