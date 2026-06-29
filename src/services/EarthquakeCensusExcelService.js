const ExcelJS = require('exceljs');
const { formatDamageLabels } = require('../constants/earthquakeCensusDamages');
const EarthquakeCensusPhotoZipService = require('./EarthquakeCensusPhotoZipService');
const EarthquakeCensusPdfService = require('./EarthquakeCensusPdfService');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const ALT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

const COLUMNS = [
    { header: 'Apartamento', key: 'apartment', width: 22 },
    { header: 'Habita actualmente', key: 'inhabiting', width: 16 },
    { header: 'Teléfono', key: 'phone', width: 16 },
    { header: 'Correo', key: 'email', width: 28 },
    { header: 'Daños reportados', key: 'damages', width: 36 },
    { header: 'Detalle daños', key: 'damage_notes', width: 40 },
    { header: 'Notas unidad', key: 'unit_notes', width: 32 },
    { header: 'Cant. fotos', key: 'photo_count', width: 11 },
    { header: 'Link fotos ZIP', key: 'photos_zip_url', width: 42 },
    { header: 'Actualizado', key: 'updated_at', width: 18 },
    { header: '#', key: 'member_num', width: 5 },
    { header: 'Nombres', key: 'first_name', width: 18 },
    { header: 'Apellidos', key: 'last_name', width: 18 },
    { header: 'Cédula', key: 'cedula', width: 14 },
    { header: 'Sin CI', key: 'no_cedula', width: 8 },
    { header: 'Edad', key: 'age', width: 8 },
    { header: 'Fecha nacimiento', key: 'birth_date', width: 16 },
    { header: 'Ocupación / instrucción', key: 'occupation', width: 24 },
    { header: 'Discapacidad', key: 'disability', width: 12 },
    { header: 'Detalle discapacidad', key: 'disability_notes', width: 32 }
];

function safeFilenamePart(name) {
    return String(name || 'condominio').replace(/[^a-z0-9-]+/gi, '_').slice(0, 50);
}

function formatDateEs(val) {
    if (!val) return '';
    try {
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return String(val);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
        return String(val || '');
    }
}

function formatDateOnly(val) {
    if (!val) return '';
    const s = String(val).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-');
        return `${d}/${m}/${y}`;
    }
    return s;
}

function formatDisability(member) {
    if (!member.has_disability) return 'No';
    const notes = String(member.disability_notes || '').trim();
    return notes ? 'Sí' : 'Sí';
}

