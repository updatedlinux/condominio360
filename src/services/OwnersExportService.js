const ExcelJS = require('exceljs');

/**
 * Servicio centralizado para construir el Excel de propietarios.
 *
 * Resalta en amarillo (toda la fila) aquellos propietarios que tienen
 * al menos una solicitud de actualización de datos APROBADA por el
 * SuperAdmin (`DataUpdateRequests.status = 'APPROVED'`).
 *
 * Incluye 3 columnas adicionales:
 *  - Registrado el (Users.created_at)
 *  - Datos actualizados (Sí / No)
 *  - Última actualización (DataUpdateRequests.reviewed_at más reciente APROBADA)
 *  - # actualizaciones (conteo de aprobaciones)
 */
class OwnersExportService {
    static _fmtDate(value) {
        if (!value) return '';
        try {
            const d = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(d.getTime())) return '';
            const pad = (n) => String(n).padStart(2, '0');
            return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch {
            return '';
        }
    }

    /**
     * Construye un workbook de ExcelJS listo para enviar al cliente.
     * @param {Array<Object>} rows  Filas devueltas por UserModel.findOwnersForExport
     * @returns {ExcelJS.Workbook}
     */
    static buildWorkbook(rows, options = {}) {
        const dniHeader = options.dniColumnHeader || 'DNI / Documento';
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Condominio360';
        workbook.created = new Date();

        const sheet = workbook.addWorksheet('Propietarios', {
            views: [{ state: 'frozen', ySplit: 1 }]
        });

        sheet.columns = [
            { header: 'Nombre', key: 'first_name', width: 18 },
            { header: 'Apellido', key: 'last_name', width: 18 },
            { header: 'Email', key: 'email', width: 28 },
            { header: 'Teléfono', key: 'phone', width: 16 },
            { header: dniHeader, key: 'dni', width: 16 },
            { header: 'Usuario activo', key: 'is_active', width: 12 },
            { header: 'Registrado el', key: 'registrado_el', width: 18 },
            { header: 'Datos actualizados', key: 'datos_actualizados', width: 18 },
            { header: 'Última actualización', key: 'ultima_actualizacion', width: 20 },
            { header: '# actualizaciones', key: 'num_actualizaciones', width: 16 },
            { header: 'Inmueble', key: 'inmueble', width: 22 },
            { header: 'Edificio/Calle', key: 'edificio', width: 18 },
            { header: 'Principal', key: 'is_primary_owner', width: 10 },
            { header: '% participación', key: 'porcentaje_participacion', width: 14 },
            { header: 'ID propietario', key: 'user_id', width: 38 },
            { header: 'ID inmueble', key: 'property_id', width: 38 }
        ];

        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
        headerRow.height = 22;
        headerRow.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1F2937' }
            };
            cell.border = {
                bottom: { style: 'thin', color: { argb: 'FF111827' } }
            };
        });

        const highlightFill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF3CD' }
        };
        const highlightFontColor = { argb: 'FF7A4E00' };

        (rows || []).forEach((r) => {
            const approvedCount = Number(r.actualizaciones_aprobadas || 0);
            const lastApprovedAt = r.ultima_actualizacion_aprobada || null;
            const updated = approvedCount > 0;

            const addedRow = sheet.addRow({
                first_name: r.first_name || '',
                last_name: r.last_name || '',
                email: r.email || '',
                phone: r.phone || '',
                dni: r.dni || '',
                is_active: r.is_active ? 'Sí' : 'No',
                registrado_el: this._fmtDate(r.usuario_creado),
                datos_actualizados: updated ? 'Sí' : 'No',
                ultima_actualizacion: this._fmtDate(lastApprovedAt),
                num_actualizaciones: approvedCount,
                inmueble: r.inmueble || '(sin inmueble en este conjunto)',
                edificio: r.edificio || '',
                is_primary_owner:
                    r.is_primary_owner === true || r.is_primary_owner === 1
                        ? 'Sí'
                        : r.property_id ? 'No' : '',
                porcentaje_participacion:
                    r.porcentaje_participacion != null
                        ? parseFloat(r.porcentaje_participacion)
                        : '',
                user_id: r.user_id,
                property_id: r.property_id || ''
            });

            if (updated) {
                addedRow.eachCell({ includeEmpty: true }, (cell) => {
                    cell.fill = highlightFill;
                    cell.font = { color: highlightFontColor, bold: false };
                });
                const updatedCell = addedRow.getCell('datos_actualizados');
                updatedCell.font = { bold: true, color: highlightFontColor };
            }
        });

        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: sheet.columns.length }
        };

        return workbook;
    }

    /**
     * Envía el Excel como respuesta HTTP.
     */
    static async streamWorkbook(res, rows, filename, options = {}) {
        const workbook = this.buildWorkbook(rows, options);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        await workbook.xlsx.write(res);
    }
}

module.exports = OwnersExportService;
