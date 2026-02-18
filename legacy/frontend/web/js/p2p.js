/**
 * P2P Trading Frontend Logic
 */

// Global state
let cryptoAssets = [];
let fiatCurrencies = [];
let paymentDefinitions = []; // Definiciones de métodos de pago (para logos)
let currentOrders = [];
let currentOrderId = null;
let currentUserId = null; // ID del usuario actual
let currentUserProfile = null; // Perfil extendido (país, etc.)

// Pagination State
let historyPage = 1;
const HISTORY_ITEMS_PER_PAGE = 20;
let lastOrders = [];
let lastTrades = [];

// ============================================================
// P2P WebSocket Client Module
// ============================================================
let p2pSocket = null;
let currentSearchRequestId = null; // ID de la solicitud actual en búsqueda

/**
 * Inicializa conexión WebSocket para P2P
 */
function initP2PSocket() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        console.warn('[P2P Socket] No token, cannot connect');
        return;
    }

    // No reconectar si ya está conectado
    if (p2pSocket && p2pSocket.connected) {
        console.log('[P2P Socket] Already connected');
        return;
    }

    try {
        p2pSocket = io(window.location.origin, {
            auth: { token: accessToken },
            transports: ['websocket', 'polling']
        });

        p2pSocket.on('connect', () => {
            console.log('[P2P Socket] Connected:', p2pSocket.id);
        });

        p2pSocket.on('disconnect', (reason) => {
            console.log('[P2P Socket] Disconnected:', reason);
        });

        p2pSocket.on('error', (error) => {
            console.error('[P2P Socket] Error:', error);
        });

        // =====================================
        // Eventos para Zona de Cajero
        // =====================================

        // Nueva solicitud P2P disponible
        p2pSocket.on('p2p:new-request', (request) => {
            console.log('[P2P Socket] Nueva solicitud:', request);
            if (typeof handleNewLiveRequest === 'function') {
                handleNewLiveRequest(request);
            }
        });

        // Solicitud cancelada
        p2pSocket.on('p2p:request-cancelled', (data) => {
            console.log('[P2P Socket] Solicitud cancelada:', data);
            if (typeof handleRequestCancelled === 'function') {
                handleRequestCancelled(data.requestId, data.reason);
            }
        });

        // Solicitud tomada por otro cajero (o por mí)
        p2pSocket.on('p2p:request-claimed', (data) => {
            console.log('[P2P Socket] Solicitud tomada:', data);
            if (typeof handleRequestClaimed === 'function') {
                handleRequestClaimed(data.requestId, data.cashierId, data.tradeId);
            }
        });

        // Solicitud expirada
        p2pSocket.on('p2p:request-expired', (data) => {
            console.log('[P2P Socket] Solicitud expirada:', data);
            if (typeof handleRequestExpired === 'function') {
                handleRequestExpired(data.requestId);
            }
        });

        // =====================================
        // Eventos para Usuario (Quick Trade)
        // =====================================

        // Mi solicitud fue tomada por un cajero
        p2pSocket.on('p2p:my-request-matched', (data) => {
            console.log('[P2P Socket] Mi solicitud fue tomada!', data);
            if (typeof handleMyRequestMatched === 'function') {
                handleMyRequestMatched(data.requestId, data.tradeId);
            }
        });

        // Mi solicitud fue cancelada (confirmación)
        p2pSocket.on('p2p:my-request-cancelled', (data) => {
            console.log('[P2P Socket] Mi solicitud fue cancelada:', data);
            if (typeof handleMyRequestCancelled === 'function') {
                handleMyRequestCancelled(data.requestId, data.reason);
            }
        });

        // Mi solicitud expiró
        p2pSocket.on('p2p:my-request-expired', (data) => {
            console.log('[P2P Socket] Mi solicitud expiró:', data);
            if (typeof handleMyRequestExpired === 'function') {
                handleMyRequestExpired(data.requestId);
            }
        });

        // Confirmación de unirse al feed de cajeros
        p2pSocket.on('joined-p2p-live-feed', () => {
            console.log('[P2P Socket] Unido al feed de solicitudes en vivo');
        });

    } catch (error) {
        console.error('[P2P Socket] Error initializing:', error);
    }
}

/**
 * Unirse al feed de solicitudes en vivo (Zona de Cajero)
 */
function joinP2PLiveFeed() {
    if (p2pSocket && p2pSocket.connected) {
        p2pSocket.emit('join-p2p-live-feed');
    } else {
        initP2PSocket();
        // Reintentar después de conexión
        setTimeout(() => {
            if (p2pSocket && p2pSocket.connected) {
                p2pSocket.emit('join-p2p-live-feed');
            }
        }, 1000);
    }
}

/**
 * Salir del feed de solicitudes en vivo
 */
function leaveP2PLiveFeed() {
    if (p2pSocket && p2pSocket.connected) {
        p2pSocket.emit('leave-p2p-live-feed');
    }
}

/**
 * Suscribirse a actualizaciones de mi solicitud (Quick Trade)
 */
function subscribeToMyRequest(requestId) {
    currentSearchRequestId = requestId;
    if (p2pSocket && p2pSocket.connected) {
        p2pSocket.emit('subscribe-my-request', requestId);
        console.log('[P2P Socket] Suscrito a mi solicitud:', requestId);
    }
}

/**
 * Desuscribirse de mi solicitud
 */
function unsubscribeFromMyRequest(requestId) {
    if (p2pSocket && p2pSocket.connected) {
        p2pSocket.emit('unsubscribe-my-request', requestId);
        console.log('[P2P Socket] Desuscrito de mi solicitud:', requestId);
    }
    currentSearchRequestId = null;
}

// ============================================================
// Handlers para eventos WebSocket de P2P
// ============================================================

/**
 * Handler: Nueva solicitud en Zona de Cajero
 */
function handleNewLiveRequest(request) {
    // Agregar la nueva solicitud a la lista en tiempo real
    const container = document.getElementById('liveRequestsList');
    if (!container) return;

    // Si el container muestra "no hay solicitudes", limpiarlo
    if (container.querySelector('.no-requests-message')) {
        container.innerHTML = '';
    }

    // Crear tarjeta de la nueva solicitud
    const card = createLiveRequestCard(request);
    // Insertar al inicio para que las más nuevas aparezcan primero
    container.insertBefore(card, container.firstChild);

    // Animación de entrada
    card.style.animation = 'fadeInSlide 0.3s ease-out';
}

/**
 * Handler: Solicitud cancelada (para cajeros)
 */
function handleRequestCancelled(requestId, reason) {
    const card = document.querySelector(`.live-request-card[data-request-id="${requestId}"]`);
    if (card) {
        card.classList.add('request-cancelled');
        setTimeout(() => card.remove(), 300);
    }
}

/**
 * Handler: Solicitud tomada por otro cajero (o por mí)
 */
function handleRequestClaimed(requestId, cashierId, tradeId) {
    // Obtener el ID del usuario actual
    const currentUserId = localStorage.getItem('userId');
    
    // Si yo fui el cajero que tomó la solicitud, redirigir al tradeview
    if (currentUserId && cashierId === currentUserId && tradeId) {
        console.log('[P2P] Yo tomé esta solicitud, redirigiendo al tradeview...');
        setTimeout(() => {
            window.location.href = `/p2p-trade?tradeId=${tradeId}`;
        }, 500);
        return;
    }
    
    // Si otro cajero tomó la solicitud, solo remover la card
    const card = document.querySelector(`.live-request-card[data-request-id="${requestId}"]`);
    if (card) {
        card.classList.add('request-claimed');
        setTimeout(() => card.remove(), 300);
    }
}

/**
 * Handler: Solicitud expirada
 */
function handleRequestExpired(requestId) {
    const card = document.querySelector(`.live-request-card[data-request-id="${requestId}"]`);
    if (card) {
        card.classList.add('request-expired');
        setTimeout(() => card.remove(), 300);
    }
}

/**
 * Handler: Mi solicitud Quick Trade fue tomada por un cajero
 */
function handleMyRequestMatched(requestId, tradeId) {
    console.log('[P2P] handleMyRequestMatched llamado:', { requestId, tradeId });
    
    // Detener el timer de búsqueda
    if (searchPollingInterval) {
        clearInterval(searchPollingInterval);
        searchPollingInterval = null;
    }
    
    // Detener el timer visual también
    if (searchTimerInterval) {
        clearInterval(searchTimerInterval);
        searchTimerInterval = null;
    }

    // Cerrar el modal de búsqueda
    hideSearchingModal();

    // Si no hay tradeId, intentar obtenerlo del polling o hacer una última consulta
    if (!tradeId) {
        console.warn('[P2P] No se recibió tradeId en el evento WebSocket, intentando obtenerlo del request...');
        // Hacer una consulta rápida para obtener el tradeId del request
        fetch(`/api/p2p/requests/${requestId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
                'Content-Type': 'application/json'
            }
        })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            let finalTradeId = null;
            
            // Intentar obtener tradeId de diferentes fuentes
            if (data.tradeId) {
                finalTradeId = data.tradeId;
            } else if (data.metadata) {
                try {
                    const metadata = JSON.parse(data.metadata);
                    finalTradeId = metadata.tradeId;
                } catch (e) {
                    console.error('[P2P] Error parseando metadata:', e);
                }
            } else if (data.request && data.request.metadata) {
                try {
                    const metadata = JSON.parse(data.request.metadata);
                    finalTradeId = metadata.tradeId;
                } catch (e) {
                    console.error('[P2P] Error parseando metadata del request:', e);
                }
            }
            
            if (finalTradeId) {
                console.log('[P2P] TradeId obtenido del request:', finalTradeId);
                showAlert('¡Match encontrado! Redirigiendo al trade...', 'success');
                setTimeout(() => {
                    window.location.href = `/p2p-trade?tradeId=${finalTradeId}`;
                }, 1500);
            } else {
                console.error('[P2P] No se pudo obtener tradeId del request. Datos recibidos:', data);
                showAlert('Error: No se pudo obtener el ID del trade. Por favor, recarga la página.', 'error');
            }
        })
        .catch(err => {
            console.error('[P2P] Error obteniendo tradeId:', err);
            showAlert('Error al obtener información del trade. Por favor, recarga la página.', 'error');
        });
        return;
    }

    // Mostrar mensaje de éxito y redirigir al trade
    showAlert('¡Match encontrado! Redirigiendo al trade...', 'success');

    // Redirigir al trade
    setTimeout(() => {
        window.location.href = `/p2p-trade?tradeId=${tradeId}`;
    }, 1500);
}

/**
 * Handler: Mi solicitud fue cancelada
 */
function handleMyRequestCancelled(requestId, reason) {
    // Detener polling si existe
    if (searchPollingInterval) {
        clearInterval(searchPollingInterval);
        searchPollingInterval = null;
    }

    hideSearchingModal();
    showToast('Búsqueda cancelada', 'info');
}

/**
 * Handler: Mi solicitud expiró sin match
 */
function handleMyRequestExpired(requestId) {
    // Detener polling
    if (searchPollingInterval) {
        clearInterval(searchPollingInterval);
        searchPollingInterval = null;
    }
    
    // Detener timer
    if (searchTimerInterval) {
        clearInterval(searchTimerInterval);
        searchTimerInterval = null;
    }
    
    // Limpiar estado para permitir nueva búsqueda
    if (currentRequestId === requestId) {
        currentRequestId = null;
    }
    window.isExecutingTrade = false;

    // NO cerrar el modal aquí - dejar que transitionToOrderSearch lo maneje
    // El modal se mantendrá abierto mostrando el resultado de la búsqueda
}

/**
 * Crear elemento DOM para tarjeta de solicitud en vivo
 */
function createLiveRequestCard(request) {
    const card = document.createElement('div');
    card.className = 'live-request-card card mb-3';
    card.setAttribute('data-request-id', request.id);

    const typeLabel = request.type === 'DEPOSIT' ? 'Quiere comprar' : 'Quiere vender';
    const typeClass = request.type === 'DEPOSIT' ? 'text-success' : 'text-danger';
    const userName = request.user?.profile?.displayName || request.user?.email || 'Usuario';
    // Usar displayName de la definición del admin si está disponible, sino usar name como fallback
    const paymentMethod = request.paymentMethod?.displayName || request.paymentMethod?.name || 'Transferencia';
    const price = request.price ? `Tasa: ${formatNumber(request.price)}` : '';

    card.innerHTML = `
        <div class="card-body">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                    <span class="badge ${typeClass === 'text-success' ? 'bg-success' : 'bg-danger'}">${typeLabel}</span>
                    <span class="fw-bold ms-2">${formatNumber(request.amount)} ${request.cryptoAsset}</span>
                </div>
                <small class="text-muted">${formatTimeAgo(request.createdAt)}</small>
            </div>
            <div class="mb-2">
                <small class="text-muted">Usuario: </small>
                <span>${userName}</span>
            </div>
            <div class="mb-2">
                <small class="text-muted">Método: </small>
                <span>${paymentMethod}</span>
                ${price ? `<span class="ms-2 text-info">${price}</span>` : ''}
            </div>
            <button class="btn btn-primary btn-sm w-100" onclick="claimRequest('${request.id}')">
                Tomar Solicitud
            </button>
        </div>
    `;

    return card;
}

/**
 * Formatear tiempo relativo
 */
function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return 'hace unos segundos';
    if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)} min`;
    if (diffSec < 86400) return `hace ${Math.floor(diffSec / 3600)} h`;
    return date.toLocaleDateString();
}


// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    await loadCurrentUser(); // Cargar ID del usuario actual
    loadMyReputation(); // Cargar reputación del usuario
    loadConfig();

    // Inicializar WebSocket para P2P
    initP2PSocket();

    // Mostrar pantalla de selección inicial
    showSelectionScreen();

    // Setup logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }
});

// Cargar información del usuario actual
async function loadCurrentUser() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        console.warn('No access token found');
        return;
    }

    try {
        const response = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const userData = await response.json();
            // El endpoint devuelve { user, profile, wallets }
            currentUserId = userData.user?.id || userData.id;
            currentUserProfile = userData.profile;
        }
    } catch (error) {
        console.error('Error loading current user:', error);
    }
}

// Auth check
function checkAuth() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }
}

/**
 * Helper centralizado para llamadas API con manejo automático de errores 401
 * @param {string} endpoint - URL del endpoint
 * @param {object} options - Opciones de fetch (method, body, headers, etc.)
 * @param {boolean} handleAuthError - Si true, maneja errores 401 automáticamente
 * @returns {Promise<Response>} - Response object
 */
async function apiCall(endpoint, options = {}, handleAuthError = true) {
    const accessToken = localStorage.getItem('accessToken');
    
    if (!accessToken && handleAuthError) {
        handleSessionExpired(true, true);
        throw new Error('No autenticado');
    }

    const defaultHeaders = {
        'Content-Type': 'application/json',
        ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
        ...(options.headers || {})
    };

    try {
        const response = await fetch(endpoint, {
            ...options,
            headers: defaultHeaders
        });

        // Manejar error 401 (Sesión expirada)
        if (response.status === 401 && handleAuthError) {
            handleSessionExpired(true, true);
            throw new Error('Sesión expirada');
        }

        return response;
    } catch (error) {
        // Si es error de sesión expirada, ya fue manejado arriba
        if (error.message === 'Sesión expirada' || error.message === 'No autenticado') {
            throw error;
        }
        
        console.error('API Error:', error);
        throw error;
    }
}

/**
 * Maneja errores 401 (Sesión expirada) de forma centralizada
 * Muestra un modal estilizado y opcionalmente redirige al login
 */
function handleSessionExpired(showModal = true, redirectToLogin = true) {
    console.warn('[P2P] Sesión expirada detectada');
    
    // Limpiar tokens
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    
    if (showModal) {
        // Mostrar modal estilizado
        showSessionExpiredModal();
    }
    
    if (redirectToLogin) {
        // Redirigir después de 3 segundos para dar tiempo a leer el mensaje
        setTimeout(() => {
            window.location.href = '/login';
        }, 3000);
    }
}

/**
 * Muestra un modal estilizado cuando la sesión expira
 */
function showSessionExpiredModal() {
    // El modal ya existe en el HTML, solo mostrarlo
    const modal = document.getElementById('sessionExpiredModal');
    if (modal) {
        $('#sessionExpiredModal').modal({
            backdrop: 'static',
            keyboard: false
        });
        $('#sessionExpiredModal').modal('show');
    } else {
        // Fallback: alert si el modal no existe
        alert('Tu sesión ha expirado. Serás redirigido al inicio de sesión.');
    }
}

/**
 * Oculta el modal de sesión expirada
 */
function hideSessionExpiredModal() {
    $('#sessionExpiredModal').modal('hide');
}

// Hacer funciones globales
window.apiCall = apiCall;
window.handleSessionExpired = handleSessionExpired;
window.showSessionExpiredModal = showSessionExpiredModal;
window.hideSessionExpiredModal = hideSessionExpiredModal;

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

