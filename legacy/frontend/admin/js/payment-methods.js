
// Base API URL - Managed by AdminConfig
// Base API URL - Managed by AdminConfig
function getApiUrl() {
    return `${AdminConfig.API_URL}/admin/p2p/payment-method-definitions`;
}

// Global State
let allMethods = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 20;
let currentSearch = '';

// Handle Search
function handleSearch() {
    currentSearch = document.getElementById('searchMethods').value.toLowerCase().trim();
    currentPage = 1; // Reset to first page
    renderMethods();
}

// Filter and Render
function renderMethods() {
    // 1. Filter
    let filtered = allMethods.filter(m => {
        const term = currentSearch;
        return m.name.toLowerCase().includes(term) ||
            m.code.toLowerCase().includes(term) ||
            (m.currency && m.currency.toLowerCase().includes(term));
    });

    // 2. Paginate
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

    // Ensure current page is valid
    if (currentPage > totalPages) currentPage = totalPages || 1;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageItems = filtered.slice(start, end);

    // 3. Render Table
    const tbody = $('#methodsTableBody');
    tbody.empty();

    if (pageItems.length === 0) {
        tbody.append('<tr><td colspan="7" class="text-center">No se encontraron métodos</td></tr>');
    } else {
        pageItems.forEach(method => {
            const row = `
                <tr>
                    <td class="text-center">
                        ${method.logoUrl ? `<img src="${method.logoUrl}" style="height: 30px;">` : '-'}
                    </td>
                    <td>${method.code}</td>
                    <td>${method.name}</td>
                    <td>${method.currency || '-'}</td>
                    <td class="text-center">
                        <span class="badge badge-${method.isActive ? 'success' : 'secondary'}">
                            ${method.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                    </td>
                    <td>${method.displayOrder}</td>
                    <td>
                        <button class="btn btn-sm btn-info" onclick="editMethod('${method.id}')" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-warning" onclick="cloneMethod('${method.id}')" title="Clonar">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteMethod('${method.id}')" title="Eliminar">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
            tbody.append(row);
        });
    }

    // 4. Render Pagination
    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const container = $('#paginationControls');
    container.empty();

    if (totalPages <= 1) return;

    // Previous
    container.append(`
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changePage(${currentPage - 1}); return false;">Anterior</a>
        </li>
    `);

    // Pages (Show max 5 page links around current)
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    for (let i = startPage; i <= endPage; i++) {
        container.append(`
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" onclick="changePage(${i}); return false;">${i}</a>
            </li>
        `);
    }

    // Next
    container.append(`
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changePage(${currentPage + 1}); return false;">Siguiente</a>
        </li>
    `);
}

function changePage(page) {
    if (page < 1) return;
    currentPage = page;
    renderMethods();
}

// Load Methods
async function loadMethods() {
    try {
        const response = await fetch(getApiUrl(), {
            headers: AdminConfig.getAuthHeaders()
        });

        if (response.status === 401) {
            AdminConfig.handleApiError(401);
            return;
        }

        const data = await response.json();

        allMethods = data.definitions || []; // Store globally

        handleSearch(); // Triggers initial render
    } catch (error) {
        console.error('Error loading methods:', error);
        Swal.fire('Error', 'Error al cargar métodos de pago', 'error');
    }
}

// Load Currencies
async function loadCurrencies() {
    try {
        const response = await fetch(`${AdminConfig.API_URL}/p2p/config/fiat-currencies`, {
            headers: AdminConfig.getAuthHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            const select = $('#currency');
            select.empty();
            select.append('<option value="">Seleccione Moneda...</option>');

            (data.currencies || []).forEach(curr => {
                select.append(`<option value="${curr.code}">${curr.code} - ${curr.name}</option>`);
            });
        }
    } catch (error) {
        console.error('Error loading currencies:', error);
    }
}

// Open Modal for Create
function openCreateModal() {
    $('#methodId').val('');
    $('#code').val('').prop('disabled', false);
    $('#name').val('');
    $('#currency').val('');
    $('#logoUrl').val('');
    $('#logoUpload').val('');
    $('#logoUploadLabel').text('Elegir archivo...');
    $('#logoPreview').attr('src', '').hide();

    $('#displayOrder').val(0);
    $('#isActive').prop('checked', true);
    $('#fieldsContainer').empty();

    $('#methodModalLabel').text('Nuevo Método de Pago');
    $('#methodModal').modal('show');
}

// Open Modal for Edit
async function editMethod(id) {
    try {
        const response = await fetch(`${getApiUrl()}/${id}`, {
            headers: AdminConfig.getAuthHeaders()
        });

        if (response.status === 401) {
            AdminConfig.handleApiError(401);
            return;
        }

        const data = await response.json();
        const method = data.definition;

        $('#methodId').val(method.id);
        $('#code').val(method.code).prop('disabled', true);
        $('#name').val(method.name);
        $('#currency').val(method.currency || '');
        $('#logoUrl').val(method.logoUrl || '');

        // Reset upload input
        $('#logoUpload').val('');
        $('#logoUploadLabel').text('Elegir archivo...');

        // Show preview if exists
        if (method.logoUrl) {
            $('#logoPreview').attr('src', method.logoUrl).show();
        } else {
            $('#logoPreview').attr('src', '').hide();
        }

        $('#displayOrder').val(method.displayOrder);
        $('#isActive').prop('checked', method.isActive);

        $('#fieldsContainer').empty();

        // Parse Schema
        let schema = [];
        try {
            schema = typeof method.fieldsSchema === 'string' ? JSON.parse(method.fieldsSchema) : method.fieldsSchema;
        } catch (e) { console.error('Error parsing schema', e); }

        if (Array.isArray(schema)) {
            schema.forEach(field => addField(field));
        }

        $('#methodModalLabel').text('Editar Método de Pago');
        $('#methodModal').modal('show');

    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'Error al cargar detalle del método', 'error');
    }
}

// Upload Logo Handler
$('#logoUpload').on('change', async function () {
    const file = this.files[0];
    if (!file) return;

    // Update label
    $('#logoUploadLabel').text(file.name);

    const formData = new FormData();
    formData.append('file', file);

    try {
        // Show loading state could be nice here, but for now just wait
        const originalLabel = $('#logoUploadLabel').text();
        $('#logoUploadLabel').text('Subiendo...');

        const response = await fetch(`${AdminConfig.API_URL}/admin/p2p/payment-method-definitions/upload-logo`, {
            method: 'POST',
            headers: {
                'Authorization': AdminConfig.getAuthHeaders()['Authorization']
                // Content-Type must NOT be set for FormData, browser does it with boundary
            },
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Error al subir imagen');
        }

        const data = await response.json();

        // Success
        $('#logoUrl').val(data.url);
        $('#logoPreview').attr('src', data.url).show();
        $('#logoUploadLabel').text(file.name); // Restore name or "Completado"

    } catch (error) {
        console.error('Upload error:', error);
        Swal.fire('Error', 'Error al subir imagen: ' + error.message, 'error');
        $('#logoUpload').val('');
        $('#logoUploadLabel').text('Elegir archivo...');
        $('#logoPreview').hide();
    }
});

// Save Method
async function saveMethod() {
    const id = $('#methodId').val();
    const isEdit = !!id;

    const data = {
        code: $('#code').val(),
        name: $('#name').val(),
        currency: $('#currency').val(),
        logoUrl: $('#logoUrl').val(),
        displayOrder: parseInt($('#displayOrder').val()) || 0,
        isActive: $('#isActive').is(':checked'),
        fieldsSchema: []
    };

    if (!data.name) return Swal.fire('Error', 'El nombre es requerido', 'warning');
    if (!isEdit && !data.code) return Swal.fire('Error', 'El código es requerido', 'warning');


    // Collect Fields
    let fieldsValid = true;
    $('.field-row').each(function () {
        const row = $(this);
        const name = row.find('.field-name').val();
        const label = row.find('.field-label').val();
        const type = row.find('.field-type').val();
        const mapping = row.find('.field-mapping').val();
        const required = row.find('.field-required').is(':checked');
        const optionsStr = row.find('.field-options').val();

        if (!name || !label) {
            fieldsValid = false;
            return;
        }

        const fieldData = {
            name, label, type, mapping, required
        };

        if (type === 'select') {
            fieldData.options = optionsStr ? optionsStr.split(',').map(s => s.trim()) : [];
        }

        data.fieldsSchema.push(fieldData);
    });

    if (!fieldsValid) return Swal.fire('Error', 'Todos los campos deben tener Nombre ID y Etiqueta', 'warning');

    // API Call
    const url = isEdit ? `${getApiUrl()}/${id}` : getApiUrl();
    const method = isEdit ? 'PATCH' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: AdminConfig.getAuthHeaders(),
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Error al guardar');
        }

        $('#methodModal').modal('hide');
        Swal.fire('Éxito', 'Método guardado correctamente', 'success');
        loadMethods();

    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
}

// Delete Method
async function deleteMethod(id) {
    const result = await Swal.fire({
        title: '¿Estás seguro?',
        text: "No podrás revertir esto.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, eliminar'
    });

    if (!result.isConfirmed) return;

    try {
        const response = await fetch(`${getApiUrl()}/${id}`, {
            method: 'DELETE',
            headers: AdminConfig.getAuthHeaders()
        });

        if (response.ok) {
            Swal.fire('Eliminado', 'El método ha sido eliminado.', 'success');
            loadMethods();
        } else {
            const err = await response.json();
            throw new Error(err.error || 'Error al eliminar');
        }
    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'Error al eliminar: ' + error.message, 'error');
    }
}

// Add Field UI
function addField(data = null) {
    const template = document.getElementById('fieldRowTemplate');
    const clone = template.content.cloneNode(true);
    const container = $('#fieldsContainer');

    if (data) {
        clone.querySelector('.field-name').value = data.name;
        clone.querySelector('.field-label').value = data.label;
        clone.querySelector('.field-type').value = data.type;
        clone.querySelector('.field-mapping').value = data.mapping || 'details';
        clone.querySelector('.field-required').checked = data.required;

        if (data.type === 'select' && data.options) {
            const optionsContainer = clone.querySelector('.options-container');
            if (optionsContainer) {
                optionsContainer.style.display = 'block';
                clone.querySelector('.field-options').value = Array.isArray(data.options) ? data.options.join(', ') : data.options;
            }
        }
    }

    container.append(clone);
}

// Remove Field UI
function removeField(btn) {
    $(btn).closest('.field-row').remove();
}

// Toggle Options
function toggleOptions(select) {
    const row = $(select).closest('.field-row');
    const optionsContainer = row.find('.options-container');
    if (select.value === 'select') {
        optionsContainer.show();
    } else {
        optionsContainer.hide();
    }
}

// Clone Method
async function cloneMethod(id) {
    try {
        const response = await fetch(`${getApiUrl()}/${id}`, {
            headers: AdminConfig.getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Error retrieving method to clone');
        }

        const data = await response.json();
        const originalMethod = data.definition;

        // Generate Unique Code safely (max 50 chars)
        // 1. Remove ANY previous copy suffix (anything starting with _COPY or _C followed by digits)
        let baseCode = originalMethod.code.replace(/(_COPY_.*|_CPY_.*|_C\d+).*$/, '');

        // 2. Hard truncate base to 35 chars to leave room for suffix (35 + 6 = 41 chars max)
        if (baseCode.length > 35) baseCode = baseCode.substring(0, 35);

        // 3. Append short suffix: _C + 4 digits (e.g., _C1234) -> Total added length: 6 chars
        const suffix = Math.floor(1000 + Math.random() * 9000).toString();
        const newCode = `${baseCode}_C${suffix}`;

        // Clone Data
        const cloneData = {
            ...originalMethod,
            code: newCode,
            name: `${originalMethod.name.replace(/\(Copia\)$/, '')} (Copia)`,
            isActive: false, // Inactive by default
            id: undefined, // Let backend generate new ID
            createdAt: undefined,
            updatedAt: undefined
        };

        // Remove fields that should not be copied if any (typically IDs are ignored by backend on create if valid DTO)

        // API Call to Create
        const createResponse = await fetch(getApiUrl(), {
            method: 'POST',
            headers: AdminConfig.getAuthHeaders(),
            body: JSON.stringify(cloneData)
        });

        if (!createResponse.ok) {
            const err = await createResponse.json();
            throw new Error(err.error || 'Error al clonar método');
        }

        Swal.fire('Éxito', 'Método clonado correctamente (Inactivo). Puede editarlo ahora.', 'success');
        loadMethods();

    } catch (error) {
        console.error('Clone error:', error);
        Swal.fire('Error', 'Error al clonar: ' + error.message, 'error');
    }
}
