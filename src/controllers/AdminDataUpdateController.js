const ExcelJS = require('exceljs');
const DataUpdateRequestModel = require('../models/DataUpdateRequestModel');
const UserModel = require('../models/UserModel');
const PropertyModel = require('../models/PropertyModel');
const EmailService = require('../services/EmailService');
const AdminController = require('./AdminController');
const { connectDB, sql } = require('../config/database');

/**
 * Admin Data Update Controller
 * Gestión de solicitudes de actualización de datos de propietarios
 */
class AdminDataUpdateController {
    /**
     * GET /api/admin/data-update-requests
     * Listar solicitudes con paginación
     */
    static async list(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 20, 100);
            const status = req.query.status || null;

            const { rows, total } = await DataUpdateRequestModel.list({ page, limit, status });

            res.json({
                success: true,
                data: rows,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            console.error('List data update requests error:', error);
            res.status(500).json({ error: 'Error al listar solicitudes' });
        }
    }

    /**
     * GET /api/admin/data-update-requests/:id
     * Obtener detalle de una solicitud
     */
    static async getById(req, res) {
        try {
            const { id } = req.params;
            const request = await DataUpdateRequestModel.findById(id);
            if (!request) {
                return res.status(404).json({ error: 'Solicitud no encontrada' });
            }

            const oldData = typeof request.old_data === 'string' ? JSON.parse(request.old_data) : request.old_data;
            const newData = typeof request.new_data === 'string' ? JSON.parse(request.new_data) : request.new_data;

            const pool = await connectDB();
            const propsResult = await pool.request()
                .input('user_id', sql.UniqueIdentifier, request.user_id)
                .query(`
                    SELECT p.id, p.name, p.type, b.name as building_name, t.name as tenant_name, t.id as tenant_id
                    FROM PropertyOwners po
                    INNER JOIN Properties p ON po.property_id = p.id
                    INNER JOIN Buildings b ON p.building_id = b.id
                    INNER JOIN Tenants t ON p.tenant_id = t.id
                    WHERE po.user_id = @user_id
                    ORDER BY t.name, b.name, p.name
                `);

            res.json({
                success: true,
                request: {
                    id: request.id,
                    user_id: request.user_id,
                    status: request.status,
                    old_data: oldData,
                    new_data: newData,
                    requested_at: request.requested_at,
                    reviewed_at: request.reviewed_at,
                    rejection_reason: request.rejection_reason,
                    approval_comment: request.approval_comment || null,
                    user: {
                        first_name: request.first_name,
                        last_name: request.last_name,
                        email: request.email,
                        dni: request.dni
                    }
                },
                properties: propsResult.recordset,
                tenants: [...new Map(propsResult.recordset.map(p => [p.tenant_id, { id: p.tenant_id, name: p.tenant_name }])).values()]
            });
        } catch (error) {
            console.error('Get data update request error:', error);
            res.status(500).json({ error: 'Error al obtener solicitud' });
        }
    }