// Load P2P configuration (crypto assets and fiat currencies)
async function loadConfig() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        return;
    }

    try {
        // Load crypto assets
        const cryptoResponse = await fetch('/api/p2p/config/crypto-assets', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (cryptoResponse.ok) {
            const data = await cryptoResponse.json();
            // Filter out BiUSD globally for P2P
            cryptoAssets = (data.assets || []).filter(asset => asset.symbol !== 'BiUSD');
            populateCryptoSelects();
        }

        // Load fiat currencies
        const fiatResponse = await fetch('/api/p2p/config/fiat-currencies', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (fiatResponse.ok) {
            const data = await fiatResponse.json();
            fiatCurrencies = data.currencies || [];
            populateFiatSelects();
        }
    } catch (error) {
        console.error('Error loading config:', error);
        showAlert('Error al cargar configuración', 'error');
    } finally {
        // Initialize new filters after config load
        initP2PFilters();
    }
}

// Populate crypto selects
function populateCryptoSelects() {
    const filterCrypto = document.getElementById('filterCrypto');
    const orderCrypto = document.getElementById('orderCrypto');
    const quickTradeCrypto = document.getElementById('quickTradeCrypto');

    // Group by symbol
    const grouped = {};
    cryptoAssets.forEach(asset => {
        if (!grouped[asset.symbol]) {
            grouped[asset.symbol] = asset;
        }
    });

    const options = Object.values(grouped).map(asset => {
        return `<option value="${asset.symbol}">${asset.symbol} (${asset.network})</option>`;
    }).join('');

    if (filterCrypto) {
        filterCrypto.innerHTML = '<option value="">Todas</option>' + options;
    }
    if (orderCrypto) {
        orderCrypto.innerHTML = '<option value="">Seleccione...</option>' + options;
    }
    if (quickTradeCrypto) {
        quickTradeCrypto.innerHTML = '<option value="">Seleccione...</option>' + options;
    }
}

// Populate fiat selects
function populateFiatSelects() {
    const filterFiat = document.getElementById('filterFiat');
    const orderFiat = document.getElementById('orderFiat');
    const quickTradeFiat = document.getElementById('quickTradeFiat');

    const options = fiatCurrencies.map(currency => {
        return `<option value="${currency.code}">${currency.code} - ${currency.name}</option>`;
    }).join('');

    if (filterFiat) {
        filterFiat.innerHTML = '<option value="">Todas</option>' + options;
    }
    if (orderFiat) {
        orderFiat.innerHTML = '<option value="">Seleccione...</option>' + options;
    }
    if (quickTradeFiat) {
        quickTradeFiat.innerHTML = '<option value="">Seleccione...</option>' + options;
    }
}

// Load orders
async function loadOrders() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    if (!currentUserId) await loadCurrentUser();

    // Load Reputation
    loadMyReputation();

    // Use new filter state
    // Mode: 
    // isBuyCryptoMode = true => User Wants to BUY Crypto (Tengo Fiat -> Quiero Crypto) => Look for SELL orders (Maker Sells)
    // isBuyCryptoMode = false => User Wants to SELL Crypto (Tengo Crypto -> Quiero Fiat) => Look for BUY orders (Maker Buys)

    // API Expects:
    // type: 'BUY' or 'SELL' (Maker's intention)
    // cryptoAsset: 'USDT'
    // fiatCurrency: 'VES'

    const type = p2pFilterState.isBuyCryptoMode ? 'SELL' : 'BUY';
    const crypto = p2pFilterState.selectedCrypto;
    const fiat = p2pFilterState.selectedFiat;

    const params = new URLSearchParams();
    params.append('type', type);
    if (crypto) params.append('cryptoAsset', crypto);
    if (fiat) params.append('fiatCurrency', fiat);
    params.append('status', 'PENDING');
    params.append('limit', '50');

    try {
        const response = await fetch(`/api/p2p/orders?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Error al cargar órdenes');

        const data = await response.json();
        currentOrders = data.orders || [];
        renderOrders(currentOrders);
    } catch (error) {
        console.error('Error loading orders:', error);
        renderOrders([]);
    }
}

// Load My Reputation
async function loadMyReputation() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    try {
        const response = await fetch('/api/p2p/reputation/me', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            renderReputation(data);
        }
    } catch (error) {
        console.error('Error loading reputation:', error);
    }
}


function renderReputation(data) {
    if (!data) return;

    // Assuming data structure: { userId, totalTrades, completionRate, avgRating, totalVotes, makerAvgMinutes, takerAvgMinutes, ... }

    // Initials
    const userDisplay = localStorage.getItem('user');
    let initials = 'YO';
    if (userDisplay) {
        try {
            const u = JSON.parse(userDisplay);
            if (u.firstName) initials = u.firstName.charAt(0).toUpperCase();
        } catch (e) { }
    }

    document.querySelectorAll('.p2p-profile-initials').forEach(el => el.textContent = initials);

    // Rating
    // Rating
    const rating = parseFloat(data.averageRating || 0).toFixed(2);
    document.querySelectorAll('.p2p-profile-rating').forEach(el => el.textContent = rating);

    const votes = data.totalFeedbacks || 0;
    document.querySelectorAll('.p2p-profile-votes').forEach(el => el.textContent = votes);

    // Trades
    const totalTrades = data.totalTrades || 0;
    document.querySelectorAll('.p2p-profile-total-trades').forEach(el => el.textContent = totalTrades);

    // Completion
    let completionText = '0%';
    let completionColor = '#dc3545'; // Red

    const rate = parseFloat(data.completionRate || 0);
    completionText = rate.toFixed(1) + '%';
    if (rate >= 90) completionColor = '#28a745'; // Green
    else if (rate >= 80) completionColor = '#ffc107'; // Yellow

    document.querySelectorAll('.p2p-profile-completion').forEach(el => {
        el.textContent = completionText;
        el.style.color = completionColor;
    });

    // Avg Time
    let avgMinutes = 0;
    const makerTrades = data.makerTotalTrades || 0;
    const takerTrades = data.takerTotalTrades || 0;
    const totalCalcTrades = makerTrades + takerTrades;

    if (totalCalcTrades > 0) {
        const makerTime = data.makerAvgMinutes || 0;
        const takerTime = data.takerAvgMinutes || 0;
        avgMinutes = ((makerTime * makerTrades) + (takerTime * takerTrades)) / totalCalcTrades;
    }

    let timeText = '--';
    if (avgMinutes > 0) {
        timeText = Math.round(avgMinutes) + ' min';
    }

    document.querySelectorAll('.p2p-profile-avg-time').forEach(el => el.textContent = timeText);

    // Make cards clickable
    document.querySelectorAll('#myP2PProfileCard, .my-p2p-profile-card').forEach(card => {
        card.style.cursor = 'pointer';
        card.onclick = () => {
            // Check if user ID is available to pass it? 
            // Logic in merchant-profile.js handles "me" if no ID.
            // But if I want to link to "me", sending 'me' or empty is properly handled?
            // merchant-profile.js: if userId provided -> /api/p2p/reputation/${userId}, else /api/p2p/reputation/me
            // So just navigating to .html is fine.
            window.location.href = '/merchant-profile';
        };
    });
}

// --- P2P Filter Logic (Tengo/Quiero) ---

let p2pFilterState = {
    isBuyCryptoMode: false, // Default: Sell Crypto (Tengo Crypto -> Quiero Fiat)
    selectedCrypto: 'USDT',
    selectedFiat: 'VES'
};

function initP2PFilters() {
    // Set defaults if available
    if (cryptoAssets.length > 0 && !p2pFilterState.selectedCrypto) {
        // Prefer USDT if available, otherwise first one
        const usdt = cryptoAssets.find(c => c.symbol === 'USDT');
        p2pFilterState.selectedCrypto = usdt ? 'USDT' : cryptoAssets[0].symbol;
    }
    if (fiatCurrencies.length > 0 && !p2pFilterState.selectedFiat) {
        const vef = fiatCurrencies.find(f => f.code === 'VES');
        p2pFilterState.selectedFiat = vef ? 'VES' : fiatCurrencies[0].code;
    }

    updateFilterUI();
    loadOrders();
}

function updateFilterUI() {
    const tengoContent = document.getElementById('tengoSelectedContent');
    const quieroContent = document.getElementById('quieroSelectedContent');

    if (!tengoContent || !quieroContent) return;

    // Helper to render selected item
    const renderItem = (type, value) => {
        if (type === 'crypto') {
            const asset = cryptoAssets.find(c => c.symbol === value);
            if (!asset) return '<span>Seleccionar...</span>';
            const icon = getCoinIconPath(value);
            return `
                <img src="${icon}" style="width: 24px; height: 24px; border-radius: 50%;">
                <span style="font-weight: 600; font-size: 16px; color: #333;">${value}</span>
                <span style="font-size: 12px; color: #999;">${asset.name}</span>
            `;
        } else {
            const currency = fiatCurrencies.find(c => c.code === value);
            if (!currency) return '<span>Seleccionar...</span>';
            const flag = currencyToCountryFlag[value] || '🏳️';
            return `
                <span style="font-size: 24px;">${flag}</span>
                <span style="font-weight: 600; font-size: 16px; color: #333;">${value}</span>
                <span style="font-size: 12px; color: #999;">${currency.name}</span>
            `;
        }
    };

    if (p2pFilterState.isBuyCryptoMode) {
        // Mode: Buy Crypto (Tengo Fiat -> Quiero Crypto)
        tengoContent.innerHTML = renderItem('fiat', p2pFilterState.selectedFiat);
        quieroContent.innerHTML = renderItem('crypto', p2pFilterState.selectedCrypto);
    } else {
        // Mode: Sell Crypto (Tengo Crypto -> Quiero Fiat)
        tengoContent.innerHTML = renderItem('crypto', p2pFilterState.selectedCrypto);
        quieroContent.innerHTML = renderItem('fiat', p2pFilterState.selectedFiat);
    }
}

function swapTengoQuiero() {
    p2pFilterState.isBuyCryptoMode = !p2pFilterState.isBuyCryptoMode;
    closeDropdowns();
    updateFilterUI();
    loadOrders();
}

function toggleDropdown(type) {
    const listId = type + 'Options';
    const list = document.getElementById(listId);

    // Close other
    const other = type === 'tengo' ? 'quieroOptions' : 'tengoOptions';
    document.getElementById(other).style.display = 'none';

    if (list.style.display === 'block') {
        list.style.display = 'none';
        return;
    }

    // Render options based on current mode and which dropdown it is
    // Mode Sell Crypto (isBuy=false): Tengo=Crypto, Quiero=Fiat
    // Mode Buy Crypto (isBuy=true): Tengo=Fiat, Quiero=Crypto

    let isCryptoList = false;
    if (type === 'tengo') {
        isCryptoList = !p2pFilterState.isBuyCryptoMode;
    } else {
        isCryptoList = p2pFilterState.isBuyCryptoMode;
    }

    renderDropdownList(list, isCryptoList, type);
    list.style.display = 'block';
}


function renderDropdownList(container, isCrypto, dropdownType) {
    if (isCrypto) {
        // Filter duplicates and excluded coins (BiUSD, BNB, SOL)
        const uniqueAssets = [];
        const seenSymbols = new Set();
        const excludedSymbols = ['BiUSD', 'BNB', 'SOL'];

        cryptoAssets.forEach(asset => {
            if (!excludedSymbols.includes(asset.symbol) && !seenSymbols.has(asset.symbol)) {
                seenSymbols.add(asset.symbol);
                uniqueAssets.push(asset);
            }
        });

        // Sort: USDT first, USDC second, then others
        uniqueAssets.sort((a, b) => {
            const priorities = ['USDT', 'USDC'];
            const idxA = priorities.indexOf(a.symbol);
            const idxB = priorities.indexOf(b.symbol);

            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return 0;
        });

        container.innerHTML = uniqueAssets.map(asset => `
            <div onclick="selectFilterOption('${dropdownType}', 'crypto', '${asset.symbol}')" 
                 style="padding: 10px 16px; display: flex; align-items: center; gap: 10px; cursor: pointer; transition: background 0.2s;"
                 onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">
                <img src="${getCoinIconPath(asset.symbol)}" style="width: 20px; height: 20px;">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 500; color: #333;">${asset.symbol}</span>
                    <small style="color: #999;">${asset.name}</small>
                </div>
                ${p2pFilterState.selectedCrypto === asset.symbol ? '<i class="ri-check-line" style="margin-left: auto; color: #ee6a3e;"></i>' : ''}
            </div>
        `).join('');
    } else {

        container.innerHTML = fiatCurrencies.map(currency => `
            <div onclick="selectFilterOption('${dropdownType}', 'fiat', '${currency.code}')" 
                 style="padding: 10px 16px; display: flex; align-items: center; gap: 10px; cursor: pointer; transition: background 0.2s;"
                 onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">
                <span style="font-size: 20px;">${currencyToCountryFlag[currency.code] || '🏳️'}</span>
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 500; color: #333;">${currency.code}</span>
                    <small style="color: #999;">${currency.name}</small>
                </div>
                ${p2pFilterState.selectedFiat === currency.code ? '<i class="ri-check-line" style="margin-left: auto; color: #ee6a3e;"></i>' : ''}
            </div>
        `).join('');
    }
}

function selectFilterOption(dropdownType, assetType, value) {
    if (assetType === 'crypto') {
        p2pFilterState.selectedCrypto = value;
    } else {
        p2pFilterState.selectedFiat = value;
    }

    closeDropdowns();
    updateFilterUI();
    loadOrders();
}

function closeDropdowns() {
    document.getElementById('tengoOptions').style.display = 'none';
    document.getElementById('quieroOptions').style.display = 'none';
}

// Close dropdowns when clicking outside
document.addEventListener('click', function (e) {
    if (!e.target.closest('.custom-select-wrapper')) {
        closeDropdowns();
    }
});


// Render orders
function renderOrders(orders) {
    const ordersList = document.getElementById('ordersList');
    if (!ordersList) return;

    if (orders.length === 0) {
        ordersList.innerHTML = `
            <div class="empty-state">
                <i class="ri-inbox-line"></i>
                <p>No hay órdenes disponibles</p>
            </div>
        `;
        return;
    }

    ordersList.innerHTML = orders.map(order => {
        // Logic Inverted for Taker Perspective:
        // If Maker SELLS ('SELL'), Taker BUYS -> Show 'Comprar' (buy class)
        // If Maker BUYS ('BUY'), Taker SELLS -> Show 'Vender' (sell class)
        const isMakerSell = order.type === 'SELL';
        const actionText = isMakerSell ? 'Comprar' : 'Vender';
        const actionClass = isMakerSell ? 'buy' : 'sell';
        const priceColor = isMakerSell ? '#0ecb81' : '#ee6a3e'; // Green for buy, Orange for sell

        const expiresAt = new Date(order.expiresAt);
        const now = new Date();
        const isExpired = expiresAt < now;

        // Verificar si la orden es del usuario actual
        const makerId = order.maker?.id || null;
        const isMyOrder = currentUserId && makerId && String(makerId) === String(currentUserId);

        // Maker info
        const makerName = order.maker?.profile?.firstName
            ? `${order.maker.profile.firstName} ${order.maker.profile.lastName || ''}`.trim()
            : order.maker?.email || 'Usuario';



        // Mock stats for now (could be real if backend provided)
        const tradesCount = order.maker?.stats?.totalTrades || 0;
        const completionRate = order.maker?.stats?.completionRate || 100;

        return `
            <div class="order-card" style="background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 12px;">
                <!-- Header: User Info -->
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="display: flex; align-items: center; gap: 10px; cursor: pointer;" onclick="window.location.href='/merchant-profile?userId=${makerId}'">
                        <div style="width: 32px; height: 32px; background: #ee6a3e; color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">
                            ${makerName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div style="font-weight: 600; color: #333; font-size: 14px; display: flex; align-items: center; gap: 5px;">
                                ${makerName}
                                <i class="ri-verified-badge-fill" style="color: #3b82f6;"></i>
                            </div>
                            <div style="font-size: 11px; color: #666;">
                                ${tradesCount} Ordenes | ${completionRate}% Completado
                            </div>
                        </div>
                    </div>
                    <div style="text-align: right;">
                         <div style="font-size: 11px; color: #999;">Precio</div>
                         <div style="font-size: 20px; font-weight: 700; color: ${priceColor};">
                            ${formatNumber(order.rate)} <span style="font-size: 12px; color: #666; font-weight: 400;">${order.fiatCurrency}</span>
                         </div>
                    </div>
                </div>

                <!-- Main Info: Limits & Amount -->
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-top: 1px solid #f0f0f0; border-bottom: 1px solid #f0f0f0;">
                    <div style="flex: 1;">
                        <div style="font-size: 12px; color: #999; margin-bottom: 4px;">Disponible</div>
                        <div style="font-size: 14px; color: #333; font-weight: 600;">
                            ${formatNumber(order.amount)} ${order.type === 'BUY' ? order.fiatCurrency : order.cryptoAsset}
                        </div>
                    </div>
                    <div style="flex: 1; border-left: 1px solid #f0f0f0; padding-left: 15px;">
                         <div style="font-size: 12px; color: #999; margin-bottom: 4px;">Límites</div>
                         <div style="font-size: 14px; color: #333;">
                            ${order.minAmount ? formatNumber(order.minAmount) : '0'} - ${order.maxAmount ? formatNumber(order.maxAmount) : 'Max'} ${order.type === 'BUY' ? order.fiatCurrency : order.cryptoAsset}
                         </div>
                    </div>
                </div>

                <!-- Footer: Payment Methods & Action -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                    <div style="flex: 1;">
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            ${(Array.isArray(order.paymentMethods) ? order.paymentMethods : []).map(method => `
                                <div style="display: flex; align-items: center; gap: 4px; padding-right: 8px; border-right: 1px solid #eee;">
                                    ${method.logoUrl ? `<img src="${method.logoUrl}" style="width: 14px; height: 14px; border-radius: 50%;">` : '<div style="width: 2px; height: 10px; background: #ee6a3e;"></div>'}
                                    <span style="font-size: 11px; color: #666;">${method.bankName || method.name}</span>
                                </div>
                            `).join('')}
                            ${(!Array.isArray(order.paymentMethods) || order.paymentMethods.length === 0) ? '<span style="font-size: 11px; color: #999;">No especificado</span>' : ''}
                        </div>
                    </div>
                    
                    <div style="margin-left: 15px;">
                        ${!isMyOrder ? `
                            <button class="btn-take-order" onclick="showTakeOrderModal('${order.id}')" ${isExpired ? 'disabled' : ''} 
                                style="background: ${isMakerSell ? '#0ecb81' : '#ee6a3e'}; color: #fff; padding: 8px 24px; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; opacity: ${isExpired ? 0.6 : 1};">
                                ${isExpired ? 'Expirada' : actionText}
                            </button>
                        ` : `
                             <span style="font-size: 12px; color: #999; background: #f5f5f5; padding: 5px 10px; border-radius: 4px;">Tu Orden</span>
                        `}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}


// Get time left
function getTimeLeft(expiresAt) {
    const now = new Date();
    const diff = expiresAt - now;
    if (diff <= 0) return 'Expirada';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// Format number
function formatNumber(num) {
    if (num >= 1) {
        return parseFloat(num).toFixed(2);
    }
    return parseFloat(num).toFixed(8);
}

// Estado para crear orden
let createOrderState = {
    type: null, // 'BUY' o 'SELL'
    selectedCrypto: null,
    selectedFiat: null,
    amount: null,
    rate: null,
    minAmount: null,
    maxAmount: null,
    paymentMethodIds: [],
    terms: null,
    expiresHours: 24,
    availableBalance: null
};

// Estado para tomar orden
let takeOrderState = {
    isMakerBuy: false,
    rate: 0,
    maxFiat: 0,
    minFiat: 0
};

// Show create order modal
async function showCreateOrderModal() {
    const modal = document.getElementById('createOrderModal');
    if (modal) {
        // Resetear estado
        createOrderState = {
            type: null,
            selectedCrypto: null,
            selectedFiat: null,
            amount: null,
            rate: null,
            minAmount: null,
            maxAmount: null,
            paymentMethodIds: [],
            terms: null,
            expiresHours: 24,
            availableBalance: null
        };

        // Mostrar paso 1
        document.querySelectorAll('[id^="createOrderStep"]').forEach(step => {
            step.style.display = 'none';
        });
        document.getElementById('createOrderStep1').style.display = 'block';

        // Remover selección de cards
        document.querySelectorAll('#createOrderContent .operation-card').forEach(card => {
            card.classList.remove('selected');
        });

        modal.style.display = 'block';
    }
}

// Close create order modal
function closeCreateOrderModal() {
    const modal = document.getElementById('createOrderModal');
    if (modal) {
        modal.style.display = 'none';

        // Resetear estado
        createOrderState = {
            type: null,
            selectedCrypto: null,
            selectedFiat: null,
            amount: null,
            rate: null,
            minAmount: null,
            maxAmount: null,
            paymentMethodIds: [],
            terms: null,
            expiresHours: 24,
            availableBalance: null
        };

        // Limpiar formularios
        const inputs = ['createOrderAmount', 'createOrderRate', 'createOrderMinAmount', 'createOrderMaxAmount', 'createOrderTerms', 'createOrderExpiresHours'];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // Resetear checkboxes de métodos de pago
        document.querySelectorAll('#createOrderPaymentMethodsList input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
    }
}

// Seleccionar tipo de orden (BUY/SELL)
function selectCreateOrderType(type, element) {
    createOrderState.type = type;

    // Marcar card seleccionada
    document.querySelectorAll('#createOrderContent .operation-card').forEach(card => {
        card.classList.remove('selected');
    });
    if (element) {
        element.classList.add('selected');
    }

    // Ocultar paso 1 y mostrar paso 2
    document.getElementById('createOrderStep1').style.display = 'none';

    if (type === 'SELL') {
        // Cargar wallets con balance y mostrar paso 2 (seleccionar crypto)
        loadUserWalletsForCreateOrderSell();
    } else {
        // Mostrar paso 2 (seleccionar crypto - todas las soportadas)
        document.getElementById('createOrderStep2Buy').style.display = 'block';
        loadCryptoAssetsForCreateOrderBuy();
    }
}

// Cargar wallets del usuario para venta (crear orden)
async function loadUserWalletsForCreateOrderSell() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    try {
        const response = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            const wallets = data.wallets || [];

            // Filtrar solo wallets con balance > 0 y que estén en SUPPORTED_CRYPTO_ASSETS
            const walletsWithBalance = wallets.filter(w =>
                parseFloat(w.balance) > 0 && SUPPORTED_CRYPTO_ASSETS.includes(w.assetSymbol)
            );

            // Agrupar por símbolo (sumar balances de diferentes redes)
            const groupedWallets = {};
            walletsWithBalance.forEach(wallet => {
                const symbol = wallet.assetSymbol;
                if (!groupedWallets[symbol]) {
                    groupedWallets[symbol] = {
                        symbol,
                        totalBalance: 0,
                        wallets: []
                    };
                }
                groupedWallets[symbol].totalBalance += parseFloat(wallet.balance);
                groupedWallets[symbol].wallets.push(wallet);
            });

            // Renderizar cards de criptos disponibles
            renderCryptoCardsForCreateOrderSell(Object.values(groupedWallets));
            document.getElementById('createOrderStep2Sell').style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading wallets:', error);
        showAlert('Error al cargar tus wallets', 'error');
    }
}

// Renderizar cards de criptos para venta (crear orden)
function renderCryptoCardsForCreateOrderSell(cryptoGroups) {
    const container = document.getElementById('createOrderCryptoCardsSell');
    if (!container) return;

    if (cryptoGroups.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666;">No tienes criptomonedas con balance disponible</p>';
        return;
    }

    container.innerHTML = cryptoGroups.map(group => {
        const iconPath = getCoinIconPath(group.symbol);
        return `
            <div class="crypto-card" data-symbol="${group.symbol}" onclick="selectCryptoForCreateOrderSell('${group.symbol}', this)">
                <img src="${iconPath}" alt="${group.symbol}" style="width: 48px; height: 48px; margin-bottom: 10px;">
                <h4>${group.symbol}</h4>
                <div class="balance">Disponible: ${formatNumber(group.totalBalance)}</div>
            </div>
        `;
    }).join('');
}

// Seleccionar cripto para venta (crear orden)
async function selectCryptoForCreateOrderSell(symbol, element) {
    createOrderState.selectedCrypto = symbol;

    // Marcar card seleccionada
    document.querySelectorAll('#createOrderCryptoCardsSell .crypto-card').forEach(card => {
        card.classList.remove('selected');
    });
    if (element) {
        element.classList.add('selected');
    }

    // Obtener balance total de esta crypto desde el elemento
    const balanceText = element.querySelector('.balance')?.textContent || '';
    const balanceMatch = balanceText.match(/Disponible: ([\d.]+)/);
    const cryptoGroup = balanceMatch ? parseFloat(balanceMatch[1]) : 0;

    // Guardar el balance disponible para validación
    createOrderState.availableBalance = cryptoGroup;

    // Mostrar paso 3 (seleccionar fiat)
    document.getElementById('createOrderStep2Sell').style.display = 'none';
    document.getElementById('createOrderStep3').style.display = 'block';
    loadFiatCurrenciesForCreateOrder();
}

// Cargar assets disponibles para compra (crear orden)
async function loadCryptoAssetsForCreateOrderBuy() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    try {
        const response = await fetch('/api/p2p/config/crypto-assets', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            const assets = data.assets || [];

            // Filtrar solo las criptos soportadas por BidiPago
            const supportedAssets = assets.filter(asset =>
                SUPPORTED_CRYPTO_ASSETS.includes(asset.symbol) && asset.isActive
            );

            // Agrupar por símbolo (tomar el primero de cada símbolo)
            const grouped = {};
            supportedAssets.forEach(asset => {
                if (!grouped[asset.symbol]) {
                    grouped[asset.symbol] = asset;
                }
            });

            const container = document.getElementById('createOrderCryptoCardsBuy');
            if (container) {
                container.innerHTML = Object.values(grouped).map(asset => {
                    const iconPath = getCoinIconPath(asset.symbol);
                    return `
                        <div class="crypto-card" data-symbol="${asset.symbol}" onclick="selectCryptoForCreateOrderBuy('${asset.symbol}', this)">
                            <img src="${iconPath}" alt="${asset.symbol}" style="width: 48px; height: 48px; margin-bottom: 10px;">
                            <h4>${asset.symbol}</h4>
                            <p style="color: #666; font-size: 0.9rem;">${asset.name}</p>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (error) {
        console.error('Error loading crypto assets:', error);
    }
}

// Seleccionar crypto para compra (crear orden)
function selectCryptoForCreateOrderBuy(symbol, element) {
    createOrderState.selectedCrypto = symbol;

    document.querySelectorAll('#createOrderCryptoCardsBuy .crypto-card').forEach(card => {
        card.classList.remove('selected');
    });
    if (element) {
        element.classList.add('selected');
    }

    // Mostrar paso 3 (seleccionar fiat)
    document.getElementById('createOrderStep2Buy').style.display = 'none';
    document.getElementById('createOrderStep3').style.display = 'block';
    loadFiatCurrenciesForCreateOrder();
}

// Cargar monedas fiat para crear orden
async function loadFiatCurrenciesForCreateOrder() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    try {
        const response = await fetch('/api/p2p/config/fiat-currencies', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            const currencies = data.currencies || [];

            const container = document.getElementById('createOrderFiatCards');
            if (container) {
                container.innerHTML = currencies.map(currency => {
                    const flag = currencyToCountryFlag[currency.code] || '🏳️';
                    return `
                        <div class="fiat-card" data-code="${currency.code}" onclick="selectFiatForCreateOrder('${currency.code}', this)">
                            <span class="flag-icon">${flag}</span>
                            <h4>${currency.code}</h4>
                            <p style="color: #666; font-size: 0.9rem;">${currency.name}</p>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (error) {
        console.error('Error loading fiat currencies:', error);
    }
}

// Seleccionar fiat para crear orden
function selectFiatForCreateOrder(fiatCode, element) {
    createOrderState.selectedFiat = fiatCode;

    document.querySelectorAll('#createOrderFiatCards .fiat-card').forEach(card => {
        card.classList.remove('selected');
    });
    if (element) {
        element.classList.add('selected');
    }

    // Ocultar colapsable de tasas del paso 3 si está abierto
    const collapseStep3 = document.getElementById('suggestedRatesCollapse');
    if (collapseStep3) {
        collapseStep3.style.display = 'none';
        const toggleText = document.getElementById('suggestedRatesToggleText');
        const toggleIcon = document.getElementById('suggestedRatesToggleIcon');
        if (toggleText) toggleText.textContent = 'Ver';
        if (toggleIcon) toggleIcon.className = 'ri-arrow-down-s-line';
    }

    // Mostrar paso 4 (monto y tasa)
    document.getElementById('createOrderStep3').style.display = 'none';
    document.getElementById('createOrderStep4').style.display = 'block';

    // Actualizar labels
    document.getElementById('createOrderFiatSymbol').textContent = fiatCode;
    document.getElementById('createOrderCryptoSymbol').textContent = createOrderState.selectedCrypto;

    // Obtener tasas sugeridas
    fetchSuggestedRates(createOrderState.selectedCrypto, fiatCode, createOrderState.type);
    document.getElementById('createOrderCryptoSymbol').textContent = createOrderState.selectedCrypto;
    
    // Actualizar símbolo de fiat en los badges de tasas
    const marketRateFiatSymbol = document.getElementById('marketRateFiatSymbol');
    const internalRateFiatSymbol = document.getElementById('internalRateFiatSymbol');
    if (marketRateFiatSymbol) marketRateFiatSymbol.textContent = fiatCode;
    if (internalRateFiatSymbol) internalRateFiatSymbol.textContent = fiatCode;

    // Actualizar label de monto según tipo
    const amountLabel = document.getElementById('createOrderAmountLabel');
    const amountHint = document.getElementById('createOrderAmountHint');

    if (createOrderState.type === 'SELL') {
        amountLabel.innerHTML = `Monto en <span id="createOrderCryptoLabel">${createOrderState.selectedCrypto}</span> *`;
        amountHint.textContent = `Disponible: ${formatNumber(createOrderState.availableBalance || 0)} ${createOrderState.selectedCrypto}`;

        // Agregar listener para validar balance
        const amountInput = document.getElementById('createOrderAmount');
        const rateInput = document.getElementById('createOrderRate');
        if (amountInput) {
            amountInput.oninput = () => {
                validateCreateOrderAmount();
            };
            amountInput.onchange = () => {
                validateCreateOrderAmount();
            };
        }
        if (rateInput) {
            rateInput.oninput = () => {
                validateCreateOrderAmount();
            };
            rateInput.onchange = () => {
                validateCreateOrderAmount();
            };
            rateInput.onchange = () => {
                validateCreateOrderAmount();
            };
        }

        // Mostrar botón MAX
        const btnMax = document.getElementById('btnMaxCreateOrder');
        if (btnMax) btnMax.style.display = 'block';

        // Deshabilitar botón inicialmente
        const continueButton = document.querySelector('#createOrderStep4 .btn-create-order');
        if (continueButton) {
            continueButton.disabled = true;
            continueButton.style.opacity = '0.5';
            continueButton.style.cursor = 'not-allowed';
        }
    } else {
        amountLabel.innerHTML = `Monto en <span id="createOrderFiatLabel">${fiatCode}</span> *`;
        amountHint.textContent = `Monto en ${fiatCode} que deseas gastar`;

        // Ocultar botón MAX si es compra
        const btnMax = document.getElementById('btnMaxCreateOrder');
        if (btnMax) btnMax.style.display = 'none';
    }
}
// Constante de comisión (debe coincidir con backend o venir de config)
const MAKER_FEE_PERCENT = 0.003; // 0.3%

// Set Max Amount for Create Order
function setMaxCreateOrderAmount() {
    if (createOrderState.type !== 'SELL' || !createOrderState.availableBalance) return;

    // Calcular máximo posible: Balance / (1 + Fee)
    // Dejar un pequeño margen por redondeo (opcional, pero seguro)
    const maxAmount = createOrderState.availableBalance / (1 + MAKER_FEE_PERCENT);

    // Redondear hacia abajo a 8 decimales para asegurar que no pase el límite por precision
    const roundedMax = Math.floor(maxAmount * 100000000) / 100000000;

    const amountInput = document.getElementById('createOrderAmount');
    if (amountInput) {
        amountInput.value = roundedMax.toFixed(8);
        validateCreateOrderAmount(); // Re-validar
    }
}

// Validar monto de crear orden
function validateCreateOrderAmount() {
    const amountInput = document.getElementById('createOrderAmount');
    const rateInput = document.getElementById('createOrderRate');
    const continueButton = document.querySelector('#createOrderStep4 .btn-create-order');
    const errorMessage = document.getElementById('createOrderAmountError');

    if (!amountInput || !rateInput || !continueButton) return;

    const amount = parseFloat(amountInput.value) || 0;
    const rate = parseFloat(rateInput.value) || 0;

    if (createOrderState.type === 'SELL') {
        const available = createOrderState.availableBalance || 0;
        const symbol = createOrderState.selectedCrypto;

        if (amount <= 0) {
            continueButton.disabled = true;
            continueButton.style.opacity = '0.5';
            continueButton.style.cursor = 'not-allowed';
            if (errorMessage) errorMessage.style.display = 'none';
            amountInput.setCustomValidity('El monto debe ser mayor a 0');
            return;
        }

        // Validar monto + fee
        const feeAmount = amount * MAKER_FEE_PERCENT;
        const totalRequired = amount + feeAmount;

        if (totalRequired > available) {
            continueButton.disabled = true;
            continueButton.style.opacity = '0.5';
            continueButton.style.cursor = 'not-allowed';

            const maxPossible = available / (1 + MAKER_FEE_PERCENT);
            const formattedMax = formatNumber(Math.floor(maxPossible * 100000000) / 100000000);

            amountInput.setCustomValidity(`El monto más comisión (${formatNumber(feeAmount)}) excede tu balance`);

            if (errorMessage) {
                errorMessage.innerHTML = `
                    Saldo insuficiente para cubrir venta + comisión (0.3%).<br>
                    <strong>Requerido:</strong> ${formatNumber(totalRequired)} ${symbol}<br>
                    <strong>Disponible:</strong> ${formatNumber(available)} ${symbol}<br>
                    <strong>Máximo a vender:</strong> ${formattedMax} ${symbol}
                `;
                errorMessage.style.display = 'block';
            }
        } else {
            continueButton.disabled = false;
            continueButton.style.opacity = '1';
            continueButton.style.cursor = 'pointer';
            amountInput.setCustomValidity('');

            if (errorMessage) {
                errorMessage.style.display = 'none';
            }
        }
    } else if (createOrderState.type === 'BUY') {
        // Para compra: el monto en fiat nunca debe ser menor a la tasa
        if (amount <= 0) {
            continueButton.disabled = true;
            continueButton.style.opacity = '0.5';
            continueButton.style.cursor = 'not-allowed';
            if (errorMessage) errorMessage.style.display = 'none';
            amountInput.setCustomValidity('El monto debe ser mayor a 0');
            return;
        }

        if (rate > 0 && amount < rate) {
            continueButton.disabled = true;
            continueButton.style.opacity = '0.5';
            continueButton.style.cursor = 'not-allowed';
            amountInput.setCustomValidity(`El monto no puede ser menor a la tasa (${formatNumber(rate)} ${createOrderState.selectedFiat})`);

            if (errorMessage) {
                errorMessage.textContent = `El monto en ${createOrderState.selectedFiat} no puede ser menor a la tasa de cambio (${formatNumber(rate)} ${createOrderState.selectedFiat})`;
                errorMessage.style.display = 'block';
            }
        } else {
            continueButton.disabled = false;
            continueButton.style.opacity = '1';
            continueButton.style.cursor = 'pointer';
            amountInput.setCustomValidity('');

            if (errorMessage) {
                errorMessage.style.display = 'none';
            }
        }
    }

    // Validar también min/max amounts
    validateMinMaxAmounts();
}

// Validar montos mínimo y máximo
function validateMinMaxAmounts() {
    const amountInput = document.getElementById('createOrderAmount');
    const rateInput = document.getElementById('createOrderRate');
    const minAmountInput = document.getElementById('createOrderMinAmount');
    const maxAmountInput = document.getElementById('createOrderMaxAmount');
    const minAmountHint = document.getElementById('createOrderMinAmountHint');
    const maxAmountHint = document.getElementById('createOrderMaxAmountHint');

    if (!amountInput || !rateInput) return;

    const amount = parseFloat(amountInput.value) || 0;
    const rate = parseFloat(rateInput.value) || 0;
    const minAmount = minAmountInput.value ? parseFloat(minAmountInput.value) : null;
    const maxAmount = maxAmountInput.value ? parseFloat(maxAmountInput.value) : null;

    if (createOrderState.type === 'BUY') {
        // Para compra: el monto mínimo debe ser mayor a la tasa de cambio
        if (minAmount !== null) {
            if (rate > 0 && minAmount <= rate) {
                minAmountInput.setCustomValidity('El monto mínimo debe ser mayor a la tasa de cambio');
                if (minAmountHint) {
                    minAmountHint.textContent = `Debe ser mayor a ${formatNumber(rate)} ${createOrderState.selectedFiat}`;
                    minAmountHint.style.color = '#dc3545';
                }
            } else {
                minAmountInput.setCustomValidity('');
                if (minAmountHint) {
                    minAmountHint.textContent = '';
                }
            }
        }

        // Para compra: maxAmount no debe ser mayor al monto a gastar ni menor a la tasa de cambio
        if (maxAmount !== null) {
            let hasError = false;
            let errorMessage = '';

            if (maxAmount > amount) {
                hasError = true;
                errorMessage = `Debe ser menor o igual a ${formatNumber(amount)} ${createOrderState.selectedFiat}`;
            } else if (rate > 0 && maxAmount < rate) {
                hasError = true;
                errorMessage = `Debe ser mayor o igual a ${formatNumber(rate)} ${createOrderState.selectedFiat}`;
            } else if (minAmount !== null && maxAmount < minAmount) {
                hasError = true;
                errorMessage = `Debe ser mayor o igual a ${formatNumber(minAmount)} ${createOrderState.selectedFiat}`;
            }

            if (hasError) {
                maxAmountInput.setCustomValidity(errorMessage);
                if (maxAmountHint) {
                    maxAmountHint.textContent = errorMessage;
                    maxAmountHint.style.color = '#dc3545';
                }
            } else {
                maxAmountInput.setCustomValidity('');
                if (maxAmountHint) {
                    maxAmountHint.textContent = '';
                }
            }
        } else {
            maxAmountInput.setCustomValidity('');
            if (maxAmountHint) {
                maxAmountHint.textContent = '';
            }
        }
    } else if (createOrderState.type === 'SELL') {
        // Para venta: validar que minAmount <= amount y maxAmount <= amount
        if (minAmount !== null && minAmount > amount) {
            minAmountInput.setCustomValidity('El monto mínimo no puede ser mayor al monto a vender');
            if (minAmountHint) {
                minAmountHint.textContent = `Debe ser menor o igual a ${formatNumber(amount)} ${createOrderState.selectedCrypto}`;
                minAmountHint.style.color = '#dc3545';
            }
        } else {
            minAmountInput.setCustomValidity('');
            if (minAmountHint) {
                minAmountHint.textContent = '';
            }
        }

        if (maxAmount !== null) {
            if (maxAmount > amount) {
                maxAmountInput.setCustomValidity('El monto máximo no puede ser mayor al monto a vender');
                if (maxAmountHint) {
                    maxAmountHint.textContent = `Debe ser menor o igual a ${formatNumber(amount)} ${createOrderState.selectedCrypto}`;
                    maxAmountHint.style.color = '#dc3545';
                }
            } else if (minAmount !== null && maxAmount < minAmount) {
                maxAmountInput.setCustomValidity('El monto máximo no puede ser menor al monto mínimo');
                if (maxAmountHint) {
                    maxAmountHint.textContent = `Debe ser mayor o igual a ${formatNumber(minAmount)} ${createOrderState.selectedCrypto}`;
                    maxAmountHint.style.color = '#dc3545';
                }
            } else {
                maxAmountInput.setCustomValidity('');
                if (maxAmountHint) {
                    maxAmountHint.textContent = '';
                }
            }
        }
    }
}

// Continuar después de ingresar monto y tasa
function continueCreateOrder() {
    const amountInput = document.getElementById('createOrderAmount');
    const rateInput = document.getElementById('createOrderRate');
    const minAmountInput = document.getElementById('createOrderMinAmount');
    const maxAmountInput = document.getElementById('createOrderMaxAmount');

    const amount = parseFloat(amountInput.value);
    const rate = parseFloat(rateInput.value);
    const minAmount = minAmountInput.value ? parseFloat(minAmountInput.value) : null;
    const maxAmount = maxAmountInput.value ? parseFloat(maxAmountInput.value) : null;

    if (!amount || amount <= 0) {
        showAlert('Por favor ingresa un monto válido', 'error');
        return;
    }

    if (!rate || rate <= 0) {
        showAlert('Por favor ingresa una tasa válida', 'error');
        return;
    }

    // Validaciones específicas según el tipo de orden
    if (createOrderState.type === 'SELL') {
        // Validar balance para venta: requiere monto + comisión maker (0.3%)
        const available = createOrderState.availableBalance || 0;
        const feeAmount = amount * MAKER_FEE_PERCENT;
        const totalRequired = amount + feeAmount;

        if (totalRequired > available) {
            const maxPossible = available / (1 + MAKER_FEE_PERCENT);
            showAlert(
                `Saldo insuficiente para cubrir venta + comisión (0.3%). Requerido: ${formatNumber(totalRequired)} ${createOrderState.selectedCrypto}. Disponible: ${formatNumber(available)}. Máximo a vender: ${formatNumber(Math.floor(maxPossible * 100000000) / 100000000)}`,
                'error'
            );
            validateCreateOrderAmount();
            return;
        }

        // Para venta: validar minAmount y maxAmount
        if (minAmount !== null && minAmount > amount) {
            showAlert('El monto mínimo no puede ser mayor al monto a vender', 'error');
            return;
        }

        if (maxAmount !== null) {
            if (maxAmount > amount) {
                showAlert('El monto máximo no puede ser mayor al monto a vender', 'error');
                return;
            }
            if (minAmount !== null && maxAmount < minAmount) {
                showAlert('El monto máximo no puede ser menor al monto mínimo', 'error');
                return;
            }
        }
    } else if (createOrderState.type === 'BUY') {
        // Para compra: el monto en fiat nunca debe ser menor a la tasa
        if (amount < rate) {
            showAlert(`El monto en ${createOrderState.selectedFiat} no puede ser menor a la tasa de cambio (${formatNumber(rate)} ${createOrderState.selectedFiat})`, 'error');
            return;
        }

        // Monto mínimo debe ser mayor a la tasa de cambio
        if (minAmount !== null && minAmount <= rate) {
            showAlert(`El monto mínimo debe ser mayor a la tasa de cambio (${formatNumber(rate)} ${createOrderState.selectedFiat})`, 'error');
            return;
        }

        // Monto máximo no debe ser mayor al monto a gastar
        if (maxAmount !== null && maxAmount > amount) {
            showAlert(`El monto máximo no puede ser mayor al monto a gastar (${formatNumber(amount)} ${createOrderState.selectedFiat})`, 'error');
            return;
        }

        // Monto máximo no debe ser menor a la tasa de cambio
        if (maxAmount !== null && maxAmount < rate) {
            showAlert(`El monto máximo no puede ser menor a la tasa de cambio (${formatNumber(rate)} ${createOrderState.selectedFiat})`, 'error');
            return;
        }

        // Monto máximo no puede ser menor al monto mínimo (si ambos están definidos)
        if (minAmount !== null && maxAmount !== null && maxAmount < minAmount) {
            showAlert('El monto máximo no puede ser menor al monto mínimo', 'error');
            return;
        }
    }

    createOrderState.amount = amount;
    createOrderState.rate = rate;
    createOrderState.minAmount = minAmount;
    createOrderState.maxAmount = maxAmount;

    // Mostrar paso 5 (métodos de pago y términos)
    document.getElementById('createOrderStep4').style.display = 'none';
    document.getElementById('createOrderStep5').style.display = 'block';
    loadPaymentMethodsForCreateOrder();
}

// Cargar métodos de pago para crear orden
async function loadPaymentMethodsForCreateOrder() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    try {
        const response = await fetch('/api/p2p/payment-methods', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            const methods = data.paymentMethods || [];
            // Filtrar activos y que coincidan con la moneda Fiat seleccionada (o que no tengan moneda definida por compatibilidad)
            const activeMethods = methods.filter(m => m.isActive && (!m.currency || m.currency === createOrderState.selectedFiat));

            const container = document.getElementById('createOrderPaymentMethodsList');
            if (container) {
                if (activeMethods.length === 0) {
                    container.innerHTML = `<p style="color: #666; text-align: center;">No tienes métodos de pago configurados para ${createOrderState.selectedFiat}. <a href="/p2p/payment-methods">Agregar</a></p>`;
                } else {
                    container.innerHTML = activeMethods.map(method => `
                        <div class="payment-method-item" style="display: flex; align-items: center; gap: 10px;">
                            <input type="checkbox" id="pm_${method.id}" value="${method.id}" style="width: auto;">
                            ${method.logoUrl
                            ? `<img src="${method.logoUrl}" alt="" style="width: 32px; height: 32px; object-fit: contain; border-radius: 4px;">`
                            : ''}
                            <label for="pm_${method.id}" style="flex: 1; margin: 0; cursor: pointer;">
                                <h5 style="margin: 0 0 5px 0;">${method.name}</h5>
                                <p style="margin: 0; color: #666; font-size: 0.9rem;">${method.displayName || method.type}</p>
                            </label>
                        </div>
                    `).join('');
                }
            }
        }
    } catch (error) {
        console.error('Error loading payment methods:', error);
    }
}

// Enviar orden
async function submitCreateOrder() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showAlert('Sesión expirada', 'error');
        return;
    }

    // Obtener métodos de pago seleccionados
    const selectedCheckboxes = document.querySelectorAll('#createOrderPaymentMethodsList input[type="checkbox"]:checked');
    const paymentMethodIds = Array.from(selectedCheckboxes).map(cb => cb.value);

    const terms = document.getElementById('createOrderTerms').value || null;
    const expiresHours = parseInt(document.getElementById('createOrderExpiresHours').value) || 24;
    const paymentWindowMinutes = parseInt(document.getElementById('createOrderPaymentWindow').value) || 15;
    const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);

    // Reset error
    const errorDiv = document.getElementById('createOrderErrorStep5');
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';
    }



    if (paymentMethodIds.length === 0) {
        if (errorDiv) {
            errorDiv.textContent = 'Debes seleccionar al menos un método de pago';
            errorDiv.style.display = 'block';
        } else {
            showAlert('Debes seleccionar al menos un método de pago', 'error');
        }
        return;
    }

    createOrderState.paymentMethodIds = paymentMethodIds;
    createOrderState.terms = terms;
    createOrderState.expiresHours = expiresHours;

    try {
        const response = await fetch('/api/p2p/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: createOrderState.type,
                cryptoAsset: createOrderState.selectedCrypto,
                fiatCurrency: createOrderState.selectedFiat,
                amount: createOrderState.amount,
                rate: createOrderState.rate,
                minAmount: createOrderState.minAmount,
                maxAmount: createOrderState.maxAmount,
                paymentMethodIds: createOrderState.paymentMethodIds.length > 0 ? createOrderState.paymentMethodIds : undefined,
                terms: createOrderState.terms,
                paymentWindowMinutes: paymentWindowMinutes,
                expiresAt: expiresAt.toISOString()
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al crear orden');
        }

        showAlert('Orden creada exitosamente', 'success');
        closeCreateOrderModal();
        showAlert('Orden creada exitosamente', 'success');
        closeCreateOrderModal();
        loadOrders(); // Actualizar mercado publico
        loadMyOrders('book'); // Actualizar mi libro de ordenes
    } catch (error) {
        console.error('Error creating order:', error);
        // Show inline error
        const errorDiv = document.getElementById('createOrderErrorStep5');
        if (errorDiv) {
            errorDiv.textContent = error.message || 'Error al crear orden';
            errorDiv.style.display = 'block';
        } else {
            showAlert(error.message || 'Error al crear orden', 'error');
        }
    }
}

// Navegar entre pasos de crear orden
function goToCreateOrderStep(step) {
    document.querySelectorAll('[id^="createOrderStep"]').forEach(s => s.style.display = 'none');

    // Ocultar todos los colapsables
    const collapses = ['suggestedRatesCollapse', 'suggestedRatesCollapseStep4'];
    collapses.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Resetear textos de toggle
    const toggleTexts = ['suggestedRatesToggleText', 'suggestedRatesToggleTextStep4'];
    const toggleIcons = ['suggestedRatesToggleIcon', 'suggestedRatesToggleIconStep4'];
    toggleTexts.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = 'Ver';
    });
    toggleIcons.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = 'ri-arrow-down-s-line';
    });

    if (step === 1) {
        document.getElementById('createOrderStep1').style.display = 'block';
        // Resetear estado parcialmente
        createOrderState.selectedCrypto = null;
        createOrderState.selectedFiat = null;
        createOrderState.amount = null;
        createOrderState.rate = null;
    } else if (step === 2) {
        if (createOrderState.type === 'SELL') {
            document.getElementById('createOrderStep2Sell').style.display = 'block';
        } else {
            document.getElementById('createOrderStep2Buy').style.display = 'block';
        }
    } else if (step === 3) {
        document.getElementById('createOrderStep3').style.display = 'block';
    } else if (step === 4) {
        document.getElementById('createOrderStep4').style.display = 'block';
    }
}

