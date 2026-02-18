// SAN View - Group Details and Chat
let currentGroup = null;
let currentUserId = null;
let isParticipant = false;
let socket = null;
let messagePollingInterval = null;
let displayedMessageIds = new Set(); // Track displayed message IDs to avoid duplicates

// Get groupId from URL
const urlParams = new URLSearchParams(window.location.search);
const groupId = urlParams.get('groupId');

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }

    if (groupId) {
        loadGroupInfo();
        loadMessages();
        initializeWebSocket();
    } else {
        showError('No se proporcionó un ID de grupo válido');
    }
});

// API helper
async function apiCall(url, options = {}) {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return null;
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (response.status === 401) {
            window.location.href = '/login';
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { error: error.message };
    }
}

// Load group information
async function loadGroupInfo() {
    const result = await apiCall(`/api/san/groups/${groupId}`);

    if (!result || result.error || !result.group) {
        showError('Error al cargar información del grupo');
        return;
    }

    currentGroup = result.group;

    // Get current user
    const userResult = await apiCall('/api/auth/me');
    if (userResult && userResult.user) {
        currentUserId = userResult.user.id || userResult.id;
    }

    // Check if current user is a participant
    isParticipant = checkIfParticipant();

    displayGroupInfo();

    // Hide loading, show container
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('sanContainer').style.display = 'grid';
}

// Display group information
function displayGroupInfo() {
    if (!currentGroup) return;

    const statusLabels = {
        'pending': 'Esperando inicio',
        'active': 'En curso',
        'completed': 'Completado',
        'cancelled': 'Cancelado'
    };

    document.getElementById('groupName').textContent = currentGroup.name;

    const statusEl = document.getElementById('groupStatus');
    statusEl.textContent = statusLabels[currentGroup.status] || currentGroup.status;
    statusEl.className = `san-status ${currentGroup.status}`;

    const periodicityText = currentGroup.periodicity === 'weekly' ? 'Semanal' : 'Mensual';
    const dayText = currentGroup.periodicity === 'weekly'
        ? ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][currentGroup.paymentDay]
        : `Día ${currentGroup.paymentDay}`;

    document.getElementById('periodicity').textContent = periodicityText;
    document.getElementById('contribution').textContent = `${parseFloat(currentGroup.contributionAmount).toFixed(2)} BiUSD`;
    document.getElementById('paymentDay').textContent = dayText;
    // Formatear fecha como UTC para evitar que reste horas por timezone
    document.getElementById('startDate').textContent = formatDateUTC(currentGroup.startDate);

    // Calculate and display end date
    const endDate = calculateEndDate(
        currentGroup.startDate,
        currentGroup.periodicity,
        currentGroup.paymentDay,
        currentGroup.maxParticipants
    );
    document.getElementById('endDate').textContent = formatDateUTC(endDate);

    document.getElementById('participants').textContent = `${currentGroup.currentParticipants}/${currentGroup.maxParticipants}`;
    document.getElementById('currentPeriod').textContent = currentGroup.currentPeriod || '0';

    // Total benefit
    const totalBenefit = parseFloat(currentGroup.contributionAmount) * currentGroup.maxParticipants;
    document.getElementById('totalBenefit').textContent = `${totalBenefit.toFixed(2)} BiUSD`;

    // Beneficiary order
    displayBeneficiaryOrder();

    // Setup chat state
    setupChatState();
}

