/**
 * BidiSAN JavaScript
 * Maneja la lógica de la página de grupos de ahorro colaborativo
 */

// API helper - get token but don't redirect immediately
const accessToken = localStorage.getItem('accessToken');

async function apiCall(endpoint, options = {}, handleAuthError = true) {
    // If no token, return error but don't redirect yet
    if (!accessToken) {
        if (handleAuthError) {
            window.location.href = '/login';
        }
        return { error: 'No autenticado' };
    }

    try {
        const response = await fetch(endpoint, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                ...options.headers
            }
        });

        if (response.status === 401) {
            // Only redirect on 401 if handleAuthError is true
            if (handleAuthError) {
                localStorage.removeItem('accessToken');
                localStorage.removeItem('refreshToken');
                window.location.href = '/login';
            }
            return { error: 'Sesión expirada', authError: true };
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { error: error.message };
    }
}

// BidiSAN Frontend Logic
let isEligible = false;
let currentUserId = null;
let myGroupIds = new Set(); // Track user's group IDs

// Helper function to format dates in UTC (avoiding timezone conversion issues)
function formatDateUTC(dateString, options = { short: false }) {
    const date = new Date(dateString);
    const months = options.short
        ? ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
        : ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const day = date.getUTCDate();
    const month = months[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    return options.short ? `${day} ${month}. ${year}` : `${day} de ${month} de ${year}`;
}

// Modal functions
function showSuccessModal(message) {
    document.getElementById('successMessage').textContent = message;
    document.getElementById('successModal').classList.add('show');
}

function hideSuccessModal() {
    document.getElementById('successModal').classList.remove('show');
}

function showErrorModal(message) {
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorModal').classList.add('show');
}

function hideErrorModal() {
    document.getElementById('errorModal').classList.remove('show');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async function () {
    // First check if we have a token at all
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }

    // Check eligibility first - if this fails with 401, redirect
    const eligibilityOk = await checkEligibility();
    if (!eligibilityOk) return; // Already redirected

    // Load groups - these won't redirect on error
    await loadMyGroups();
    await loadAvailableGroups();
    initDateSelectors();
});

// Check eligibility - returns true if page should continue loading
async function checkEligibility() {
    const result = await apiCall('/api/san/eligibility');

    // If auth error, we've already been redirected
    if (!result || result.authError) {
        return false;
    }

    isEligible = result.canParticipate;
    const banner = document.getElementById('eligibilityBanner');

    if (isEligible) {
        banner.className = 'eligibility-banner eligible';
        banner.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span><i class="ri-checkbox-circle-fill"></i> ¡Estás habilitado para participar en BidiSAN!</span>
                <button onclick="this.closest('.eligibility-banner').style.display='none'" style="background: none; border: none; color: inherit; font-size: 1.2rem; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
            </div>
        `;
    } else {
        banner.className = 'eligibility-banner not-eligible';
        // Show detailed message with link to upgrade KYC
        banner.innerHTML = `
            <i class="ri-alert-fill"></i> 
            <strong>BidiSAN no disponible</strong><br>
            ${result.reason || 'Se requiere KYC nivel L3 o superior para participar.'}
            <br><a href="/profile" style="color: #856404; text-decoration: underline; margin-top: 8px; display: inline-block;">
                Ir a mi perfil para subir de nivel →
            </a>
        `;
    }
    banner.style.display = 'block';
    return true;
}

// Load my groups - don't redirect on auth error since eligibility already validated auth
async function loadMyGroups() {
    const container = document.getElementById('myGroupsContainer');
    const result = await apiCall('/api/san/my-groups', {}, false);

    if (!result || result.error) {
        container.innerHTML = '<div class="empty-state"><p>Error cargando grupos</p></div>';
        return;
    }

    document.getElementById('myGroupsCount').textContent = result.groups?.length || 0;

    // Update Header Stats
    if (result.stats) {
        document.getElementById('totalSaved').textContent = `${(result.stats.totalSaved || 0).toFixed(2)} BiUSD`;
        if (result.stats.nextPayment) {
            document.getElementById('nextPayment').textContent = formatDateUTC(result.stats.nextPayment, { short: true }).split(' ').slice(0, 2).join(' ');
        } else {
            document.getElementById('nextPayment').textContent = '-';
        }
    }

    if (!result.groups || result.groups.length === 0) {
        myGroupIds.clear();
        container.innerHTML = `
            <div class="empty-state">
                <i class="ri-team-line"></i>
                <h4>No estás en ningún grupo</h4>
                <p>Únete a un grupo o crea uno nuevo</p>
                ${isEligible ? '<button class="btn-sm btn-primary" onclick="showCreateModal()">Crear Grupo</button>' : ''}
            </div>
        `;
        return;
    }

    // Track user's group IDs
    myGroupIds = new Set(result.groups.map(g => g.id));

    container.innerHTML = result.groups.map(g => renderGroupCard(g, true)).join('');
}

// Load available groups - don't redirect on auth error
async function loadAvailableGroups() {
    const container = document.getElementById('availableGroupsContainer');
    const result = await apiCall('/api/san/groups', {}, false);

    if (!result || result.error) {
        container.innerHTML = '<div class="empty-state"><p>Error cargando grupos</p></div>';
        return;
    }

    if (!result.groups || result.groups.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="ri-search-line"></i>
                <h4>No hay grupos disponibles</h4>
                <p>Sé el primero en crear uno</p>
            </div>
        `;
        return;
    }

    container.innerHTML = result.groups.map(g => renderGroupCard(g, false)).join('');
}

