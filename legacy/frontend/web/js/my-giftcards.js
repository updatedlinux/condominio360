/**
 * Gift Card History Frontend Logic
 */

const API_BASE = '/api/giftcards';
let currentPage = 1;
const ITEMS_PER_PAGE = 20;
let currentOrders = [];

// DOM Elements
const ordersContainer = document.getElementById('ordersContainer');
const alertContainer = document.getElementById('alertContainer');
const paginationContainer = document.getElementById('paginationContainer');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('pageInfo');
const detailsModal = document.getElementById('detailsModal');
const modalContent = document.getElementById('modalContent');
const closeDetailsModal = document.getElementById('closeDetailsModal');
const closeDetailBtn = document.getElementById('closeDetailBtn');

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
    loadOrderHistory();
});

function checkAuth() {
    const token = localStorage.getItem('accessToken');
    if (!token) {
        window.location.href = '/login';
    }
}

function getAuthHeaders() {
    const token = localStorage.getItem('accessToken');
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

function setupEventListeners() {
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            window.location.href = '/login';
        });
    }

    // Sidebar Toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('show');
        });
    }

    // Pagination
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadOrderHistory();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        currentPage++;
        loadOrderHistory();
    });

    // Modal
    closeDetailsModal.addEventListener('click', () => {
        detailsModal.classList.remove('active');
    });
    closeDetailBtn.addEventListener('click', () => {
        detailsModal.classList.remove('active');
    });
    detailsModal.addEventListener('click', (e) => {
        if (e.target === detailsModal) detailsModal.classList.remove('active');
    });
}

async function loadOrderHistory() {
    try {
        ordersContainer.innerHTML = `
            <div class="loading-state">
                <i class="ri-loader-4-line"></i>
                <p>Cargando historial...</p>
            </div>
        `;

        const response = await fetch(`${API_BASE}/orders?page=${currentPage}&limit=${ITEMS_PER_PAGE}`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/login';
                return;
            }
            throw new Error('Error al cargar historial');
        }

        const data = await response.json();

        if (data.success) {
            currentOrders = data.data.orders;
            renderOrders(data.data.orders);
            updatePagination(data.data);
        } else {
            showAlert(data.error || 'Error desconocido', 'danger');
        }

    } catch (error) {
        console.error('Error loading history:', error);
        ordersContainer.innerHTML = `
            <div class="empty-state">
                <i class="ri-error-warning-line"></i>
                <p>Error al cargar el historial. Intenta nuevamente.</p>
                <button class="btn btn-primary" onclick="loadOrderHistory()">Reintentar</button>
            </div>
        `;
    }
}

function renderOrders(orders) {
    if (!orders || orders.length === 0) {
        ordersContainer.innerHTML = `
            <div class="empty-state">
                <i class="ri-gift-line"></i>
                <p>No tienes compras de gift cards aún.</p>
                <a href="/giftcards" class="btn btn-primary">Ir a Comprar</a>
            </div>
        `;
        paginationContainer.style.display = 'none';
        return;
    }

    ordersContainer.innerHTML = `<div class="orders-list">
        ${orders.map(order => createOrderCard(order)).join('')}
    </div>`;
}

function createOrderCard(order) {
    const date = new Date(order.createdAt).toLocaleDateString();
    let statusClass = 'status-pending';
    let statusLabel = order.status;

    if (order.status === 'SUCCESS') {
        if (order.hasGiftcardCodes) {
            statusClass = 'status-success';
            statusLabel = 'Código Entregado';
        } else {
            statusClass = 'status-pending'; // Or status-warning if defined
            statusLabel = 'Pendiente por Recibir Código';
        }
    }
    if (order.status === 'PENDING') { statusClass = 'status-pending'; statusLabel = 'Procesando'; }
    if (order.status === 'FAILED') { statusClass = 'status-failed'; statusLabel = 'Fallida'; }
    if (order.status === 'REFUNDED') { statusClass = 'status-refunded'; statusLabel = 'Reembolsada'; }

    return `
        <div class="order-card">
            <div class="order-icon">
                <i class="ri-gift-2-line"></i>
            </div>
            <div class="order-info">
                <div class="order-title">${order.productName}</div>
                <div class="order-meta">
                    <span><i class="ri-calendar-line"></i> ${date}</span>
                    <span class="status-badge ${statusClass}">${statusLabel}</span>
                    ${order.quantity > 1 ? `<span>Cant: ${order.quantity}</span>` : ''}
                </div>
            </div>
            <div class="order-amount">
                <span class="amount-usd">$${parseFloat(order.totalUsd).toFixed(2)} USD</span>
                <span class="amount-crypto">${parseFloat(order.walletAmountDebited).toFixed(6)} ${order.walletCurrency}</span>
            </div>
            <div class="order-actions">
                ${order.status === 'SUCCESS' ?
            `<button class="btn btn-outline" onclick="showOrderDetails('${order.id}')">
                        <i class="${order.hasGiftcardCodes ? 'ri-eye-line' : 'ri-file-list-line'}"></i> ${order.hasGiftcardCodes ? 'Ver Código' : 'Ver Detalles'}
                     </button>` :
            ''}
            </div>
        </div>
    `;
}