// Alternar colapsable de tasas sugeridas para crear orden
async function toggleSuggestedRatesCollapse() {
    // Determinar qué colapsable usar (paso 3 o paso 4)
    const step3Visible = document.getElementById('createOrderStep3').style.display !== 'none';
    const step4Visible = document.getElementById('createOrderStep4').style.display !== 'none';

    let collapseElement, contentElement, toggleText, toggleIcon;

    if (step3Visible) {
        collapseElement = document.getElementById('suggestedRatesCollapse');
        contentElement = document.getElementById('suggestedRatesCollapseContent');
        toggleText = document.getElementById('suggestedRatesToggleText');
        toggleIcon = document.getElementById('suggestedRatesToggleIcon');
    } else if (step4Visible) {
        collapseElement = document.getElementById('suggestedRatesCollapseStep4');
        contentElement = document.getElementById('suggestedRatesCollapseContentStep4');
        toggleText = document.getElementById('suggestedRatesToggleTextStep4');
        toggleIcon = document.getElementById('suggestedRatesToggleIconStep4');
    } else {
        return; // No hay paso visible
    }

    if (!collapseElement || !contentElement) return;

    // Verificar si ya está expandido
    const isExpanded = collapseElement.style.display !== 'none';

    if (isExpanded) {
        // Ocultar
        collapseElement.style.display = 'none';
        if (toggleText) toggleText.textContent = 'Ver';
        if (toggleIcon) toggleIcon.className = 'ri-arrow-down-s-line';
        
        // También cerrar el acordeón de detalles si está abierto
        const accordion = document.getElementById('marketDetailsAccordion');
        if (accordion) {
            accordion.style.display = 'none';
        }
    } else {
        // Mostrar y cargar tasas
        collapseElement.style.display = 'block';
        if (toggleText) toggleText.textContent = 'Ocultar';
        if (toggleIcon) toggleIcon.className = 'ri-arrow-up-s-line';

        // Validar que tengamos crypto y fiat seleccionados
        if (!createOrderState.selectedCrypto || !createOrderState.selectedFiat) {
            contentElement.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Por favor selecciona primero la criptomoneda y la moneda fiat</p>';
            return;
        }

        // Mostrar loading
        contentElement.innerHTML = '<div class="loading"><i class="ri-loader-4-line"></i> Cargando tasas...</div>';

        // Cargar tasas
        await loadSuggestedRatesForCreateOrder(contentElement);
    }
}

// Cargar tasas sugeridas para crear orden (dentro del colapsable)
// Esta función ya no se usa, ahora usamos fetchSuggestedRates que actualiza los badges
// y showMarketDetailsForCreateOrder para mostrar el modal con detalles
async function loadSuggestedRatesForCreateOrder(contentElement) {
    // Esta función ahora solo muestra los badges, el contenido real se carga con fetchSuggestedRates
    // Los badges se actualizan automáticamente cuando se llama a fetchSuggestedRates
    // El modal de detalles se muestra con showMarketDetailsForCreateOrder
    if (contentElement) {
        contentElement.innerHTML = `
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <!-- Market Average Badge -->
                <div id="marketRateBadge" onclick="toggleMarketDetailsAccordion()"
                    style="flex: 1; min-width: 140px; background: #fff; border: 1px solid #dee2e6; border-radius: 6px; padding: 10px; cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden;">
                    <div style="font-size: 11px; color: #666; text-transform: uppercase;">Promedio Mercado</div>
                    <div style="font-size: 16px; font-weight: 700; color: #1a73e8; margin-top: 4px;">
                        <span id="marketRateValueCollapse">--</span> <span id="marketRateFiatSymbolCollapse">${createOrderState.selectedFiat || 'VES'}</span>
                    </div>
                    <i class="ri-global-line" style="position: absolute; right: 10px; top: 10px; color: #e9ecef; font-size: 24px;"></i>
                </div>

                <!-- BidiPago Average Badge -->
                <div id="internalRateBadge" onclick="applySuggestedRate('internal')"
                    style="flex: 1; min-width: 140px; background: #fff; border: 1px solid #dee2e6; border-radius: 6px; padding: 10px; cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden;">
                    <div style="font-size: 11px; color: #666; text-transform: uppercase;">P2P BidiPago</div>
                    <div style="font-size: 16px; font-weight: 700; color: #ee6a3e; margin-top: 4px;">
                        <span id="internalRateValueCollapse">--</span> <span id="internalRateFiatSymbolCollapse">${createOrderState.selectedFiat || 'VES'}</span>
                    </div>
                    <i class="ri-group-line" style="position: absolute; right: 10px; top: 10px; color: #e9ecef; font-size: 24px;"></i>
                </div>
            </div>
            <div style="text-align: right; margin-top: 8px;">
                <small style="font-size: 11px; color: #888;">* Haz clic en "Promedio Mercado" para ver detalles de exchanges</small>
            </div>
            
            <!-- Acordeón de detalles de exchanges -->
            <div id="marketDetailsAccordion" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #e2e8f0;">
                <div id="marketDetailsAccordionContent" style="max-height: 300px; overflow-y: auto;">
                    <!-- El contenido se carga dinámicamente -->
                </div>
            </div>
        `;
        
        // Sincronizar valores con los badges principales
        const marketRateValue = document.getElementById('marketRateValue');
        const internalRateValue = document.getElementById('internalRateValue');
        const marketRateValueCollapse = document.getElementById('marketRateValueCollapse');
        const internalRateValueCollapse = document.getElementById('internalRateValueCollapse');
        
        if (marketRateValue && marketRateValueCollapse) {
            marketRateValueCollapse.textContent = marketRateValue.textContent;
        }
        if (internalRateValue && internalRateValueCollapse) {
            internalRateValueCollapse.textContent = internalRateValue.textContent;
        }
    }
}

// Alternar acordeón de detalles de mercado dentro del modal de creación de orden
function toggleMarketDetailsAccordion() {
    const accordion = document.getElementById('marketDetailsAccordion');
    const accordionContent = document.getElementById('marketDetailsAccordionContent');
    
    if (!accordion || !accordionContent) return;
    
    // Verificar si está expandido
    const isExpanded = accordion.style.display !== 'none';
    
    if (isExpanded) {
        // Ocultar
        accordion.style.display = 'none';
    } else {
        // Mostrar y cargar contenido
        accordion.style.display = 'block';
        
        if (!currentMarketBreakdown || currentMarketBreakdown.length === 0) {
            accordionContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No hay detalles de mercado disponibles para esta selección o están cargando.</div>';
        } else {
            const rows = currentMarketBreakdown.map(item => `
                <tr>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 0.9em;">
                        <strong style="color: #2d3748;">${item.exchange}</strong>
                    </td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #1a73e8; font-weight: 600; font-size: 0.9em;">
                        ${formatNumber(item.rate)}
                    </td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #718096; font-size: 0.85em;">
                        ${new Date(item.updatedAt).toLocaleTimeString()}
                    </td>
                </tr>
            `).join('');

            accordionContent.innerHTML = `
                <table style="width: 100%; border-collapse: collapse; margin: 0;">
                    <thead>
                        <tr style="background: #f7fafc;">
                            <th style="padding: 10px 12px; text-align: left; font-size: 0.85em; font-weight: 600; color: #4a5568; border-bottom: 2px solid #e2e8f0;">Exchange</th>
                            <th style="padding: 10px 12px; text-align: right; font-size: 0.85em; font-weight: 600; color: #4a5568; border-bottom: 2px solid #e2e8f0;">Tasa</th>
                            <th style="padding: 10px 12px; text-align: right; font-size: 0.85em; font-weight: 600; color: #4a5568; border-bottom: 2px solid #e2e8f0;">Hora</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            `;
        }
    }
}

// Hacer función global
window.toggleMarketDetailsAccordion = toggleMarketDetailsAccordion;