// Display beneficiary order
function displayBeneficiaryOrder() {
    const container = document.getElementById('beneficiaryOrder');

    // Only show order if SAN is active or completed
    if (currentGroup.status !== 'active' && currentGroup.status !== 'completed') {
        container.innerHTML = `
            <div class="waiting-order-message">
                <i class="ri-time-line"></i>
                Esperando a iniciar el SAN para determinar orden aleatorio
            </div>
        `;
        return;
    }

    // Check if we have participants with positions
    if (!currentGroup.participants || currentGroup.participants.length === 0) {
        container.innerHTML = `
            <div class="waiting-order-message">
                <i class="ri-information-line"></i>
                No hay participantes registrados
            </div>
        `;
        return;
    }

    // Sort participants by position
    const sortedParticipants = [...currentGroup.participants].sort((a, b) => a.position - b.position);

    container.innerHTML = `
        <ul class="beneficiary-list">
            ${sortedParticipants.map(p => {
        const isCurrent = p.position === currentGroup.currentPeriod;

        // Determinar si mostrar botón de pago
        // Reglas: 1. Soy participante, 2. No es mi período (no me pago a mí mismo), 3. No he pagado aún
        const myPosition = currentGroup.myParticipation?.position;
        const hasPaid = p.periodStats?.hasCurrentUserPaid;
        const showPayButton = isParticipant && myPosition !== p.position && !hasPaid;

        // Determinar nombre a mostrar
        let name = 'Participante';
        if (p.isSystemPlaceholder) {
            name = 'Puesto Ocupado por BidiPago';
        } else if (p.firstName) {
            name = `${p.firstName} ${p.lastName || ''}`.trim();
        } else if (p.fullName) {
            name = p.fullName;
        } else if (p.email) {
            name = p.email;
        }

        // Formatear fecha de pago
        const dateStr = p.payoutDate ? formatDateUTC(p.payoutDate) : '';
        const textColor = isCurrent ? 'rgba(255,255,255,0.9)' : 'var(--text-secondary)';

        // Datos de progreso
        const stats = p.periodStats || { paid: 0, totalExpected: 0 };
        const paidCount = stats.paid;
        const pendingCount = Math.max(0, stats.totalExpected - paidCount);
        // Prevenir división por cero
        const percentage = stats.totalExpected > 0
            ? Math.round((paidCount / stats.totalExpected) * 100)
            : 0;

        return `
                    <li class="beneficiary-item ${isCurrent ? 'current' : ''}" onclick="toggleDetails(${p.position})">
                        <div class="beneficiary-header-row">
                            <div style="display: flex; align-items: center;">
                                <span class="beneficiary-position">${p.position}</span>
                                <span class="beneficiary-name" style="${isCurrent ? 'color: #fff;' : ''}">${escapeHtml(name)}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                ${dateStr ? `<span style="font-size: 0.85em; color: ${textColor}; margin-right: 8px;">${dateStr}</span>` : ''}
                                ${isCurrent ? '<span style="color: #fff; font-weight: 500; font-size: 0.9em;"><i class="ri-star-fill"></i> Actual</span>' : ''}
                                <i class="ri-arrow-down-s-line" style="transition: transform 0.3s; ${isCurrent ? 'color: #fff;' : ''}"></i>
                            </div>
                        </div>
                        
                        <div id="details-${p.position}" class="beneficiary-details">
                            <div class="progress-stats">
                                <span style="${isCurrent ? 'color: rgba(255,255,255,0.9);' : ''}"><i class="ri-check-double-line"></i> ${paidCount} Pagados</span>
                                ${showPayButton ? `
                                    <button class="btn-pay-quota" onclick="initiatePayment(${p.position}, '${escapeHtml(name)}'); event.stopPropagation();">
                                        <i class="ri-hand-coin-line"></i> Pagar Cuota
                                    </button>
                                ` : ''}
                                <span style="${isCurrent ? 'color: rgba(255,255,255,0.9);' : ''}">${pendingCount} Pendientes <i class="ri-history-line"></i></span>
                            </div>
                            <div class="progress-container" style="${isCurrent ? 'background-color: rgba(255,255,255,0.3);' : ''}">
                                <div class="progress-bar" style="width: ${percentage}%; ${isCurrent ? 'background: #fff;' : ''}"></div>
                            </div>
                        </div>
                    </li>
                `;
    }).join('')}
        </ul>
    `;

    // Auto-open current period
    if (currentGroup.currentPeriod > 0) {
        // setTimeout(() => toggleDetails(currentGroup.currentPeriod), 500);
        // Don't auto open to avoid clutter? Or maybe yes.
    }
}

// Toggle beneficiary details
window.toggleDetails = function (position) {
    const details = document.getElementById(`details-${position}`);
    if (details) {
        const isExpanded = details.classList.contains('expanded');
        // Close others if needed, here we allow multiple open
        details.classList.toggle('expanded');

        // Rotate arrow icon if exists
        const item = details.closest('.beneficiary-item');
        if (item) {
            const arrow = item.querySelector('.ri-arrow-down-s-line');
            if (arrow) {
                arrow.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
            }
        }
    }
};

