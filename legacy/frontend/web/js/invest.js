/**
 * BidiInvest JavaScript
 * 
 * Maneja la lógica del frontend de BidiInvest:
 * - Carga de planes y salas
 * - Validación de elegibilidad
 * - Proyección de recompensas de staking
 * - Unirse a salas
 */

const API_BASE = '/api/invest';
let currentRoom = null;
let currentPlan = null;
let isEligible = false;
let activeInvestmentRoomId = null; // Track user's active investment room

// Token de autenticación
function getToken() {
    return localStorage.getItem('accessToken');
}

// Headers para fetch
function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
    };
}

// Formatear moneda
function formatCurrency(amount) {
    const formatted = new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
    return formatted + ' BiUSD';
}

// Formatear fecha
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-VE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    // Verificar autenticación
    if (!getToken()) {
        window.location.href = '/login';
        return;
    }

    // Cargar datos
    // Cargar elegibilidad primero para asegurar estado correcto
    await loadEligibility();

    // Load investments first to know if user has an active investment
    await loadInvestments();

    // Cargar el resto de datos
    await Promise.all([
        loadLimitStatus(),
        loadRooms(),
        loadPlans(),
        loadLockedBalance()
    ]);
});

// Cargar elegibilidad
async function loadEligibility() {
    try {
        const res = await fetch(`${API_BASE}/eligibility`, { headers: getHeaders() });
        const data = await res.json();

        const banner = document.getElementById('eligibilityBanner');

        if (data.eligible) {
            isEligible = true;
            eligibilityState = { eligible: true, reason: '' };
            banner.className = 'eligibility-banner eligible';
            banner.innerHTML = `
                <span><i class="ri-checkbox-circle-line"></i> ¡Estás listo para hacer staking! Cumples con todos los requisitos.</span>
                <button type="button" class="close-banner" onclick="this.parentElement.style.display='none'" aria-label="Cerrar">
                    <i class="ri-close-line"></i>
                </button>
            `;
        } else {
            isEligible = false;
            eligibilityState = { eligible: false, reason: data.reason || 'No cumples los requisitos.' };
            banner.className = 'eligibility-banner not-eligible';
            let message = `<i class="ri-alert-line"></i> ${data.reason || 'No cumples los requisitos para hacer staking.'}`;
            if (data.cooldownUntil) {
                message += ` <br><small>Podrás hacer staking después de ${formatDate(data.cooldownUntil)}</small>`;
            }
            banner.innerHTML = message;
        }
        banner.style.display = 'block';
    } catch (error) {
        console.error('Error loading eligibility:', error);
    }
}

// Cargar estado del límite bimestral
// Cargar estado del límite bimestral
async function loadLimitStatus() {
    try {
        const res = await fetch(`${API_BASE}/limit-status`, { headers: getHeaders() });
        const data = await res.json();

        if (data.success) {
            const used = data.usedAmount || 0;
            const max = data.maxAmount || 1500;
            const percent = Math.min(100, (used / max) * 100);

            document.getElementById('limitBarFill').style.width = `${percent}%`;
            document.getElementById('limitUsed').textContent = `${formatCurrency(used)} usados`;
            document.getElementById('limitRemaining').textContent = `${formatCurrency(max - used)} disponibles`;
        }
    } catch (error) {
        console.error('Error loading limit status:', error);
    }
}