// Show take order modal
async function showTakeOrderModal(orderId) {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showAlert('Sesión expirada', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/p2p/orders/${orderId}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al cargar orden');
        }

        const data = await response.json();
        const order = data.order;
        currentOrderId = orderId;

        const modal = document.getElementById('takeOrderModal');
        const detailsDiv = document.getElementById('takeOrderDetails');

        // Reset Error
        const errorDiv = document.getElementById('takeOrderError');
        if (errorDiv) {
            errorDiv.style.display = 'none';
            errorDiv.textContent = '';
        }
        const takeAmountInput = document.getElementById('takeAmount');
        const takeAmountHint = document.getElementById('takeAmountHint');

        if (detailsDiv) {
            const isMakerBuy = order.type === 'BUY';
            const actionText = isMakerBuy ? `Vender ${order.cryptoAsset}` : `Comprar ${order.cryptoAsset}`;

            // Calculate Crypto limits for display if needed
            let minCrypto, maxCrypto, minFiat, maxFiat;

            if (isMakerBuy) {
                // Maker Buys (Pay Fiat, Get Crypto). Limits typically in Fiat.
                // order.amount is Total Crypto.
                // order.minAmount is Min Fiat.
                // order.maxAmount is Max Fiat.

                minFiat = order.minAmount || 0;
                // If maxAmount not set, implied max is the total order value in Fiat
                maxFiat = order.maxAmount || (order.amount * order.rate);

                minCrypto = minFiat / order.rate;
                maxCrypto = maxFiat / order.rate;

                limitsHtml = `
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <div style="display: flex; gap: 24px;">
                            <div style="flex: 1;">
                                <span style="display: block; font-size: 13px; color: #777; margin-bottom: 2px;">Mínimo (Crypto)</span>
                                <span style="font-size: 17px; font-weight: 600; font-family: monospace; color: #333;">${formatNumber(minCrypto)} ${order.cryptoAsset}</span>
                                <div style="font-size: 13px; color: #666; font-weight: 500; margin-top: 2px;">≈ ${formatNumber(minFiat)} ${order.fiatCurrency}</div>
                            </div>
                            <div style="flex: 1;">
                                 <span style="display: block; font-size: 13px; color: #777; margin-bottom: 2px;">Máximo (Crypto)</span>
                                 <span style="font-size: 17px; font-weight: 600; font-family: monospace; color: #333;">${formatNumber(maxCrypto)} ${order.cryptoAsset}</span>
                                 <div style="font-size: 13px; color: #666; font-weight: 500; margin-top: 2px;">≈ ${formatNumber(maxFiat)} ${order.fiatCurrency}</div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                // Maker Sells (Give Crypto, Get Fiat). Limits typically in Crypto.
                // order.amount is Total Crypto.
                // order.minAmount is Min Crypto.
                // order.maxAmount is Max Crypto.

                minCrypto = order.minAmount || 0;
                // If maxAmount not set, implied max is the total order amount
                maxCrypto = order.maxAmount || order.amount;

                minFiat = minCrypto * order.rate;
                maxFiat = maxCrypto * order.rate;

                // Standard display (Redesigned)
                limitsHtml = `
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <div style="display: flex; gap: 24px;">
                            <div style="flex: 1;">
                                <span style="display: block; font-size: 13px; color: #777; margin-bottom: 2px;">Mínimo (Crypto)</span>
                                <span style="font-size: 17px; font-weight: 600; font-family: monospace; color: #333;">${formatNumber(minCrypto)} ${order.cryptoAsset}</span>
                                <div style="font-size: 13px; color: #666; font-weight: 500; margin-top: 2px;">≈ ${formatNumber(minFiat)} ${order.fiatCurrency}</div>
                            </div>
                            <div style="flex: 1;">
                                 <span style="display: block; font-size: 13px; color: #777; margin-bottom: 2px;">Máximo (Crypto)</span>
                                 <span style="font-size: 17px; font-weight: 600; font-family: monospace; color: #333;">${formatNumber(maxCrypto)} ${order.cryptoAsset}</span>
                                 <div style="font-size: 13px; color: #666; font-weight: 500; margin-top: 2px;">≈ ${formatNumber(maxFiat)} ${order.fiatCurrency}</div>
                            </div>
                        </div>
                    </div>
                `;
            }

            detailsDiv.innerHTML = `
                <div style="background: transparent;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px;">
                        <div>
                            <span style="font-size: 13px; color: #666; font-weight: 500; display: block; margin-bottom: 4px;">Tú vas a:</span>
                            <span style="font-size: 24px; font-weight: 700; color: #333; line-height: 1;">${actionText}</span>
                        </div>
                        <div style="text-align: right;">
                             <span style="font-size: 13px; color: #666; font-weight: 500; display: block; margin-bottom: 4px;">Tasa de Cambio</span>
                             <span style="font-size: 20px; font-weight: 600; color: #333;">${formatNumber(order.rate)} <small style="font-size: 14px; font-weight: 400; color: #999;">${order.fiatCurrency}</small></span>
                        </div>
                    </div>

                    <div style="background: #f8f9fa; border-radius: 8px; padding: 15px; border: 1px solid #eee;">
                        <span style="font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 8px;">Límites de la Orden</span>
                        ${limitsHtml}
                    </div>
                </div>
            `;

            // Populate Terms
            const termsText = order.terms || 'Sin términos y condiciones especificados.';
            const termsElement = document.getElementById('takeTermsText');
            const termsContainer = document.getElementById('takeOrderTerms');
            if (termsElement && termsContainer) {
                termsElement.textContent = termsText;
                termsContainer.style.display = order.terms ? 'block' : 'none';
            }
        }

        if (takeAmountInput) {
            takeAmountInput.value = '';
            takeAmountInput.step = "any";

            // Si es BUY (Maker Compra -> Taker Vende):
            // El API espera FIAT. Pero el usuario quiere ingresar CRYPTO.
            // Vamos a permitir ingresar Crypto y convertir a Fiat al enviar.
            // Para eso, necesitamos saber en qué modo estamos.
            takeOrderState.isMakerBuy = order.type === 'BUY';
            takeOrderState.rate = order.rate;
            takeOrderState.currency = order.type === 'BUY' ? order.cryptoAsset : order.cryptoAsset; // Siempre input en Crypto para consistencia visual?

            // Actually, let's keep it simple first.
            // If Maker Buys -> Taker Sells Crypto. Taker wants to assume logic based on Crypto.
            // But Limits are in Fiat.
            // Let's change the input label dynamically.

            const label = document.querySelector('label[for="takeAmount"]');
            if (label) {
                label.textContent = order.type === 'BUY'
                    ? `Monto a Vender (${order.cryptoAsset})` // User inputs Crypto
                    : `Monto a Comprar (${order.cryptoAsset})`; // User inputs Crypto
            }

            // Calculate Max Crypto based on Fiat Limit for BUY orders
            const maxCrypto = order.type === 'BUY'
                ? (order.amount / order.rate)
                : order.amount;

            takeAmountInput.max = maxCrypto;
            takeAmountInput.min = (order.minAmount || 0) / (order.type === 'BUY' ? order.rate : 1);

            // Store original order limits for validation
            takeOrderState.maxFiat = order.amount;
            takeOrderState.minFiat = order.minAmount;
        }

        if (takeAmountHint) {
            const maxCrypto = order.type === 'BUY'
                ? (order.amount / order.rate)
                : order.amount;
            takeAmountHint.textContent = `Máximo disponible: ${formatNumber(maxCrypto)} ${order.cryptoAsset}`;
        }

        if (modal) {
            modal.style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading order:', error);
        showAlert('Error al cargar orden', 'error');
    }
}

// Close take order modal
function closeTakeOrderModal() {
    const modal = document.getElementById('takeOrderModal');
    if (modal) {
        modal.style.display = 'none';
        currentOrderId = null;
    }
}

// Set MAX amount for Take Order
function setTakeMaxAmount() {
    const input = document.getElementById('takeAmount');
    if (input && input.max) {
        input.value = input.max;
        // Trigger generic change event if needed
    } else if (input) {
        // Fallback: use stored state max
        // Logic depends on input mode (Crypto or Fiat).
        // Based on showTakeOrderModal logic:
        // if Maker BUY (user sells), input max is Crypto amount.
        // if Maker SELL (user buys), input max is Crypto amount.
        // We set input.max in showTakeOrderModal, so it should be there.
    }
}

// Handle take order
async function handleTakeOrder(event) {
    event.preventDefault();
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showAlert('Sesión expirada', 'error');
        return;
    }

    if (!currentOrderId) {
        showAlert('Error: Orden no seleccionada', 'error');
        return;
    }

    let amount = parseFloat(document.getElementById('takeAmount').value);

    // Conversión si es BUY (Maker Compra -> Taker Vende, imputamos Crypto pero API espera Fiat)
    // takeOrderState debe haber sido seteado en showTakeOrderModal
    // Pero como JS es stateless al recargar si no usamos variables globales, asegurémoslo.
    // Usamos el global takeOrderState si existe, o inferimos?
    // Mejor definir takeOrderState global arriba.

    if (takeOrderState.isMakerBuy) {
        // Convertir Crypto Amount (input) a Fiat Amount (API expects Fiat)
        // Amount (Check) = Input * Rate
        // Pero validemos límites primero? Backend validará.
        amount = amount * takeOrderState.rate;
        // console.log(`Converted Crypto Input ${document.getElementById('takeAmount').value} to Fiat ${amount}`);
    }

    try {
        const response = await fetch('/api/p2p/trades', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                orderId: currentOrderId,
                amount: amount // Sends Fiat if MakerBuy, Crypto if MakerSell
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al tomar orden');
        }

        showAlert('Orden tomada exitosamente. Redirigiendo a trade...', 'success');
        closeTakeOrderModal();

        // Redirect to trade view
        setTimeout(() => {
            window.location.href = `/p2p-trade?tradeId=${data.trade.id}`;
        }, 1500);
    } catch (error) {
        console.error('Error taking order:', error);
        // Mostrar error en el modal en lugar de alert
        const errorDiv = document.getElementById('takeOrderError');
        if (errorDiv) {
            // Si es un error de método de pago, agregar link
            if (error.message && (error.message.includes('método de pago') || error.message.includes('payment method'))) {
                errorDiv.innerHTML = `
                    ${error.message}
                    <br><br>
                    <a href="/p2p/payment-methods" style="color: #ee6a3e; font-weight: 600;">
                        👉 Agregar Método de Pago
                    </a>
                `;
            } else {
                errorDiv.textContent = error.message || 'Error al tomar orden';
            }
            errorDiv.style.display = 'block';
        } else {
            showAlert(error.message || 'Error al tomar orden', 'error');
        }
    }
}

// Show alert
function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) return;

    const alertClass = `alert-${type}`;
    const alert = document.createElement('div');
    alert.className = `alert ${alertClass}`;
    alert.textContent = message;
    alert.style.position = 'fixed';
    alert.style.top = '20px';
    alert.style.right = '20px';
    alert.style.zIndex = '3000';
    alert.style.minWidth = '300px';

    alertContainer.appendChild(alert);

    setTimeout(() => {
        alert.remove();
    }, 5000);
}

// Close modals when clicking outside
window.onclick = function (event) {
    const createModal = document.getElementById('createOrderModal');
    const takeModal = document.getElementById('takeOrderModal');
    const suggestedRatesModal = document.getElementById('suggestedRatesModal');
    const cancelOrderModal = document.getElementById('cancelOrderModal');
    const quickTradeModal = document.getElementById('quickTradeOrderModal');

    if (event.target === createModal) {
        closeCreateOrderModal();
    }
    if (event.target === takeModal) {
        closeTakeOrderModal();
    }
    if (event.target === suggestedRatesModal) {
        closeSuggestedRatesModal();
    }
    if (event.target === cancelOrderModal) {
        closeCancelOrderModal();
    }
    if (event.target === quickTradeModal) {
        closeQuickTradeOrderModal();
    }
}

// ============================================
// Funciones para Pantalla de Selección
// ============================================


function showSelectionScreen() {
    const selectionScreen = document.getElementById('p2pSelectionScreen');
    const quickTradeView = document.getElementById('quickTradeView');
    const classicOrdersView = document.getElementById('classicOrdersView');
    const myOrdersView = document.getElementById('myOrdersView');

    if (selectionScreen) {
        selectionScreen.style.display = 'block';

        // Nationality Badge Injection - BELOW selection cards
        if (!document.getElementById('nationalityBanner')) {
            const banner = document.createElement('div');
            banner.id = 'nationalityBanner';
            banner.style.cssText = `
                background: linear-gradient(135deg, #fdfbf7 0%, #fff 100%);
                border: 1px solid #fee9e1;
                border-left: 4px solid #ee6a3e;
                padding: 16px 20px;
                border-radius: 8px;
                margin-top: 30px;
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 15px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.02);
                max-width: 800px;
                margin-left: auto;
                margin-right: auto;
            `;

            // Insert AFTER the selection cards
            const selectionCards = selectionScreen.querySelector('.selection-cards');
            if (selectionCards) {
                selectionCards.insertAdjacentElement('afterend', banner);
            } else {
                // Fallback: append to selection screen
                selectionScreen.appendChild(banner);
            }

            // Update content based on profile
            const country = (currentUserProfile?.country || '').toLowerCase();
            let text = "Compra o Vende USDT, USDC o BTC entre otras criptos usando las múltiples monedas fiat disponibles";
            let icon = "🌍";
            let highlight = "Múltiples Monedas";

            // Map countries to their respective currencies
            if (country.includes('venezuela')) {
                icon = "🇻🇪";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Bolívares Venezolanos";
                highlight = "Bolívares";
            } else if (country.includes('colombia')) {
                icon = "🇨🇴";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Pesos Colombianos";
                highlight = "Pesos Colombianos";
            } else if (country.includes('argentina')) {
                icon = "🇦🇷";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Pesos Argentinos";
                highlight = "Pesos Argentinos";
            } else if (country.includes('chile')) {
                icon = "🇨🇱";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Pesos Chilenos";
                highlight = "Pesos Chilenos";
            } else if (country.includes('méxico') || country.includes('mexico')) {
                icon = "🇲🇽";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Pesos Mexicanos";
                highlight = "Pesos Mexicanos";
            } else if (country.includes('brasil') || country.includes('brazil')) {
                icon = "🇧🇷";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Reales Brasileños";
                highlight = "Reales Brasileños";
            } else if (country.includes('perú') || country.includes('peru')) {
                icon = "🇵🇪";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Soles Peruanos";
                highlight = "Soles Peruanos";
            } else if (country.includes('bolivia')) {
                icon = "🇧🇴";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Bolivianos";
                highlight = "Bolivianos";
            } else if (country.includes('uruguay')) {
                icon = "🇺🇾";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Pesos Uruguayos";
                highlight = "Pesos Uruguayos";
            } else if (country.includes('dominicana') || country.includes('república dominicana')) {
                icon = "🇩🇴";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Pesos Dominicanos";
                highlight = "Pesos Dominicanos";
            } else if (country.includes('paraguay')) {
                icon = "🇵🇾";
                text = "Recarga o Vende USDT, USDC o BTC entre otras criptos usando tus Guaraníes";
                highlight = "Guaraníes";
            }

            banner.innerHTML = `
                <div style="font-size: 28px; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.1));">${icon}</div>
                <div style="flex: 1;">
                    <strong style="display: block; color: #ee6a3e; font-size: 0.9em; text-transform: uppercase; margin-bottom: 2px;">${highlight}</strong>
                    <span style="color: #444; font-weight: 500; font-size: 1.1em;">${text}</span>
                </div>
            `;
        }
    }

    if (quickTradeView) quickTradeView.style.display = 'none';
    if (classicOrdersView) classicOrdersView.style.display = 'none';
    if (myOrdersView) myOrdersView.style.display = 'none';
}

function initCashierZoneStructure() {
    // We strictly use myOrdersView for both "My Book" and "History" tabs in Cashier Zone.
    // classicOrdersView (Marketplace) is NOT used here anymore.

    const myOrdersView = document.getElementById('myOrdersView');
    const myOrdersContent = document.getElementById('cashierMyOrdersContent');

    if (myOrdersView && myOrdersContent && myOrdersView.parentNode !== myOrdersContent) {
        const backBtn = myOrdersView.querySelector('.btn-back');
        if (backBtn) backBtn.style.display = 'none';

        // Hide the entire header when embedded in cashier zone
        const header = myOrdersView.querySelector('.p2p-header');
        if (header) header.style.display = 'none';

        // UI Fix: Reset margins/padding to align with "Live Requests" tab content
        myOrdersView.style.marginTop = '0';
        myOrdersView.style.paddingTop = '0';

        // Ajuste de margen superior del contenedor de filtros; el padding interno se deja al CSS para que Tipo/Estado no queden pegados al borde
        const filtersSection = myOrdersView.querySelector('.filters-section');
        if (filtersSection) {
            filtersSection.style.marginTop = '0';
        }

        // Ensure the container inside doesn't have extra padding either if needed
        const internalContainer = myOrdersView.querySelector('.container, .p2p-container');
        if (internalContainer) {
            internalContainer.style.paddingTop = '0';
        }

        myOrdersContent.appendChild(myOrdersView);
        myOrdersView.style.display = 'block';
    }
}

function selectP2PMode(mode) {
    const selectionScreen = document.getElementById('p2pSelectionScreen');
    const quickTradeView = document.getElementById('quickTradeView');
    const cashierZoneView = document.getElementById('cashierZoneView');
    const classicOrdersView = document.getElementById('classicOrdersView');
    const myOrdersView = document.getElementById('myOrdersView');

    if (selectionScreen) selectionScreen.style.display = 'none';
    if (quickTradeView) quickTradeView.style.display = 'none';
    if (cashierZoneView) cashierZoneView.style.display = 'none';

    // Ensure classic/myOrders views are hidden if they haven't been moved yet
    // OR if we are in Quick Trade mode, ensuring they don't pop up
    if (classicOrdersView && classicOrdersView.parentNode !== document.getElementById('cashierBookContent')) {
        classicOrdersView.style.display = 'none';
    }
    if (myOrdersView && myOrdersView.parentNode !== document.getElementById('cashierMyOrdersContent')) {
        myOrdersView.style.display = 'none';
    }

    if (mode === 'quick') {
        if (quickTradeView) quickTradeView.style.display = 'block';

        // Reset state
        quickTradeState = {
            operationType: null,
            selectedCrypto: null,
            selectedFiat: null,
            amount: null,
            rate: null,
            userWallets: [],
            userPaymentMethods: []
        };

        document.querySelectorAll('.quick-trade-step').forEach(step => {
            step.style.display = 'none';
        });
        document.getElementById('quickTradeStep1').style.display = 'block';
        document.getElementById('quickTradeResult').style.display = 'none';

        document.querySelectorAll('.operation-card').forEach(card => {
            card.classList.remove('selected');
        });

        loadFiatCurrenciesForBuy();

    } else if (mode === 'cashier') {
        if (cashierZoneView) {
            cashierZoneView.style.display = 'block';

            // Move views into tabs if needed
            initCashierZoneStructure();

            // Default to live requests
            switchCashierTab('live');
        }
    }
}

function goBackToSelection() {
    const selectionScreen = document.getElementById('p2pSelectionScreen');
    const quickTradeView = document.getElementById('quickTradeView');
    const cashierZoneView = document.getElementById('cashierZoneView');

    if (quickTradeView) quickTradeView.style.display = 'none';
    if (cashierZoneView) cashierZoneView.style.display = 'none';
    if (selectionScreen) selectionScreen.style.display = 'block';
}

// ============================================
// Funciones para Cambio Rápido (Refactorizado con Cards)
// ============================================

let quickTradeState = {
    operationType: null, // 'BUY' o 'SELL'
    selectedCrypto: null,
    selectedFiat: null,
    amount: null,
    rate: null,
    userWallets: [],
    userPaymentMethods: [],
    selectedPaymentMethodId: null  // For Sell: single payment method selection
};

// Paso 1: Seleccionar tipo de operación
function selectQuickTradeOperation(type, element) {
    quickTradeState.operationType = type;

    // Marcar card seleccionada
    document.querySelectorAll('.operation-card').forEach(card => {
        card.classList.remove('selected');
    });
    if (element) {
        element.classList.add('selected');
    }

    // Ocultar paso 1 y mostrar siguiente paso
    document.getElementById('quickTradeStep1').style.display = 'none';

    if (type === 'SELL') {
        // Cargar wallets con balance y mostrar paso 2 (seleccionar crypto)
        loadUserWalletsForSell();
    } else {
        // Mostrar paso 2 (seleccionar crypto) - NUEVO ORDEN
        document.getElementById('quickTradeStep2Buy').style.display = 'block';
        loadCryptoAssetsForBuy();
    }
}

// Cargar wallets del usuario para venta
async function loadUserWalletsForSell() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    try {
        const response = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            quickTradeState.userWallets = data.wallets || [];

            // Filtrar solo wallets con balance > 0 y que estén en SUPPORTED_CRYPTO_ASSETS (excluye BiUSD)
            const walletsWithBalance = quickTradeState.userWallets.filter(w =>
                parseFloat(w.balance) > 0 && SUPPORTED_CRYPTO_ASSETS.includes(w.assetSymbol)
            );

            // Agrupar por símbolo (sumar balances de diferentes redes)
            const groupedWallets = {};
            walletsWithBalance.forEach(wallet => {
                const symbol = wallet.assetSymbol;
                if (!groupedWallets[symbol]) {
                    groupedWallets[symbol] = {
                        symbol,
                        totalBalance: 0,
                        wallets: []
                    };
                }
                groupedWallets[symbol].totalBalance += parseFloat(wallet.balance);
                groupedWallets[symbol].wallets.push(wallet);
            });

            // Renderizar cards de criptos disponibles
            renderCryptoCardsForSell(Object.values(groupedWallets));
            document.getElementById('quickTradeStep2Sell').style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading wallets:', error);
        showAlert('Error al cargar tus wallets', 'error');
    }
}

// Renderizar cards de criptos para venta
function renderCryptoCardsForSell(cryptoGroups) {
    const container = document.getElementById('cryptoCardsSell');
    if (!container) return;

    if (cryptoGroups.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666;">No tienes criptomonedas con balance disponible</p>';
        return;
    }

    container.innerHTML = cryptoGroups.map(group => {
        const iconPath = getCoinIconPath(group.symbol);
        return `
            <div class="crypto-card" data-symbol="${group.symbol}" onclick="selectCryptoForSell('${group.symbol}', this)">
                <img src="${iconPath}" alt="${group.symbol}" style="width: 48px; height: 48px; margin-bottom: 10px;">
                <h4>${group.symbol}</h4>
                <div class="balance">Disponible: ${formatNumber(group.totalBalance)}</div>
            </div>
        `;
    }).join('');
}

// Seleccionar cripto para venta
function selectCryptoForSell(symbol, element) {
    quickTradeState.selectedCrypto = symbol;

    // Marcar card seleccionada
    document.querySelectorAll('#cryptoCardsSell .crypto-card').forEach(card => {
        card.classList.remove('selected');
    });
    if (element) {
        element.classList.add('selected');
    }

    // Obtener balance total de esta crypto
    const cryptoGroup = quickTradeState.userWallets
        .filter(w => w.assetSymbol === symbol)
        .reduce((acc, w) => acc + parseFloat(w.balance), 0);

    // Guardar el balance disponible para validación
    quickTradeState.availableBalance = cryptoGroup;

    // Mostrar paso 3 (monto)
    document.getElementById('quickTradeStep2Sell').style.display = 'none';
    document.getElementById('quickTradeStep3Sell').style.display = 'block';

    document.getElementById('selectedCryptoSell').textContent = symbol;
    document.getElementById('availableBalanceSell').textContent = formatNumber(cryptoGroup);
    document.getElementById('availableBalanceCryptoSell').textContent = symbol;

    // Verificar si es estable o volátil
    const isStable = symbol === 'USDT' || symbol === 'USDC';
    if (!isStable) {
        document.getElementById('volatileConversionSell').style.display = 'block';
        document.getElementById('cryptoToDeductCryptoSell').textContent = symbol;
    } else {
        document.getElementById('volatileConversionSell').style.display = 'none';
    }

    // Limpiar input y deshabilitar botón inicialmente
    const amountInput = document.getElementById('quickTradeAmountSell');
    const continueButton = document.querySelector('#quickTradeStep3Sell .btn-create-order');

    if (amountInput) {
        amountInput.value = '';
        amountInput.oninput = () => {
            validateSellAmount();
        };
        amountInput.onchange = () => {
            validateSellAmount();
        };
    }

    if (continueButton) {
        continueButton.disabled = true;
        continueButton.style.opacity = '0.5';
        continueButton.style.cursor = 'not-allowed';
    }
}

// Validar monto de venta
function validateSellAmount() {
    const amountInput = document.getElementById('quickTradeAmountSell');
    const continueButton = document.querySelector('#quickTradeStep3Sell .btn-create-order');
    const errorMessage = document.getElementById('sellAmountError');

    if (!amountInput || !continueButton) return;

    const amount = parseFloat(amountInput.value) || 0;
    const available = quickTradeState.availableBalance || 0;
    const symbol = quickTradeState.selectedCrypto;
    const isStable = symbol === 'USDT' || symbol === 'USDC';

    // Validar balance
    if (amount <= 0) {
        if (continueButton) {
            continueButton.disabled = true;
            continueButton.style.opacity = '0.5';
            continueButton.style.cursor = 'not-allowed';
        }
        if (errorMessage) {
            errorMessage.style.display = 'none';
        }
        amountInput.setCustomValidity('El monto debe ser mayor a 0');
        return;
    }

    if (amount > available) {
        if (continueButton) {
            continueButton.disabled = true;
            continueButton.style.opacity = '0.5';
            continueButton.style.cursor = 'not-allowed';
        }
        amountInput.setCustomValidity(`El monto no puede ser mayor a ${formatNumber(available)} ${symbol}`);

        // Mostrar mensaje de error
        if (errorMessage) {
            errorMessage.textContent = `El monto excede tu balance disponible (${formatNumber(available)} ${symbol})`;
            errorMessage.style.display = 'block';
            errorMessage.style.color = '#dc3545';
        }
    } else {
        if (continueButton) {
            continueButton.disabled = false;
            continueButton.style.opacity = '1';
            continueButton.style.cursor = 'pointer';
        }
        amountInput.setCustomValidity('');

        // Ocultar mensaje de error
        if (errorMessage) {
            errorMessage.style.display = 'none';
        }

        // Si es volátil, calcular conversión USD
        if (!isStable && amount > 0) {
            calculateVolatileConversionSell(amount, symbol);
        }
    }
}

// Calcular conversión para crypto volátil (venta) usando promedio de mercado externo
async function calculateVolatileConversionSell(amount, symbol) {
    try {
        const response = await fetch(`/api/external-prices/convert?crypto=${encodeURIComponent(symbol)}&fiat=USD&amount=${amount}&side=SELL`);
        if (response.ok) {
            const data = await response.json();
            const usdValue = data.fiatAmount ?? 0;
            document.getElementById('usdEquivalentSell').textContent = formatNumber(usdValue);
            document.getElementById('cryptoToDeductSell').textContent = formatNumber(amount);
        } else {
            const fallback = await fetch(`/api/prices/convert?from=${symbol}&to=USD&amount=${amount}`);
            if (fallback.ok) {
                const d = await fallback.json();
                document.getElementById('usdEquivalentSell').textContent = formatNumber(d.convertedAmount || 0);
                document.getElementById('cryptoToDeductSell').textContent = formatNumber(amount);
            }
        }
    } catch (error) {
        console.error('Error calculating conversion:', error);
    }
}

// Continuar después de ingresar monto (venta)
async function continueQuickTradeSell() {
    const amountInput = document.getElementById('quickTradeAmountSell');
    const amount = parseFloat(amountInput.value);

    if (!amount || amount <= 0) {
        showAlert('Por favor ingresa un monto válido', 'error');
        return;
    }

    // Validar balance (usar el balance guardado en el estado)
    const available = quickTradeState.availableBalance || 0;

    if (amount > available) {
        showAlert(`El monto no puede ser mayor a ${formatNumber(available)} ${quickTradeState.selectedCrypto}`, 'error');
        // Re-validar para actualizar UI
        validateSellAmount();
        return;
    }

    quickTradeState.amount = amount;

    const isStable = quickTradeState.selectedCrypto === 'USDT' || quickTradeState.selectedCrypto === 'USDC';

    if (isStable) {
        // Mostrar selección de fiat
        document.getElementById('quickTradeStep3Sell').style.display = 'none';
        document.getElementById('quickTradeStep4SellStable').style.display = 'block';
        loadFiatCurrenciesForSell();
        loadUserPaymentMethods();
    } else {
        // Para volátiles, también necesitamos fiat
        document.getElementById('quickTradeStep3Sell').style.display = 'none';
        document.getElementById('quickTradeStep4SellStable').style.display = 'block';
        loadFiatCurrenciesForSell();
        loadUserPaymentMethods();
    }
}

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

/**
 * Obtiene la ruta del icono SVG para una moneda
 * @param {string} assetSymbol - Símbolo de la moneda (USDT, USDC, BTC, etc.)
 * @returns {string} - Ruta al archivo SVG del icono
 */
function getCoinIconPath(assetSymbol) {
    const iconMap = {
        'USDT': 'usdt.svg',
        'USDC': 'usdc.svg',
        'BTC': 'btc.svg',
        'ETH': 'eth.svg',
        'LTC': 'ltc.svg',
        'BiUSD': 'biusd.svg'
    };

    const iconFile = iconMap[assetSymbol] || 'usdt.svg'; // Default a USDT si no se encuentra
    return `/assets/coins/${iconFile}`;
}

// Cargar monedas fiat para venta
async function loadFiatCurrenciesForSell() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    try {
        const response = await fetch('/api/p2p/config/fiat-currencies', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            const currencies = data.currencies || [];

            const container = document.getElementById('fiatCardsSell');
            if (container) {
                container.innerHTML = currencies.map(currency => {
                    const flag = currencyToCountryFlag[currency.code] || '🏳️';
                    return `
                        <div class="fiat-card" data-code="${currency.code}" onclick="selectFiatForSell('${currency.code}', this)">
                            <span class="flag-icon">${flag}</span>
                            <h4>${currency.code}</h4>
                            <p style="color: #666; font-size: 0.9rem;">${currency.name}</p>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (error) {
        console.error('Error loading fiat currencies:', error);
    }
}

// Seleccionar fiat para venta
function selectFiatForSell(fiatCode, element) {
    quickTradeState.selectedFiat = fiatCode;

    document.querySelectorAll('#fiatCardsSell .fiat-card').forEach(card => {
        card.classList.remove('selected');
    });

    if (element) {
        element.classList.add('selected');
    }

    // Re-renderizar métodos de pago para habilitar/deshabilitar Continuar según corresponda
    renderPaymentMethods();

    // Mostrar botón de búsqueda (Sell) -> Ahora irá al paso de Tasa
    const btn = document.getElementById('btnSearchBestOfferSell');
    if (btn) {
        btn.style.display = 'block';
        btn.textContent = 'Continuar'; // Change label to indicate next step
        btn.onclick = goToQuickTradeStep5Sell; // Change handler
    }

    // Fetch Rates for SELL
    // Note: We need the crypto symbol. For Sell flow, it's stored in quickTradeState.selectedCrypto
    const crypto = quickTradeState.selectedCrypto || 'USDT';
    fetchSuggestedRates(crypto, fiatCode, 'SELL');

    // Update Badges Fiat Symbol
    document.querySelectorAll('.fiatSymbolDisplay').forEach(el => el.textContent = fiatCode);
}

// Ir al paso 5 (Definir Tasa para Venta)
function goToQuickTradeStep5Sell() {
    console.log('[QuickTrade] goToQuickTradeStep5Sell() called');

    if (!quickTradeState.selectedFiat) {
        showAlert('Por favor selecciona una moneda fiat', 'error');
        return;
    }

    // Hide Step 4 (Fiat Select)
    document.getElementById('quickTradeStep4SellStable').style.display = 'none';

    // Show Step 5 (Rate Input) - Assuming we create this ID in HTML
    const step5 = document.getElementById('quickTradeStep5SellStable');
    console.log('[QuickTrade] Step5 element found:', !!step5);

    if (step5) {
        step5.style.display = 'block';

        // Update Labels
        const fiatSpan = document.getElementById('fiatSymbolSellRate');
        const cryptoSpan = document.getElementById('cryptoSymbolSellRate');
        if (fiatSpan) fiatSpan.textContent = quickTradeState.selectedFiat;
        if (cryptoSpan) cryptoSpan.textContent = quickTradeState.selectedCrypto;

        // Load user payment methods for Sell
        console.log('[QuickTrade] Calling loadUserPaymentMethods()');
        loadUserPaymentMethods();
    } else {
        console.error('[QuickTrade] Step5 element NOT found!');
    }
}

// Volver al paso 4 (Selección de Fiat) desde paso 5
function goBackToStep4Sell() {
    console.log('[QuickTrade] goBackToStep4Sell() called');

    // Hide Step 5
    const step5 = document.getElementById('quickTradeStep5SellStable');
    if (step5) step5.style.display = 'none';

    // Show Step 4
    const step4 = document.getElementById('quickTradeStep4SellStable');
    if (step4) step4.style.display = 'block';
}

// Validar input de tasa de venta en tiempo real
function validateSellRateInput() {
    const rateInput = document.getElementById('quickTradeRateSell');
    const btn = document.getElementById('btnSearchBestOffer');
    const message = document.getElementById('rateValidationMessage');

    if (!rateInput || !btn) return;

    const rate = parseFloat(rateInput.value);
    const isValid = rate && rate > 0;

    // Enable/disable button based on validation
    btn.disabled = !isValid;

    // Update visual feedback
    if (rateInput.value === '') {
        // Empty - neutral state
        rateInput.style.borderColor = '';
        if (message) {
            message.textContent = 'Define el precio al que quieres vender tus criptomonedas.';
            message.style.color = '#666';
        }
    } else if (isValid) {
        // Valid - success state
        rateInput.style.borderColor = '#28a745';
        if (message) {
            message.textContent = '✓ Tasa válida';
            message.style.color = '#28a745';
        }
    } else {
        // Invalid - error state
        rateInput.style.borderColor = '#dc3545';
        if (message) {
            message.textContent = 'Ingresa un valor mayor a 0';
            message.style.color = '#dc3545';
        }
    }
}

// Ejecutar quick trade (venta) FINAL
async function executeQuickTradeSell() {
    // Validate Rate Input (double-check even though button should be disabled)
    const rateInput = document.getElementById('quickTradeRateSell');
    const rate = parseFloat(rateInput ? rateInput.value : 0);

    if (!rate || rate <= 0) {
        // Instead of popup, just ensure button is disabled and show inline message
        validateSellRateInput();
        return;
    }

    quickTradeState.rate = rate;

    // Proceed to execution
    await executeQuickTrade(rate);
}

// Cargar monedas fiat para compra (cards)
async function loadFiatCurrenciesForBuy() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    try {
        const response = await fetch('/api/p2p/config/fiat-currencies', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            const currencies = data.currencies || [];

            const container = document.getElementById('fiatCardsBuy');
            if (container) {
                container.innerHTML = currencies.map(currency => {
                    const flag = currencyToCountryFlag[currency.code] || '🏳️';
                    return `
                        <div class="fiat-card" data-code="${currency.code}" onclick="selectFiatForBuy('${currency.code}', this)">
                            <span class="flag-icon">${flag}</span>
                            <h4>${currency.code}</h4>
                            <p style="color: #666; font-size: 0.9rem;">${currency.name}</p>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (error) {
        console.error('Error loading fiat currencies:', error);
    }
}

// Seleccionar fiat para compra
async function selectFiatForBuy(fiatCode, element) {
    quickTradeState.selectedFiat = fiatCode;

    document.querySelectorAll('#fiatCardsBuy .fiat-card').forEach(card => {
        card.classList.remove('selected');
    });
    if (element) {
        element.classList.add('selected');
    }

    // Cargar métodos de pago antes de validar (en Compra no se cargan hasta el paso 4, pero validamos aquí)
    await loadUserPaymentMethods();

    // Fetch Rates con crypto y fiat seleccionados
    if (quickTradeState.selectedCrypto && fiatCode) {
        fetchSuggestedRates(quickTradeState.selectedCrypto, fiatCode, 'BUY');
    }

    // Update Fiat Symbol in Badges
    document.querySelectorAll('.fiatSymbolDisplay').forEach(el => el.textContent = fiatCode);

    // Mostrar botón de continuar (NO avanzar automáticamente)
    const continueBtn = document.getElementById('btnContinueAfterFiatBuy');
    if (continueBtn) {
        continueBtn.style.display = 'block';
    }
}

// Debounce timer para conversión en vivo (compra - cripto no estable)
let _quickTradeBuyFiatEquivalentDebounce = null;
function updateBuyAmountFiatEquivalentLive() {
    const amountInput = document.getElementById('quickTradeAmountBuy');
    const equivEl = document.getElementById('quickTradeBuyFiatEquivalent');
    const valueEl = document.getElementById('quickTradeBuyFiatValue');
    const symbolEl = document.getElementById('quickTradeBuyFiatSymbol');
    if (!amountInput || !equivEl || !valueEl || !symbolEl) return;
    const amount = parseFloat(amountInput.value);
    const isStable = quickTradeState.selectedCrypto === 'USDT' || quickTradeState.selectedCrypto === 'USDC';
    if (isStable || !quickTradeState.selectedFiat || !amount || amount <= 0) {
        equivEl.style.display = 'none';
        return;
    }
    equivEl.style.display = 'block';
    symbolEl.textContent = quickTradeState.selectedFiat;
    valueEl.textContent = '...';
    fetch(`/api/external-prices/convert?crypto=${encodeURIComponent(quickTradeState.selectedCrypto)}&fiat=${encodeURIComponent(quickTradeState.selectedFiat)}&amount=${amount}&side=BUY`)
        .then(r => r.json())
        .then(data => {
            if (data.fiatAmount != null) {
                valueEl.textContent = formatNumber(data.fiatAmount);
            } else {
                equivEl.style.display = 'none';
            }
        })
        .catch(() => { equivEl.style.display = 'none'; });
}

// Continuar después de seleccionar fiat (compra)
function continueAfterFiatBuy() {
    if (!quickTradeState.selectedFiat) {
        showAlert('Por favor selecciona una moneda fiat', 'error');
        return;
    }

    // Avanzar al paso 4 (monto de crypto)
    document.getElementById('quickTradeStep3Buy').style.display = 'none';
    document.getElementById('quickTradeStep4BuyAmount').style.display = 'block';
    
    // Actualizar label del monto
    const cryptoLabel = document.getElementById('selectedCryptoBuy');
    if (cryptoLabel) {
        cryptoLabel.textContent = quickTradeState.selectedCrypto;
    }

    // Para criptos no estables: mostrar equivalente en fiat y actualizar al escribir
    const isStable = quickTradeState.selectedCrypto === 'USDT' || quickTradeState.selectedCrypto === 'USDC';
    const equivEl = document.getElementById('quickTradeBuyFiatEquivalent');
    const amountInput = document.getElementById('quickTradeAmountBuy');
    if (equivEl) equivEl.style.display = isStable ? 'none' : 'block';
    if (!isStable && amountInput) {
        amountInput.oninput = function () {
            if (_quickTradeBuyFiatEquivalentDebounce) clearTimeout(_quickTradeBuyFiatEquivalentDebounce);
            _quickTradeBuyFiatEquivalentDebounce = setTimeout(updateBuyAmountFiatEquivalentLive, 400);
        };
        updateBuyAmountFiatEquivalentLive();
    }
}

// Continuar después de ingresar monto de crypto (compra)
async function continueQuickTradeBuy() {
    const amountInput = document.getElementById('quickTradeAmountBuy');
    const amount = parseFloat(amountInput.value);

    if (!quickTradeState.selectedCrypto || !quickTradeState.selectedFiat || !amount || amount <= 0) {
        showAlert('Por favor completa todos los campos', 'error');
        return;
    }

    quickTradeState.amount = amount;

    // Mostrar paso 5 (tasa y métodos de pago)
    document.getElementById('quickTradeStep4BuyAmount').style.display = 'none';
    
    const isStable = quickTradeState.selectedCrypto === 'USDT' || quickTradeState.selectedCrypto === 'USDC';
    if (isStable) {
        document.getElementById('quickTradeStep4BuyStable').style.display = 'block';
        document.getElementById('fiatSymbolBuy').textContent = quickTradeState.selectedFiat;
        document.getElementById('cryptoSymbolBuy').textContent = quickTradeState.selectedCrypto;
        loadUserPaymentMethods();
        // Las tasas ya se cargaron en el paso 3
    } else {
        document.getElementById('quickTradeStep4BuyVolatile').style.display = 'block';
        document.getElementById('fiatSymbolBuyVolatile').textContent = quickTradeState.selectedFiat;
        document.getElementById('cryptoSymbolBuyVolatile').textContent = quickTradeState.selectedCrypto;
        // Calcular conversión: monto es de crypto, calcular equivalente en fiat
        await calculateVolatileConversionBuy();
        loadUserPaymentMethods();
        // Las tasas ya se cargaron en el paso 3
    }
}

// Criptos soportadas por BidiPago (con logos disponibles)
const SUPPORTED_CRYPTO_ASSETS = ['USDT', 'USDC', 'BTC', 'ETH', 'LTC'];

// Cargar assets disponibles para compra (solo los soportados por BidiPago)
async function loadCryptoAssetsForBuy() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    try {
        const response = await fetch('/api/p2p/config/crypto-assets', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            const assets = data.assets || [];

            // Filtrar solo las criptos soportadas por BidiPago
            const supportedAssets = assets.filter(asset =>
                SUPPORTED_CRYPTO_ASSETS.includes(asset.symbol) && asset.isActive
            );

            // Agrupar por símbolo (tomar el primero de cada símbolo)
            const grouped = {};
            supportedAssets.forEach(asset => {
                if (!grouped[asset.symbol]) {
                    grouped[asset.symbol] = asset;
                }
            });

            const container = document.getElementById('cryptoCardsBuy');
            if (container) {
                container.innerHTML = Object.values(grouped).map(asset => {
                    const iconPath = getCoinIconPath(asset.symbol);
                    return `
                        <div class="crypto-card" data-symbol="${asset.symbol}" onclick="selectCryptoForBuy('${asset.symbol}', this)">
                            <img src="${iconPath}" alt="${asset.symbol}" style="width: 48px; height: 48px; margin-bottom: 10px;">
                            <h4>${asset.symbol}</h4>
                            <p style="color: #666; font-size: 0.9rem;">${asset.name}</p>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (error) {
        console.error('Error loading crypto assets:', error);
    }
}

// Seleccionar crypto para compra
function selectCryptoForBuy(symbol, element) {
    quickTradeState.selectedCrypto = symbol;

    document.querySelectorAll('#cryptoCardsBuy .crypto-card').forEach(card => {
        card.classList.remove('selected');
    });
    if (element) {
        element.classList.add('selected');
    }

    // Avanzar al paso 3 (seleccionar fiat)
    document.getElementById('quickTradeStep2Buy').style.display = 'none';
    document.getElementById('quickTradeStep3Buy').style.display = 'block';
    
    // Ocultar botón de continuar al entrar al paso 3
    const continueBtn = document.getElementById('btnContinueAfterFiatBuy');
    if (continueBtn) {
        continueBtn.style.display = 'none';
    }
    
    loadFiatCurrenciesForBuy();
    // Precargar métodos de pago para que la validación al seleccionar fiat tenga datos
    loadUserPaymentMethods();
}

// Calcular conversión para crypto volátil (compra) usando promedio de mercado externo
async function calculateVolatileConversionBuy() {
    try {
        const response = await fetch(`/api/external-prices/convert?crypto=${quickTradeState.selectedCrypto}&fiat=${quickTradeState.selectedFiat}&amount=${quickTradeState.amount}&side=BUY`);
        if (response.ok) {
            const data = await response.json();
            const fiatAmount = data.fiatAmount ?? 0;
            document.getElementById('cryptoAmountBuy').textContent = formatNumber(quickTradeState.amount);
            document.getElementById('fiatAmountBuy').textContent = formatNumber(fiatAmount);
        }
    } catch (error) {
        console.error('Error calculating conversion:', error);
    }
}

// Actualizar label de monto (compra) - Ya no se usa, se actualiza automáticamente
function updateBuyAmountLabel() {
    // Función obsoleta, se mantiene por compatibilidad
}

// Cargar métodos de pago del usuario
async function loadUserPaymentMethods() {
    console.log('[QuickTrade] loadUserPaymentMethods() called');
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        console.warn('[QuickTrade] No access token found');
        return;
    }

    try {
        console.log('[QuickTrade] Fetching payment methods from /api/p2p/payment-methods');
        const response = await fetch('/api/p2p/payment-methods', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('[QuickTrade] Payment methods response status:', response.status);

        if (response.ok) {
            const data = await response.json();
            console.log('[QuickTrade] Payment methods data received:', data);
            console.log('[QuickTrade] Payment methods array:', data.paymentMethods);

            quickTradeState.userPaymentMethods = data.paymentMethods || [];
            // Also sync with global variable for legacy order creation flow
            userPaymentMethods = quickTradeState.userPaymentMethods;
            console.log('[QuickTrade] Stored in state:', quickTradeState.userPaymentMethods.length, 'methods');

            renderPaymentMethods();
            // Also populate legacy order payment methods select if it exists
            if (typeof populatePaymentMethodsSelect === 'function') {
                populatePaymentMethodsSelect();
            }
        } else {
            const errorText = await response.text();
            console.error('[QuickTrade] Failed to load payment methods:', response.status, errorText);
        }
    } catch (error) {
        console.error('[QuickTrade] Error loading payment methods:', error);
    }
}

// Renderizar métodos de pago
function renderPaymentMethods() {
    console.log('[QuickTrade] renderPaymentMethods() called');
    console.log('[QuickTrade] Total methods in state:', quickTradeState.userPaymentMethods.length);
    console.log('[QuickTrade] Selected Fiat:', quickTradeState.selectedFiat);

    // Filter by isActive and matching currency (API devuelve currency desde definición; algunos usan fiatCurrency)
    const selectedFiat = quickTradeState.selectedFiat;
    const methods = quickTradeState.userPaymentMethods.filter(m => {
        const isActive = m.isActive !== false;
        const methodCurrency = m.currency || m.fiatCurrency;
        const matchesCurrency = !selectedFiat || methodCurrency === selectedFiat;
        console.log('[QuickTrade] Method:', m.name, 'currency:', methodCurrency, 'matches:', matchesCurrency);
        return isActive && matchesCurrency;
    });

    console.log('[QuickTrade] Filtered methods for', selectedFiat, ':', methods.length);

    if (methods.length === 0) {
        console.warn('[QuickTrade] No matching payment methods for currency:', selectedFiat);

        // Badge en paso de selección fiat (SELL y BUY)
        const sellFiatBadge = document.getElementById('noPaymentMethodsBadgeSellFiatStep');
        const buyFiatBadge = document.getElementById('noPaymentMethodsBadgeBuyFiatStep');
        if (sellFiatBadge) {
            sellFiatBadge.style.display = 'flex';
            const codeEl = document.getElementById('noPmBadgeSellFiatCode');
            if (codeEl) codeEl.textContent = selectedFiat || 'VES';
        }
        if (buyFiatBadge) {
            buyFiatBadge.style.display = 'flex';
            const codeEl = document.getElementById('noPmBadgeBuyFiatCode');
            if (codeEl) codeEl.textContent = selectedFiat || 'VES';
        }
        const btnContinueBuy = document.getElementById('btnContinueAfterFiatBuy');
        if (btnContinueBuy) {
            btnContinueBuy.disabled = true;
            btnContinueBuy.style.opacity = '0.6';
            btnContinueBuy.style.cursor = 'not-allowed';
        }

        // BUY: Mostrar badge "No hay método de pago" e inhabilitar botón
        const buySection = document.getElementById('paymentMethodsSectionBuy');
        const buyBadge = document.getElementById('noPaymentMethodsBadgeBuy');
        const buyList = document.getElementById('paymentMethodsListBuy');
        if (buySection && buyBadge && buyList) {
            buySection.style.display = 'block';
            buyBadge.style.display = 'flex';
            buyList.innerHTML = '';
            buyList.style.display = 'none';
        }
        const btnBuyStable = document.getElementById('btnSearchBestOfferBuyStable');
        if (btnBuyStable) {
            btnBuyStable.disabled = true;
            btnBuyStable.style.opacity = '0.6';
            btnBuyStable.style.cursor = 'not-allowed';
        }

        const buyVolatileSection = document.getElementById('paymentMethodsSectionBuyVolatile');
        const buyVolatileBadge = document.getElementById('noPaymentMethodsBadgeBuyVolatile');
        const buyVolatileList = document.getElementById('paymentMethodsListBuyVolatile');
        if (buyVolatileSection && buyVolatileBadge && buyVolatileList) {
            buyVolatileSection.style.display = 'block';
            buyVolatileBadge.style.display = 'flex';
            buyVolatileList.innerHTML = '';
            buyVolatileList.style.display = 'none';
        }
        const btnBuyVolatile = document.getElementById('btnSearchBestOfferBuyVolatile');
        if (btnBuyVolatile) {
            btnBuyVolatile.disabled = true;
            btnBuyVolatile.style.opacity = '0.6';
            btnBuyVolatile.style.cursor = 'not-allowed';
        }

        // SELL: Mostrar mensaje e inhabilitar botón
        const sellContainer = document.getElementById('paymentMethodsListSell');
        if (sellContainer) {
            sellContainer.innerHTML = `<div style="padding:15px; text-align:center; color:#666;">No tienes métodos de pago para ${selectedFiat || 'esta moneda'}. <a href="/p2p/payment-methods" style="color:var(--primary-color)">Agregar uno</a></div>`;
            const sellSection = document.getElementById('paymentMethodsSectionSell');
            if (sellSection) sellSection.style.display = 'block';
        }
        const btnSell = document.getElementById('btnSearchBestOffer');
        const btnSellStep4 = document.getElementById('btnSearchBestOfferSell');
        if (btnSell) { btnSell.disabled = true; btnSell.style.opacity = '0.6'; btnSell.style.cursor = 'not-allowed'; }
        if (btnSellStep4) { btnSellStep4.disabled = true; btnSellStep4.style.opacity = '0.6'; btnSellStep4.style.cursor = 'not-allowed'; }

        return;
    }

    // HTML for Buy (Checkboxes - multi selection)
    const html = methods.map(method => {
        const logoHtml = method.logoUrl
            ? `<img src="${method.logoUrl}" alt="${method.displayName}" style="width: 32px; height: 32px; border-radius: 4px; object-fit: contain; background: #f8f9fa;">`
            : `<div style="width: 32px; height: 32px; border-radius: 4px; background: #e9ecef; display: flex; align-items: center; justify-content: center;"><i class="ri-bank-card-line" style="color: #666;"></i></div>`;

        return `
            <div class="payment-method-item" style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" id="qt_pm_${method.id}" value="${method.id}" style="width: auto;" checked>
                ${logoHtml}
                <label for="qt_pm_${method.id}" style="flex: 1; margin: 0; cursor: pointer;">
                    <h5 style="margin: 0;">${method.name}</h5>
                    <p style="margin: 0; font-size: 0.8em; color: #666;">${method.displayName}</p>
                </label>
            </div>
        `;
    }).join('');

    // HTML for Sell (Radio buttons - single selection)
    const htmlSell = methods.map((method, index) => {
        const logoHtml = method.logoUrl
            ? `<img src="${method.logoUrl}" alt="${method.displayName}" style="width: 40px; height: 40px; border-radius: 6px; object-fit: contain; background: #f8f9fa;">`
            : `<div style="width: 40px; height: 40px; border-radius: 6px; background: #e9ecef; display: flex; align-items: center; justify-content: center;"><i class="ri-bank-card-line" style="color: #666; font-size: 20px;"></i></div>`;

        return `
            <div class="payment-method-item" style="display: flex; align-items: center; gap: 12px; background: #fff; padding: 12px; border-radius: 8px; border: 1px solid #dee2e6; cursor: pointer; transition: all 0.2s;" onclick="selectPaymentMethodSell('${method.id}', this)">
                <input type="radio" name="qt_pm_sell" id="qt_pm_sell_${method.id}" value="${method.id}" style="width: auto;" ${index === 0 ? 'checked' : ''}>
                ${logoHtml}
                <label for="qt_pm_sell_${method.id}" style="flex: 1; margin: 0; cursor: pointer;">
                    <h5 style="margin: 0; font-size: 14px; font-weight: 600;">${method.name}</h5>
                    <p style="margin: 0; font-size: 0.8em; color: #666;">${method.displayName}</p>
                </label>
            </div>
        `;
    }).join('');

    const buyContainer = document.getElementById('paymentMethodsListBuy');
    const buyVolatileContainer = document.getElementById('paymentMethodsListBuyVolatile');
    const sellContainer = document.getElementById('paymentMethodsListSell');

    // Ocultar badges de "no hay método" y habilitar botones cuando sí hay métodos
    const buyBadge = document.getElementById('noPaymentMethodsBadgeBuy');
    const buyVolatileBadge = document.getElementById('noPaymentMethodsBadgeBuyVolatile');
    if (buyBadge) buyBadge.style.display = 'none';
    if (buyVolatileBadge) buyVolatileBadge.style.display = 'none';

    // Ocultar badges del paso fiat y habilitar Continuar
    const sellFiatBadge = document.getElementById('noPaymentMethodsBadgeSellFiatStep');
    const buyFiatBadge = document.getElementById('noPaymentMethodsBadgeBuyFiatStep');
    if (sellFiatBadge) sellFiatBadge.style.display = 'none';
    if (buyFiatBadge) buyFiatBadge.style.display = 'none';
    const btnContinueBuy = document.getElementById('btnContinueAfterFiatBuy');
    if (btnContinueBuy) {
        btnContinueBuy.disabled = false;
        btnContinueBuy.style.opacity = '';
        btnContinueBuy.style.cursor = '';
    }

    const btnBuyStable = document.getElementById('btnSearchBestOfferBuyStable');
    const btnBuyVolatile = document.getElementById('btnSearchBestOfferBuyVolatile');
    const btnSell = document.getElementById('btnSearchBestOffer');
    const btnSellStep4 = document.getElementById('btnSearchBestOfferSell');
    if (btnBuyStable) { btnBuyStable.disabled = false; btnBuyStable.style.opacity = ''; btnBuyStable.style.cursor = ''; }
    if (btnBuyVolatile) { btnBuyVolatile.disabled = false; btnBuyVolatile.style.opacity = ''; btnBuyVolatile.style.cursor = ''; }
    if (btnSell) { btnSell.disabled = false; btnSell.style.opacity = ''; btnSell.style.cursor = ''; }
    if (btnSellStep4) { btnSellStep4.disabled = false; btnSellStep4.style.opacity = ''; btnSellStep4.style.cursor = ''; }

    if (buyContainer) {
        buyContainer.innerHTML = html;
        buyContainer.style.display = 'block';
        document.getElementById('paymentMethodsSectionBuy').style.display = 'block';
    }

    if (buyVolatileContainer) {
        buyVolatileContainer.innerHTML = html;
        buyVolatileContainer.style.display = 'block';
        document.getElementById('paymentMethodsSectionBuyVolatile').style.display = 'block';
    }

    if (sellContainer) {
        console.log('[QuickTrade] Rendering Sell payment methods:', methods.length);
        sellContainer.innerHTML = htmlSell;
        const section = document.getElementById('paymentMethodsSectionSell');
        if (section) section.style.display = 'block';

        // Set default selection to first method
        if (methods.length > 0) {
            quickTradeState.selectedPaymentMethodId = methods[0].id;
            // IMPORTANTE: Guardar también en paymentMethodIds para que esté disponible en el request
            quickTradeState.paymentMethodIds = [methods[0].id];
        }
    }
}

// Select payment method for Sell flow
function selectPaymentMethodSell(methodId, element) {
    quickTradeState.selectedPaymentMethodId = methodId;
    // IMPORTANTE: Guardar también en paymentMethodIds para que esté disponible en el request
    quickTradeState.paymentMethodIds = [methodId];

    // Update radio button
    const radio = document.getElementById(`qt_pm_sell_${methodId}`);
    if (radio) radio.checked = true;

    // Visual feedback
    document.querySelectorAll('#paymentMethodsListSell .payment-method-item').forEach(item => {
        item.style.borderColor = '#dee2e6';
        item.style.background = '#fff';
    });
    if (element) {
        element.style.borderColor = '#ee6a3e';
        element.style.background = '#fff5f0';
    }
}

// Ejecutar quick trade (compra)
async function executeQuickTradeBuy() {
    const isStable = quickTradeState.selectedCrypto === 'USDT' || quickTradeState.selectedCrypto === 'USDC';

    let rate = null;

    if (isStable) {
        const rateInput = document.getElementById('quickTradeRateBuy');
        rate = parseFloat(rateInput.value);

        if (!rate || rate <= 0) {
            showAlert('Por favor ingresa una tasa válida', 'error');
            return;
        }
    }

    // Obtener métodos de pago seleccionados
    const paymentMethodsListId = isStable ? 'paymentMethodsListBuy' : 'paymentMethodsListBuyVolatile';
    const selectedCheckboxes = document.querySelectorAll(`#${paymentMethodsListId} input[type="checkbox"]:checked`);
    const paymentMethodIds = Array.from(selectedCheckboxes).map(cb => cb.value);

    // Update state to include selected payment methods
    quickTradeState.paymentMethodIds = paymentMethodIds;

    // NOTE: We are allowing execution even if no methods selected, or we could enforce it.
    // Given the requirement "must allow selecting multiple", let's assume at least one is good practice,
    // but the backend might just search best price if none selected (logic in service).
    // Let's pass what is selected.

    await executeQuickTrade(rate); // Pass rate explicitly
}

// Estado de la orden encontrada en quick trade
let foundQuickTradeOrder = null;

// Estado de la orden encontrada en quick trade


// Estado de la solicitud actual
let currentRequestId = null;
let pollingInterval = null;
let searchStartTime = null;
let searchTimerInterval = null;
let searchPollingInterval = null;

// Ejecutar quick trade (función común) - Crea una P2PRequest
async function executeQuickTrade(rate = null) {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showAlert('Sesión expirada', 'error');
        return;
    }

    // CRITICAL: Prevenir solicitudes duplicadas
    if (window.isExecutingTrade) {
        console.warn('[QuickTrade] Already executing, ignoring duplicate click');
        return;
    }
    // Verificar si hay una solicitud activa, pero permitir crear una nueva si la anterior expiró o fue cancelada
    // Solo bloquear si realmente hay una solicitud en estado LIVE_OPEN
    if (currentRequestId && window.isExecutingTrade) {
        // Verificar el estado de la solicitud antes de bloquear
        try {
            const statusResponse = await fetch(`/api/p2p/requests/${currentRequestId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (statusResponse.ok) {
                const statusData = await statusResponse.json();
                const status = statusData.status || statusData.request?.status;
                // Si la solicitud está expirada, cancelada o completada, permitir nueva búsqueda
                if (status === 'EXPIRED' || status === 'CANCELLED_BY_USER' || status === 'COMPLETED' || status === 'FAILED') {
                    // Limpiar estado y continuar
                    currentRequestId = null;
                    window.isExecutingTrade = false;
                } else {
                    // Solicitud aún activa
                    console.warn('[QuickTrade] Request already active:', currentRequestId);
                    showAlert('Ya tienes una búsqueda en progreso', 'warning');
                    return;
                }
            } else {
                // Si no se puede verificar, limpiar y continuar
                currentRequestId = null;
                window.isExecutingTrade = false;
            }
        } catch (e) {
            // Si hay error al verificar, limpiar y continuar
            console.warn('[QuickTrade] Error checking request status, clearing state:', e);
            currentRequestId = null;
            window.isExecutingTrade = false;
        }
    }

    // Validar datos mínimos
    if (!quickTradeState.amount || quickTradeState.amount <= 0) {
        showAlert('Por favor ingresa un monto válido', 'error');
        return;
    }

    // CRITICAL: Bloquear inmediatamente
    window.isExecutingTrade = true;

    // Deshabilitar TODOS los botones de búsqueda
    const sellBtn = document.querySelector('#quickTradeStep5SellStable .btn-create-order');
    const buyBtn = document.querySelector('#quickTradeStep5BuyFinal .btn-create-order');
    if (sellBtn) sellBtn.disabled = true;
    if (buyBtn) buyBtn.disabled = true;

    // Ocultar modal de orden encontrada si estaba abierto
    closeQuickTradeOrderModal();

    try {
        // 1. Crear la solicitud (POST /api/p2p/requests)
        // Mapear operationType: BUY (Taker Buys Crypto) -> DEPOSIT (Fiat -> Crypto)
        // SELL (Taker Sells Crypto) -> WITHDRAW (Crypto -> Fiat)
        const type = quickTradeState.operationType === 'BUY' ? 'DEPOSIT' : 'WITHDRAW';

        // NOTE: In the backend 'DEPOSIT' means User sends Fiat, receives Crypto. 
        // 'WITHDRAW' means User sends Crypto, receives Fiat.
        // This matches standard P2P flow where "Home" Deposit/Withdraw is from the perspective of the wallet balance.

        // Guardar todos los métodos de pago en metadata para mostrarlos en la zona de cajero
        const metadata = {
            paymentMethodIds: quickTradeState.paymentMethodIds || []
        };

        const payload = {
            type: type,
            cryptoAsset: quickTradeState.selectedCrypto,
            fiatCurrency: quickTradeState.selectedFiat,
            amount: parseFloat(quickTradeState.amount),
            // For SELL: use single selected method, for BUY: use first of multiple
            paymentMethodId: quickTradeState.selectedPaymentMethodId
                || (quickTradeState.paymentMethodIds && quickTradeState.paymentMethodIds.length > 0
                    ? quickTradeState.paymentMethodIds[0]
                    : null),
            price: (rate || quickTradeState.rate) ? parseFloat(rate || quickTradeState.rate) : null,
            metadata: metadata
        };

        console.log('[QuickTrade] Creating request:', payload);

        const response = await fetch('/api/p2p/requests', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            // Mostrar el error del backend de manera clara al usuario
            const errorMessage = data.error || 'Error al crear la solicitud';
            
            // Si es el error de solicitud activa, mostrar mensaje más descriptivo
            if (response.status === 400 && errorMessage.includes('Ya tienes una solicitud')) {
                throw new Error('Ya tienes una solicitud de búsqueda activa. Por favor, espera a que termine o cancélala antes de crear una nueva.');
            } else {
                throw new Error(errorMessage);
            }
        }

        console.log('[QuickTrade] Request created successfully:', data.id);

        // 2. Mostrar modal de espera
        currentRequestId = data.id;
        showSearchingModal(data);

        // 3. Suscribirse via WebSocket para recibir notificación inmediata de match
        subscribeToMyRequest(currentRequestId);

        // 4. Iniciar Polling como fallback (será interrumpido por WebSocket si hay match)
        startPollingRequest(currentRequestId);

    } catch (error) {
        console.error('Error executing quick trade:', error);
        
        // Si es el error de solicitud activa, mostrar modal estilizado
        if (error.message && error.message.includes('Ya tienes una solicitud')) {
            showActiveRequestErrorModal(error.message);
        } else {
            // Para otros errores, usar showAlert
            showAlert(error.message, 'error');
        }

        // Re-habilitar botones
        if (sellBtn) sellBtn.disabled = false;
        if (buyBtn) buyBtn.disabled = false;
        window.isExecutingTrade = false;
    }
}

function showSearchingModal(requestData) {
    const modal = document.getElementById('searchingModal');
    if (!modal) return;

    // Restaurar el contenido del modal a su estado inicial de búsqueda
    // Esto es necesario porque transitionToOrderSearch puede haber modificado el contenido
    const modalContent = document.querySelector('#searchingModal .modal-content');
    if (modalContent) {
        // Verificar si el modal tiene el contenido de "Búsqueda Finalizada" y restaurarlo
        const hasFinishedContent = modalContent.querySelector('.modal-header') || 
                                   modalContent.textContent.includes('No se encontraron ofertas') ||
                                   modalContent.textContent.includes('Búsqueda Finalizada');
        
        if (hasFinishedContent) {
            // Restaurar el HTML original del modal
            modalContent.innerHTML = `
                <h2 style="font-size: 24px; font-weight: 700; color: #1a202c; margin-bottom: 10px;">Buscando compañero</h2>
                <div id="searchingStatusParams" style="color: #718096; margin-bottom: 30px; display: none;"></div>

                <!-- Illustration (Placeholder using Icons/CSS to mimic Cloud+Globe) -->
                <div style="display: flex; align-items: center; justify-content: center; gap: 20px; margin: 40px 0;">
                    <!-- User Cloud -->
                    <div style="position: relative;">
                        <i class="ri-cloud-fill" style="font-size: 80px; color: #ee6a3e;"></i>
                        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -40%); background: #c54e26; border-radius: 4px; padding: 2px 6px;">
                            <i class="ri-money-dollar-circle-fill" style="color: #fff; font-size: 24px;"></i>
                        </div>
                        <div style="margin-top: 10px; font-size: 12px; color: #4a5568;">Tú</div>
                    </div>

                    <!-- Connection Dots -->
                    <div class="connection-dots" style="display: flex; gap: 5px;">
                        <span style="width: 6px; height: 6px; background: #ee6a3e; border-radius: 50%; animation: pulse 1.5s infinite;"></span>
                        <span style="width: 6px; height: 6px; background: #ee6a3e; border-radius: 50%; animation: pulse 1.5s infinite 0.2s;"></span>
                        <span style="width: 6px; height: 6px; background: #ee6a3e; border-radius: 50%; animation: pulse 1.5s infinite 0.4s;"></span>
                    </div>

                    <!-- World/Network -->
                    <div style="position: relative;">
                        <i class="ri-earth-fill" style="font-size: 80px; color: #ee6a3e;"></i>
                        <!-- Markers -->
                        <i class="ri-map-pin-fill" style="position: absolute; top: 20%; left: 30%; color: #fff; font-size: 12px;"></i>
                        <i class="ri-map-pin-fill" style="position: absolute; top: 60%; left: 70%; color: #fff; font-size: 12px;"></i>
                        <div style="margin-top: 10px; font-size: 12px; color: #4a5568;">Mercado de Cajeros BidiPago</div>
                    </div>
                </div>

                <p id="searchingHelpText" style="color: #a0aec0; font-size: 14px; margin-bottom: 30px;">
                    1. Una vez encontrado, los fondos en BidiPago de tu cajero serán retenidos para ti.
                </p>

                <div style="margin-bottom: 20px;">
                    <span id="searchingTimer" style="font-size: 18px; font-weight: 600; color: #ee6a3e;">00:00</span>
                </div>

                <button onclick="cancelSearchRequest()" class="btn-cancel-search"
                    style="background: transparent; border: 1px solid #e53e3e; color: #e53e3e; padding: 10px 30px; border-radius: 20px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                    Cancelar
                </button>
            `;
        }
    }

    modal.style.display = 'flex'; // Use flex to center with the style added in HTML

    // Actualizar UI con info básica
    const statusDiv = document.getElementById('searchingStatusParams');
    if (statusDiv) {
        const typeText = requestData.type === 'DEPOSIT' ? 'Compra' : 'Venta';
        statusDiv.style.display = 'block';
        statusDiv.innerHTML = `
            <strong>Operación:</strong> ${typeText} ${requestData.cryptoAsset}<br>
            <strong>Monto:</strong> ${formatNumber(requestData.amount)}
        `;
    }

    // Help Text Logic for Funds Locking
    const helpText = document.getElementById('searchingHelpText');
    if (helpText) {
        if (requestData.type === 'WITHDRAW') { // SELL (User sends Crypto)
            helpText.textContent = '1. Una vez encontrado, tus fondos serán retenidos en garantía por BidiPago.';
        } else { // BUY (User sends Fiat)
            helpText.textContent = '1. Una vez encontrado, los fondos en BidiPago de tu cajero serán retenidos para ti.';
        }
    }

    // Timer Countdown (2 min = 120 sec)
    searchStartTime = Date.now();
    console.log('[Timer] searchStartTime set:', searchStartTime);

    // Immediately show 02:00
    const timerEl = document.getElementById('searchingTimer');
    if (timerEl) {
        timerEl.textContent = '02:00';
        console.log('[Timer] Initial display set to 02:00');
    }

    // Clear any existing interval
    if (searchTimerInterval) {
        clearInterval(searchTimerInterval);
        searchTimerInterval = null;
    }

    // Start countdown
    searchTimerInterval = setInterval(updateSearchTimer, 1000);
    console.log('[Timer] Interval started, ID:', searchTimerInterval);
}

function updateSearchTimer() {
    console.log('[Timer] updateSearchTimer called, searchStartTime:', searchStartTime);

    if (!searchStartTime) {
        console.warn('[Timer] searchStartTime is null, skipping update');
        return;
    }

    const elapsed = Math.floor((Date.now() - searchStartTime) / 1000);
    const timeLeft = 120 - elapsed;

    console.log('[Timer] elapsed:', elapsed, 'timeLeft:', timeLeft);

    if (timeLeft <= 0) {
        clearInterval(searchTimerInterval);
        searchTimerInterval = null;
        const el = document.getElementById('searchingTimer');
        if (el) el.textContent = "00:00";
        handleSearchTimeout();
        return;
    }

    const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const secs = (timeLeft % 60).toString().padStart(2, '0');
    const el = document.getElementById('searchingTimer');
    if (el) {
        el.textContent = `${mins}:${secs}`;
        console.log('[Timer] Updated display to:', `${mins}:${secs}`);
    } else {
        console.warn('[Timer] Timer element not found!');
    }
}

async function handleSearchTimeout() {
    // Cancel logic - mantener el modal abierto para mostrar el resultado de la búsqueda
    await cancelSearchRequest(true);
    // Advance to Search Orders logic
    transitionToOrderSearch();
}

async function transitionToOrderSearch() {
    // NO mostrar alert aquí, solo actualizar el modal
    // showAlert('Tiempo agotado. Buscando ofertas existentes...', 'info');

    // Asegurar que el modal esté abierto
    const modal = document.getElementById('searchingModal');
    if (modal) {
        modal.style.display = 'flex';
    }

    // Actualizar el contenido del modal para mostrar "Buscando..."
    const modalContent = document.querySelector('#searchingModal .modal-content');
    if (modalContent) {
        const statusDiv = document.getElementById('searchingStatusParams');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <strong>Operación:</strong> ${quickTradeState.operationType === 'BUY' ? 'Compra' : 'Venta'} ${quickTradeState.selectedCrypto}<br>
                <strong>Monto:</strong> ${formatNumber(quickTradeState.amount)}<br>
                <small style="color: #718096;">Buscando ofertas en el mercado interno...</small>
            `;
        }
    }

    const payload = {
        type: quickTradeState.operationType,
        cryptoAsset: quickTradeState.selectedCrypto,
        fiatCurrency: quickTradeState.selectedFiat,
        amount: parseFloat(quickTradeState.amount),
        paymentMethodIds: quickTradeState.paymentMethodIds || []
    };

    try {
        const response = await fetch('/api/p2p/quick-trade/search', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        let data = {};
        try {
            data = await response.json();
        } catch (e) {
            console.warn('Response was not JSON', e);
        }

        if (response.ok && data.order) {
            // Si hay una orden encontrada, mostrar dentro del modal de búsqueda
            // NO cerrar el modal, solo actualizar su contenido
            displayQuickTradeResults([data.order], data.amountToTake, data.fiatAmount, data.cryptoAmount);
        } else {
            // Detener el timer si aún está corriendo
            if (searchTimerInterval) {
                clearInterval(searchTimerInterval);
                searchTimerInterval = null;
            }
            
            // Ocultar el timer y otros elementos de búsqueda
            const timerEl = document.getElementById('searchingTimer');
            if (timerEl) {
                timerEl.style.display = 'none';
            }
            
            const statusDiv = document.getElementById('searchingStatusParams');
            if (statusDiv) {
                statusDiv.style.display = 'none';
            }
            
            const helpText = document.getElementById('searchingHelpText');
            if (helpText) {
                helpText.style.display = 'none';
            }
            
            // Asegurar que el modal esté abierto
            if (modal) {
                modal.style.display = 'flex';
            }
            
            // PHASE 2 MESSAGE: Show in Modal - Actualizar contenido sin cerrar
            if (modalContent) {
                // Mensaje específico para cuando no hay cajeros ni órdenes disponibles
                const errorMessage = response.status === 404 || !response.ok
                    ? 'No hay Cajero Disponible para esta orden, de igual manera tampoco hay ordenes que coincidan con tu solicitud en el Mercado Interno de BidiPago, por favor intenta mas tarde'
                    : 'No se encontraron cajeros ni ofertas disponibles con esa tasa en este momento.';
                
                modalContent.innerHTML = `
                  <div class="modal-header" style="border-bottom:none;">
                       <h5 class="modal-title">Búsqueda Finalizada</h5>
                       <button type="button" class="close" data-dismiss="modal" aria-label="Close" onclick="hideSearchingModal()">
                           <span aria-hidden="true">&times;</span>
                       </button>
                  </div>
                  <div class="modal-body text-center p-4">
                       <div style="font-size: 3rem; color: #718096; margin-bottom: 20px;">
                           <i class="ri-search-eye-line"></i>
                       </div>
                       <h4 style="margin-bottom: 10px; font-weight: 700;">No se encontraron ofertas</h4>
                       <p class="text-muted" style="margin-bottom: 30px;">${errorMessage}</p>
                       
                       <div>
                           <button class="btn btn-secondary" onclick="hideSearchingModal()">Cerrar</button>
                       </div>
                  </div>
               `;
            } else {
                // Fallback si no se encuentra el modal
                const errorMessage = response.status === 404 || !response.ok
                    ? 'No hay Cajero Disponible para esta orden, de igual manera tampoco hay ordenes que coincidan con tu solicitud en el Mercado Interno de BidiPago, por favor intenta mas tarde'
                    : 'No se encontraron cajeros ni ofertas disponibles. Intenta ajustar la tasa.';
                showAlert(errorMessage, 'warning');
            }
        }
    } catch (e) {
        console.error(e);
        
        // Asegurar que el modal esté abierto incluso en caso de error
        if (modal) {
            modal.style.display = 'flex';
        }
        
        // Mostrar error en el modal
        if (modalContent) {
            modalContent.innerHTML = `
              <div class="modal-header" style="border-bottom:none;">
                   <h5 class="modal-title">Error en la Búsqueda</h5>
                   <button type="button" class="close" data-dismiss="modal" aria-label="Close" onclick="hideSearchingModal()">
                       <span aria-hidden="true">&times;</span>
                   </button>
              </div>
              <div class="modal-body text-center p-4">
                   <div style="font-size: 3rem; color: #dc3545; margin-bottom: 20px;">
                       <i class="ri-error-warning-line"></i>
                   </div>
                   <h4 style="margin-bottom: 10px; font-weight: 700;">Error al buscar ofertas</h4>
                   <p class="text-muted" style="margin-bottom: 30px;">Ocurrió un error al buscar ofertas. Por favor, intenta nuevamente.</p>
                   
                   <div>
                       <button class="btn btn-secondary" onclick="hideSearchingModal()">Cerrar</button>
                   </div>
              </div>
           `;
        } else {
            showAlert('Error al buscar ofertas', 'error');
        }
    }
}

function displayQuickTradeResults(orders, amountToTake, fiatAmount, cryptoAmount) {
    if (!orders || orders.length === 0) {
        console.warn('[displayQuickTradeResults] No orders provided');
        return;
    }
    
    const order = orders[0]; // Siempre es un solo orden en quick trade search
    // Mostrar solo nombre y apellido, no el email
    let makerName = 'Usuario';
    if (order.maker?.profile) {
        const firstName = order.maker.profile.firstName || '';
        const lastName = order.maker.profile.lastName || '';
        if (firstName || lastName) {
            makerName = `${firstName} ${lastName}`.trim();
        } else if (order.maker.profile.fullName) {
            makerName = order.maker.profile.fullName;
        }
    }
    
    // Detener el timer si aún está corriendo
    if (searchTimerInterval) {
        clearInterval(searchTimerInterval);
        searchTimerInterval = null;
    }
    
    // Ocultar el timer y otros elementos de búsqueda
    const timerEl = document.getElementById('searchingTimer');
    if (timerEl) {
        timerEl.style.display = 'none';
    }
    
    // Actualizar el contenido del modal de búsqueda con la orden encontrada
    const modal = document.getElementById('searchingModal');
    const modalContent = document.querySelector('#searchingModal .modal-content');
    
    if (!modalContent) {
        console.error('[displayQuickTradeResults] No se encontró el modal de búsqueda');
        return;
    }
    
    // Obtener métodos de pago de la orden si están disponibles
    let paymentMethodsHtml = '';
    if (order.paymentMethods && Array.isArray(order.paymentMethods) && order.paymentMethods.length > 0) {
        paymentMethodsHtml = `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e2e8f0;">
                <p style="margin-bottom: 8px; font-weight: 600; color: #4a5568;">Métodos de Pago:</p>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${order.paymentMethods.map(pm => `
                        <span style="display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.9em;">
                            ${pm.logoUrl ? `<img src="${pm.logoUrl}" style="width: 20px; height: 20px; object-fit: contain;" />` : ''}
                            <span>${pm.bankName || pm.name || pm.type}</span>
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    // Actualizar el contenido del modal
    modalContent.innerHTML = `
        <div style="text-align: center;">
            <div style="font-size: 4rem; color: #10b981; margin-bottom: 20px;">
                <i class="ri-checkbox-circle-line"></i>
            </div>
            <h2 style="font-size: 24px; font-weight: 700; color: #1a202c; margin-bottom: 20px;">¡Orden encontrada!</h2>
            
            <div style="background: #f7fafc; border-radius: 12px; padding: 20px; margin-bottom: 25px; text-align: left;">
                <div style="margin-bottom: 12px;">
                    <span style="color: #718096; font-size: 0.9em;">Vendedor:</span>
                    <div style="font-weight: 600; color: #2d3748; margin-top: 4px;">${makerName}</div>
                </div>
                <div style="margin-bottom: 12px;">
                    <span style="color: #718096; font-size: 0.9em;">Monto Crypto:</span>
                    <div style="font-weight: 600; color: #2d3748; margin-top: 4px;">${formatNumber(cryptoAmount || amountToTake)} ${order.cryptoAsset}</div>
                </div>
                <div style="margin-bottom: 12px;">
                    <span style="color: #718096; font-size: 0.9em;">Tasa:</span>
                    <div style="font-weight: 600; color: #2d3748; margin-top: 4px;">${formatNumber(order.rate)} ${order.fiatCurrency}/${order.cryptoAsset}</div>
                </div>
                <div style="margin-bottom: 12px;">
                    <span style="color: #718096; font-size: 0.9em;">Monto Fiat:</span>
                    <div style="font-weight: 600; color: #2d3748; margin-top: 4px;">${formatNumber(fiatAmount || (cryptoAmount * order.rate))} ${order.fiatCurrency}</div>
                </div>
                ${paymentMethodsHtml}
            </div>
            
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button class="btn btn-primary" onclick="takeQuickTradeOrder('${order.id}', ${amountToTake || cryptoAmount})" 
                    style="padding: 12px 24px; font-weight: 600; border-radius: 8px; min-width: 140px;">
                    Tomar Orden
                </button>
                <button class="btn btn-secondary" onclick="hideSearchingModal()" 
                    style="padding: 12px 24px; font-weight: 600; border-radius: 8px; min-width: 140px;">
                    Cancelar
                </button>
            </div>
        </div>
    `;
    
    // Asegurar que el modal esté visible
    if (modal) {
        modal.style.display = 'flex';
    }
}

// Función para tomar la orden encontrada
async function takeQuickTradeOrder(orderId, amount) {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showAlert('Sesión expirada', 'error');
        return;
    }
    
    try {
        // La ruta correcta es POST /api/p2p/trades (no /api/p2p/orders/:id/take)
        const response = await fetch(`/api/p2p/trades`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                orderId: orderId,
                amount: amount 
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || error.message || 'Error al tomar la orden');
        }
        
        const data = await response.json();
        const tradeId = data.trade?.id || data.tradeId;
        
        if (tradeId) {
            // Redirigir al tradeview
            window.location.href = `/p2p-trade?tradeId=${tradeId}`;
        } else {
            showAlert('Orden tomada exitosamente', 'success');
            // Recargar la página o redirigir
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        }
    } catch (error) {
        console.error('Error taking order:', error);
        showAlert(error.message || 'Error al tomar la orden', 'error');
    }
}

// Hacer función global
window.takeQuickTradeOrder = takeQuickTradeOrder;

async function cancelSearchRequest(keepModalOpen = false) {
    if (!currentRequestId) return;

    const requestIdToCancel = currentRequestId;

    // Desuscribirse de WebSocket primero
    unsubscribeFromMyRequest(requestIdToCancel);

    // Call Cancel API
    const accessToken = localStorage.getItem('accessToken');
    try {
        const response = await fetch(`/api/p2p/requests/${requestIdToCancel}/cancel`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            const data = await response.json();
            console.warn('Cancel response:', data);
        }
    } catch (e) {
        console.error('Error cancelling request:', e);
    }

    stopPolling();
    
    // Solo cerrar el modal si no se debe mantener abierto
    if (!keepModalOpen) {
        const modal = document.getElementById('searchingModal');
        if (modal) modal.style.display = 'none';
    }
    
    currentRequestId = null;
    showAlert('Solicitud cancelada', 'info');
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    if (searchTimerInterval) {
        clearInterval(searchTimerInterval);
        searchTimerInterval = null;
    }
}

function startPollingRequest(requestId) {
    // Only clear existing polling, NOT the timer
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }

    // Poll every 2 seconds
    pollingInterval = setInterval(async () => {
        try {
            const accessToken = localStorage.getItem('accessToken');
            const res = await fetch(`/api/p2p/requests/${requestId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (!res.ok) return; // Retry next tick

            const data = await res.json();
            const status = data.status;

            // Check Status
            if (status === 'IN_TRADE' || status === 'COMPLETED' || status === 'TAKEN') {
                // Match Found!
                stopPolling();
                showAlert('¡Cajero encontrado! Redirigiendo...', 'success');

                // Intentar obtener tradeId de diferentes fuentes
                let tradeId = data.tradeId;
                
                // Si no viene directamente, intentar extraerlo del metadata
                if (!tradeId && data.metadata) {
                    try {
                        const metadata = JSON.parse(data.metadata);
                        tradeId = metadata.tradeId;
                    } catch (e) {
                        console.warn('[P2P Polling] Error parseando metadata:', e);
                    }
                }
                
                // Si aún no hay tradeId, intentar obtenerlo del request completo
                if (!tradeId && data.request && data.request.metadata) {
                    try {
                        const metadata = JSON.parse(data.request.metadata);
                        tradeId = metadata.tradeId;
                    } catch (e) {
                        console.warn('[P2P Polling] Error parseando metadata del request:', e);
                    }
                }

                if (tradeId) {
                    window.location.href = `/p2p-trade?tradeId=${tradeId}`;
                } else {
                    console.error('[P2P Polling] No se pudo obtener tradeId del request. Datos recibidos:', data);
                    showAlert('Error: No se pudo obtener el ID del trade. Por favor, recarga la página.', 'error');
                }
            } else if (status === 'EXPIRED' || status === 'FAILED' || status === 'CANCELLED') {
                stopPolling();
                const modal = document.getElementById('searchingModal');
                if (modal) modal.style.display = 'none';
                showAlert('No se encontró un cajero disponible a tiempo.', 'warning');
            }
            // If LIVE_OPEN, LIVE_CLAIMED, BOOK_MATCH... continue polling.

        } catch (e) {
            console.error('Polling error', e);
        }
    }, 2000);
}

// Funciones obsoletas eliminadas (confirmTakeQuickTradeOrder, showQuickTradeOrderModal)
// El flujo ahora usa executeQuickTrade -> P2PRequest -> Polling


// Mostrar mensaje cuando no hay órdenes disponibles
function showNoOrdersAvailable() {
    const resultDiv = document.getElementById('quickTradeResult');
    if (resultDiv) {
        resultDiv.innerHTML = `
        <div style="background: #fff; border-radius: 16px; padding: 40px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.08); max-width: 600px; margin: 40px auto; border: 1px solid rgba(0,0,0,0.05);">
            <div style="width: 80px; height: 80px; background: rgba(238, 106, 62, 0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 25px;">
                <i class="ri-search-eye-line" style="font-size: 36px; color: #ee6a3e;"></i>
            </div>
            
            <h3 style="font-size: 22px; font-weight: 700; color: #2d3748; margin-bottom: 15px; letter-spacing: -0.5px;">
                No hay ofertas disponibles
            </h3>
            
            <p style="color: #718096; font-size: 16px; line-height: 1.6; margin-bottom: 10px;">
                No se encontraron órdenes que coincidan con tu búsqueda en este momento.
            </p>
            
            <p style="color: #718096; font-size: 15px; line-height: 1.6; margin-bottom: 30px;">
                Puedes crear tu propia orden en el libro de órdenes P2P clásico.
            </p>

            <div style="display: flex; justify-content: center;">
                <button onclick="selectP2PMode('classic')" style="
                    background: #ee6a3e; 
                    color: white; 
                    border: none; 
                    padding: 14px 32px; 
                    border-radius: 12px; 
                    font-weight: 600; 
                    font-size: 15px; 
                    cursor: pointer; 
                    transition: all 0.2s ease;
                    box-shadow: 0 4px 12px rgba(238, 106, 62, 0.25);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 15px rgba(238, 106, 62, 0.35)'" 
                   onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(238, 106, 62, 0.25)'">
                    <i class="ri-file-list-3-line" style="font-size: 18px;"></i>
                    Ir a P2P Clásico - Libro de Órdenes
                </button>
            </div>
        </div>
        `;
        resultDiv.style.display = 'block';
    }
}

// Navegar entre pasos
function goToQuickTradeStep(step) {
    // Ocultar todos los pasos
    document.querySelectorAll('.quick-trade-step').forEach(s => s.style.display = 'none');
    document.getElementById('quickTradeResult').style.display = 'none';

    if (step === 1) {
        document.getElementById('quickTradeStep1').style.display = 'block';
        // Resetear estado
        quickTradeState = {
            operationType: null,
            selectedCrypto: null,
            selectedFiat: null,
            amount: null,
            rate: null,
            userWallets: [],
            userPaymentMethods: []
        };
    } else if (step === 2) {
        if (quickTradeState.operationType === 'SELL') {
            document.getElementById('quickTradeStep2Sell').style.display = 'block';
        } else {
            // BUY: Paso 2 es seleccionar crypto
            document.getElementById('quickTradeStep2Buy').style.display = 'block';
            if (quickTradeState.operationType === 'BUY') {
                loadCryptoAssetsForBuy();
            }
        }
    } else if (step === 3) {
        if (quickTradeState.operationType === 'SELL') {
            document.getElementById('quickTradeStep3Sell').style.display = 'block';
        } else {
            // BUY: Paso 3 es seleccionar fiat (con tasas)
            document.getElementById('quickTradeStep3Buy').style.display = 'block';
            
            // Ocultar botón de continuar al volver atrás (solo mostrar si ya hay fiat seleccionado)
            const continueBtn = document.getElementById('btnContinueAfterFiatBuy');
            if (continueBtn) {
                continueBtn.style.display = quickTradeState.selectedFiat ? 'block' : 'none';
            }
            
            if (quickTradeState.selectedCrypto && quickTradeState.selectedFiat) {
                fetchSuggestedRates(quickTradeState.selectedCrypto, quickTradeState.selectedFiat, 'BUY');
            }
            loadFiatCurrenciesForBuy();
            // Precargar métodos de pago para validación al seleccionar fiat
            loadUserPaymentMethods();
        }
    }
}

// Mostrar modal de tasas sugeridas
async function showSuggestedRatesModal() {
    // Validar que tengamos al menos crypto y fiat seleccionados
    if (!quickTradeState.selectedCrypto) {
        showAlert('Por favor selecciona una criptomoneda primero', 'error');
        return;
    }

    // Si no hay fiat seleccionado, usar el que está en el estado o mostrar selector
    let selectedFiat = quickTradeState.selectedFiat;

    const modal = document.getElementById('suggestedRatesModal');
    const content = document.getElementById('suggestedRatesContent');

    if (modal) modal.style.display = 'block';
    if (content) {
        content.innerHTML = '<div class="loading"><i class="ri-loader-4-line"></i> Cargando tasas...</div>';
    }

    try {
        // Si no hay fiat seleccionado, cargar lista de fiat para que el usuario seleccione
        if (!selectedFiat) {
            const accessToken = localStorage.getItem('accessToken');
            if (!accessToken) return;

            const response = await fetch('/api/p2p/config/fiat-currencies', {
                headers: {
                    'Authorization': `Bearer ${accessToken} `,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                const currencies = data.currencies || [];

                // Mostrar selector de fiat
                if (content) {
                    content.innerHTML = `
        < div style = "margin-bottom: 20px;" >
                            <label><strong>Selecciona la moneda fiat:</strong></label>
                            <select id="modalFiatSelect" class="form-control" style="width: 100%; padding: 10px; margin-top: 10px; border: 1px solid #ddd; border-radius: 5px;">
                                <option value="">Seleccione...</option>
                                ${currencies.map(c => `<option value="${c.code}">${currencyToCountryFlag[c.code] || '🏳️'} ${c.code} - ${c.name}</option>`).join('')}
                            </select>
                        </div >
                        <div style="margin-bottom: 20px;">
                            <label><strong>Selecciona el exchange:</strong></label>
                            <select id="modalExchangeSelect" class="form-control" style="width: 100%; padding: 10px; margin-top: 10px; border: 1px solid #ddd; border-radius: 5px;">
                                <option value="">Todos los exchanges</option>
                                <option value="binancep2p">Binance P2P</option>
                                <option value="okexp2p">OKX P2P</option>
                                <option value="bybitp2p">Bybit P2P</option>
                                <option value="bitgetp2p">Bitget P2P</option>
                                <option value="bingxp2p">BingX P2P</option>
                            </select>
                        </div>
                        <button class="btn-create-order" onclick="loadSuggestedRatesFromModal()" style="width: 100%;">
                            <i class="ri-search-line"></i> Buscar Tasas
                        </button>
    `;
                }
                return;
            }
        }

        // Si ya hay fiat seleccionado, cargar tasas directamente
        await loadSuggestedRates(selectedFiat, null);

    } catch (error) {
        console.error('Error loading suggested rates:', error);
        if (content) {
            content.innerHTML = '<p style="text-align: center; color: #dc3545;">Error al cargar tasas sugeridas</p>';
        }
    }
}

// Cargar tasas sugeridas desde el modal
async function loadSuggestedRatesFromModal() {
    const fiatSelect = document.getElementById('modalFiatSelect');
    const exchangeSelect = document.getElementById('modalExchangeSelect');

    const selectedFiat = fiatSelect.value;
    const selectedExchange = exchangeSelect.value;

    if (!selectedFiat) {
        showAlert('Por favor selecciona una moneda fiat', 'error');
        return;
    }

    await loadSuggestedRates(selectedFiat, selectedExchange);
}

// Función para cargar y mostrar tasas sugeridas
async function loadSuggestedRates(fiat, exchangeFilter) {
    const content = document.getElementById('suggestedRatesContent');
    if (!content) return;

    content.innerHTML = '<div class="loading"><i class="ri-loader-4-line"></i> Cargando tasas...</div>';

    try {
        // Llamar al endpoint sin volumen (siempre usa 0.1)
        const response = await fetch(`/api/external-prices/suggested/${quickTradeState.selectedCrypto}/${fiat}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al obtener tasas sugeridas');
        }

        const data = await response.json();
        const prices = data.prices || {};

        // Filtrar por exchange si se seleccionó uno
        let validPrices = Object.entries(prices).map(([exchange, price]) => ({ exchange, price }));
        if (exchangeFilter) {
            validPrices = validPrices.filter(p => p.exchange === exchangeFilter);
        }

        if (validPrices.length === 0) {
            content.innerHTML = '<p style="text-align: center; color: #666;">No hay tasas disponibles en este momento</p>';
            return;
        }

        const exchangeNames = {
            'binancep2p': 'Binance P2P',
            'okexp2p': 'OKX P2P',
            'bybitp2p': 'Bybit P2P',
            'bitgetp2p': 'Bitget P2P',
            'bingxp2p': 'BingX P2P'
        };

        const operationType = quickTradeState.operationType || 'BUY';
        const priceKey = operationType === 'BUY' ? 'ask' : 'bid';
        const totalKey = operationType === 'BUY' ? 'totalAsk' : 'totalBid';

        // Ordenar por mejor precio
        validPrices.sort((a, b) => {
            const priceA = a.price[priceKey];
            const priceB = b.price[priceKey];
            return operationType === 'BUY' ? priceA - priceB : priceB - priceA;
        });

        const typeLabels = {
            'BANK_TRANSFER': 'Transferencia Bancaria',
            'PAGO_MOVIL': 'Pago Móvil',
            'PAYPAL': 'PayPal',
            'ZELLE': 'Zelle',
            'BANESCO_PANAMA': 'Banesco Panamá',
            'WALLY_TECH': 'Wally Tech',
            'ZINLI': 'Zinli'
        };

        const flag = currencyToCountryFlag[fiat] || '🏳️';

        content.innerHTML = `
            <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
                <p><strong>Criptomoneda:</strong> ${quickTradeState.selectedCrypto}</p>
                <p><strong>Moneda Fiat:</strong> ${flag} ${fiat}</p>
                <p style="color: #666; font-size: 0.9rem;">Volumen de referencia: 0.1</p>
            </div>
            <div style="margin-bottom: 15px;">
                <label><strong>Filtrar por Exchange:</strong></label>
                <select id="filterExchangeSelect" class="form-control" style="width: 100%; padding: 10px; margin-top: 10px; border: 1px solid #ddd; border-radius: 5px;" onchange="filterRatesByExchange(this.value)">
                    <option value="">Todos los exchanges</option>
                    <option value="binancep2p">Binance P2P</option>
                    <option value="okexp2p">OKX P2P</option>
                    <option value="bybitp2p">Bybit P2P</option>
                    <option value="bitgetp2p">Bitget P2P</option>
                    <option value="bingxp2p">BingX P2P</option>
                </select>
            </div>
            <table class="suggested-rates-table">
                <thead>
                    <tr>
                        <th>Exchange</th>
                        <th>Tasa (${fiat}/${quickTradeState.selectedCrypto})</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody id="ratesTableBody">
                    ${validPrices.map(result => `
                        <tr data-exchange="${result.exchange}">
                            <td><strong>${exchangeNames[result.exchange] || result.exchange}</strong></td>
                            <td>${formatNumber(result.price[priceKey])}</td>
                            <td>${formatNumber(result.price[totalKey])} ${operationType === 'BUY' ? quickTradeState.selectedCrypto : fiat}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
                <h4>Métodos de Pago Disponibles:</h4>
                ${quickTradeState.userPaymentMethods.length > 0 ?
                quickTradeState.userPaymentMethods.filter(m => m.isActive).map(m => `
                        <div style="margin-top: 10px;">
                            <strong>${m.name}</strong> - ${typeLabels[m.type] || m.type}
                        </div>
                    `).join('') :
                '<p style="color: #666;">No tienes métodos de pago configurados. <a href="/p2p/payment-methods">Agregar</a></p>'
            }
            </div>
        `;

        // Guardar todas las tasas para el filtro
        window.allRates = validPrices;

    } catch (error) {
        console.error('Error loading suggested rates:', error);
        if (content) {
            content.innerHTML = '<p style="text-align: center; color: #dc3545;">Error al cargar tasas sugeridas</p>';
        }
    }
}

// Filtrar tasas por exchange
function filterRatesByExchange(exchange) {
    const tbody = document.getElementById('ratesTableBody');
    if (!tbody) return;

    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
        if (!exchange || row.dataset.exchange === exchange) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

// Hacer función global
window.filterRatesByExchange = filterRatesByExchange;
window.loadSuggestedRatesFromModal = loadSuggestedRatesFromModal;

// Cerrar modal de tasas sugeridas
function closeSuggestedRatesModal() {
    const modal = document.getElementById('suggestedRatesModal');
    if (modal) {
        $('#suggestedRatesModal').modal('hide');
    }
}

// Hacer funciones globales
window.selectQuickTradeOperation = selectQuickTradeOperation;
window.selectCryptoForSell = selectCryptoForSell;
window.selectCryptoForBuy = selectCryptoForBuy;
window.selectFiatForSell = selectFiatForSell;
window.selectFiatForBuy = selectFiatForBuy;
window.continueQuickTradeSell = continueQuickTradeSell;
window.continueQuickTradeBuy = continueQuickTradeBuy;
window.continueAfterFiatBuy = continueAfterFiatBuy;
window.executeQuickTradeSell = executeQuickTradeSell;
window.executeQuickTradeBuy = executeQuickTradeBuy;
window.goToQuickTradeStep = goToQuickTradeStep;
window.showSuggestedRatesModal = showSuggestedRatesModal;
window.closeSuggestedRatesModal = closeSuggestedRatesModal;
window.validateSellAmount = validateSellAmount;
window.selectCreateOrderType = selectCreateOrderType;
window.selectCryptoForCreateOrderSell = selectCryptoForCreateOrderSell;
window.selectCryptoForCreateOrderBuy = selectCryptoForCreateOrderBuy;
window.selectFiatForCreateOrder = selectFiatForCreateOrder;
window.continueCreateOrder = continueCreateOrder;
window.submitCreateOrder = submitCreateOrder;
window.goToCreateOrderStep = goToCreateOrderStep;
window.toggleSuggestedRatesCollapse = toggleSuggestedRatesCollapse;
window.validateMinMaxAmounts = validateMinMaxAmounts;

// ============================================
// Actualizar creación de orden para usar métodos de pago
// ============================================

let userPaymentMethods = [];

// NOTE: loadUserPaymentMethods is defined earlier in the file (around line 3194)
// and handles both Quick Trade (renderPaymentMethods) and Order creation (populatePaymentMethodsSelect)

function populatePaymentMethodsSelect() {
    const select = document.getElementById('orderPaymentMethods');
    if (!select) return;

    if (userPaymentMethods.length === 0) {
        select.innerHTML = '<option value="">No tienes métodos de pago. <a href="/p2p/payment-methods">Agregar</a></option>';
        return;
    }

    const options = userPaymentMethods.map(method => {
        return `<option value="${method.id}">${method.name} (${method.type})</option>`;
    }).join('');

    select.innerHTML = '<option value="">Seleccione métodos de pago...</option>' + options;
    select.setAttribute('multiple', 'multiple');
}

// Cargar métodos de pago al inicializar
document.addEventListener('DOMContentLoaded', () => {
    loadUserPaymentMethods();
});

// ============================================
// Funciones para Mis Órdenes P2P
// ============================================

// Cargar órdenes del usuario
// Cargar órdenes del usuario
async function loadMyOrders(mode) { // mode: 'book' (Maker Only) or 'history' (Maker + Taker). Si no se pasa, se infiere por la pestaña activa.
    if (mode !== 'book' && mode !== 'history') {
        const bookActive = document.querySelector('#tabBtnBook.active');
        const myOrdersVisible = document.getElementById('cashierMyOrdersContent') && document.getElementById('cashierMyOrdersContent').style.display !== 'none';
        mode = (bookActive && myOrdersVisible) ? 'book' : 'history';
    }
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        return;
    }

    // Hide Title if in Cashier Mode
    const myOrdersView = document.getElementById('myOrdersView');
    if (myOrdersView) {
        const titleHandler = myOrdersView.querySelector('.p2p-header h1');
        if (titleHandler) {
            // If we are inside cashierMyOrdersContent, hide the title
            if (myOrdersView.parentNode.id === 'cashierMyOrdersContent') {
                titleHandler.style.display = 'none';
            } else {
                titleHandler.style.display = 'block';
            }
        }
    }

    const filterType = document.getElementById('myOrdersFilterType')?.value || '';
    const filterStatus = document.getElementById('myOrdersFilterStatus')?.value || '';

    const params = new URLSearchParams();
    params.append('my', 'true'); // Indicar que queremos las órdenes del usuario
    if (filterType) params.append('type', filterType);
    if (filterStatus) params.append('status', filterStatus);
    params.append('limit', '100'); // Cargar más órdenes para el usuario

    // Reset history info if loading new data
    if (mode === 'history') {
        historyPage = 1;
    }

    const ordersList = document.getElementById('myOrdersList');
    if (ordersList) {
        ordersList.innerHTML = `
            <div class="empty-state">
                <i class="ri-loader-4-line"></i>
                <p>Cargando tus órdenes...</p>
            </div>
        `;
    }

    try {
        const response = await fetch(`/api/p2p/orders?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al cargar tus órdenes');
        }

        const data = await response.json();
        const orders = data.orders || [];

        // Cargar trades para órdenes tomadas
        const tradesResponse = await fetch('/api/p2p/trades?role=all&limit=100', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        let trades = [];
        if (tradesResponse.ok) {
            const tradesData = await tradesResponse.json();
            trades = tradesData.trades || [];
        }

        // Asegurarse de que currentUserId esté cargado
        if (!currentUserId) {
            await loadCurrentUser();
        }

        renderMyOrders(orders, trades, mode);

    } catch (error) {
        console.error('Error loading my orders:', error);
        showAlert('Error al cargar tus órdenes', 'error', 'myOrdersAlertContainer');
        if (ordersList) {
            ordersList.innerHTML = `
                <div class="empty-state">
                    <i class="ri-error-warning-line"></i>
                    <p>Error al cargar tus órdenes</p>
                </div>
            `;
        }
    }
}

// Renderizar órdenes del usuario
function renderMyOrders(orders, trades, mode = 'history') {
    // Update Global Cache for Pagination
    lastOrders = orders;
    lastTrades = trades;

    const ordersList = document.getElementById('myOrdersList');
    if (!ordersList) return;

    // Crear un mapa de trades por orderId para acceso rápido
    const tradesByOrderId = {};
    trades.forEach(trade => {
        if (trade.order && trade.order.id) {
            const orderId = trade.order.id;
            if (!tradesByOrderId[orderId]) {
                tradesByOrderId[orderId] = trade;
            } else {
                const existingTrade = tradesByOrderId[orderId];
                const isExistingActive = existingTrade.status !== 'SETTLED' && existingTrade.status !== 'CANCELLED';
                const isCurrentActive = trade.status !== 'SETTLED' && trade.status !== 'CANCELLED';

                if (isCurrentActive && !isExistingActive) {
                    tradesByOrderId[orderId] = trade;
                } else if (isCurrentActive === isExistingActive) {
                    const existingDate = new Date(existingTrade.createdAt);
                    const currentDate = new Date(trade.createdAt);
                    if (currentDate > existingDate) {
                        tradesByOrderId[orderId] = trade;
                    }
                }
            }
        }
    });

    const currentUserIdStr = String(currentUserId);

    // 1. Trades where I am Taker (Orders created by others)
    const takerTrades = trades.filter(trade => {
        if (!trade.order || !trade.order.maker || !trade.taker) return false;

        // If I am Maker, this is handled in orders loop (Maker Order)
        // If I am Taker, this is a Taker Trade.

        const takerId = String(trade.taker.id || trade.taker);
        const makerId = String(trade.order.maker.id || trade.order.maker);

        // I am Taker AND I am NOT Maker (Logic check)
        return takerId === currentUserIdStr && makerId !== currentUserIdStr;
    });

    // 2. Orders where I am Maker (My Created Orders)
    // These come from the 'orders' array (fetched with my=true)
    // We already have them.

    let displayItems = [];
    let totalPages = 1;

    if (mode === 'book') {
        // "Mi Libro de Órdenes": ONLY Maker Orders.
        // Show all orders where I am maker.
        // Filter out Taker Trades entirely.

        const myMakerOrders = orders.filter(order => {
            const makerId = String(order.maker?.id || order.maker || '');
            return makerId === currentUserIdStr;
        });

        // Map to display structure
        displayItems = myMakerOrders.map(order => ({ type: 'ORDER', data: order }));

    } else {
        // "Historial": Everything (Maker Orders + Taker Trades)

        // Helper to avoid duplicates if an order is in both lists? 
        // Requests user made -> Taker Trades.
        // Offers user made -> Maker Orders.

        const myMakerOrders = orders.filter(order => {
            const makerId = String(order.maker?.id || order.maker || '');
            return makerId === currentUserIdStr;
        });

        const orderItems = myMakerOrders.map(o => ({ type: 'ORDER', data: o }));
        const tradeItems = takerTrades.map(t => ({ type: 'TRADE', data: t })); // Trades where I am taker

        displayItems = [...orderItems, ...tradeItems];

        // Sort by date descending
        displayItems.sort((a, b) => {
            const dateA = new Date(a.data.createdAt);
            const dateB = new Date(b.data.createdAt);
            return dateB - dateA;
        });

        // Pagination Logic
        if (mode === 'history') {
            totalPages = Math.ceil(displayItems.length / HISTORY_ITEMS_PER_PAGE);
            if (totalPages < 1) totalPages = 1;

            const startIndex = (historyPage - 1) * HISTORY_ITEMS_PER_PAGE;
            const endIndex = startIndex + HISTORY_ITEMS_PER_PAGE;
            // Slice items for current page
            displayItems = displayItems.slice(startIndex, endIndex);
        }
    }

    if (displayItems.length === 0) {
        const emptyText = mode === 'book' ? 'No tienes órdenes P2P creadas' : 'No tienes historial de órdenes o trades';
        const createBtn = mode === 'book' ? `
            <button class="btn-create-order" onclick="showCreateOrderModal()" style="margin-top: 20px; padding: 10px 25px; width: auto; display: inline-flex; align-items: center; justify-content: center;">
                <i class="ri-add-line" style="margin-right:5px;"></i> Crear Primera Orden
            </button>
        ` : '';

        ordersList.innerHTML = `
            <div class="empty-state">
                <i class="ri-file-list-3-line"></i>
                <p>${emptyText}</p>
                ${createBtn}
            </div>
        `;
        return;
    }

    const ordersHtml = displayItems.map(item => {
        const isTradeItem = item.type === 'TRADE';
        const entity = item.data;

        let order, trade;
        if (isTradeItem) {
            trade = entity;
            order = entity.order;
        } else {
            order = entity;
            trade = tradesByOrderId[order.id];
        }

        if (!order) return '';

        const orderType = order.type === 'BUY' ? 'Comprar' : 'Vender';
        const orderTypeClass = order.type === 'BUY' ? 'buy' : 'sell';
        const orderTypeIcon = order.type === 'BUY' ? 'ri-shopping-cart-line' : 'ri-money-dollar-circle-line';

        // Effective Status Logic
        const effectiveStatus = isTradeItem ? trade.status : order.status;
        let statusBadge = '';
        let statusClass = '';

        switch (effectiveStatus) {
            case 'PENDING':
                statusBadge = '<span class="badge badge-warning" style="margin-left: 8px;">Pendiente</span>';
                statusClass = 'pending';
                break;
            case 'TAKEN':
                statusBadge = '<span class="badge badge-success">Tomada</span>';
                statusClass = 'taken';
                break;
            case 'WAITING_PAYMENT':
                statusBadge = '<span class="badge badge-warning">Esperando Pago</span>';
                statusClass = 'waiting';
                break;
            case 'PAYMENT_CONFIRMED':
                statusBadge = '<span class="badge badge-info">Pago Confirmado</span>';
                statusClass = 'confirmed';
                break;
            case 'SETTLED':
                statusBadge = '<span class="badge badge-success">Liquidada</span>';
                statusClass = 'settled';
                break;
            case 'DISPUTED':
                statusBadge = '<span class="badge badge-danger">En Disputa</span>';
                statusClass = 'disputed';
                break;
            case 'CANCELLED':
                statusBadge = '<span class="badge badge-secondary">Cancelada</span>';
                statusClass = 'cancelled';
                break;
            case 'EXPIRED':
                statusBadge = '<span class="badge badge-danger">Expirada</span>';
                statusClass = 'expired';
                break;
            default:
                statusBadge = `<span class="badge">${effectiveStatus}</span>`;
        }

        const hasActiveTrade = trade && trade.status !== 'SETTLED' && trade.status !== 'CANCELLED';
        const hasSettledTrade = trade && trade.status === 'SETTLED';

        // Role Badge
        let roleBadge = '';
        if (mode === 'history') {
            if (isTradeItem) {
                roleBadge = '<span class="badge badge-info" style="margin-left:5px; background:#17a2b8;">Tomador de la Orden</span>';
            } else {
                roleBadge = '<span class="badge badge-primary" style="margin-left:5px; background:#007bff;">Creador de la Orden</span>';
            }
        }

        // Action Buttons
        let actionButtons = '';

        // 1. Cancel Order (Only Maker, PENDING, No Active Trade)
        if (!isTradeItem && order.status === 'PENDING' && !hasActiveTrade) {
            actionButtons = `
                <button class="btn-cancel-order" onclick="cancelMyOrder('${order.id}')" style="background: #dc3545; color: #fff; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer;">
                    <i class="ri-close-line"></i> Cancelar
                </button>
            `;
        }

        // 2. View Trade / Chat
        let showTradeBtn = false;
        if (isTradeItem) {
            showTradeBtn = true;
        } else {
            if (hasActiveTrade || hasSettledTrade || order.status === 'TAKEN' || order.status === 'SETTLED') {
                showTradeBtn = true;
            }
        }

        if (showTradeBtn && trade && trade.id) {
            let btnStyle = hasActiveTrade ? 'background: #ee6a3e; color: #fff;' : 'background: #6c757d; color: #fff;';
            if (trade.status === 'CANCELLED') btnStyle = 'background: #6c757d; color: #fff;';

            actionButtons += `
                <button class="btn-view-trade" onclick="openTradeView('${trade.id}')" style="${btnStyle} border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; margin-left: 10px;">
                    <i class="ri-message-3-line"></i> Ver Trade / Chat
                </button>
            `;
        }

        const date = new Date(entity.createdAt).toLocaleString();
        const makerName = order.maker ? (order.maker.alias || order.maker.email || 'Usuario') : 'Yo';
        const displayMaker = isTradeItem ? makerName : 'Yo';

        let cryptoAmountVal, fiatAmountVal;

        if (isTradeItem) {
            cryptoAmountVal = trade.cryptoAmount;
            fiatAmountVal = trade.fiatAmount;
        } else {
            // For P2P v2:
            // SELL Orders: order.amount is Crypto.
            // BUY Orders: order.amount is Fiat (VES).
            if (order.type === 'BUY') {
                fiatAmountVal = order.amount;
                cryptoAmountVal = order.amount / order.rate;
            } else {
                cryptoAmountVal = order.amount;
                fiatAmountVal = order.totalFiatAmount || (order.amount * order.rate);
            }
        }

        // Expires text for Maker Orders
        let expiresText = '';
        if (!isTradeItem && order.status === 'PENDING' && order.expiresAt) {
            const expiresAt = new Date(order.expiresAt);
            if (expiresAt < new Date()) {
                expiresText = 'Expirada';
            } else {
                expiresText = `Expira: ${expiresAt.toLocaleString()}`;
            }
        }

        // Indicador de orden parcial (Tomada/Liquidada): "50 de 100 originales"
        // O remanente (Cancelada): "50 - remanente de 100 originales"
        let partialIndicator = '';
        if (order.maker) {
            const makerId = String(order.maker.id || order.maker || '');
            const ourAmount = order.type === 'BUY' ? Number(order.amount) / Number(order.rate) : Number(order.amount);
            // Buscar orden "hermana" (mismo maker, tasa, crypto/fiat) creada después
            const siblingOrder = orders.find(o => {
                if (!o || o.id === order.id) return false;
                const oMakerId = String(o.maker?.id || o.maker || '');
                if (oMakerId !== makerId) return false;
                if (o.cryptoAsset !== order.cryptoAsset || o.fiatCurrency !== order.fiatCurrency || Math.abs(Number(o.rate) - Number(order.rate)) > 0.001) return false;
                const sibAmount = order.type === 'BUY' ? Number(o.amount) / Number(o.rate) : Number(o.amount);
                if (Math.abs(sibAmount - ourAmount) > 0.00000001) return false;
                return new Date(o.createdAt).getTime() !== new Date(order.createdAt).getTime();
            });
            if (siblingOrder) {
                const siblingTrade = tradesByOrderId[siblingOrder.id];
                let originalCrypto = 0;
                if (trade && trade.status === 'SETTLED') {
                    originalCrypto = Number(trade.cryptoAmount) + (order.type === 'BUY' ? Number(siblingOrder.amount) / Number(order.rate) : Number(siblingOrder.amount));
                    partialIndicator = ` <span style="font-size: 0.8em; color: #666;">(parcial: ${parseFloat(cryptoAmountVal).toFixed(2)} de ${originalCrypto.toFixed(2)} ${order.cryptoAsset})</span>`;
                } else if (effectiveStatus === 'CANCELLED' && siblingTrade && siblingTrade.status === 'SETTLED') {
                    originalCrypto = Number(siblingTrade.cryptoAmount) + (order.type === 'BUY' ? Number(order.amount) / Number(order.rate) : Number(order.amount));
                    partialIndicator = ` <span style="font-size: 0.8em; color: #666;">(remanente de ${originalCrypto.toFixed(2)} ${order.cryptoAsset})</span>`;
                }
            }
        }

        const isExpanded = false;
        const accordionId = `order-accordion-${isTradeItem ? 'trade' : 'order'}-${entity.id}`;
        const bodyId = `order-body-${isTradeItem ? 'trade' : 'order'}-${entity.id}`;
        const iconId = `order-icon-${isTradeItem ? 'trade' : 'order'}-${entity.id}`;

        // ============================================
        // VISTA 1: MI LIBRO DE ÓRDENES (Simple Card)
        // ============================================
        if (mode === 'book') {
            return `
            <div class="order-card ${statusClass}">
                <div class="order-header">
                    <div style="display: flex; align-items: center;">
                        <i class="${orderTypeIcon} ${orderTypeClass}" style="font-size: 1.2rem; margin-right: 10px;"></i>
                        <span class="order-type ${orderTypeClass}">
                            ${orderType} ${order.cryptoAsset}
                            ${isTradeItem ? '(Tomada)' : ''}
                        </span>
                        ${roleBadge}
                        ${statusBadge}
                    </div>
                </div>
                <div class="order-details">
                    <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #666; font-size: 0.9em;">Monto:</span>
                        <span style="font-weight: 600; color: #333;">${parseFloat(cryptoAmountVal).toFixed(8)} ${order.cryptoAsset} ≈ ${parseFloat(fiatAmountVal).toFixed(2)} ${order.fiatCurrency}${partialIndicator}</span>
                    </div>
                    <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #666; font-size: 0.9em;">Tasa:</span>
                        <span style="font-weight: 600; color: #333;">${parseFloat(order.rate).toFixed(2)} ${order.fiatCurrency}/${order.cryptoAsset}</span>
                    </div>
                    
                    <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #666; font-size: 0.9em;">Métodos de Pago:</span>
                        <div style="text-align: right; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px;">
                            ${(() => {
                    if (!Array.isArray(order.paymentMethods) || order.paymentMethods.length === 0) return '<span style="color: #999; font-size: 0.9em;">--</span>';

                    return order.paymentMethods.map(pm => {
                        const def = paymentDefinitions.find(d => d.code === pm.type);
                        const logoUrl = pm.logoUrl || (def ? def.logoUrl : null);

                        // Mostrar nombre de la definición (ej. Pago Móvil) cuando exista; si no, el nombre del método del usuario
                        const displayLabel = pm.bankName || pm.name;
                        let content = `<i class="ri-bank-card-line"></i> ${displayLabel}`;
                        let style = 'background: #f8f9fa; color: #333; border: 1px solid #ddd;';

                        if (logoUrl) {
                            content = `<img src="${logoUrl}" alt="${displayLabel}" style="height: 16px; margin-right: 4px; vertical-align: middle;"> ${displayLabel}`;
                            style = 'background: #fff; color: #333; border: 1px solid #ddd;';
                        } else {
                            const pmStyles = {
                                'BANK_TRANSFER': { icon: 'ri-bank-card-line', color: '#007bff', bg: '#e7f1ff' },
                                'PAGO_MOVIL': { icon: 'ri-smartphone-line', color: '#6f42c1', bg: '#f3e5f5' },
                                'ZELLE': { icon: 'ri-shuffle-line', color: '#6610f2', bg: '#ede7f6' },
                                'PAYPAL': { icon: 'ri-paypal-line', color: '#003087', bg: '#e3f2fd' },
                                'BINANCE_PAY': { icon: 'ri-exchange-funds-line', color: '#f3ba2f', bg: '#fff8e1' },
                                'default': { icon: 'ri-wallet-3-line', color: '#666', bg: '#f8f9fa' }
                            };
                            const s = pmStyles[pm.type] || pmStyles['default'];
                            content = `<i class="${s.icon}"></i> ${displayLabel}`;
                            style = `background: ${s.bg}; color: ${s.color}; border: 1px solid ${s.color}20;`;
                        }

                        return `<span class="badge" style="display: inline-flex; align-items: center; gap: 3px; padding: 4px 8px; border-radius: 4px; font-weight: 500; ${style}">
                                        ${content}
                                    </span>`;
                    }).join('');
                })()}
                        </div>
                    </div>
                    <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #666; font-size: 0.9em;">Creado:</span>
                        <span style="color: #888; font-size: 0.9em;">${date}</span>
                    </div>
                    ${expiresText ? `<div class="detail-row" style="color: #dc3545; font-size: 0.85em; text-align: right; margin-top: 5px;"><span>${expiresText}</span></div>` : ''}
                </div>
                <div class="order-actions" style="margin-top: 15px; display: flex; justify-content: flex-end;">
                    ${actionButtons}
                </div>
            </div>`;
        } else {
            // ============================================
            // VISTA 2: HISTORIAL (Accordion View)
            // ============================================

            // Determinar nombre a mostrar (contraparte = quien tomó la orden, o "Pendiente" si nadie la ha tomado)
            let counterpartyName;
            if (!isTradeItem && order.status === 'PENDING') {
                counterpartyName = 'Pendiente'; // Mi orden sin tomador aún
            } else if (!isTradeItem && trade && trade.taker) {
                // Mi orden con trade: contraparte es el taker
                const taker = trade.taker;
                const profile = taker.profile || taker;
                counterpartyName = (profile.firstName || profile.lastName)
                    ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim()
                    : (taker.alias || (taker.email ? taker.email.split('@')[0] : 'Usuario'));
            } else {
                // Trade donde yo soy taker: contraparte es el maker
                counterpartyName = displayMaker;
                if (mode !== 'book' && displayMaker !== 'Yo' && order.maker) {
                    const m = order.maker;
                    const profile = m.profile || m;
                    counterpartyName = (profile.firstName || profile.lastName)
                        ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim()
                        : (m.alias || (m.email ? m.email.split('@')[0] : 'Usuario'));
                }
            }

            // Lógica de Métodos de Pago:
            // Para Trades (especialmente tomados/liquidados), el método de pago efectivo suele estar en 'trade.paymentMethodId' o similar,
            // pero la UI busca 'order.paymentMethods'. 
            // Si es un Trade, a veces la info de pago está en el objeto trade o se debe inferir.
            // Si order.paymentMethods está vacío o null, intentamos usar los del trade si existen (depende de backend).
            // FIX: Asegurar que sea array.
            let paymentMethodsToRender = [];
            if (Array.isArray(order.paymentMethods) && order.paymentMethods.length > 0) {
                paymentMethodsToRender = order.paymentMethods;
            } else if (isTradeItem && trade && trade.paymentMethod) {
                // Si el trade tiene un paymentMethod específico (objeto), usémoslo
                paymentMethodsToRender = [trade.paymentMethod];
            } else if (isTradeItem && trade && trade.paymentMethodId) {
                // Si solo tiene ID, no podemos renderizar mucho sin buscar la def, pero evitamos crash
                // Intentar buscar en definiciones si tenemos el tipo
            }

            return `
            <div class="order-card ${statusClass}" style="padding: 0; overflow: hidden;">
                <!-- Header (Summary) - Clickable -->
                <div class="order-header" onclick="document.getElementById('${bodyId}').style.display = document.getElementById('${bodyId}').style.display === 'none' ? 'block' : 'none'; document.getElementById('${iconId}').classList.toggle('ri-arrow-down-s-line'); document.getElementById('${iconId}').classList.toggle('ri-arrow-up-s-line');" style="cursor: pointer; padding: 15px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.02);">
                    <div style="display: flex; align-items: center; flex: 1;">
                        <i class="${orderTypeIcon} ${orderTypeClass}" style="font-size: 1.2rem; margin-right: 15px;"></i>
                        <div style="display: flex; flex-direction: column;">
                            <span class="order-type ${orderTypeClass}" style="margin-bottom: 2px;">
                                ${orderType} ${order.cryptoAsset}
                                ${isTradeItem ? '(Tomada)' : ''}
                            </span>
                            <span style="font-size: 0.85em; color: #666;">
                                <span style="font-weight: 500; color: #666; margin-right: 4px;">Monto:</span>${parseFloat(cryptoAmountVal).toFixed(8)} ${order.cryptoAsset} ≈ ${parseFloat(fiatAmountVal).toFixed(2)} ${order.fiatCurrency}${partialIndicator}
                            </span>
                        </div>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 10px;">
                        ${roleBadge}
                        ${statusBadge}
                        <i id="${iconId}" class="ri-arrow-down-s-line" style="font-size: 1.5rem; color: #666;"></i>
                    </div>
                </div>

                <!-- Body (Details) - Hidden by default -->
                <div id="${bodyId}" class="order-details" style="display: none; padding: 15px; border-top: 1px solid #eee; background: #fff;">
                    
                    <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #666; font-size: 0.9em;">Tasa de Cambio:</span>
                        <span style="font-weight: 600; color: #333;">${parseFloat(order.rate).toFixed(2)} ${order.fiatCurrency}/${order.cryptoAsset}</span>
                    </div>

                    <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #666; font-size: 0.9em;">Contraparte:</span>
                        <span style="font-weight: 600; color: #333;">${counterpartyName}</span>
                    </div>
                    
                    <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #666; font-size: 0.9em;">Métodos de Pago:</span>
                        <div style="text-align: right; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px;">
                            ${(() => {
                    if (!Array.isArray(paymentMethodsToRender) || paymentMethodsToRender.length === 0) return '<span style="color: #999; font-size: 0.9em;">--</span>';

                    return paymentMethodsToRender.map(pm => {
                        const def = paymentDefinitions.find(d => d.code === pm.type);
                        const logoUrl = pm.logoUrl || (def ? def.logoUrl : null);
                        const displayLabel = pm.bankName || pm.name;
                        let content = `<i class="ri-bank-card-line"></i> ${displayLabel}`;
                        let style = 'background: #f8f9fa; color: #333; border: 1px solid #ddd;';

                        if (logoUrl) {
                            content = `<img src="${logoUrl}" alt="${displayLabel}" style="height: 16px; margin-right: 4px; vertical-align: middle;"> ${displayLabel}`;
                            style = 'background: #fff; color: #333; border: 1px solid #ddd;';
                        } else {
                            const pmStyles = {
                                'BANK_TRANSFER': { icon: 'ri-bank-card-line', color: '#007bff', bg: '#e7f1ff' },
                                'PAGO_MOVIL': { icon: 'ri-smartphone-line', color: '#6f42c1', bg: '#f3e5f5' },
                                'ZELLE': { icon: 'ri-shuffle-line', color: '#6610f2', bg: '#ede7f6' },
                                'PAYPAL': { icon: 'ri-paypal-line', color: '#003087', bg: '#e3f2fd' },
                                'BINANCE_PAY': { icon: 'ri-exchange-funds-line', color: '#f3ba2f', bg: '#fff8e1' },
                                'default': { icon: 'ri-wallet-3-line', color: '#666', bg: '#f8f9fa' }
                            };
                            const s = pmStyles[pm.type] || pmStyles['default'];
                            content = `<i class="${s.icon}"></i> ${displayLabel}`;
                            style = `background: ${s.bg}; color: ${s.color}; border: 1px solid ${s.color}20;`;
                        }

                        return `<span class="badge" style="display: inline-flex; align-items: center; gap: 3px; padding: 4px 8px; border-radius: 4px; font-weight: 500; ${style}">
                                        ${content}
                                    </span>`;
                    }).join('');
                })()}
                        </div>
                    </div>
                    
                    <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #666; font-size: 0.9em;">Creado:</span>
                        <span style="color: #888; font-size: 0.9em;">${date}</span>
                    </div>
                    
                    ${expiresText ? `<div class="detail-row" style="color: #dc3545; font-size: 0.85em; text-align: right; margin-top: 5px;"><span>${expiresText}</span></div>` : ''}

                    <!-- Action Buttons in Expanded View -->
                    ${actionButtons ? `
                    <div class="order-actions" style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #eee; display: flex; justify-content: flex-end;">
                        ${actionButtons}
                    </div>` : ''}
                </div>
            </div>`;
        }
    }).join('');

    // Si estamos en modo 'book', agregamos el botón flotante para crear orden
    let extraHtml = '';
    if (mode === 'book') {
        extraHtml = `
            <button class="btn-create-order-floating" onclick="showCreateOrderModal()" style="
                position: fixed;
                bottom: 30px;
                right: 30px;
                width: 60px;
                height: 60px;
                border-radius: 50%;
                background-color: #ee6a3e;
                color: white;
                border: none;
                box-shadow: 0 4px 12px rgba(238, 106, 62, 0.4);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 28px;
                z-index: 1000;
                transition: transform 0.2s, box-shadow 0.2s;
            " onmouseover="this.style.transform='scale(1.1)'; this.style.boxShadow='0 6px 16px rgba(238, 106, 62, 0.5)';" 
              onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 4px 12px rgba(238, 106, 62, 0.4)';">
                <i class="ri-add-line"></i>
            </button>
        `;
    }

    // Pagination Controls (History Mode)
    if (mode === 'history' && totalPages > 1) {
        extraHtml += `
            <div class="pagination-controls" style="display: flex; justify-content: center; align-items: center; margin-top: 20px; gap: 15px;">
                <button ${historyPage === 1 ? 'disabled' : ''} onclick="changeHistoryPage(-1)" 
                    style="padding: 8px 16px; background: #fff; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; color: #333; ${historyPage === 1 ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                    <i class="ri-arrow-left-s-line"></i> Anterior
                </button>
                <span style="font-weight: 500; color: #555;">Página ${historyPage} de ${totalPages}</span>
                <button ${historyPage >= totalPages ? 'disabled' : ''} onclick="changeHistoryPage(1)" 
                    style="padding: 8px 16px; background: #fff; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; color: #333; ${historyPage >= totalPages ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                    Siguiente <i class="ri-arrow-right-s-line"></i>
                </button>
            </div>
        `;
    }

    ordersList.innerHTML = ordersHtml + extraHtml;

}

// Variable global para almacenar el orderId que se va a cancelar
let pendingCancelOrderId = null;

// Cancelar orden del usuario - Muestra modal de confirmación
function cancelMyOrder(orderId) {
    pendingCancelOrderId = orderId;
    const modal = document.getElementById('cancelOrderModal');
    if (modal) {
        modal.style.display = 'block';

        // Configurar el botón de confirmación
        const confirmBtn = document.getElementById('confirmCancelOrderBtn');
        if (confirmBtn) {
            // Remover listeners anteriores
            const newConfirmBtn = confirmBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

            // Agregar nuevo listener
            newConfirmBtn.addEventListener('click', () => {
                executeCancelOrder(orderId);
            });
        }
    }
}

// Cerrar modal de cancelación
function closeCancelOrderModal() {
    const modal = document.getElementById('cancelOrderModal');
    if (modal) {
        modal.style.display = 'none';
    }
    pendingCancelOrderId = null;
}

// Ejecutar la cancelación de la orden
async function executeCancelOrder(orderId) {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showAlert('Sesión expirada', 'error', 'myOrdersAlertContainer');
        closeCancelOrderModal();
        return;
    }

    // Cerrar el modal primero
    closeCancelOrderModal();

    try {
        const response = await fetch(`/api/p2p/orders/${orderId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al cancelar orden');
        }

        showAlert('Orden cancelada exitosamente', 'success', 'myOrdersAlertContainer');
        loadMyOrders(); // Recargar órdenes
    } catch (error) {
        console.error('Error canceling order:', error);
        showAlert(error.message || 'Error al cancelar orden', 'error', 'myOrdersAlertContainer');
    }
}

// Abrir vista de trade
function openTradeView(tradeId) {
    window.location.href = `/p2p-trade?tradeId=${tradeId}`;
}

// Pagination Handler
window.changeHistoryPage = function (delta) {
    historyPage += delta;
    if (historyPage < 1) historyPage = 1;

    // Re-render with cached data
    if (lastOrders && lastTrades) {
        renderMyOrders(lastOrders, lastTrades, 'history');
        // Scroll to top of list
        const ordersList = document.getElementById('myOrdersList');
        if (ordersList) {
            ordersList.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
};

// Función helper para mostrar alertas en diferentes contenedores
function showAlert(message, type = 'info', containerId = 'alertContainer') {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`Alert container ${containerId} not found`);
        alert(message);
        return;
    }

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.setAttribute('role', 'alert');

    alertDiv.innerHTML = message;

    container.appendChild(alertDiv);

    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}


// ============================================
// Funciones Zona Cajero (Cashier Zone)
// ============================================

// Polling interval for live requests (5 seconds)
let liveRequestsPollingInterval = null;

function startLiveRequestsPolling() {
    stopLiveRequestsPolling(); // Clear any existing interval

    // Unirse al feed WebSocket para actualizaciones en tiempo real
    joinP2PLiveFeed();

    // Cargar solicitudes actuales y luego polling como fallback
    loadLiveRequests();
    liveRequestsPollingInterval = setInterval(loadLiveRequests, 5000);
    console.log('[Cashier Zone] Started live requests polling + WebSocket feed');
}

function stopLiveRequestsPolling() {
    if (liveRequestsPollingInterval) {
        clearInterval(liveRequestsPollingInterval);
        liveRequestsPollingInterval = null;
        console.log('[Cashier Zone] Stopped live requests polling');
    }
    // Salir del feed WebSocket
    leaveP2PLiveFeed();
}

async function loadLiveRequests() {
    const listContainer = document.getElementById('liveRequestsList');
    if (!listContainer) return;

    listContainer.innerHTML = `
        <div class="empty-state">
            <i class="ri-loader-4-line" style="animation: spin 1s infinite linear;"></i>
            <p>Cargando solicitudes...</p>
        </div>
        `;

    try {
        const accessToken = localStorage.getItem('accessToken');
        
        if (!accessToken) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <i class="ri-error-warning-line" style="color: #e53e3e;"></i>
                    <p style="color: #e53e3e;">No estás autenticado. Por favor, inicia sesión.</p>
                </div>
            `;
            return;
        }

        const response = await apiCall('/api/p2p/cashier/live', {
            method: 'GET'
        });

        if (!response.ok) {
            // Otros errores (401 ya fue manejado por apiCall)
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || errorData.message || 'Error al cargar solicitudes');
        }

        const data = await response.json();
        const requests = data.requests || [];

        if (requests.length === 0) {
            listContainer.innerHTML = `
        <div class="empty-state">
                    <i class="ri-inbox-archive-line"></i>
                    <p>No hay solicitudes disponibles en este momento.</p>
                </div>
        `;
            return;
        }

        // Store globally for modal access
        window.currentLiveRequests = requests;

        listContainer.innerHTML = requests.map(req => {
            const isDeposit = req.type === 'DEPOSIT'; // Deposit = User sends Fiat, gets Crypto. Cashier Perspective: Sell Crypto, Receive Fiat.
            const actionLabel = isDeposit ? 'Vender' : 'Comprar';
            const actionClass = isDeposit ? 'danger' : 'success'; // Color badge: red for sell, green for buy

            // User info
            const userName = req.user?.profile?.firstName || req.user?.email?.split('@')[0] || 'Usuario';

            // Rate/Price display
            const rateDisplay = req.price ? `Tasa: ${formatNumber(req.price)} ${req.fiatCurrency}` : '';

            // Fiat Amount Logic
            // Si es DEPOSIT (usuario compra crypto, cajero vende), el cajero RECIBE fiat
            // Si es WITHDRAW (usuario vende crypto, cajero compra), el cajero PAGA fiat
            let fiatAmountDisplay = '';
            if (req.price && req.amount) {
                const totalFiat = req.amount * req.price;
                const labelText = isDeposit ? 'A Recibir' : 'A pagar';
                fiatAmountDisplay = `<span style="display:block; font-size: 0.75em; color: #666; margin-top: 4px; font-weight: normal;">${labelText}: ${formatNumber(totalFiat)} ${req.fiatCurrency || 'VES'}</span>`;
            }

            // Payment methods display - mostrar todos los métodos seleccionados con logos
            let paymentMethodDisplay = '';
            if (req.paymentMethods && Array.isArray(req.paymentMethods) && req.paymentMethods.length > 0) {
                // Mostrar todos los métodos con logos
                paymentMethodDisplay = req.paymentMethods.map(pm => {
                    const logoHtml = pm.logoUrl
                        ? `<img src="${pm.logoUrl}" alt="${pm.displayName || pm.name}" style="width: 20px; height: 20px; border-radius: 4px; object-fit: contain; margin-right: 6px; vertical-align: middle;">`
                        : `<i class="ri-bank-line" style="margin-right: 6px; vertical-align: middle;"></i>`;
                    const displayName = pm.displayName || pm.name || 'Método';
                    return `<span style="display: inline-flex; align-items: center; margin-right: 12px; margin-bottom: 4px;">${logoHtml} ${displayName}</span>`;
                }).join('');
            } else if (req.paymentMethod) {
                // Fallback: si solo hay un método singular
                const logoHtml = req.paymentMethod.logoUrl
                    ? `<img src="${req.paymentMethod.logoUrl}" alt="${req.paymentMethod.displayName || req.paymentMethod.name}" style="width: 20px; height: 20px; border-radius: 4px; object-fit: contain; margin-right: 6px; vertical-align: middle;">`
                    : `<i class="ri-bank-line" style="margin-right: 6px; vertical-align: middle;"></i>`;
                const pmDisplayName = req.paymentMethod.displayName || req.paymentMethod.name || 'Método seleccionado';
                paymentMethodDisplay = `<span style="display: inline-flex; align-items: center;">${logoHtml} ${pmDisplayName}</span>`;
            } else if (req.paymentMethodId) {
                paymentMethodDisplay = `<i class="ri-bank-line"></i> Método preferido`;
            } else {
                paymentMethodDisplay = `<i class="ri-bank-line"></i> Cualquier método`;
            }

            // Time remaining
            const expiresAt = new Date(req.liveExpiresAt);
            const now = new Date();
            const minutesLeft = Math.max(0, Math.round((expiresAt - now) / 60000));

            return `
                <div class="card p-3 mb-3 request-card" style="border-left: 5px solid ${isDeposit ? '#dc3545' : '#28a745'}; box-shadow: 0 2px 8px rgba(0,0,0,0.05); transition: all 0.2s;">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="badge badge-${actionClass}">${actionLabel} ${req.cryptoAsset}</span>
                        <small class="text-muted timer-countdown" data-expires="${req.liveExpiresAt}" style="font-size: 0.85em;">
                            <i class="ri-time-line"></i> ${minutesLeft > 0 ? `${minutesLeft} min` : 'Expirando...'}
                        </small>
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h5 class="mb-1" style="font-weight: 700; color: #2d3748;">
                                ${formatNumber(req.amount)} <small style="font-size: 0.7em; color: #718096;">${req.cryptoAsset}</small>
                                ${fiatAmountDisplay}
                            </h5>
                            <div class="d-flex flex-wrap align-items-center text-muted small mt-2" style="gap: 15px;">
                                <span><i class="ri-user-3-line"></i> ${userName}</span>
                                <span><i class="ri-money-dollar-circle-line"></i> ${rateDisplay || 'Mejor Oferta'}</span>
                            </div>
                            <div class="mt-2 text-muted small payment-method-badge" style="color: #4a5568;">
                                ${paymentMethodDisplay}
                            </div>
                        </div>
                        <div style="padding-left: 15px;">
                            <button class="btn btn-primary" style="background-color: ${isDeposit ? '#dc3545' : '#28a745'}; border-color: ${isDeposit ? '#dc3545' : '#28a745'};" onclick="openClaimModal('${req.id}')">
                                Tomar
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error en loadLiveRequests:', error);
        
        // Mostrar mensaje de error más específico
        const errorMessage = error.message || 'Error al cargar solicitudes';
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="ri-error-warning-line" style="color: #e53e3e; font-size: 3rem;"></i>
                <p style="color: #e53e3e; font-weight: 600; margin-top: 15px;">Error al cargar solicitudes</p>
                <p style="color: #666; margin-top: 10px; font-size: 0.9em;">${errorMessage}</p>
                <button class="btn btn-secondary" onclick="loadLiveRequests()" style="margin-top: 20px; border-radius: 8px;">
                    <i class="ri-refresh-line"></i> Reintentar
                </button>
            </div>
        `;
    }
}

// Modal para confirmar la toma de la orden
async function openClaimModal(requestId) {
    const request = window.currentLiveRequests ? window.currentLiveRequests.find(r => r.id === requestId) : null;
    if (!request) return;

    let modal = document.getElementById('claimConfirmationModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'claimConfirmationModal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('role', 'dialog');
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered" role="document">
                <div class="modal-content" style="border-radius: 16px; border: none; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.15);">
                    <div class="modal-header" style="background: linear-gradient(135deg, #f8fafc 0%, #edf2f7 100%); border-bottom: 1px solid #e2e8f0; padding: 20px 24px;">
                        <h5 class="modal-title" style="font-weight: 700; color: #2d3748; display: flex; align-items: center; gap: 10px;">
                            <i class="ri-check-double-line" style="color: #ee6a3e;"></i> Confirmar Operación
                        </h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body p-4">
                        <div style="text-align: center; margin-bottom: 25px;">
                            <p style="color: #718096; font-size: 1.1em; margin-bottom: 5px;">Estás a punto de tomar una solicitud por:</p>
                            <h2 style="color: #2d3748; font-weight: 800; font-size: 2em;" id="claimModalAmount"></h2>
                            <p style="color: #ee6a3e; font-weight: 600; font-size: 1.1em;" id="claimModalFiat"></p>
                        </div>
                        
                        <div style="background: #f7fafc; border-radius: 12px; padding: 15px; border: 1px solid #edf2f7;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                <span style="color: #718096;">Tasa:</span>
                                <span style="font-weight: 600; color: #2d3748;" id="claimModalRate"></span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span style="color: #718096;">Método:</span>
                                <span style="font-weight: 600; color: #2d3748;" id="claimModalMethod"></span>
                            </div>
                        </div>

                        <div class="alert alert-warning" style="margin-top: 20px; font-size: 0.9em; display: flex; gap: 10px; border-radius: 8px;">
                            <i class="ri-alert-line" style="font-size: 1.2em;"></i>
                            <div>Recuerda que al tomar esta orden te comprometes a completarla en el tiempo establecido.</div>
                        </div>
                        
                        <div id="claimModalError" style="display: none; margin-top: 15px;"></div>
                    </div>
                    <div class="modal-footer" style="padding: 20px 24px; border-top: none;">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal" style="border-radius: 10px; padding: 10px 20px; font-weight: 600;">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="btnConfirmClaim" style="border-radius: 10px; padding: 10px 24px; background: #ee6a3e; border: none; font-weight: 700; box-shadow: 0 4px 12px rgba(238, 106, 62, 0.3);">
                            Confirmar y Tomar
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Populate Data
    const fiatAmount = (request.amount * request.price).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('claimModalAmount').textContent = `${formatNumber(request.amount)} ${request.cryptoAsset}`;
    document.getElementById('claimModalFiat').textContent = ` ≈ ${fiatAmount} ${request.fiatCurrency}`;
    document.getElementById('claimModalRate').textContent = `${formatNumber(request.price)} ${request.fiatCurrency}`;

    // Resolve Payment Method Name - Usar displayName de la definición del admin
    let methodName = 'Cualquier método';
    if (request.paymentMethods && Array.isArray(request.paymentMethods) && request.paymentMethods.length > 0) {
        // Si hay múltiples métodos, mostrar todos separados por comas
        methodName = request.paymentMethods
            .map(pm => pm.displayName || pm.name || 'Método')
            .join(', ');
    } else if (request.paymentMethod) {
        // Si hay un método singular, usar displayName
        methodName = request.paymentMethod.displayName || request.paymentMethod.name || 'Método seleccionado';
    } else if (request.paymentMethodId) {
        methodName = 'Método Preferido';
    }
    document.getElementById('claimModalMethod').textContent = methodName;

    // Set Action
    const confirmBtn = document.getElementById('btnConfirmClaim');
    confirmBtn.onclick = () => executeClaimRequest(requestId);
    
    // Limpiar cualquier error previo al abrir el modal
    const errorDiv = document.getElementById('claimModalError');
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.innerHTML = '';
    }
    
    // Habilitar el botón de confirmar
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirmar y Tomar';
        confirmBtn.style.opacity = '1';
        confirmBtn.style.cursor = 'pointer';
    }
    
    // Asegurar que los botones de cerrar funcionen correctamente
    const closeBtn = modal.querySelector('.close');
    const cancelBtn = modal.querySelector('.btn-secondary[data-dismiss="modal"]');
    
    if (closeBtn) {
        closeBtn.onclick = () => {
            $('#claimConfirmationModal').modal('hide');
        };
    }
    
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            $('#claimConfirmationModal').modal('hide');
        };
    }

    $('#claimConfirmationModal').modal('show');
}

// Ejecutar la toma de orden (llamado desde el modal)
async function executeClaimRequest(requestId) {
    const errorDiv = document.getElementById('claimModalError');
    const confirmBtn = document.getElementById('btnConfirmClaim');
    
    // Ocultar error previo y mostrar loading
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.innerHTML = '';
    }
    
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="ri-loader-4-line" style="animation: spin 1s linear infinite;"></i> Procesando...';
    }

    try {
        const accessToken = localStorage.getItem('accessToken');
        const response = await fetch('/api/p2p/cashier/claim', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requestId })
        });

        const data = await response.json();

        if (!response.ok) {
            // Check for Payment Mismatch Error
            if (data.error && data.error.includes('REQ_PAYMENT_MISMATCH')) {
                $('#claimConfirmationModal').modal('hide');
                const parts = data.error.split('|||');
                let msg = 'Método de pago incompatible. Debes tener el mismo método configurado.';
                let logoUrl = null;
                if (parts.length >= 3) {
                    msg = parts[2];
                    try {
                        const payload = JSON.parse(parts[1]);
                        logoUrl = payload.l || null;
                    } catch (e) { /* ignorar */ }
                } else if (parts.length >= 2) {
                    msg = parts[1] || msg;
                }
                showPaymentMismatchModal(msg, logoUrl);
                return;
            }
            
            // Manejar error 400 (Bad Request) - Errores de validación (balance, método de pago, etc.)
            if (response.status === 400) {
                const errorMessage = data.error || 'Error al tomar la solicitud';
                
                // Detectar si es error de balance insuficiente
                const isBalanceError = errorMessage.includes('No cuentas con balance') || 
                                      errorMessage.includes('balance necesario') ||
                                      errorMessage.includes('Saldo insuficiente') ||
                                      errorMessage.includes('No tienes una wallet');
                
                // Mostrar error en el modal
                if (errorDiv) {
                    const errorIcon = isBalanceError ? 'ri-wallet-3-line' : 'ri-error-warning-line';
                    const errorStyle = isBalanceError ? 'background: #FFF5F5; border: 1px solid #FEB2B2;' : '';
                    const textStyle = isBalanceError ? 'color: #C53030; font-weight: 600;' : '';
                    
                    errorDiv.innerHTML = `
                        <div class="alert alert-danger" style="display: flex; align-items: center; gap: 10px; border-radius: 8px; margin: 0; ${errorStyle}">
                            <i class="${errorIcon}" style="font-size: 1.3em; ${isBalanceError ? 'color: #C53030;' : ''}"></i>
                            <div style="flex: 1; ${textStyle}">${errorMessage}</div>
                        </div>
                    `;
                    errorDiv.style.display = 'block';
                }
                
                // Deshabilitar botón cuando hay error
                if (confirmBtn) {
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = 'Confirmar y Tomar';
                    confirmBtn.style.opacity = '0.5';
                    confirmBtn.style.cursor = 'not-allowed';
                }
                
                return;
            }
            
            // Manejar error 409 (Conflict) - Solicitud ya tomada o expirada
            if (response.status === 409) {
                let errorMessage = 'La solicitud ya no está disponible.';
                
                // Intentar obtener el estado actual de la solicitud para dar un mensaje más específico
                try {
                    const requestStatusResponse = await fetch(`/api/p2p/requests/${requestId}`, {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (requestStatusResponse.ok) {
                        const requestData = await requestStatusResponse.json();
                        const request = requestData.request || requestData;
                        
                        if (request.status === 'LIVE_CLAIMED' || request.status === 'IN_TRADE') {
                            errorMessage = 'La solicitud ya fue tomada por otro cajero.';
                        } else if (request.status === 'BOOK_MATCH_PENDING' || request.status === 'BOOK_ASSIGNED') {
                            errorMessage = 'La solicitud expiró después de 2 minutos y fue movida al sistema de matching automático.';
                        } else if (request.status === 'EXPIRED' || request.status === 'CANCELLED_BY_USER') {
                            errorMessage = 'La solicitud ya no está disponible (expirada o cancelada).';
                        } else {
                            errorMessage = 'La solicitud ya no está disponible. Puede que haya sido tomada por otro cajero o haya expirado después de 2 minutos.';
                        }
                    } else {
                        // Si no se puede obtener el estado, usar mensaje genérico mejorado
                        errorMessage = 'La solicitud ya no está disponible. Puede que haya sido tomada por otro cajero o haya expirado después de 2 minutos.';
                    }
                } catch (statusError) {
                    // Si falla obtener el estado, usar mensaje genérico mejorado
                    console.warn('No se pudo obtener el estado de la solicitud:', statusError);
                    errorMessage = 'La solicitud ya no está disponible. Puede que haya sido tomada por otro cajero o haya expirado después de 2 minutos.';
                }
                
                // Mostrar error en el modal
                if (errorDiv) {
                    errorDiv.innerHTML = `
                        <div class="alert alert-danger" style="display: flex; align-items: center; gap: 10px; border-radius: 8px; margin: 0;">
                            <i class="ri-error-warning-line" style="font-size: 1.3em;"></i>
                            <div style="flex: 1;">${errorMessage}</div>
                        </div>
                    `;
                    errorDiv.style.display = 'block';
                }
                
                // Deshabilitar botón cuando hay error
                if (confirmBtn) {
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = 'Confirmar y Tomar';
                    confirmBtn.style.opacity = '0.5';
                    confirmBtn.style.cursor = 'not-allowed';
                }
                
                // Recargar lista después de un momento
                setTimeout(() => {
                    if (typeof loadLiveRequests === 'function') {
                        loadLiveRequests();
                    }
                }, 2000);
                
                return;
            }
            
            // Otros errores - mostrar en el modal también
            const genericError = data.error || 'No se pudo tomar la solicitud';
            
            // Detectar si es error de balance insuficiente
            const isBalanceError = genericError.includes('No cuentas con balance') || 
                                  genericError.includes('balance necesario') ||
                                  genericError.includes('Saldo insuficiente');
            
            if (errorDiv) {
                // Si es error de balance, usar un estilo más destacado
                const errorClass = isBalanceError ? 'alert-danger' : 'alert-danger';
                const errorIcon = isBalanceError ? 'ri-wallet-3-line' : 'ri-error-warning-line';
                
                errorDiv.innerHTML = `
                    <div class="alert ${errorClass}" style="display: flex; align-items: center; gap: 10px; border-radius: 8px; margin: 0; ${isBalanceError ? 'background: #FFF5F5; border: 1px solid #FEB2B2;' : ''}">
                        <i class="${errorIcon}" style="font-size: 1.3em; ${isBalanceError ? 'color: #C53030;' : ''}"></i>
                        <div style="flex: 1; ${isBalanceError ? 'color: #C53030; font-weight: 600;' : ''}">${genericError}</div>
                    </div>
                `;
                errorDiv.style.display = 'block';
            }
            
            // Deshabilitar botón cuando hay error
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Confirmar y Tomar';
                confirmBtn.style.opacity = '0.5';
                confirmBtn.style.cursor = 'not-allowed';
            }
            
            return;
        }

        // Éxito - cerrar modal y redirigir
        $('#claimConfirmationModal').modal('hide');
        showAlert('Solicitud asignada exitosamente', 'success');

        // Redirigir al Trade
        setTimeout(() => {
            if (data.tradeId) {
                window.location.href = `/p2p-trade?tradeId=${data.tradeId}`;
            } else if (data.request && data.request.metadata) {
                try {
                    const metadata = JSON.parse(data.request.metadata);
                    if (metadata.tradeId) {
                        window.location.href = `/p2p-trade?tradeId=${metadata.tradeId}`;
                        return;
                    }
                } catch (e) {
                    console.warn('No se pudo parsear metadata del trade:', e);
                }
            }
            // Si no hay tradeId, recargar lista
            if (typeof loadLiveRequests === 'function') {
                loadLiveRequests();
            }
        }, 1000);

    } catch (error) {
        console.error(error);
        
        // Mostrar error en el modal
        if (errorDiv) {
            errorDiv.innerHTML = `
                <div class="alert alert-danger" style="display: flex; align-items: center; gap: 10px; border-radius: 8px; margin: 0;">
                    <i class="ri-error-warning-line" style="font-size: 1.3em;"></i>
                    <div style="flex: 1;">${error.message || 'Error al procesar la solicitud. Por favor, intenta nuevamente.'}</div>
                </div>
            `;
            errorDiv.style.display = 'block';
        }
        
        // Deshabilitar botón cuando hay error
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Confirmar y Tomar';
            confirmBtn.style.opacity = '0.5';
            confirmBtn.style.cursor = 'not-allowed';
        }
        
        // Recargar lista
        if (typeof loadLiveRequests === 'function') {
            loadLiveRequests();
        }
    }
}
window.openClaimModal = openClaimModal;
window.executeClaimRequest = executeClaimRequest;