// Setup chat state based on group status and membership
function setupChatState() {
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendButton');
    const chatClosedMessage = document.getElementById('chatClosedMessage');
    const chatInputContainer = document.getElementById('chatInputContainer');
    const joinButtonContainer = document.getElementById('joinButtonContainer');

    // If not a participant, show join button and disable chat
    if (!isParticipant) {
        chatInput.disabled = true;
        sendButton.disabled = true;
        chatClosedMessage.innerHTML = '<i class="ri-lock-line"></i> Debes unirte al grupo para participar en el chat.';
        chatClosedMessage.style.display = 'block';
        chatInputContainer.style.opacity = '0.6';

        // Show join button if group is pending and has space
        if (currentGroup.status === 'pending' && currentGroup.currentParticipants < currentGroup.maxParticipants) {
            joinButtonContainer.style.display = 'block';
        } else {
            joinButtonContainer.style.display = 'none';
        }
        return;
    }

    // Hide join button for participants
    joinButtonContainer.style.display = 'none';

    // Chat is closed for completed or cancelled groups
    if (currentGroup.status === 'completed' || currentGroup.status === 'cancelled') {
        chatInput.disabled = true;
        sendButton.disabled = true;
        chatClosedMessage.innerHTML = '<i class="ri-lock-line"></i> Este grupo ha finalizado. El chat está cerrado.';
        chatClosedMessage.style.display = 'block';
        chatInputContainer.style.opacity = '0.6';
    } else {
        chatInput.disabled = false;
        sendButton.disabled = false;
        chatClosedMessage.style.display = 'none';
        chatInputContainer.style.opacity = '1';
    }
}

// Load messages
let isFirstLoad = true;
async function loadMessages() {
    const container = document.getElementById('chatMessages');

    const result = await apiCall(`/api/san/groups/${groupId}/messages`);

    if (result && result.error) {
        // If endpoint doesn't exist yet, show empty state
        container.innerHTML = '<div class="loading" style="text-align: center; padding: 20px; color: #999;">No hay mensajes aún. ¡Sé el primero en escribir!</div>';
        return;
    }

    const messages = result?.messages || [];

    if (isFirstLoad) {
        // First load - display all messages
        displayMessages(messages);
        isFirstLoad = false;
    } else {
        // Polling update - only add new messages
        messages.forEach(msg => {
            if (!displayedMessageIds.has(msg.id)) {
                addMessageToChat(msg);
            }
        });
    }
}

