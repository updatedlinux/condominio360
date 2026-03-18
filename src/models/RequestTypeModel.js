const { sql, connectDB } = require('../config/database');

/**
 * Modelo para Tipos de Solicitud (RequestTypes)
 * Soporta configuración dinámica de formularios por tenant
 */
class RequestTypeModel {
    /**
     * Obtener todos los tipos de solicitud activos de un tenant
     * @param {string} tenantId 
     */
    static async getByTenant(tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT id, name, description, icon, color, form_schema, 
                           is_system, requires_approval, is_active, created_at,
                           is_move_type, move_type, days_allowed, time_range,
                           requires_insurance, requires_moving_company, move_instructions
                    FROM RequestTypes
                    WHERE tenant_id = @tenant_id AND is_active = 1
                    ORDER BY is_system DESC, name ASC
                `);

            return result.recordset.map(rt => ({
                ...rt,
                form_schema: rt.form_schema ? JSON.parse(rt.form_schema) : null
            }));
        } catch (error) {
            console.error('Error fetching request types:', error);
            throw error;
        }
    }

    /**
     * Obtener un tipo de solicitud específico
     * @param {string} id 
     * @param {string} tenantId 
     */
    static async findById(id, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    SELECT * FROM RequestTypes
                    WHERE id = @id AND tenant_id = @tenant_id
                `);

            if (result.recordset.length === 0) return null;

