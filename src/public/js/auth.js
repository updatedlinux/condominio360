// Auth Logic
const API_URL = '/api/auth';

// Si vienen de redirect=/security, preseleccionar Vigilancia
document.addEventListener('DOMContentLoaded', () => {
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (redirect === '/security' && typeof setLoginType === 'function') {
        setLoginType('SECURITY');
    }
});

// Login Type Selector
function setLoginType(type) {
    document.getElementById('loginType').value = type;
    
    // Update button styles (tema naranja coherente con landing)
    document.querySelectorAll('.login-type-btn').forEach(btn => {
        btn.classList.remove('bg-orange-500', 'text-white');
        btn.classList.add('bg-slate-100', 'text-slate-600');
    });
    
    const activeBtn = type === 'SECURITY' ? 'btn-type-security' : 'btn-type-default';
    document.getElementById(activeBtn).classList.remove('bg-slate-100', 'text-slate-600');
    document.getElementById(activeBtn).classList.add('bg-orange-500', 'text-white');
}

// Esperar a que grecaptcha esté disponible (script carga async)
function waitForGrecaptcha(timeoutMs = 5000) {
    return new Promise((resolve) => {
        if (typeof grecaptcha !== 'undefined') {
            resolve(grecaptcha);
            return;
        }
        const deadline = Date.now() + timeoutMs;
        const check = () => {
            if (typeof grecaptcha !== 'undefined') {
                resolve(grecaptcha);
                return;
            }
            if (Date.now() > deadline) {
                console.warn('reCAPTCHA: timeout esperando script');
                resolve(null);
                return;
            }
            setTimeout(check, 100);
        };
        check();
    });
}

// Obtener token reCAPTCHA v3 (si está configurado)
async function getRecaptchaToken() {
    const siteKey = (window.RECAPTCHA_SITE_KEY || '').trim();
    if (!siteKey) {
        console.warn('[reCAPTCHA] No RECAPTCHA_SITE_KEY. Revisa que esté en .env del servidor.');
        return null;
    }
    try {
        const grecaptcha = await waitForGrecaptcha();
        if (!grecaptcha) {
            console.warn('[reCAPTCHA] Script no cargó a tiempo. ¿Dominio en recaptcha.google.com?');
            return null;
        }
        await grecaptcha.ready();
        const token = await grecaptcha.execute(siteKey, { action: 'login' });
        if (!token) {
            console.warn('[reCAPTCHA] execute() no devolvió token.');
            return null;
        }
        return token;
    } catch (err) {
        console.warn('[reCAPTCHA] Error:', err.message || err);
        return null;
    }
}