// Display messages
function displayMessages(messages) {
    const container = document.getElementById('chatMessages');

    if (!currentUserId) {
        setTimeout(() => displayMessages(messages), 500);
        return;
    }

    if (messages.length === 0) {
        container.innerHTML = '<div class="loading" style="text-align: center; padding: 20px; color: #999;">No hay mensajes aún. ¡Sé el primero en escribir!</div>';
        return;
    }

    // Clear and rebuild ID tracking
    displayedMessageIds.clear();
    messages.forEach(msg => displayedMessageIds.add(msg.id));

    container.innerHTML = messages.map(msg => {
        const isOwn = msg.senderId === currentUserId || msg.sender?.id === currentUserId;
        const senderName = msg.sender?.profile?.firstName
            ? `${msg.sender.profile.firstName} ${msg.sender.profile.lastName || ''}`.trim()
            : msg.sender?.email || 'Usuario';
        const time = new Date(msg.createdAt).toLocaleTimeString('es-VE', {
            hour: '2-digit',
            minute: '2-digit'
        });

        return `
            <div class="message ${isOwn ? 'own' : 'other'}">
                ${!isOwn ? `<div class="message-sender">${senderName}</div>` : ''}
                <div class="message-bubble">${escapeHtml(msg.content)}</div>
                <div class="message-info">${time}</div>
            </div>
        `;
    }).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// Add single message to chat
function addMessageToChat(message) {
    if (!message || !message.id) return;

    // Check if already displayed
    if (displayedMessageIds.has(message.id)) {
        return;
    }

    // Add to specific set
    displayedMessageIds.add(message.id);

    const container = document.getElementById('chatMessages');

    // Remove "no messages" placeholder if present
    const placeholder = container.querySelector('.loading');
    if (placeholder) {
        placeholder.remove();
    }

    const isOwn = message.senderId === currentUserId || message.sender?.id === currentUserId;
    const senderName = message.sender?.profile?.firstName
        ? `${message.sender.profile.firstName} ${message.sender.profile.lastName || ''}`.trim()
        : message.sender?.email || 'Usuario';
    const time = new Date(message.createdAt).toLocaleTimeString('es-VE', {
        hour: '2-digit',
        minute: '2-digit'
    });

    const messageHtml = `
        <div class="message ${isOwn ? 'own' : 'other'}">
            ${!isOwn ? `<div class="message-sender">${senderName}</div>` : ''}
            <div class="message-bubble">${escapeHtml(message.content)}</div>
            <div class="message-info">${time}</div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', messageHtml);
    container.scrollTop = container.scrollHeight;
}

// Send message
async function sendMessage(event) {
    event.preventDefault();

    const input = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendButton');
    const content = input.value.trim();

    if (!content) return;

    // Check if user is participant before trying to send
    if (!isParticipant) {
        showErrorTooltip('Debes unirte al grupo para enviar mensajes');
        return;
    }

    sendButton.disabled = true;

    try {
        console.log('Sending message:', content);
        const result = await apiCall(`/api/san/groups/${groupId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content })
        });

        console.log('Send result:', result);

        if (result && !result.error && result.message) {
            input.value = '';
            // Always add message to chat immediately
            // WebSocket will handle real-time updates from other users
            addMessageToChat(result.message);
        } else {
            console.error('Error sending message:', result?.error);
            showErrorTooltip(result?.error || 'Error al enviar mensaje');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showErrorTooltip('Error al enviar mensaje');
    } finally {
        sendButton.disabled = false;
    }
}

// Initialize WebSocket
function initializeWebSocket() {
    if (typeof io === 'undefined') {
        console.warn('Socket.IO not available, using polling');
        startMessagePolling();
        return;
    }

    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        startMessagePolling();
        return;
    }

    try {
        socket = io({
            auth: { token: accessToken },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5
        });

        socket.on('connect', () => {
            console.log('WebSocket connected');
            if (groupId) {
                socket.emit('join-san-group', groupId);
            }
        });

        socket.on('joined-san-group', (data) => {
            console.log('Joined SAN group:', data.groupId);
        });

        socket.on('san-new-message', (message) => {
            addMessageToChat(message);
        });

        socket.on('san-group-update', (group) => {
            currentGroup = group;
            displayGroupInfo();
        });

        socket.on('error', (error) => {
            console.error('WebSocket error:', error);
            if (!messagePollingInterval) {
                startMessagePolling();
            }
        });

        socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error);
            if (!messagePollingInterval) {
                startMessagePolling();
            }
        });

        socket.on('disconnect', () => {
            console.log('WebSocket disconnected');
            // Start polling when disconnected
            if (!messagePollingInterval) {
                startMessagePolling();
            }
        });

        // Always start polling as backup for messages from other users
        // WebSocket in backend may not be implemented for SAN groups yet
        startMessagePolling();

    } catch (error) {
        console.error('Error initializing WebSocket:', error);
        startMessagePolling();
    }
}

// Polling fallback
function startMessagePolling() {
    if (messagePollingInterval) return;

    messagePollingInterval = setInterval(() => {
        loadMessages();
    }, 5000);
}

// Check if current user is a participant in the group
function checkIfParticipant() {
    if (!currentGroup || !currentUserId) return false;

    // Check myParticipation from API response
    if (currentGroup.myParticipation) return true;

    // Check participants array
    if (currentGroup.participants && currentGroup.participants.length > 0) {
        return currentGroup.participants.some(p =>
            p.userId === currentUserId || p.user?.id === currentUserId
        );
    }

    return false;
}