            const rt = result.recordset[0];
            rt.form_schema = rt.form_schema ? JSON.parse(rt.form_schema) : null;
            return rt;
        } catch (error) {
            console.error('Error finding request type:', error);
            throw error;
        }
    }

    /**
     * Crear nuevo tipo de solicitud
     * @param {Object} data 
     */
    static async create(data) {
        const {
            tenant_id,
            name,
            description = null,
            form_schema = null,
            icon = 'fa-file-alt',
            color = '#6B7280',
            requires_approval = false,
            auto_assign_to = null,
            is_system = false,
            is_move_type = false,
            move_type = null,
            days_allowed = null,
            time_range = null,
            requires_insurance = false,
            requires_moving_company = false,
            move_instructions = null
        } = data;

        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('tenant_id', sql.UniqueIdentifier, tenant_id)
                .input('name', sql.NVarChar, name)
                .input('description', sql.NVarChar, description)
                .input('form_schema', sql.NVarChar, form_schema ? JSON.stringify(form_schema) : null)
                .input('icon', sql.NVarChar, icon)
                .input('color', sql.NVarChar, color)
                .input('requires_approval', sql.Bit, requires_approval ? 1 : 0)
                .input('auto_assign_to', sql.NVarChar, auto_assign_to)
                .input('is_system', sql.Bit, is_system ? 1 : 0)
                .input('is_move_type', sql.Bit, is_move_type ? 1 : 0)
                .input('move_type', sql.NVarChar, move_type)
                .input('days_allowed', sql.NVarChar, days_allowed)
                .input('time_range', sql.NVarChar, time_range)
                .input('requires_insurance', sql.Bit, requires_insurance ? 1 : 0)
                .input('requires_moving_company', sql.Bit, requires_moving_company ? 1 : 0)
                .input('move_instructions', sql.NVarChar, move_instructions)
                .query(`
                    INSERT INTO RequestTypes 
                        (tenant_id, name, description, form_schema, icon, color, 
                         requires_approval, auto_assign_to, is_system,
                         is_move_type, move_type, days_allowed, time_range,
                         requires_insurance, requires_moving_company, move_instructions)
                    OUTPUT INSERTED.*
                    VALUES 
                        (@tenant_id, @name, @description, @form_schema, @icon, @color,
                         @requires_approval, @auto_assign_to, @is_system,
                         @is_move_type, @move_type, @days_allowed, @time_range,
                         @requires_insurance, @requires_moving_company, @move_instructions)
                `);

            const rt = result.recordset[0];
            rt.form_schema = rt.form_schema ? JSON.parse(rt.form_schema) : null;
            return rt;
        } catch (error) {
            console.error('Error creating request type:', error);
            throw error;
        }
    }

    /**
     * Actualizar tipo de solicitud
     * @param {string} id 
     * @param {string} tenantId 
     * @param {Object} data 
     */
    static async update(id, tenantId, data) {
        const allowedFields = [
            'name', 'description', 'form_schema', 'icon', 'color',
            'requires_approval', 'auto_assign_to', 'is_active',
            'is_move_type', 'move_type', 'days_allowed', 'time_range',
            'requires_insurance', 'requires_moving_company', 'move_instructions'
        ];
        
        const updates = [];
        
        for (const [key, value] of Object.entries(data)) {
            if (allowedFields.includes(key)) {
                if (key === 'form_schema') {
                    updates.push(`${key} = @${key}`);
                } else if (key === 'requires_approval' || key === 'is_active') {
                    updates.push(`${key} = @${key}`);
                } else {
                    updates.push(`${key} = @${key}`);
                }
            }
        }

        if (updates.length === 0) return null;

        try {
            const pool = await connectDB();
            const request = pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId);

            // Agregar parámetros
            const bitFields = ['requires_approval', 'is_active', 'is_move_type', 'requires_insurance', 'requires_moving_company'];
            for (const [key, value] of Object.entries(data)) {
                if (allowedFields.includes(key)) {
                    if (key === 'form_schema') {
                        request.input(key, sql.NVarChar, value ? JSON.stringify(value) : null);
                    } else if (bitFields.includes(key)) {
                        request.input(key, sql.Bit, value ? 1 : 0);
                    } else {
                        request.input(key, sql.NVarChar, value);
                    }
                }
            }

            const result = await request.query(`
                UPDATE RequestTypes 
                SET ${updates.join(', ')}, updated_at = SYSDATETIME()
                OUTPUT INSERTED.*
                WHERE id = @id AND tenant_id = @tenant_id AND is_system = 0
            `);

            if (result.recordset.length === 0) return null;

            const rt = result.recordset[0];
            rt.form_schema = rt.form_schema ? JSON.parse(rt.form_schema) : null;
            return rt;
        } catch (error) {
            console.error('Error updating request type:', error);
            throw error;
        }
    }

    /**
     * Eliminar tipo de solicitud (soft delete)
     * Solo permite eliminar tipos no-system
     */
    static async delete(id, tenantId) {
        try {
            const pool = await connectDB();
            const result = await pool.request()
                .input('id', sql.UniqueIdentifier, id)
                .input('tenant_id', sql.UniqueIdentifier, tenantId)
                .query(`
                    UPDATE RequestTypes 
                    SET is_active = 0, updated_at = SYSDATETIME()
                    OUTPUT INSERTED.*
                    WHERE id = @id AND tenant_id = @tenant_id AND is_system = 0
                `);

            return result.recordset[0] || null;
        } catch (error) {
            console.error('Error deleting request type:', error);
            throw error;
        }
    }

    /**
     * Crear tipos de solicitud por defecto para un nuevo tenant
     * @param {string} tenantId 
     * @param {string} createdBy 
     */
    static async createDefaults(tenantId, createdBy) {
        const defaults = [
            {
                name: 'Mudanza - Entrada',
                description: 'Solicitud para ingreso de mudanza',
                icon: 'fa-truck-moving',
                color: '#F59E0B',
                requires_approval: true,
                is_system: true,
                form_schema: {
                    fields: [
                        {
                            name: 'move_date',
                            label: 'Fecha de Mudanza',
                            type: 'date',
                            required: true,
                            validation: { min_notice_days: 7 }
                        },
                        {
                            name: 'elevator_needed',
                            label: 'Requiere ascensor',
                            type: 'checkbox',
                            required: false
                        },
                        {
                            name: 'transporter_name',
                            label: 'Nombre del transportista',
                            type: 'text',
                            required: true
                        },
                        {
                            name: 'transporter_phone',
                            label: 'Teléfono del transportista',
                            type: 'tel',
                            required: true
                        },
                        {
                            name: 'vehicle_plate',
                            label: 'Placa del vehículo',
                            type: 'text',
                            required: true
                        }
                    ]
                }
            },
            {
                name: 'Mudanza - Salida',
                description: 'Solicitud para egreso de mudanza',
                icon: 'fa-truck-loading',
                color: '#EF4444',
                requires_approval: true,
                is_system: true,
                form_schema: {
                    fields: [
                        {
                            name: 'move_date',
                            label: 'Fecha de Mudanza',
                            type: 'date',
                            required: true,
                            validation: { min_notice_days: 7 }
                        },
                        {
                            name: 'elevator_needed',
                            label: 'Requiere ascensor',
                            type: 'checkbox',
                            required: false
                        },
                        {
                            name: 'new_address',
                            label: 'Nueva dirección',
                            type: 'textarea',
                            required: false
                        }
                    ]
                }
            },
            {
                name: 'Sugerencia',
                description: 'Propuesta de mejora para el condominio',
                icon: 'fa-lightbulb',
                color: '#10B981',
                requires_approval: false,
                is_system: true,
                form_schema: {
                    fields: [
                        {
                            name: 'category',
                            label: 'Categoría',
                            type: 'select',
                            required: true,
                            options: ['Infraestructura', 'Seguridad', 'Limpieza', 'Áreas Comunes', 'Otro']
                        },
                        {
                            name: 'details',
                            label: 'Detalle de la sugerencia',
                            type: 'textarea',
                            required: true
                        }
                    ]
                }
            },
            {
                name: 'Reclamo',
                description: 'Reporte de problema o queja',
                icon: 'fa-exclamation-circle',
                color: '#DC2626',
                requires_approval: false,
                is_system: true,
                form_schema: {
                    fields: [
                        {
                            name: 'category',
                            label: 'Categoría',
                            type: 'select',
                            required: true,
                            options: ['Ruido', 'Vecinos', 'Mantenimiento', 'Seguridad', 'Otro']
                        },
                        {
                            name: 'urgency',
                            label: 'Nivel de urgencia',
                            type: 'select',
                            required: true,
                            options: ['Baja', 'Media', 'Alta', 'Crítica']
                        },
                        {
                            name: 'details',
                            label: 'Detalle del reclamo',
                            type: 'textarea',
                            required: true
                        }
                    ]
                }
            },
            {
                name: 'PQR',
                description: 'Peticiones, Quejas o Reclamos generales',
                icon: 'fa-clipboard-list',
                color: '#6B7280',
                requires_approval: false,
                is_system: true,
                form_schema: {
                    fields: [
                        {
                            name: 'type',
                            label: 'Tipo',
                            type: 'select',
                            required: true,
                            options: ['Petición', 'Queja', 'Reclamo', 'Felicitación']
                        },
                        {
                            name: 'subject',
                            label: 'Asunto',
                            type: 'text',
                            required: true
                        },
                        {
                            name: 'details',
                            label: 'Detalles',
                            type: 'textarea',
                            required: true
                        }
                    ]
                }
            }
        ];

        const created = [];
        for (const rt of defaults) {
            try {
                const result = await this.create({
                    tenant_id: tenantId,
                    ...rt
                });
                created.push(result);
            } catch (error) {
                console.error(`Error creating default request type ${rt.name}:`, error);
            }
        }

        return created;
    }

    /**
     * Validar datos de formulario contra schema
     * @param {Object} formSchema - Schema del tipo de solicitud
     * @param {Object} data - Datos a validar
     * @returns {Object} { valid: boolean, errors: [] }
     */
    static validateFormData(formSchema, data) {
        const errors = [];

        if (!formSchema || !formSchema.fields) {
            return { valid: true, errors: [] };
        }

        for (const field of formSchema.fields) {
            const value = data[field.name];

            // Validar requerido
            if (field.required && (value === undefined || value === null || value === '')) {
                errors.push(`El campo '${field.label}' es requerido`);
                continue;
            }

            // Si no es requerido y está vacío, saltar validaciones adicionales
            if (!field.required && (value === undefined || value === null || value === '')) {
                continue;
            }

            // Validaciones específicas por tipo
            if (field.type === 'date' && field.validation) {
                const dateValue = new Date(value);
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                if (field.validation.min_notice_days) {
                    const minDate = new Date(today);
                    minDate.setDate(minDate.getDate() + field.validation.min_notice_days);
                    
                    if (dateValue < minDate) {
                        errors.push(`La fecha debe tener al menos ${field.validation.min_notice_days} días de anticipación`);
                    }
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

module.exports = RequestTypeModel;