    /**
     * POST /api/admin/data-update-requests/:id/approve
     * Aprobar solicitud (con opción de editar datos finales)
     */
    static async approve(req, res) {
        try {
            const { id } = req.params;
            const { new_data: overrideData, comment: approvalComment } = req.body || {};
            const reviewerId = req.user.userId;
            const commentTrim =
                typeof approvalComment === 'string' ? approvalComment.trim() : '';
            const storedApprovalComment = commentTrim.length > 0 ? commentTrim : null;

            const request = await DataUpdateRequestModel.findById(id);
            if (!request) {
                return res.status(404).json({ error: 'Solicitud no encontrada' });
            }
            if (request.status !== 'PENDING') {
                return res.status(400).json({ error: 'La solicitud ya fue procesada' });
            }

            const finalData = overrideData || (typeof request.new_data === 'string' ? JSON.parse(request.new_data) : request.new_data);

            const pool = await connectDB();
            await pool.request()
                .input('id', sql.UniqueIdentifier, request.user_id)
                .input('first_name', sql.NVarChar, finalData.first_name)
                .input('last_name', sql.NVarChar, finalData.last_name)
                .input('email', sql.NVarChar, finalData.email)
                .input('dni', sql.NVarChar, finalData.dni)
                .input('phone', sql.NVarChar, finalData.phone || null)
                .query(`
                    UPDATE Users
                    SET first_name = @first_name, last_name = @last_name,
                        email = @email, dni = @dni, phone = @phone,
                        updated_at = SYSDATETIME()
                    WHERE id = @id
                `);

            await DataUpdateRequestModel.approve(id, reviewerId, finalData, storedApprovalComment);

            // Desactivar nickname si todos los propietarios del inmueble tienen solicitud aprobada
            const propertyIds = await PropertyModel.getPropertyIdsByOwner(request.user_id);
            for (const propId of propertyIds) {
                const prop = await PropertyModel.findById(propId);
                if (prop && prop.nickname && (prop.nickname_active === 1 || prop.nickname_active === true)) {
                    const allApproved = await PropertyModel.checkAllOwnersHaveApprovedRequest(propId);
                    if (allApproved) {
                        await PropertyModel.setNicknameInactive(propId);
                    }
                }
            }

            const user = await UserModel.findById(request.user_id);
            const notifyEmail = finalData.email || user.email;

            // Generar token de invitación para que el propietario defina su contraseña
            const invitationToken = await UserModel.setInvitationTokenForPasswordSetup(request.user_id);
            const baseUrl = process.env.APP_URL || 'http://localhost:3000';
            const invitationLink = `${baseUrl}/auth/complete-registration?token=${invitationToken}`;

            // Obtener tenant y propiedad para el email
            let tenantName = 'Condominio';
            let propertyLabel = null;
            const propsResult = await pool.request()
                .input('user_id', sql.UniqueIdentifier, request.user_id)
                .query(`
                    SELECT TOP 1 p.name as prop_name, b.name as building_name, t.name as tenant_name
                    FROM PropertyOwners po
                    INNER JOIN Properties p ON po.property_id = p.id
                    INNER JOIN Tenants t ON p.tenant_id = t.id
                    LEFT JOIN Buildings b ON p.building_id = b.id
                    WHERE po.user_id = @user_id
                `);
            if (propsResult.recordset.length > 0) {
                const r = propsResult.recordset[0];
                tenantName = r.tenant_name || tenantName;
                propertyLabel = r.building_name ? `${r.building_name}, ${r.prop_name}` : r.prop_name;
            }

            try {
                await EmailService.sendDataUpdateApprovedWithPasswordSetup(
                    notifyEmail,
                    finalData.first_name,
                    tenantName,
                    invitationLink,
                    propertyLabel,
                    storedApprovalComment
                );
            } catch (e) {
                console.error('Email approved:', e);
            }

            await AdminController.logAudit(req, 'UPDATE', 'DATA_UPDATE_REQUEST', id,
                `Aprobó solicitud de actualización de datos: ${user.first_name} ${user.last_name}`, null);

            res.json({
                success: true,
                message: 'Datos actualizados correctamente'
            });
        } catch (error) {
            console.error('Approve data update error:', error);
            res.status(500).json({ error: 'Error al aprobar solicitud' });
        }
    }

    /**
     * POST /api/admin/data-update-requests/:id/reject
     * Rechazar solicitud
     */
    static async reject(req, res) {
        try {
            const { id } = req.params;
            const { reason } = req.body;
            const reviewerId = req.user.userId;

            const request = await DataUpdateRequestModel.findById(id);
            if (!request) {
                return res.status(404).json({ error: 'Solicitud no encontrada' });
            }
            if (request.status !== 'PENDING') {
                return res.status(400).json({ error: 'La solicitud ya fue procesada' });
            }

            const reasonTrim = typeof reason === 'string' ? reason.trim() : '';
            const storedReason = reasonTrim.length > 0 ? reasonTrim : null;

            await DataUpdateRequestModel.reject(id, reviewerId, storedReason);

            try {
                await EmailService.sendDataUpdateRejected(request.email, request.first_name, storedReason);
            } catch (e) {
                console.error('Email rejected:', e);
            }

            await AdminController.logAudit(req, 'UPDATE', 'DATA_UPDATE_REQUEST', id,
                `Rechazó solicitud de actualización de datos: ${request.first_name} ${request.last_name}`, null);

            res.json({
                success: true,
                message: 'Solicitud rechazada'
            });
        } catch (error) {
            console.error('Reject data update error:', error);
            res.status(500).json({ error: 'Error al rechazar solicitud' });
        }
    }