// Cargar salas disponibles
async function loadRooms() {
    const container = document.getElementById('roomsContainer');

    try {
        const res = await fetch(`${API_BASE}/rooms`, { headers: getHeaders() });
        const data = await res.json();

        if (!data.success || !data.rooms || data.rooms.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="ri-door-open-line"></i>
                    <h4>No hay salas disponibles</h4>
                    <p>Actualmente no hay salas abiertas para registro. Vuelve pronto.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = data.rooms.map(room => `
            <div class="room-card">
                <div class="room-header">
                    <h4 class="room-name">${room.name}</h4>
                    <span class="room-badge registration">🔓 Registro Abierto</span>
                </div>
                <div class="room-info">
                    <div class="room-info-item">
                        <i class="ri-funds-line"></i>
                        <span>Plan: ${room.plan.displayName}</span>
                    </div>
                    <div class="room-info-item">
                        <i class="ri-percent-line"></i>
                        <span>Rendimiento: ${room.plan.grossReturnPercent}%</span>
                    </div>
                    <div class="room-info-item">
                        <i class="ri-money-dollar-circle-line"></i>
                        <span>Rango: ${formatCurrency(room.plan.minAmount)} - ${formatCurrency(room.plan.maxAmount)}</span>
                    </div>
                    <div class="room-info-item">
                        <i class="ri-calendar-line"></i>
                        <span>Plazo: ${room.plan.businessDays} días hábiles</span>
                    </div>
                    <div class="room-info-item">
                        <i class="ri-group-line"></i>
                        <span>Participantes: ${room.participantCount || 0}</span>
                    </div>
                    <div class="room-info-item">
                        <i class="ri-time-line"></i>
                        <span>Cierre Registro: ${formatDate(room.registrationEnd)}</span>
                    </div>
                    <div class="room-info-item text-primary">
                        <i class="ri-calendar-check-line"></i>
                        <span>Inicio Sala: ${formatDate(room.startDate)}</span>
                    </div>
                    <div class="room-info-item text-muted">
                        <i class="ri-calendar-event-line"></i>
                        <span>Fin Sala: ${formatDate(room.endDate)}</span>
                    </div>
                </div>
                <div class="room-actions">
                    ${activeInvestmentRoomId === room.id
                ? `<button class="btn-sm btn-secondary" disabled>
                            <i class="ri-check-line"></i> Ya estás unido a esta sala
                           </button>`
                : `<button class="btn-sm btn-primary" 
                            onclick="showJoinModal('${room.id}', '${room.name}', '${room.plan.id}', ${room.plan.minAmount}, ${room.plan.maxAmount})">
                            <i class="ri-add-line"></i> Unirme
                           </button>`
            }
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading rooms:', error);
        container.innerHTML = `
            <div class="empty-state">
                <i class="ri-error-warning-line"></i>
                <h4>Error al cargar salas</h4>
                <p>Intenta recargar la página.</p>
            </div>
        `;
    }
}

// Cargar planes
async function loadPlans() {
    const container = document.getElementById('plansContainer');

    try {
        const res = await fetch(`${API_BASE}/plans`, { headers: getHeaders() });
        const data = await res.json();

        if (!data.success || !data.plans || data.plans.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="ri-funds-line"></i>
                    <h4>No hay planes disponibles</h4>
                </div>
            `;
            return;
        }

        container.innerHTML = data.plans.map(plan => {
            const planClass = plan.name.toLowerCase();
            return `
                <div class="plan-card ${planClass}">
                    <div class="plan-header">
                        <h4 class="plan-name">${plan.displayName}</h4>
                        <div class="plan-return">${plan.grossReturnPercent}%<span> bruto</span></div>
                    </div>
                    <div class="plan-details">
                        <div class="plan-detail-item">
                            <span class="label">Staking mínimo</span>
                            <span class="value">${formatCurrency(plan.minAmount)}</span>
                        </div>
                        <div class="plan-detail-item">
                            <span class="label">Staking máximo</span>
                            <span class="value">${formatCurrency(plan.maxAmount)}</span>
                        </div>
                        <div class="plan-detail-item">
                            <span class="label">Plazo</span>
                            <span class="value">${plan.businessDays} días hábiles</span>
                        </div>
                        <div class="plan-detail-item">
                            <span class="label">Comisión salida</span>
                            <span class="value">1%</span>
                        </div>
                    </div>
                    <p class="plan-description">${plan.description || ''}</p>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading plans:', error);
        container.innerHTML = `<p>Error al cargar planes</p>`;
    }
}

// Cargar mis inversiones
async function loadInvestments() {
    const container = document.getElementById('investmentsContainer');

    try {
        const res = await fetch(`${API_BASE}/my-investments`, { headers: getHeaders() });
        const data = await res.json();

        if (!data.success) {
            container.innerHTML = '<p class="text-center text-muted">No se pudieron cargar el staking</p>';
            return;
        }

        const investments = data.investments || [];
        document.getElementById('activeInvestments').textContent = investments.filter(i => i.status === 'active').length;

        // Track active investment room for button display
        const activeInv = investments.find(i => i.status === 'active');
        if (activeInv && activeInv.room) {
            activeInvestmentRoomId = activeInv.room.id;
        } else {
            activeInvestmentRoomId = null;
        }

        // Check for active investment and redirect
        // Auto-redirect removed to show list with button
        /*
        const activeInv = investments.find(i => i.status === 'ACTIVE');
        if (activeInv) {
            window.location.href = '/invest-view';
            return;
        }
        */

        if (investments.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="ri-safe-2-line"></i>
                    <p>No tienes staking activo</p>
                </div>
            `;
            return;
        }

        // Calculate total expected returns
        const totalReturns = investments.reduce((sum, inv) => {
            return inv.status === 'active' ? sum + Number(inv.netReturn) : sum;
        }, 0);
        document.getElementById('totalReturns').textContent = formatCurrency(totalReturns);

        container.innerHTML = investments.map(inv => {
            let statusClass = '';
            let statusText = '';

            switch (inv.status) {
                case 'active':
                    statusClass = 'border-primary';
                    statusText = 'Activo';
                    break;
                case 'liquidated':
                    statusClass = 'border-success';
                    statusText = 'Finalizado';
                    break;
                case 'cancelled':
                    statusClass = 'border-secondary';
                    statusText = 'Cancelado';
                    break;
                default:
                    statusClass = 'border-secondary';
                    statusText = inv.status;
            }


            return `
                <div class="investment-card ${inv.status === 'active' ? 'active' : ''} ${inv.status === 'liquidated' ? 'liquidated' : ''}">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="m-0 font-weight-bold">${inv.room?.name || 'Sala'}</h5>
                        <div>
                             <span class="badge ${inv.status === 'active' ? 'badge-primary' : (inv.status === 'liquidated' ? 'badge-success' : 'badge-secondary')}">
                                ${statusText}
                            </span>
                             <a href="/invest-view" class="btn btn-sm btn-outline-primary ml-2">
                                <i class="ri-eye-line"></i>
                            </a>
                        </div>
                    </div>
                    
                    <div class="row mb-3">
                        <div class="col-6">
                            <small class="text-muted d-block">Staking</small>
                            <span class="h4 text-primary font-weight-bold">${formatCurrency(inv.amount)}</span>
                        </div>
                        <div class="col-6 text-right">
                            <small class="text-muted d-block">Retorno Esperado</small>
                            <span class="h4 text-success font-weight-bold">+${formatCurrency(inv.netReturn)}</span>
                        </div>
                    </div>

                    <div class="text-muted small">
                        ${inv.room?.registrationStart ? `<div><span class="d-block">Pre-registro: ${formatDate(inv.room.registrationStart)}${inv.room.registrationEnd ? ' – ' + formatDate(inv.room.registrationEnd) : ''}</span></div>` : ''}
                        <div class="d-flex justify-content-between">
                            <span>Inicio del staking: ${formatDate(inv.room?.startDate || inv.joinedAt)}</span>
                            ${inv.liquidatedAt ? `<span>${inv.status === 'cancelled' ? 'Expulsado' : 'Liquidado'}: ${formatDate(inv.liquidatedAt)}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading investments:', error);
        container.innerHTML = `<p>Error al cargar staking</p>`;
    }
}

// Cargar balance bloqueado
async function loadLockedBalance() {
    try {
        const res = await fetch(`${API_BASE}/locked-balance`, { headers: getHeaders() });
        const data = await res.json();

        if (data.success) {
            document.getElementById('lockedBalance').textContent = formatCurrency(data.total || 0);
        }
    } catch (error) {
        console.error('Error loading locked balance:', error);
        document.getElementById('lockedBalance').textContent = '$0';
    }
}

// Mostrar modal de unirse
function showJoinModal(roomId, roomName, planId, minAmount, maxAmount) {
    // Verificar elegibilidad con detalle
    if (!eligibilityState.eligible) {
        // Si la razón es staking activo (o inversión activa por compatibilidad backend), mostrar error específico
        if (eligibilityState.reason && (eligibilityState.reason.includes('inversión activa') || eligibilityState.reason.includes('staking activo'))) {
            showError('Ya tienes un staking en curso. Solo puedes tener uno activo a la vez.');
        } else {
            // Por defecto asumir tema de KYC o bloqueos
            showKycModal();
        }
        return;
    }

    currentRoom = { id: roomId, name: roomName, planId, minAmount, maxAmount };

    document.getElementById('joinRoomName').value = roomName;
    document.getElementById('joinAmount').value = '';
    document.getElementById('joinAmount').min = minAmount;
    document.getElementById('joinAmount').max = maxAmount;
    document.getElementById('amountRange').textContent = `Rango: ${formatCurrency(minAmount)} - ${formatCurrency(maxAmount)}`;
    document.getElementById('projectionSummary').style.display = 'none';

    document.getElementById('joinModal').classList.add('show');
}

function hideJoinModal() {
    document.getElementById('joinModal').classList.remove('show');
    // currentRoom persists for TyC flow
}

// Actualizar proyección
async function updateProjection() {
    const amount = parseFloat(document.getElementById('joinAmount').value);
    const summary = document.getElementById('projectionSummary');

    if (!amount || !currentRoom || amount < currentRoom.minAmount || amount > currentRoom.maxAmount) {
        summary.style.display = 'none';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/project?planId=${currentRoom.planId}&amount=${amount}`, {
            headers: getHeaders()
        });
        const data = await res.json();

        if (data.success && data.projection) {
            const p = data.projection;
            document.getElementById('projCapital').textContent = formatCurrency(p.amount);
            document.getElementById('projGross').textContent = `+${formatCurrency(p.grossReturn)}`;
            document.getElementById('projFee').textContent = `-${formatCurrency(p.exitFee)}`;
            document.getElementById('projNet').textContent = `+${formatCurrency(p.netReturn)}`;
            document.getElementById('projTotal').textContent = formatCurrency(p.totalReceived);
            document.getElementById('projDays').textContent = p.businessDays;
            summary.style.display = 'block';
        }
    } catch (error) {
        console.error('Error getting projection:', error);
    }
}

// Variables globales para el flujo de unión
let joinAmount = 0;

// Inicializar listeners del modal TyC
document.addEventListener('DOMContentLoaded', () => {
    const check = document.getElementById('acceptTycCheck');
    const btn = document.getElementById('confirmJoinBtn');

    if (check && btn) {
        check.addEventListener('change', (e) => {
            btn.disabled = !e.target.checked;
        });

        btn.addEventListener('click', executeJoin);
    }
});

// Paso 1: Validar monto y mostrar TyC
function proceedToTyc() {
    if (!currentRoom) return;

    const amountInput = document.getElementById('joinAmount');
    joinAmount = parseFloat(amountInput.value);

    if (!joinAmount || joinAmount < currentRoom.minAmount || joinAmount > currentRoom.maxAmount) {
        showError(`El monto debe estar entre ${formatCurrency(currentRoom.minAmount)} y ${formatCurrency(currentRoom.maxAmount)}`);
        return;
    }

    // Ocultar modal de ingreso y mostrar TyC
    hideJoinModal();
    showTycModal();
}

// Mostrar TyC
// Mostrar modal de TyC
function showTycModal() {
    hideJoinModal(); // Cierra el anterior

    document.getElementById('tycModal').classList.add('show');

    // Resetear checkbox y botón
    const checkbox = document.getElementById('acceptTycCheck');
    const confirmBtn = document.getElementById('confirmJoinBtn');

    checkbox.checked = false;
    checkbox.disabled = true; // Deshabilitado hasta scroll
    confirmBtn.disabled = true;

    // Detectar scroll
    const contentDiv = document.getElementById('tycContentScroll');
    if (contentDiv) {
        contentDiv.onscroll = function () {
            // Margen de error 5px
            if (contentDiv.scrollTop + contentDiv.clientHeight >= contentDiv.scrollHeight - 5) {
                checkbox.disabled = false;
            }
        };
    }
}

function hideTycModal() {
    document.getElementById('tycModal').classList.remove('show');
}

// Lectura Rápida
function readFast() {
    const content = document.getElementById('tycContentScroll');
    content.scrollTo({
        top: content.scrollHeight,
        behavior: 'smooth'
    });

    // Habilitar tras breve delay para asegurar que el scroll disparó el evento (o forzarlo)
    setTimeout(() => {
        document.getElementById('acceptTycCheck').disabled = false;
    }, 600);
}

// Paso 2: Ejecutar unión tras aceptar TyC
async function executeJoin() {
    if (!currentRoom || !joinAmount) {
        console.error('Missing room or amount');
        return;
    }

    const btn = document.getElementById('confirmJoinBtn');
    btn.disabled = true;
    btn.textContent = 'Procesando...';

    try {
        const res = await fetch(`${API_BASE}/rooms/${currentRoom.id}/join`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                amount: joinAmount,
                acceptedTerms: true
            })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            hideTycModal();
            showSuccess('¡Te has unido exitosamente! Redirigiendo a tu panel de staking...');

            setTimeout(() => {
                window.location.href = '/invest-view';
            }, 2000);
        } else {
            hideTycModal();
            const errMsg = data.message || data.error || 'Error al unirse a la sala';
            showError(errMsg.startsWith('Error:') ? errMsg : 'Error: ' + errMsg);
        }
    } catch (error) {
        console.error('Error joining room:', error);
        hideTycModal();
        showError('Error de conexión. Intenta nuevamente.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirmar y hacer Staking';
    }
}

// Modales de feedback
function showSuccess(message) {
    document.getElementById('successMessage').textContent = message;
    document.getElementById('successModal').classList.add('show');
}

function hideSuccessModal() {
    document.getElementById('successModal').classList.remove('show');
}

function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorModal').classList.add('show');
}

function hideErrorModal() {
    document.getElementById('errorModal').classList.remove('show');
}

function showKycModal() {
    document.getElementById('kycRequiredModal').classList.add('show');
}

function hideKycModal() {
    document.getElementById('kycRequiredModal').classList.remove('show');
}