const P2P_BOOK_BADGE_CLOSED_KEY = 'p2p_book_badge_closed';

function dismissMyOrdersBookBadge() {
    const badge = document.getElementById('myOrdersBookBadge');
    if (badge) badge.style.display = 'none';
    try { localStorage.setItem(P2P_BOOK_BADGE_CLOSED_KEY, '1'); } catch (e) {}
}

async function loadOtcExpressContent() {
    const badgeEl = document.getElementById('otcEligibilityBadge');
    const btnEl = document.getElementById('otcActionButton');
    if (!badgeEl || !btnEl) return;

    const token = localStorage.getItem('accessToken');
    badgeEl.innerHTML = '<span style="color:#888;">Verificando elegibilidad...</span>';
    btnEl.innerHTML = '';

    if (!token) {
        badgeEl.innerHTML = '<span class="badge" style="background:#dc3545;color:#fff;padding:8px 16px;border-radius:8px;">No Eres Elegible para este producto hasta que te verifiques</span>';
        return;
    }

    try {
        const [kycRes, configRes] = await Promise.all([
            fetch('/api/me/kyc-dashboard', { headers: { 'Authorization': 'Bearer ' + token } }),
            fetch('/api/config/otc-portal-url')
        ]);

        let kycLevel = 'NONE';
        if (kycRes.ok) {
            const kycData = await kycRes.json();
            kycLevel = (kycData.kycStatus?.currentLevel || 'NONE').toUpperCase();
        }

        const isL4 = kycLevel === 'L4';
        if (isL4) {
            badgeEl.innerHTML = '<span class="badge" style="background:#00C853;color:#fff;padding:8px 16px;border-radius:8px;font-weight:600;"><i class="ri-checkbox-circle-fill" style="margin-right:6px;"></i>Eres Elegible para este Producto</span>';
        } else {
            badgeEl.innerHTML = '<span class="badge" style="background:#6c757d;color:#fff;padding:8px 16px;border-radius:8px;">No Eres Elegible para este producto hasta que te verifiques</span>';
        }

        if (isL4) {
            let otcUrl = '';
            if (configRes.ok) {
                const cfg = await configRes.json();
                otcUrl = cfg.otcPortalUrl || '';
            }
            if (otcUrl) {
                const fullUrl = otcUrl + '?token=' + encodeURIComponent(token);
                btnEl.innerHTML = '<a href="' + fullUrl + '" target="_blank" rel="noopener" class="btn-create-order" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;"><i class="ri-external-link-line"></i> Ir al Portal OTC Express</a>';
            } else {
                btnEl.innerHTML = '<span style="color:#888;">Portal OTC no configurado</span>';
            }
        } else {
            btnEl.innerHTML = '';
        }
    } catch (e) {
        badgeEl.innerHTML = '<span style="color:#dc3545;">Error al verificar elegibilidad</span>';
    }
}

