/**
 * Payment Methods Management Frontend Logic
 */

let paymentMethods = [];
let definitions = [];
let addMethodState = {
    step: 1,
    selectedFiat: null,
    selectedType: null
};

// Mapeo de códigos de moneda a códigos de país para banderas
const currencyToCountryFlag = {
    'VES': '🇻🇪', // Venezuela
    'USD': '🇺🇸', // Estados Unidos
    'EUR': '🇪🇺', // Unión Europea
    'ARS': '🇦🇷', // Argentina
    'BRL': '🇧🇷', // Brasil
    'CLP': '🇨🇱', // Chile
    'COP': '🇨🇴', // Colombia
    'MXN': '🇲🇽', // México
    'PEN': '🇵🇪', // Perú
    'BOB': '🇧🇴', // Bolivia
    'UYU': '🇺🇾', // Uruguay
    'DOP': '🇩🇴', // República Dominicana
    'PYG': '🇵🇾', // Paraguay
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    init();

    // Setup logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }
});

async function init() {
    await loadDefinitions();
    loadPaymentMethods();
}

// Auth check
function checkAuth() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }
}

// Logout
function logout() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    window.location.href = '/login';
}

// Toggle sidebar
function toggleSidebar() {
    const sidebar = document.getElementById('dashboardSidebar');
    const mainContent = document.getElementById('dashboardMain');
    sidebar.classList.toggle('collapsed');
    mainContent.classList.toggle('sidebar-collapsed');
}

// Load Definitions
async function loadDefinitions() {
    const accessToken = localStorage.getItem('accessToken');
    try {
        const response = await fetch('/api/p2p/config/payment-methods', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        definitions = data.definitions || [];

        // Parse fieldsSchema if string
        definitions.forEach(def => {
            if (typeof def.fieldsSchema === 'string') {
                try {
                    def.fieldsSchema = JSON.parse(def.fieldsSchema);
                } catch (e) {
                    console.error('Error parsing schema for', def.code, e);
                    def.fieldsSchema = [];
                }
            }
        });

    } catch (error) {
        console.error('Error loading definitions:', error);
    }
}

// Load payment methods
async function loadPaymentMethods() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        renderPaymentMethods(); // Render empty state if no token
        return;
    }

    const list = document.getElementById('paymentMethodsList');
    if (list) {
        list.innerHTML = `
            <div class="empty-state">
                <i class="ri-loader-4-line"></i>
                <p>Cargando métodos de pago...</p>
            </div>
        `;
    }

    try {
        const response = await fetch('/api/p2p/payment-methods', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al cargar métodos de pago');
        }

        const data = await response.json();
        paymentMethods = data.paymentMethods || [];
        renderPaymentMethods();
    } catch (error) {
        console.error('Error loading payment methods:', error);
        showAlert(error.message || 'Error al cargar métodos de pago', 'error');
        // Always render, even on error
        paymentMethods = [];
        renderPaymentMethods();
    }
}