// Render group card
function renderGroupCard(group, isMember) {
    const statusLabels = {
        'pending': 'Esperando inicio',
        'active': 'En curso',
        'completed': 'Completado'
    };

    const periodicityText = group.periodicity === 'weekly' ? 'Semanal' : 'Mensual';
    const dayText = group.periodicity === 'weekly'
        ? ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][group.paymentDay]
        : `Día ${group.paymentDay}`;

    const progressPercent = (group.currentParticipants / group.maxParticipants) * 100;
    // Use UTC formatting to avoid timezone issues
    const startDate = formatDateUTC(group.startDate, { short: true });

    return `
        <div class="group-card">
            <div class="group-header">
                <h4 class="group-name">${group.name}</h4>
                <span class="group-badge ${group.status}">${statusLabels[group.status] || group.status}</span>
            </div>
            <div class="group-amount">
                ${parseFloat(group.contributionAmount).toFixed(2)} BiUSD
                <small style="font-size: 0.5em; font-weight: normal;">/ ${periodicityText.toLowerCase()}</small>
            </div>
            <div class="group-info">
                <div class="group-info-item"><i class="ri-calendar-line"></i> ${periodicityText}</div>
                <div class="group-info-item"><i class="ri-time-line"></i> ${dayText}</div>
                <div class="group-info-item"><i class="ri-calendar-check-line"></i> Inicia: ${startDate}</div>
                <div class="group-info-item"><i class="ri-user-line"></i> ${group.currentParticipants}/${group.maxParticipants}</div>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
            </div>
            <div class="progress-text">
                <span>${group.currentParticipants} de ${group.maxParticipants}</span>
                <span>${Math.round(progressPercent)}% lleno</span>
            </div>
            <div class="group-actions">
                <button class="btn-sm btn-outline-primary" onclick="viewGroup('${group.id}')">
                    <i class="ri-eye-line"></i> Ver
                </button>
                ${!isMember && group.status === 'pending' && !myGroupIds.has(group.id) ? `
                    <button class="btn-sm btn-primary" onclick="joinGroup('${group.id}')" ${!isEligible ? 'disabled' : ''}>
                        <i class="ri-user-add-line"></i> Unirse
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

// Modal functions
function showCreateModal() {
    if (!isEligible) {
        document.getElementById('kycRequiredModal').classList.add('show');
        return;
    }

    // Safety check: ensure date selectors are populated
    const monthSelect = document.getElementById('groupStartMonth');
    if (monthSelect && monthSelect.options.length <= 1) {
        console.log('Populating date selectors on modal open...');
        initDateSelectors();
    }

    document.getElementById('createModal').classList.add('show');
}

function hideKycRequiredModal() {
    document.getElementById('kycRequiredModal').classList.remove('show');
}

function hideCreateModal() {
    document.getElementById('createModal').classList.remove('show');
}


// Update payment day options and limits based on periodicity
function updatePaymentDayOptions() {
    const periodicity = document.getElementById('groupPeriodicity').value;
    const select = document.getElementById('groupPaymentDay');
    const amountInput = document.getElementById('groupAmount');

    select.innerHTML = '';

    if (periodicity === 'weekly') {
        amountInput.setAttribute('max', '50');
        amountInput.placeholder = "Máx 50.00";

        const days = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        for (let i = 1; i <= 7; i++) {
            select.innerHTML += `<option value="${i}">${days[i]}</option>`;
        }
    } else if (periodicity === 'monthly') {
        amountInput.removeAttribute('max');
        amountInput.placeholder = "Mín 50.00";

        for (let i = 1; i <= 28; i++) {
            select.innerHTML += `<option value="${i}">Día ${i}</option>`;
        }
    } else {
        select.innerHTML = '<option value="">Selecciona periodicidad</option>';
    }
}