    /**
     * GET /api/admin/data-update-requests/export
     * Excel: solicitudes por condominio (una hoja por conjunto)
     */
    static async exportExcel(req, res) {
        try {
            const status = req.query.status || null;
            const rows = await DataUpdateRequestModel.listExportRowsByTenant({ status });
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Condominio360';
            const byTenant = new Map();
            for (const r of rows) {
                const tid = r.tenant_id;
                if (!byTenant.has(tid)) byTenant.set(tid, []);
                byTenant.get(tid).push(r);
            }
            const usedSheetNames = new Set();
            const sheetTitle = (name) => {
                let base = (name || 'Condominio').replace(/[\[\]\*\?\:\\/]/g, '').trim().slice(0, 28);
                if (!base) base = 'Condominio';
                let s = base.slice(0, 31);
                let n = 1;
                while (usedSheetNames.has(s)) {
                    const suffix = '-' + n;
                    s = (base.slice(0, 31 - suffix.length) + suffix).slice(0, 31);
                    n += 1;
                }
                usedSheetNames.add(s);
                return s;
            };
            const addRowsToSheet = (sheet, list) => {
                sheet.columns = [
                    { header: 'ID solicitud', key: 'solicitud_id', width: 38 },
                    { header: 'Estado', key: 'status', width: 12 },
                    { header: 'Solicitado', key: 'requested_at', width: 20 },
                    { header: 'Revisado', key: 'reviewed_at', width: 20 },
                    { header: 'Nombre', key: 'first_name', width: 16 },
                    { header: 'Apellido', key: 'last_name', width: 16 },
                    { header: 'Email', key: 'email', width: 28 },
                    { header: 'DNI', key: 'dni', width: 14 },
                    { header: 'Teléfono', key: 'phone', width: 14 },
                    { header: 'Motivo rechazo', key: 'rejection_reason', width: 40 },
                    { header: 'ID usuario', key: 'user_id', width: 38 }
                ];
                sheet.getRow(1).font = { bold: true };
                list.forEach((x) => {
                    sheet.addRow({
                        solicitud_id: x.solicitud_id,
                        status: x.status,
                        requested_at: x.requested_at ? new Date(x.requested_at) : '',
                        reviewed_at: x.reviewed_at ? new Date(x.reviewed_at) : '',
                        first_name: x.first_name,
                        last_name: x.last_name,
                        email: x.email,
                        dni: x.dni || '',
                        phone: x.phone || '',
                        rejection_reason: x.rejection_reason || '',
                        user_id: x.user_id
                    });
                });
            };
            if (byTenant.size === 0) {
                const sheet = workbook.addWorksheet('Solicitudes');
                addRowsToSheet(sheet, []);
            } else {
                for (const [, list] of byTenant) {
                    const name = list[0]?.condominio || 'Condominio';
                    const sheet = workbook.addWorksheet(sheetTitle(name));
                    addRowsToSheet(sheet, list);
                }
            }
            const filename = `solicitudes-actualizacion-datos-${new Date().toISOString().slice(0, 10)}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
            await workbook.xlsx.write(res);
        } catch (error) {
            console.error('Export data update requests error:', error);
            res.status(500).json({ error: 'Error al exportar solicitudes' });
        }
    }
}

module.exports = AdminDataUpdateController;