// Render payment methods
function renderPaymentMethods() {
    const list = document.getElementById('paymentMethodsList');
    if (!list) return;

    if (paymentMethods.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i class="ri-bank-card-line" style="font-size: 64px; color: #ccc; margin-bottom: 20px; display: block;"></i>
                <p style="color: #666; margin-bottom: 20px;">No tienes métodos de pago registrados</p>
                <button class="btn btn-primary" onclick="showAddPaymentMethodModal()" style="margin-top: 20px; padding: 8px 16px; font-size: 0.85rem;">
                    <i class="ri-add-line"></i> Agregar Primer Método
                </button>
            </div>
        `;
        return;
    }

    list.innerHTML = paymentMethods.map(method => {
        const def = definitions.find(d => d.code === method.type);
        const typeName = def ? def.name : method.type;
        const currency = def ? def.currency : '';
        const flag = currencyToCountryFlag[currency] || '';

        let additionalInfo = '';
        if (method.field2 && (method.type.includes('BANK') || method.type.includes('PAGO'))) {
            additionalInfo = ` • ${method.field2}`;
        } else if (method.field1) {
            additionalInfo = ` • ${method.field1}`;
        }

        return `
            <div class="payment-method-card">
                <div class="payment-method-info">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        ${def && def.logoUrl ? `<img src="${def.logoUrl}" alt="${def.name}" style="height: 24px;">` : `<span style="font-size: 20px;">${flag}</span>`}
                        <div>
                            <h3>${method.name}</h3>
                            <p>${typeName}${additionalInfo} ${method.isActive ? '' : '<span style="color: #dc3545;">(Inactivo)</span>'}</p>
                        </div>
                    </div>
                </div>
                <div class="payment-method-actions">
                    <button class="btn btn-secondary" onclick="editPaymentMethod('${method.id}')">
                        <i class="ri-edit-line"></i> Editar
                    </button>
                    <button class="btn btn-danger" onclick="deletePaymentMethod('${method.id}')">
                        <i class="ri-delete-bin-line"></i> Eliminar
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// ==========================================
// Modal Logic & Steps
// ==========================================

function showAddPaymentMethodModal() {
    addMethodState = { step: 1, selectedFiat: null, selectedType: null };

    const modal = document.getElementById('paymentMethodModal');
    const form = document.getElementById('paymentMethodForm');
    const title = document.getElementById('modalTitle');
    const idInput = document.getElementById('paymentMethodId');
    const typeInput = document.getElementById('paymentMethodType');

    if (modal) modal.style.display = 'block';
    if (title) title.textContent = 'Agregar Método de Pago';
    if (idInput) idInput.value = '';
    if (typeInput) typeInput.value = '';
    if (form) form.reset();

    goToStep(1);
    renderFiatSelection();
}

function goToStep(step) {
    addMethodState.step = step;

    const step1 = document.getElementById('modalStep1');
    const step2 = document.getElementById('modalStep2');
    const step3 = document.getElementById('modalStep3');

    if (step1) step1.style.display = step === 1 ? 'block' : 'none';
    if (step2) step2.style.display = step === 2 ? 'block' : 'none';
    if (step3) step3.style.display = step === 3 ? 'block' : 'none';
}

function renderFiatSelection() {
    const grid = document.getElementById('fiatCurrencyGrid');
    if (!grid) return;

    // Use all available currencies from the flag map to ensure they all appear
    const currencies = Object.keys(currencyToCountryFlag);

    grid.innerHTML = currencies.map(currency => {
        const flag = currencyToCountryFlag[currency] || '🏳️';
        return `
            <div class="selection-card" onclick="selectFiat('${currency}')">
                <span class="flag">${flag}</span>
                <span class="code">${currency}</span>
            </div>
        `;
    }).join('');
}

function selectFiat(currency) {
    addMethodState.selectedFiat = currency;
    goToStep(2);
    renderMethodSelection(currency);
}

function renderMethodSelection(currency) {
    const grid = document.getElementById('methodTypeGrid');
    if (!grid) return;

    const methods = definitions.filter(d => d.currency === currency);

    if (methods.length === 0) {
        grid.innerHTML = '<p class="text-muted" style="grid-column: 1/-1; text-align: center;">No hay métodos definidos para esta moneda.</p>';
        return;
    }

    grid.innerHTML = methods.map(def => {
        const flag = currencyToCountryFlag[def.currency] || '🏳️';
        const iconHtml = def.logoUrl
            ? `<img src="${def.logoUrl}" alt="${def.name}" style="height: 32px; margin-bottom: 8px; object-fit: contain;">`
            : `<span class="flag" style="font-size: 24px;">${flag}</span>`;

        return `
            <div class="selection-card" onclick="selectMethodType('${def.code}')">
                ${iconHtml}
                <span class="code" style="font-size: 13px;">${def.name}</span>
            </div>
        `;
    }).join('');
}

function selectMethodType(typeCode) {
    addMethodState.selectedType = typeCode;
    const input = document.getElementById('paymentMethodType');
    if (input) input.value = typeCode;

    // Update Step 3 title with Method Name
    const def = definitions.find(d => d.code === typeCode);
    const title = document.getElementById('step3Title');
    if (title && def) title.textContent = `Detalles: ${def.name}`;

    goToStep(3);
    updatePaymentMethodFields();
}


// Close payment method modal
function closePaymentMethodModal() {
    const modal = document.getElementById('paymentMethodModal');
    if (modal) modal.style.display = 'none';
}

// Edit payment method
async function editPaymentMethod(id) {
    const method = paymentMethods.find(m => m.id === id);
    if (!method) return;

    const modal = document.getElementById('paymentMethodModal');
    const title = document.getElementById('modalTitle');
    const idInput = document.getElementById('paymentMethodId');
    const typeInput = document.getElementById('paymentMethodType');

    if (modal) modal.style.display = 'block';
    if (title) title.textContent = 'Editar Método de Pago';
    if (idInput) idInput.value = method.id;
    if (typeInput) typeInput.value = method.type;

    // Direct to Step 3 for editing
    goToStep(3);

    // Update context for dynamic fields
    const def = definitions.find(d => d.code === method.type);
    if (title && def) title.textContent = `Editar: ${def.name}`;
    const step3Title = document.getElementById('step3Title');
    if (step3Title && def) step3Title.textContent = `Editar: ${def.name}`;

    // Render fields
    updatePaymentMethodFields();

    // Fill values
    if (def && def.fieldsSchema) {
        def.fieldsSchema.forEach(field => {
            const input = document.getElementById(`field_${field.name}`);
            if (input) {
                if (field.mapping) {
                    input.value = method[field.mapping] || '';
                }
            }
        });
    }
}

// Actualizar campos dinámicos (Step 3)
function updatePaymentMethodFields() {
    const typeInput = document.getElementById('paymentMethodType');
    const dynamicFields = document.getElementById('dynamicFields');

    if (!typeInput || !dynamicFields) return;

    const type = typeInput.value;
    const def = definitions.find(d => d.code === type);

    if (!def || !def.fieldsSchema) {
        dynamicFields.innerHTML = '';
        return;
    }

    let html = '';
    def.fieldsSchema.forEach(field => {
        let inputHtml = '';
        const inputId = `field_${field.name}`;

        if (field.type === 'select') {
            const options = (field.options || []).map(opt => `<option value="${opt}">${opt}</option>`).join('');
            inputHtml = `<select id="${inputId}" class="form-control dynamic-field" data-mapping="${field.mapping}" ${field.required ? 'required' : ''}>
                ${options}
            </select>`;
        } else {
            inputHtml = `<input type="${field.type}" id="${inputId}" class="form-control dynamic-field" data-mapping="${field.mapping}" ${field.required ? 'required' : ''} placeholder="${field.label}">`;
        }

        html += `
            <div class="form-group">
                <label>${field.label} ${field.required ? '*' : ''}</label>
                ${inputHtml}
            </div>
        `;
    });

    dynamicFields.innerHTML = html;
}

// Handle payment method submit
async function handlePaymentMethodSubmit(event) {
    event.preventDefault();
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showAlert('Sesión expirada', 'error');
        return;
    }

    const idInput = document.getElementById('paymentMethodId');
    const typeInput = document.getElementById('paymentMethodType');

    const id = idInput.value;
    const type = typeInput.value;

    // Determine Name (from definition)
    const def = definitions.find(d => d.code === type);
    const name = def ? def.name : type;

    let payload = {
        type, name,
        field1: null, field2: null, field3: null, field4: null,
        details: null
    };

    const dynamicInputs = document.querySelectorAll('.dynamic-field');
    dynamicInputs.forEach(input => {
        const mapping = input.dataset.mapping;
        if (mapping && payload.hasOwnProperty(mapping)) {
            payload[mapping] = input.value;
        }
    });

    try {
        const url = id ? `/api/p2p/payment-methods/${id}` : '/api/p2p/payment-methods';
        const method = id ? 'PATCH' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al guardar método de pago');
        }

        showAlert(id ? 'Método de pago actualizado exitosamente' : 'Método de pago creado exitosamente', 'success');
        closePaymentMethodModal();
        loadPaymentMethods();
    } catch (error) {
        console.error('Error saving payment method:', error);
        showAlert(error.message || 'Error al guardar método de pago', 'error');
    }
}