// Initialize date selectors
function initDateSelectors() {
    const monthSelect = document.getElementById('groupStartMonth');
    const months = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    // Get current date to start listing next months
    const now = new Date();
    const currentMonth = now.getMonth();

    monthSelect.innerHTML = '<option value="">Mes...</option>';

    // List only current and future months
    months.forEach((name, index) => {
        if (index >= currentMonth) {
            monthSelect.innerHTML += `<option value="${index}">${name}</option>`;
        }
    });

    // Set listeners for amount validation
    const amountInput = document.getElementById('groupAmount');
    const periodicitySelect = document.getElementById('groupPeriodicity');

    function validateAmount() {
        if (periodicitySelect.value === 'weekly') {
            const val = parseFloat(amountInput.value);
            if (val > 50) {
                amountInput.setCustomValidity('Para grupos semanales, el máximo es 50 BiUSD');
                amountInput.reportValidity();
            } else {
                amountInput.setCustomValidity('');
            }
        } else {
            amountInput.setCustomValidity('');
        }
    }

    amountInput.addEventListener('input', validateAmount);
    periodicitySelect.addEventListener('change', validateAmount);
}

// Update days based on month
function updateDaysOptions() {
    const monthSelect = document.getElementById('groupStartMonth');
    const daySelect = document.getElementById('groupStartDay');
    const month = parseInt(monthSelect.value);

    if (isNaN(month)) {
        daySelect.innerHTML = '<option value="">Día...</option>';
        return;
    }

    // Determine year (current or next)
    const now = new Date();
    let year = now.getFullYear();
    if (month < now.getMonth()) {
        year++;
    }

    // Get days in month
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Determine starting day
    // If selected month is current month, start from tomorrow (today + 1)
    let startDay = 1;
    if (month === now.getMonth() && year === now.getFullYear()) {
        startDay = now.getDate() + 1; // Start from tomorrow
    }

    let options = '<option value="">Día...</option>';
    for (let i = startDay; i <= daysInMonth; i++) {
        options += `<option value="${i}">${i}</option>`;
    }
    daySelect.innerHTML = options;
}

// Create group
async function createGroup() {
    const form = document.getElementById('createGroupForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const month = parseInt(document.getElementById('groupStartMonth').value);
    const day = parseInt(document.getElementById('groupStartDay').value);

    // Calculate year
    const now = new Date();
    let year = now.getFullYear();
    // If selected month is earlier than current month, it's for next year
    // If same month but earlier day, also next year
    if (month < now.getMonth() || (month === now.getMonth() && day < now.getDate())) {
        year++;
    }

    // Construct ISO date string as YYYY-MM-DD
    // Note: month is 0-indexed, so we add 1 for the string, but ensure 2 digits
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const data = {
        name: document.getElementById('groupName').value,
        periodicity: document.getElementById('groupPeriodicity').value,
        contributionAmount: parseFloat(document.getElementById('groupAmount').value),
        maxParticipants: parseInt(document.getElementById('groupParticipants').value),
        paymentDay: parseInt(document.getElementById('groupPaymentDay').value),
        startDate: dateStr,
        description: document.getElementById('groupDescription').value
    };

    const result = await apiCall('/api/san/groups', {
        method: 'POST',
        body: JSON.stringify(data)
    });

    if (result && !result.error) {
        showSuccessModal('¡Grupo creado exitosamente!');
        hideCreateModal();
        form.reset();
        await loadMyGroups();
        await loadAvailableGroups();
    } else {
        showErrorModal(result?.error || 'No se pudo crear el grupo');
    }
}

// Join group
async function joinGroup(groupId) {
    // Check eligibility first before attempting to join
    if (!isEligible) {
        showKycRequiredModal();
        return;
    }

    if (!confirm('¿Deseas unirte a este grupo?')) return;

    const result = await apiCall(`/api/san/groups/${groupId}/join`, { method: 'POST' });

    if (result && !result.error) {
        showSuccessModal('¡Te has unido al grupo!');
        await loadMyGroups();
        await loadAvailableGroups();
    } else {
        showErrorModal(result?.error || 'No se pudo unir al grupo');
    }
}

// Show KYC required modal with styled message
function showKycRequiredModal() {
    document.getElementById('kycRequiredModal').classList.add('show');
}

// Leave group
async function leaveGroup(groupId) {
    if (!confirm('¿Deseas abandonar este grupo?')) return;

    const result = await apiCall(`/api/san/groups/${groupId}/leave`, { method: 'POST' });

    if (result && !result.error) {
        showSuccessModal('Has abandonado el grupo');
        await loadMyGroups();
        await loadAvailableGroups();
    } else {
        showErrorModal(result?.error || 'No se pudo abandonar el grupo');
    }
}

// View group details - redirect to sanview page
function viewGroup(groupId) {
    window.location.href = `/sanview?groupId=${groupId}`;
}

// Close modal on backdrop click
// Close modal on backdrop click
document.getElementById('createModal').addEventListener('click', function (e) {
    if (e.target === this) {
        hideCreateModal();
    }
});

document.getElementById('kycRequiredModal').addEventListener('click', function (e) {
    if (e.target === this) {
        hideKycRequiredModal();
    }
});