// Join group from sanview
async function joinGroupFromView() {
    const joinButton = document.getElementById('joinGroupBtn');
    joinButton.disabled = true;
    joinButton.innerHTML = '<i class="ri-loader-4-line"></i> Procesando...';

    try {
        const result = await apiCall(`/api/san/groups/${groupId}/join`, {
            method: 'POST'
        });

        if (result && !result.error) {
            // Success - show tooltip
            showSuccessTooltip('¡Te has unido al grupo exitosamente!');

            // Update state
            isParticipant = true;
            currentGroup.currentParticipants++;

            // Re-setup chat (now enabled)
            setupChatState();

            // Update participants display
            document.getElementById('participants').textContent =
                `${currentGroup.currentParticipants}/${currentGroup.maxParticipants}`;

            // Reload messages
            loadMessages();

            // Initialize WebSocket now that we're a member
            initializeWebSocket();
        } else {
            showErrorTooltip(result?.error || 'No se pudo unir al grupo');
            joinButton.disabled = false;
            joinButton.innerHTML = '<i class="ri-user-add-line"></i> Unirse al Grupo';
        }
    } catch (error) {
        console.error('Error joining group:', error);
        showErrorTooltip('Error al unirse al grupo');
        joinButton.disabled = false;
        joinButton.innerHTML = '<i class="ri-user-add-line"></i> Unirse al Grupo';
    }
}

// Show success tooltip
function showSuccessTooltip(message) {
    const tooltip = document.getElementById('successTooltip');
    const tooltipMessage = document.getElementById('successTooltipMessage');
    tooltipMessage.textContent = message;
    tooltip.style.display = 'flex';

    setTimeout(() => {
        tooltip.style.display = 'none';
    }, 3000);
}

// Show error tooltip
function showErrorTooltip(message) {
    const tooltip = document.getElementById('errorTooltip');
    const tooltipMessage = document.getElementById('errorTooltipMessage');
    tooltipMessage.textContent = message;
    tooltip.style.display = 'flex';

    setTimeout(() => {
        tooltip.style.display = 'none';
    }, 4000);
}