function switchCashierTab(tab) {
    document.querySelectorAll('.cashier-tabs .tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.borderBottom = '2px solid transparent';
        b.style.color = '#666';
    });

    if (tab === 'otc') {
        const btn = document.querySelector('#tabBtnOtc');
        if (btn) {
            btn.classList.add('active');
            btn.style.borderBottom = '2px solid #ee6a3e';
            btn.style.color = '#ee6a3e';
        }
        stopLiveRequestsPolling();
        document.getElementById('cashierLiveContent').style.display = 'none';
        document.getElementById('cashierBookContent').style.display = 'none';
        document.getElementById('cashierMyOrdersContent').style.display = 'none';
        document.getElementById('cashierOtcContent').style.display = 'block';
        loadOtcExpressContent();
        return;
    }

    if (tab === 'live') {
        const btn = document.querySelector('#tabBtnLive');
        if (btn) {
            btn.classList.add('active');
            btn.style.borderBottom = '2px solid #ee6a3e';
            btn.style.color = '#ee6a3e';
        }
        document.getElementById('cashierLiveContent').style.display = 'block';
        document.getElementById('cashierBookContent').style.display = 'none'; // Unused now
        document.getElementById('cashierMyOrdersContent').style.display = 'none';
        if (document.getElementById('cashierOtcContent')) document.getElementById('cashierOtcContent').style.display = 'none';

        startLiveRequestsPolling();
    } else if (tab === 'book') { // Mi Libro de Órdenes (Active PENDING)
        const btn = document.querySelector('#tabBtnBook');
        if (btn) {
            btn.classList.add('active');
            btn.style.borderBottom = '2px solid #ee6a3e';
            btn.style.color = '#ee6a3e';
        }
        stopLiveRequestsPolling();
        document.getElementById('cashierLiveContent').style.display = 'none';
        document.getElementById('cashierBookContent').style.display = 'none';
        document.getElementById('cashierMyOrdersContent').style.display = 'block';
        if (document.getElementById('cashierOtcContent')) document.getElementById('cashierOtcContent').style.display = 'none';

        // Mostrar badge informativo solo si el usuario no lo cerró
        const bookBadge = document.getElementById('myOrdersBookBadge');
        if (bookBadge) {
            try {
                bookBadge.style.display = localStorage.getItem(P2P_BOOK_BADGE_CLOSED_KEY) ? 'none' : 'flex';
            } catch (e) {
                bookBadge.style.display = 'flex';
            }
        }

        // Set Filter to PENDING (Active)
        const statusFilter = document.getElementById('myOrdersFilterStatus');
        if (statusFilter) {
            statusFilter.value = 'PENDING';
        }
        loadMyOrders('book');

    } else if (tab === 'myorders' || tab === 'history') { // Historial
        const btn = document.querySelector('#tabBtnMyOrders');
        if (btn) {
            btn.classList.add('active');
            btn.style.borderBottom = '2px solid #ee6a3e';
            btn.style.color = '#ee6a3e';
        }
        stopLiveRequestsPolling();
        document.getElementById('cashierLiveContent').style.display = 'none';
        document.getElementById('cashierBookContent').style.display = 'none';
        document.getElementById('cashierMyOrdersContent').style.display = 'block';
        if (document.getElementById('cashierOtcContent')) document.getElementById('cashierOtcContent').style.display = 'none';

        // Ocultar badge en Historial
        const bookBadge = document.getElementById('myOrdersBookBadge');
        if (bookBadge) bookBadge.style.display = 'none';

        // Set Filter to ALL or relevant history
        const statusFilter = document.getElementById('myOrdersFilterStatus');
        if (statusFilter) {
            statusFilter.value = ''; // All
        }
        loadMyOrders('history');
    }
}