function safeSheetName(name, usedNames) {
    let base = String(name || 'Sin edificio').replace(/[\\/*?:\[\]]/g, '-').trim();
    if (!base) base = 'Sin edificio';
    let s = base.slice(0, 31);
    let n = 1;
    while (usedNames.has(s.toLowerCase())) {
        const suffix = ` (${n})`;
        s = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
        n += 1;
    }
    usedNames.add(s.toLowerCase());
    return s;
}

function styleHeaderRow(sheet) {
    const headerRow = sheet.getRow(1);
    headerRow.font = HEADER_FONT;
    headerRow.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF111827' } } };
    });
    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: COLUMNS.length }
    };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function unitBaseRow(submission) {
    const photoCount = submission.photo_count || submission.photos?.length || 0;
    const zipUrl = submission.photos_zip_token
        ? EarthquakeCensusPhotoZipService.getPublicUrl(submission.photos_zip_token)
        : '';
    return {
        apartment: submission.apartment_label || '',
        inhabiting: submission.currently_inhabiting !== false && submission.currently_inhabiting !== 0 ? 'Sí' : 'No',
        phone: submission.contact_phone || '',
        email: submission.contact_email || '',
        damages: formatDamageLabels(submission.damage_types || []).join('; '),
        damage_notes: submission.damage_notes || '',
        unit_notes: submission.notes || '',
        photo_count: photoCount,
        photos_zip_url: zipUrl,
        updated_at: formatDateEs(submission.updated_at || submission.submitted_at)
    };
}

function memberRowData(member, index) {
    return {
        member_num: index + 1,
        first_name: member.first_name || '',
        last_name: member.last_name || '',
        cedula: member.no_cedula || !member.cedula ? '' : member.cedula,
        no_cedula: member.no_cedula ? 'Sí' : 'No',
        age: member.age != null ? member.age : '',
        birth_date: formatDateOnly(member.birth_date),
        occupation: member.occupation_education || '',
        disability: formatDisability(member),
        disability_notes: member.has_disability ? (member.disability_notes || '') : ''
    };
}

class EarthquakeCensusExcelService {
    /**
     * @param {{ tenantName: string, submissions: Array }} payload
     * @returns {Promise<ExcelJS.Workbook>}
     */
    static async buildWorkbook(payload) {
        const { tenantName, submissions = [] } = payload;
        const groups = EarthquakeCensusPdfService.groupSubmissionsByBuilding(submissions);
        const totalMembers = submissions.reduce((acc, s) => acc + (s.members?.length || 0), 0);
        const withDisability = submissions.reduce(
            (acc, s) => acc + (s.members || []).filter((m) => m.has_disability).length,
            0
        );
        const withPhotos = submissions.filter((s) => (s.photo_count || s.photos?.length || 0) > 0).length;

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Condominio360';
        workbook.created = new Date();
        workbook.title = `Censo terremoto — ${tenantName}`;

        const summary = workbook.addWorksheet('Resumen');
        summary.columns = [
            { header: 'Concepto', key: 'label', width: 32 },
            { header: 'Valor', key: 'value', width: 48 }
        ];
        styleHeaderRow(summary);

        const summaryRows = [
            { label: 'Condominio', value: tenantName },
            { label: 'Generado', value: formatDateEs(new Date()) },
            { label: 'Unidades registradas', value: submissions.length },
            { label: 'Personas registradas', value: totalMembers },
            { label: 'Personas con discapacidad', value: withDisability },
            { label: 'Unidades con fotos de daños', value: withPhotos },
            { label: '', value: '' },
            { label: 'Edificio / calle', value: 'Unidades' }
        ];
        for (const [building, units] of groups) {
            summaryRows.push({ label: building, value: units.length });
        }
        summaryRows.forEach((row) => summary.addRow(row));
        summary.getColumn('label').font = { bold: false };

        const usedSheetNames = new Set(['resumen']);

        for (const [building, units] of groups) {
            const sheetName = safeSheetName(building, usedSheetNames);
            const sheet = workbook.addWorksheet(sheetName);
            sheet.columns = COLUMNS.map((c) => ({ ...c }));
            styleHeaderRow(sheet);

            let rowIndex = 2;
            for (const submission of units) {
                const base = unitBaseRow(submission);
                const members = submission.members?.length ? submission.members : [null];

                members.forEach((member, mi) => {
                    const rowData = {
                        ...base,
                        ...(member ? memberRowData(member, mi) : {
                            member_num: 1,
                            first_name: '',
                            last_name: '',
                            cedula: '',
                            no_cedula: '',
                            age: '',
                            birth_date: '',
                            occupation: '',
                            disability: '',
                            disability_notes: ''
                        })
                    };

                    const row = sheet.addRow(rowData);
                    row.alignment = { vertical: 'top', wrapText: true };

                    if (rowData.photos_zip_url) {
                        const cell = row.getCell('photos_zip_url');
                        cell.value = {
                            text: rowData.photos_zip_url,
                            hyperlink: rowData.photos_zip_url
                        };
                        cell.font = { color: { argb: 'FF2563EB' }, underline: true };
                    }

                    if (rowIndex % 2 === 0) {
                        row.eachCell({ includeEmpty: true }, (cell) => {
                            cell.fill = ALT_FILL;
                        });
                    }
                    rowIndex += 1;
                });
            }
        }

        if (!groups.length) {
            const sheet = workbook.addWorksheet('Sin registros');
            sheet.addRow(['No hay registros de censo todavía.']);
        }

        return workbook;
    }

    /**
     * @param {{ tenantName: string, submissions: Array }} payload
     * @returns {Promise<Buffer>}
     */
    static async generateBuffer(payload) {
        const workbook = await this.buildWorkbook(payload);
        return workbook.xlsx.writeBuffer();
    }

    static buildFilename(tenantName) {
        const date = new Date().toISOString().slice(0, 10);
        return `censo-terremoto-${safeFilenamePart(tenantName)}-${date}.xlsx`;
    }
}

module.exports = EarthquakeCensusExcelService;