// Login Handler
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const identifier = document.getElementById('identifier')?.value || document.getElementById('email')?.value;
        const password = document.getElementById('password').value;
        const type = document.getElementById('loginType')?.value || '';
        const errorMessage = document.getElementById('errorMessage');
        const submitBtn = loginForm.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        try {
            const recaptchaToken = await getRecaptchaToken();
            const body = { identifier, email: identifier, password, type };
            if (recaptchaToken) body.recaptchaToken = recaptchaToken;

            const response = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // 1. Super Admin Check
                if (data.user && data.user.isSuperAdmin) {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    window.location.href = '/admin';
                    return;
                }

                // 2. Tenant Admin Check - Ya tiene tenant asignado, va directo
                if (data.user && data.user.type === 'TENANT_ADMIN') {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    // Guardar info del tenant para mostrar nombre del condominio
                    if (data.tenant) {
                        localStorage.setItem('tenant', JSON.stringify(data.tenant));
                    }
                    window.location.href = '/tenant-admin';
                    return;
                }

                // 3. Security - Va al panel de seguridad
                if (data.user && data.user.type === 'SECURITY') {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    if (data.tenant) {
                        localStorage.setItem('tenant', JSON.stringify(data.tenant));
                    }
                    const redirect = new URLSearchParams(window.location.search).get('redirect');
                    window.location.href = (redirect && redirect.startsWith('/')) ? redirect : '/security';
                    return;
                }

                // 4. Owner - Necesita seleccionar propiedad/tenant
                if (data.properties && data.properties.length > 0) {
                    // Guardar propiedades disponibles (para el selector)
                    localStorage.setItem('availableProperties', JSON.stringify(data.properties));
                    
                    // Si solo tiene una propiedad, ir directo
                    if (data.properties.length === 1) {
                        localStorage.setItem('token', data.token);
                        localStorage.setItem('user', JSON.stringify(data.user));
                        localStorage.setItem('selectedProperty', JSON.stringify(data.properties[0]));
                        window.location.href = '/dashboard';
                        return;
                    }
                    
                    // Si tiene múltiples propiedades, mostrar selección
                    localStorage.setItem('tempToken', data.token);
                    window.location.href = '/select-property';
                    return;
                }

                // 4. Si llega aquí, algo está mal
                errorMessage.textContent = 'No tienes propiedades asignadas';
                errorMessage.classList.remove('hidden');
            } else {
                errorMessage.textContent = data.error || 'Error al iniciar sesión';
                errorMessage.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Login error:', error);
            errorMessage.textContent = 'Error de conexión';
            errorMessage.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// Load Properties for Selection (para propietarios con múltiples unidades)
async function loadPropertiesForSelection() {
    const propertyList = document.getElementById('propertyList');
    const loadingState = document.getElementById('loadingState');
    if (!propertyList) return;

    const properties = JSON.parse(localStorage.getItem('availableProperties') || '[]');
    const tempToken = localStorage.getItem('tempToken');

    if (!tempToken || properties.length === 0) {
        window.location.href = '/login';
        return;
    }

    if (loadingState) loadingState.remove();

    const propertyName = (p) => p.name || (p.building_name ? p.building_name + ' - ' + (p.floor ? 'Piso ' + p.floor : '') : (p.building || '') + ' ' + (p.floor ? 'Piso ' + p.floor : ''));
    const tenantName = (p) => p.tenantName || 'Condominio';
    const buildingInfo = (p) => p.building_name && p.floor ? `${p.building_name} • Piso ${p.floor}` : (p.building_name || p.building || '');

    properties.forEach(property => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'property-card group w-full text-left bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-sm hover:border-orange-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 cursor-pointer';
        const extraInfo = buildingInfo(property);
        card.innerHTML = `
            <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 text-orange-600 mb-1">
                        <span class="material-icons-round text-xl">home</span>
                        <span class="text-xs font-semibold uppercase tracking-wide">Inmueble</span>
                    </div>
                    <h3 class="text-lg sm:text-xl font-bold text-slate-900 truncate">${escapeHtml(propertyName(property))}</h3>
                    <p class="mt-2 text-sm text-slate-600 flex items-center gap-1.5">
                        <span class="material-icons-round text-base text-slate-400">apartment</span>
                        ${escapeHtml(tenantName(property))}
                    </p>
                    ${extraInfo ? `<p class="mt-1 text-xs text-slate-500">${escapeHtml(extraInfo)}</p>` : ''}
                </div>
                <span class="material-icons-round text-slate-300 group-hover:text-orange-500 text-2xl shrink-0">chevron_right</span>
            </div>
        `;
        card.onclick = () => selectProperty(property.id);
        propertyList.appendChild(card);
    });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Select Property (para propietarios)
async function selectProperty(propertyId) {
    const tempToken = localStorage.getItem('tempToken');
    try {
        const response = await fetch(`${API_URL}/select-property`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tempToken}`
            },
            body: JSON.stringify({ propertyId })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            localStorage.setItem('token', data.token);
            if (data.user) {
                localStorage.setItem('user', JSON.stringify(data.user));
            }
            if (data.property) {
                localStorage.setItem('selectedProperty', JSON.stringify(data.property));
            }

            // Clear temp data
            localStorage.removeItem('tempToken');
            localStorage.removeItem('availableProperties');

            window.location.href = '/dashboard';
        } else {
            alert('Error al seleccionar propiedad: ' + (data.error || 'Unknown'));
        }
    } catch (error) {
        console.error('Select property error:', error);
        alert('Error de conexión');
    }
}

// Legacy: Load Tenants for Selection (mantener por compatibilidad)
async function loadTenantsForSelection() {
    const tenantList = document.getElementById('tenantList');
    if (!tenantList) return;

    // Verificar si venimos de un Owner o TenantAdmin
    const properties = JSON.parse(localStorage.getItem('availableProperties') || '[]');
    if (properties.length > 0) {
        // Es propietario, redirigir a la nueva interfaz
        window.location.href = '/select-property';
        return;
    }

    const tenants = JSON.parse(localStorage.getItem('availableTenants') || '[]');
    const tempToken = localStorage.getItem('tempToken');

    if (!tempToken || tenants.length === 0) {
        window.location.href = '/login';
        return;
    }

    tenantList.innerHTML = '';

    tenants.forEach(tenant => {
        const button = document.createElement('button');
        button.className = 'w-full flex items-center justify-between px-4 py-4 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition';
        button.innerHTML = `
            <div class="flex flex-col items-start">
                <span class="text-lg font-bold text-gray-900">${tenant.name}</span>
                <span class="text-xs text-gray-500">ID: ${tenant.slug}</span>
            </div>
            <svg class="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
            </svg>
        `;

        button.onclick = () => selectTenant(tenant.id);
        tenantList.appendChild(button);
    });
}

// Legacy: Select Tenant (mantener por compatibilidad)
async function selectTenant(tenantId) {
    const tempToken = localStorage.getItem('tempToken');
    try {
        const response = await fetch(`${API_URL}/select-tenant`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tempToken}`
            },
            body: JSON.stringify({ tenantId })
        });

        const data = await response.json();

        if (response.ok) {
            localStorage.setItem('token', data.token);
            if (data.user) {
                localStorage.setItem('user', JSON.stringify(data.user));
            }

            // Clear temp data
            localStorage.removeItem('tempToken');
            localStorage.removeItem('availableTenants');

            if (data.role === 'ADMIN' || data.user?.type === 'TENANT_ADMIN') {
                window.location.href = '/tenant-admin';
            } else {
                window.location.href = '/dashboard';
            }
        } else {
            alert('Error al seleccionar condominio: ' + (data.error || 'Unknown'));
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Select tenant error:', error);
        alert('Error de conexión');
    }
}