// Show Generic Modal
function showGenericModal(title, message, isError = false, onOk = null) {
    const modal = document.getElementById('genericModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const modalIcon = document.getElementById('modalIcon');
    const modalOkBtn = document.getElementById('modalOkBtn');

    modalTitle.textContent = title;
    modalMessage.innerHTML = message; // Use innerHTML to allow links

    if (isError) {
        modalIcon.className = 'ri-error-warning-line';
        modalIcon.style.color = '#dc3545';
        modalOkBtn.style.background = '#dc3545';
    } else {
        modalIcon.className = 'ri-checkbox-circle-line';
        modalIcon.style.color = '#28a745';
        modalOkBtn.style.background = '#28a745';
    }

    modal.style.display = 'block';

    // Handle Ok Click
    const closeHandler = () => {
        modal.style.display = 'none';
        modalOkBtn.removeEventListener('click', closeHandler);
        if (onOk) onOk();
    };

    modalOkBtn.addEventListener('click', closeHandler);

    // Close on X
    const closeBtn = modal.querySelector('.close-modal'); // Not added in HTML yet? Wait, usually modals have X.
    // I didn't add X in previous step HTML replacement... 
    // Wait, I did verify HTML, but I pasted a block without X in my thought block, let me check the replacement.
    // The previous tool replacement did NOT have X. 
    // It's okay, user can click "Entendido".
}

// Initiate Payment
window.initiatePayment = async function (position, beneficiaryName) {
    if (!currentGroup) return;

    // Show confirmation first? Or direct payment? 
    // Maybe a confirmation modal would be good, but user didn't explicitly ask for it.
    // Given the modal requirement for "Insufficient Balance", I'll proceed to attempt payment.
    // If successful, show success modal.

    const amount = currentGroup.contributionAmount;

    // Find button to show loading state
    const detailsDiv = document.getElementById(`details-${position}`);
    const btn = detailsDiv ? detailsDiv.querySelector('.btn-pay-quota') : null;
    let originalBtnContent = '';

    if (btn) {
        originalBtnContent = btn.innerHTML;
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Procesando...';
        btn.disabled = true;
    }

    try {
        const result = await apiCall(`/api/san/groups/${currentGroup.id}/pay/${position}`, {
            method: 'POST'
        });

        if (result && !result.error) {
            // Success
            showGenericModal(
                '¡Pago Exitoso!',
                `Has pagado tu cuota de ${parseFloat(amount).toFixed(2)} BiUSD al beneficiario ${beneficiaryName}.`,
                false,
                () => {
                    // Reload group info to update UI
                    loadGroupInfo();
                }
            );
        } else {
            // Error
            let errorMessage = result?.error || 'No se pudo procesar el pago. Por favor intenta de nuevo.';

            // Check for specific balance error to add link
            if (errorMessage.includes('No Dispones de Balance en BiUSD') || errorMessage.includes('Wallet no encontrada')) {
                errorMessage += '<br><br><a href="/web/converter.html" class="btn-pay-quota" style="background: #ee6a3e; text-align: center; justify-content: center; width: auto;">Ir al Conversor de Monedas</a>';
            }

            showGenericModal(
                'Error en el Pago',
                errorMessage,
                true
            );
        }
    } catch (error) {
        console.error('Payment error:', error);
        showGenericModal('Error', 'Ocurrió un error inesperado al procesar el pago.', true);
    } finally {
        if (btn) {
            btn.innerHTML = originalBtnContent;
            btn.disabled = false;
        }
    }
};

// Helper functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Format date using UTC components to avoid timezone conversion
function formatDateUTC(dateString) {
    const date = new Date(dateString);
    const months = [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    const day = date.getUTCDate();
    const month = months[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    return `${day} de ${month} de ${year}`;
}

/**
 * Calculate the end date of a SAN group
 * @param {string} startDateStr - ISO date string of start date
 * @param {string} periodicity - 'weekly' or 'monthly'
 * @param {number} paymentDay - Day of week (1-7 for weekly, 1:Mon...7:Sun) or day of month (1-28)
 * @param {number} maxParticipants - Number of payment cycles
 * @returns {string} ISO date string of the last payment date
 */
function calculateEndDate(startDateStr, periodicity, paymentDay, maxParticipants) {
    const startDate = new Date(startDateStr);

    // Find the first payment date (first occurrence of paymentDay on or after startDate)
    let firstPaymentDate = new Date(startDate);

    if (periodicity === 'weekly') {
        // paymentDay: 1=Monday, ..., 7=Sunday (convert to JS: 0=Sunday, 1=Monday...)
        // JS getUTCDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
        const targetDayJS = paymentDay === 7 ? 0 : paymentDay; // Convert 7 (Sunday) to 0
        const currentDayJS = firstPaymentDate.getUTCDay();

        // Calculate days to add to reach the next target day
        let daysToAdd = targetDayJS - currentDayJS;
        if (daysToAdd < 0) {
            daysToAdd += 7; // Move to next week
        }
        if (daysToAdd === 0 && firstPaymentDate <= startDate) {
            // If today is the payment day but we're at start, first payment is today or next week
            // Typically first payment is the first occurrence on or after start
        }

        firstPaymentDate.setUTCDate(firstPaymentDate.getUTCDate() + daysToAdd);

        // Calculate last payment date: first payment + (cycles - 1) weeks
        const lastPaymentDate = new Date(firstPaymentDate);
        lastPaymentDate.setUTCDate(lastPaymentDate.getUTCDate() + (maxParticipants - 1) * 7);

        return lastPaymentDate.toISOString();

    } else {
        // Monthly: paymentDay is the day of the month (1-28)
        let year = firstPaymentDate.getUTCFullYear();
        let month = firstPaymentDate.getUTCMonth();

        // Check if startDate's day is before or on paymentDay
        if (firstPaymentDate.getUTCDate() > paymentDay) {
            // Move to next month
            month++;
            if (month > 11) {
                month = 0;
                year++;
            }
        }

        // Set first payment to paymentDay of that month
        firstPaymentDate = new Date(Date.UTC(year, month, paymentDay));

        // Calculate last payment date: first payment + (cycles - 1) months
        const lastPaymentDate = new Date(firstPaymentDate);
        lastPaymentDate.setUTCMonth(lastPaymentDate.getUTCMonth() + (maxParticipants - 1));

        return lastPaymentDate.toISOString();
    }
}

function showError(message) {
    document.getElementById('loadingState').innerHTML = `
        <div style="color: #dc3545; padding: 20px; text-align: center;">
            <i class="ri-error-warning-line" style="font-size: 2rem;"></i>
            <p>${message}</p>
            <a href="/san" style="color: #007bff;">Volver a BidiSAN</a>
        </div>
    `;
}