function updatePagination(meta) {
    if (meta.total <= ITEMS_PER_PAGE) {
        paginationContainer.style.display = 'none';
        return;
    }

    paginationContainer.style.display = 'block';
    const totalPages = Math.ceil(meta.total / ITEMS_PER_PAGE);

    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage >= totalPages;
    pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
}

async function showOrderDetails(orderId) {
    // Find order in current list (avoid fetch if possible, but history list doesn't have codes usually)
    // We need to fetch details to get codes securely usually? 
    // GiftcardService.getOrderHistory does NOT return codes by default to be light?
    // Let's check DTO. It has 'hasGiftcardCodes' boolean.

    try {
        detailsModal.classList.add('active');
        modalContent.innerHTML = '<div class="loading-state"><i class="ri-loader-4-line"></i></div>';

        const response = await fetch(`${API_BASE}/orders/${orderId}`, {
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (data.success && data.data) {
            const order = data.data;
            const codes = order.codes || []; // Normalized in backend controller usually? Or GiftcardService wrapper

            let codeHtml = '';
            if (codes.length > 0) {
                codeHtml = codes.map(c => `
                    <div class="code-display">
                        <div style="font-size: 0.9rem; color: #666; margin-bottom: 5px;">Código de Canje</div>
                        <div class="code-text">${c.cardNumber || c.pinCode || c}</div>
                        <button class="btn btn-outline" style="font-size: 0.8rem; padding: 4px 10px;" 
                                onclick="navigator.clipboard.writeText('${c.cardNumber || c.pinCode || c}')">
                            <i class="ri-file-copy-line"></i> Copiar
                        </button>
                         ${c.pinCode && c.cardNumber ? `<div style="margin-top:5px; font-size: 0.9rem;">PIN: ${c.pinCode}</div>` : ''}
                    </div>
                `).join('');
            } else {
                codeHtml = '<p>No hay códigos disponibles para esta orden.</p>';
            }

            modalContent.innerHTML = `
                <div style="text-align: center;">
                    <h4 style="color: #333; margin-bottom: 5px;">${order.productName}</h4>
                    <p style="color: #666; margin-bottom: 20px;">$${order.totalUsd} USD</p>
                </div>
                ${codeHtml}
                <div style="margin-top: 20px; font-size: 0.9rem; color: #555; background: #f9f9f9; padding: 15px; border-radius: 8px;">
                    <strong>Instrucciones:</strong><br>
                    ${order.redemptionInstructions || 'Visita el sitio del proveedor para canjear.'}
                </div>
            `;
        } else {
            modalContent.innerHTML = '<p class="text-danger">Error al cargar detalles</p>';
        }
    } catch (e) {
        console.error(e);
        modalContent.innerHTML = '<p class="text-danger">Error de conexión</p>';
    }
}

function showAlert(msg, type) {
    const div = document.createElement('div');
    div.className = `alert alert-${type}`;
    div.innerText = msg;
    alertContainer.innerHTML = '';
    alertContainer.appendChild(div);
    setTimeout(() => div.remove(), 5000);
}

// Global scope
window.loadOrderHistory = loadOrderHistory;
window.showOrderDetails = showOrderDetails;