// Delete payment method
async function deletePaymentMethod(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar este método de pago?')) {
        return;
    }

    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showAlert('Sesión expirada', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/p2p/payment-methods/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al eliminar método de pago');
        }

        showAlert('Método de pago eliminado exitosamente', 'success');
        loadPaymentMethods();
    } catch (error) {
        console.error('Error deleting payment method:', error);
        showAlert(error.message || 'Error al eliminar método de pago', 'error');
    }
}

// Show alert
function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) return;

    const alertClass = type === 'success' ? 'alert-success' : 'alert-danger';
    const alert = document.createElement('div');
    alert.className = `alert ${alertClass}`;
    alert.textContent = message;

    alertContainer.innerHTML = '';
    alertContainer.appendChild(alert);

    setTimeout(() => {
        alert.remove();
    }, 5000);
}

// Helper: Make global
window.updatePaymentMethodFields = updatePaymentMethodFields;
window.showAddPaymentMethodModal = showAddPaymentMethodModal;
window.closePaymentMethodModal = closePaymentMethodModal;
window.editPaymentMethod = editPaymentMethod;
window.handlePaymentMethodSubmit = handlePaymentMethodSubmit;
window.deletePaymentMethod = deletePaymentMethod;
window.goToStep = goToStep;
window.selectFiat = selectFiat;
window.selectMethodType = selectMethodType;

// Close modal when clicking outside
window.onclick = function (event) {
    const modal = document.getElementById('paymentMethodModal');
    if (event.target === modal) {
        closePaymentMethodModal();
    }
}