// --- Suggested Rates Logic ---

let currentSuggestedRates = {
    market: 0,
    internal: 0
};

async function fetchSuggestedRates(crypto, fiat, type) {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    // Resetear valores visuales
    // Resetear valores visuales (IDs especificos para Create Order y CLASES para Quick Trade)
    // Reset UI
    const marketValEls = document.querySelectorAll('.marketRateValueQT');
    const internalValEls = document.querySelectorAll('.internalRateValueQT');
    const qtFiatEls = document.querySelectorAll('.fiatSymbolDisplay'); // Keep this for fiat symbol display
    
    // También actualizar elementos del modal de creación de orden
    const marketRateValue = document.getElementById('marketRateValue');
    const internalRateValue = document.getElementById('internalRateValue');

    marketValEls.forEach(el => el.textContent = '--');
    internalValEls.forEach(el => el.textContent = '--');
    qtFiatEls.forEach(el => el.textContent = fiat); // Update fiat symbol display
    
    // Resetear valores del modal de creación de orden
    if (marketRateValue) marketRateValue.textContent = '--';
    if (internalRateValue) internalRateValue.textContent = '--';

    try {
        const response = await fetch(`/api/p2p/rates/suggestion?crypto=${crypto}&fiat=${fiat}&type=${type}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            // Store breakdown for modal
            currentMarketBreakdown = data.marketBreakdown || [];

            // Update UI para Quick Trade
            marketValEls.forEach(el => el.textContent = data.marketAverage > 0 ? formatNumber(data.marketAverage) : '--');
            // Mostrar "0.00" cuando no hay órdenes internas, en lugar de "--"
            internalValEls.forEach(el => {
                if (data.internalAverage > 0) {
                    el.textContent = formatNumber(data.internalAverage);
                } else {
                    el.textContent = '0.00';
                }
            });
            
            // Update UI para Create Order Modal
            if (marketRateValue) {
                marketRateValue.textContent = data.marketAverage > 0 ? formatNumber(data.marketAverage) : '--';
            }
            if (internalRateValue) {
                if (data.internalAverage > 0) {
                    internalRateValue.textContent = formatNumber(data.internalAverage);
                } else {
                    internalRateValue.textContent = '0.00';
                }
            }
            
            // También actualizar valores en el colapsable si está visible
            const marketRateValueCollapse = document.getElementById('marketRateValueCollapse');
            const internalRateValueCollapse = document.getElementById('internalRateValueCollapse');
            if (marketRateValueCollapse) {
                marketRateValueCollapse.textContent = data.marketAverage > 0 ? formatNumber(data.marketAverage) : '--';
            }
            if (internalRateValueCollapse) {
                if (data.internalAverage > 0) {
                    internalRateValueCollapse.textContent = formatNumber(data.internalAverage);
                } else {
                    internalRateValueCollapse.textContent = '0.00';
                }
            }

            // Update state for later usage if needed
            // quickTradeState.suggestedMarketRate = data.marketAverage;
        }
    } catch (error) {
        console.error('Error fetching suggested rates:', error);
    }
}

function applySuggestedRate(source, mode = 'CREATE') {
    let rate = 0;
    if (source === 'market') rate = currentSuggestedRates.market;
    else if (source === 'internal') rate = currentSuggestedRates.internal;

    if (rate > 0) {
        let rateInput = null;

        if (mode === 'CREATE') {
            rateInput = document.getElementById('createOrderRate');
            if (rateInput) {
                rateInput.value = rate.toFixed(2); // Ajustar decimales según fiat si fuera necesario
                createOrderState.rate = rate;
                if (typeof calculateCreateOrderTotal === 'function') calculateCreateOrderTotal();
            }
        } else if (mode === 'BUY') {
            rateInput = document.getElementById('quickTradeRateBuy');
            // Update simple state if needed, though executeQuickTradeBuy reads input
        } else if (mode === 'SELL') {
            // Try to find Sell Rate Input (Step 5)
            rateInput = document.getElementById('quickTradeRateSell');
        }

        if (rateInput) {
            rateInput.value = rate.toFixed(2);
            // Visual feedback
            rateInput.style.backgroundColor = '#e8f0fe';
            setTimeout(() => {
                rateInput.style.backgroundColor = '#fff';
            }, 300);
        }
    }
}

function toggleSuggestedRatesCollapse() {
    // Legacy support or specific toggle Logic if needed
    const collapse = document.getElementById('suggestedRatesCollapseStep4');
    const toggleText = document.getElementById('suggestedRatesToggleTextStep4');
    const toggleIcon = document.getElementById('suggestedRatesToggleIconStep4');

    if (collapse && toggleText && toggleIcon) {
        if (collapse.style.display === 'none') {
            collapse.style.display = 'block';
            toggleText.textContent = 'Ocultar';
            toggleIcon.className = 'ri-arrow-up-s-line';
        } else {
            collapse.style.display = 'none';
            toggleText.textContent = 'Ver';
            toggleIcon.className = 'ri-arrow-down-s-line';
        }
    }
}

// --- Market Details Modal Logic ---

function showMarketDetails() {
    const modal = document.getElementById('suggestedRatesModal');
    const content = document.getElementById('suggestedRatesContent');

    if (!currentMarketBreakdown || currentMarketBreakdown.length === 0) {
        if (content) content.innerHTML = '<div class="alert alert-info">No hay detalles de mercado disponibles para esta selección o están cargando.</div><div style="text-align:center;margin-top:10px;"><button onclick="closeSuggestedRatesModal()" style="background:#e9ecef;border:none;padding:5px 10px;border-radius:4px;">Cerrar</button></div>';
    } else {
        const rows = currentMarketBreakdown.map(item => `
            <tr>
                <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 0.95em;">
                    <strong style="color: #2d3748;">${item.exchange}</strong>
                </td>
                <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #1a73e8; font-weight: 600; font-size: 0.95em;">
                    ${formatNumber(item.rate)}
                </td>
                 <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #718096; font-size: 0.9em;">
                    ${new Date(item.updatedAt).toLocaleTimeString()}
                </td>
            </tr>
        `).join('');

        if (content) {
            content.innerHTML = `
                <table style="width: 100%; border-collapse: collapse; margin: 0;">
                    <thead>
                        <tr style="background: #f7fafc;">
                            <th style="padding: 12px 16px; text-align: left; font-size: 0.9em; font-weight: 600; color: #4a5568; border-bottom: 2px solid #e2e8f0;">Exchange</th>
                            <th style="padding: 12px 16px; text-align: right; font-size: 0.9em; font-weight: 600; color: #4a5568; border-bottom: 2px solid #e2e8f0;">Tasa</th>
                            <th style="padding: 12px 16px; text-align: right; font-size: 0.9em; font-weight: 600; color: #4a5568; border-bottom: 2px solid #e2e8f0;">Hora</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
                <div style="margin-top: 20px; text-align: center;">
                    <button onclick="closeSuggestedRatesModal()" 
                        class="btn btn-secondary"
                        style="border-radius: 10px; padding: 10px 20px; font-weight: 600;">
                        Cerrar
                    </button>
                </div>
            `;
        }
    }

    if (modal) {
        $('#suggestedRatesModal').modal('show');
    }
}

function closeSuggestedRatesModal() {
    const modal = document.getElementById('suggestedRatesModal');
    if (modal) {
        $('#suggestedRatesModal').modal('hide');
    }
}

// --- Quick Trade Modal Logic ---

function closeQuickTradeOrderModal() {
    const searchingModal = document.getElementById('searchingModal');
    if (searchingModal) {
        searchingModal.style.display = 'none';
    }
}

// Función para cerrar el modal de búsqueda
function hideSearchingModal() {
    // Detener el timer si está corriendo
    if (searchTimerInterval) {
        clearInterval(searchTimerInterval);
        searchTimerInterval = null;
    }
    
    // Limpiar estado completamente para permitir nueva búsqueda
    currentRequestId = null;
    window.isExecutingTrade = false;
    
    // Cerrar el modal
    const searchingModal = document.getElementById('searchingModal');
    if (searchingModal) {
        searchingModal.style.display = 'none';
    }
    
    // Detener polling si existe (verificación segura)
    try {
        if (typeof searchPollingInterval !== 'undefined' && searchPollingInterval) {
            clearInterval(searchPollingInterval);
            searchPollingInterval = null;
        }
    } catch (e) {
        // Si la variable no está definida, simplemente ignorar
        console.debug('searchPollingInterval no está disponible:', e);
    }
    
    // Detener timer si existe
    try {
        if (searchTimerInterval) {
            clearInterval(searchTimerInterval);
            searchTimerInterval = null;
        }
    } catch (e) {
        console.debug('Error clearing searchTimerInterval:', e);
    }
    
    // Detener polling de request si existe
    stopPolling();
    
    // Desuscribirse de WebSocket si hay una solicitud activa
    if (currentRequestId) {
        try {
            unsubscribeFromMyRequest(currentRequestId);
        } catch (e) {
            console.debug('Error unsubscribing from request:', e);
        }
    }
}

// Hacer la función disponible globalmente para los onclick inline
window.hideSearchingModal = hideSearchingModal;

// Mostrar modal de error de solicitud activa
function showActiveRequestErrorModal(message) {
    const modal = document.getElementById('activeRequestErrorModal');
    const messageElement = document.getElementById('activeRequestErrorMessage');
    
    if (modal && messageElement) {
        // Actualizar mensaje si se proporciona uno personalizado
        if (message) {
            messageElement.textContent = message;
        }
        
        // Mostrar modal usando Bootstrap
        $('#activeRequestErrorModal').modal('show');
    } else {
        // Fallback a showAlert si el modal no existe
        showAlert(message || 'Ya tienes una solicitud de búsqueda activa', 'error');
    }
}

// Ocultar modal de error de solicitud activa
function hideActiveRequestErrorModal() {
    const modal = document.getElementById('activeRequestErrorModal');
    if (modal) {
        $('#activeRequestErrorModal').modal('hide');
    }
}

// Hacer funciones globales
window.showActiveRequestErrorModal = showActiveRequestErrorModal;
window.hideActiveRequestErrorModal = hideActiveRequestErrorModal;

// Funciones Auxiliares para Modal de Error de Pago
function showPaymentMismatchModal(msg, logoUrl) {
    let modal = document.getElementById('paymentMismatchModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'paymentMismatchModal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('role', 'dialog');
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered" role="document">
                <div class="modal-content" style="border-radius: 16px; border: none; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
                    <div class="modal-header" style="background: #FFF5F5; border-bottom: none; padding: 20px 24px;">
                        <h5 class="modal-title" style="color: #C53030; display: flex; align-items: center; gap: 10px; font-weight: 700;">
                            <i class="ri-error-warning-fill"></i> Método Incompatible
                        </h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close" onclick="$('#paymentMismatchModal').modal('hide')">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body p-4">
                        <div id="paymentMismatchLogo"></div>
                        <p id="paymentMismatchMsg" style="font-size: 1.1em; color: #2D3748; line-height: 1.6;">${msg}</p>
                        <div class="alert alert-warning" style="background: #FFFAF0; border-color: #FEEBC8; color: #C05621; font-size: 0.9em; margin-top: 15px;">
                            <i class="ri-information-line"></i> Para seguridad, debes tener el mismo método configurado.
                        </div>
                    </div>
                    <div class="modal-footer" style="border-top: none; padding: 20px 24px;">
                        <button type="button" class="btn btn-secondary" onclick="$('#paymentMismatchModal').modal('hide')">Entendido</button>
                        <a href="/p2p/payment-methods" class="btn btn-primary" style="background: #ee6a3e; border: none;">Agregar Método</a>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    const logoEl = modal.querySelector('#paymentMismatchLogo');
    const msgEl = modal.querySelector('#paymentMismatchMsg');
    if (logoEl) {
        logoEl.innerHTML = logoUrl ? `<div style="margin-bottom: 12px;"><img src="${logoUrl}" alt="" style="width: 48px; height: 48px; object-fit: contain; border-radius: 8px;"></div>` : '';
        logoEl.style.display = logoUrl ? 'block' : 'none';
    }
    if (msgEl) msgEl.textContent = msg;
    $('#paymentMismatchModal').modal('show');
}
window.showPaymentMismatchModal = showPaymentMismatchModal;
