/**
 * Gift Cards Module - Frontend JavaScript
 * Handles product listing, search, pagination, and purchase flow
 */

const API_BASE = '/api/giftcards';
const COUNTRY_CODE = 'US';
const ITEMS_PER_PAGE = 12;

// State
let allProducts = [];
let filteredProducts = [];
let currentPage = 1;
let wallets = [];
let selectedProduct = null;
let selectedDenomination = null;
let selectedWallet = null;

// DOM Elements
const searchInput = document.getElementById('searchInput');
const filterCount = document.getElementById('filterCount');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const giftcardsGrid = document.getElementById('giftcardsGrid');
const paginationContainer = document.getElementById('paginationContainer');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('pageInfo');
const alertContainer = document.getElementById('alertContainer');

// Modal Elements
const purchaseModal = document.getElementById('purchaseModal');
const closeModal = document.getElementById('closeModal');
const modalProductImage = document.getElementById('modalProductImage');
const modalProductName = document.getElementById('modalProductName');
const modalProductBrand = document.getElementById('modalProductBrand');
const denominationContainer = document.getElementById('denominationContainer');
const walletContainer = document.getElementById('walletContainer');
const orderSummary = document.getElementById('orderSummary');
const summaryAmount = document.getElementById('summaryAmount');
const summaryCommission = document.getElementById('summaryCommission');
const summaryTotal = document.getElementById('summaryTotal');
const confirmPurchaseBtn = document.getElementById('confirmPurchaseBtn');

// Success Modal Elements
const successModal = document.getElementById('successModal');
const giftCardCode = document.getElementById('giftCardCode');
const instructionsText = document.getElementById('instructionsText');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const closeSuccessBtn = document.getElementById('closeSuccessBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadProducts();
    loadWallets();
    setupEventListeners();
});

function checkAuth() {
    const token = localStorage.getItem('accessToken');
    if (!token) {
        window.location.href = '/login';
        return;
    }
}

function getAuthHeaders() {
    const token = localStorage.getItem('accessToken');
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

// Load Products
async function loadProducts() {
    try {
        loadingState.style.display = 'block';
        giftcardsGrid.innerHTML = '';
        document.getElementById('serviceErrorState').style.display = 'none';

        const response = await fetch(`${API_BASE}/products?countryCode=${COUNTRY_CODE}`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/login';
                return;
            }
            throw new Error('Error al cargar productos');
        }

        const data = await response.json();

        if (data.success && data.data) {
            allProducts = data.data;
            filteredProducts = [...allProducts];
            renderProducts();
        } else {
            showServiceError();
        }
    } catch (error) {
        console.error('Error loading products:', error);
        showServiceError();
    } finally {
        loadingState.style.display = 'none';
    }
}

// Show service unavailable error
function showServiceError() {
    giftcardsGrid.innerHTML = '';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('serviceErrorState').style.display = 'block';
    document.getElementById('paginationContainer').style.display = 'none';
    filterCount.innerHTML = '';
}

// Load User Wallets
// Load User Wallets
async function loadWallets() {
    try {
        const response = await fetch('/api/auth/me', {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Error al cargar billeteras');
        }

        const data = await response.json();

        if (data.wallets && Array.isArray(data.wallets)) {
            // Group wallets by symbol and sum balances
            const walletMap = {};
            data.wallets.forEach(wallet => {
                const symbol = wallet.assetSymbol.toUpperCase();
                // Only include stablecoins and major cryptos
                if (['USDT', 'USDC', 'BIUSD', 'BTC', 'ETH', 'LTC'].includes(symbol)) {
                    if (!walletMap[symbol]) {
                        walletMap[symbol] = {
                            symbol: symbol,
                            totalBalance: 0,
                            walletId: wallet.id,
                            wallets: []
                        };
                    }
                    walletMap[symbol].totalBalance += parseFloat(wallet.balance) || 0;
                    walletMap[symbol].wallets.push(wallet);
                }
            });

            wallets = Object.values(walletMap).filter(w => w.totalBalance > 0);
        }
    } catch (error) {
        console.error('Error loading wallets:', error);
    }
}

// Render Products Grid
function renderProducts() {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageProducts = filteredProducts.slice(start, end);

    // Update filter count
    filterCount.innerHTML = `Mostrando <strong>${filteredProducts.length}</strong> gift cards`;

    // Show/hide states
    if (filteredProducts.length === 0) {
        emptyState.style.display = 'block';
        giftcardsGrid.innerHTML = '';
        paginationContainer.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';

    // Render grid
    giftcardsGrid.innerHTML = pageProducts.map(product => `
        <div class="giftcard-item" onclick="openPurchaseModal(${product.id})">
            <img src="${product.logoUrl}" alt="${product.name}" class="giftcard-image" 
                 onerror="this.src='/assets/images/placeholder-giftcard.png'">
            <div class="giftcard-content">
                <div class="giftcard-brand">${product.brandName}</div>
                <div class="giftcard-name" title="${product.name}">${product.name}</div>
                <span class="giftcard-price-range">${getPriceLabel(product)}</span>
            </div>
        </div>
    `).join('');

    // Update pagination
    updatePagination();
}

function getPriceLabel(product) {
    if (product.denominationType === 'FIXED') {
        const prices = product.fixedDenominations;
        if (prices.length === 1) {
            return `$${prices[0]} USD`;
        }
        return `$${Math.min(...prices)} - $${Math.max(...prices)} USD`;
    } else {
        return `$${product.minDenomination} - $${product.maxDenomination} USD`;
    }
}

function updatePagination() {
    const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);

    if (totalPages <= 1) {
        paginationContainer.style.display = 'none';
        return;
    }

    paginationContainer.style.display = 'flex';
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;
    pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
}

// Search functionality
function handleSearch() {
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
        filteredProducts = [...allProducts];
    } else {
        filteredProducts = allProducts.filter(p =>
            p.name.toLowerCase().includes(query) ||
            p.brandName.toLowerCase().includes(query)
        );
    }

    currentPage = 1;
    renderProducts();
}

// Open Purchase Modal
function openPurchaseModal(productId) {
    selectedProduct = allProducts.find(p => p.id === productId);
    if (!selectedProduct) return;

    // Reset state
    selectedDenomination = null;
    selectedWallet = null;

    // Update modal info
    modalProductImage.src = selectedProduct.logoUrl;
    modalProductName.textContent = selectedProduct.name;
    modalProductBrand.textContent = selectedProduct.brandName;

    // Render denominations
    renderDenominations();

    // Render wallets
    renderWallets();

    // Reset summary
    orderSummary.style.display = 'none';
    confirmPurchaseBtn.disabled = true;

    // Show modal
    purchaseModal.classList.add('active');
}

function renderDenominations() {
    if (selectedProduct.denominationType === 'FIXED') {
        // Fixed denominations - show buttons
        denominationContainer.innerHTML = `
            <div class="denomination-grid">
                ${selectedProduct.fixedDenominations.map(price => `
                    <button type="button" class="denomination-btn" data-value="${price}">
                        $${price}
                    </button>
                `).join('')}
            </div>
        `;
    } else {
        // Range - show input
        denominationContainer.innerHTML = `
            <input type="number" class="form-control" id="customAmount" 
                   placeholder="Ingresa el monto ($${selectedProduct.minDenomination} - $${selectedProduct.maxDenomination})"
                   min="${selectedProduct.minDenomination}" 
                   max="${selectedProduct.maxDenomination}"
                   step="0.01">
            <small id="amountError" style="color: #dc3545; display: none; margin-top: 5px; font-weight: 500;">
                <i class="ri-error-warning-line"></i> El monto colocado es mayor al máximo permitido ($${selectedProduct.maxDenomination} USD)
            </small>
            <small style="color: #666; margin-top: 5px; display: block;">
                Mínimo: $${selectedProduct.minDenomination} USD | Máximo: $${selectedProduct.maxDenomination} USD
            </small>
        `;

        // Add change event
        const customInput = document.getElementById('customAmount');
        const amountError = document.getElementById('amountError');

        customInput.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);

            if (value > selectedProduct.maxDenomination) {
                amountError.style.display = 'block';
                selectedDenomination = null;
                updateOrderSummary();
            } else if (value >= selectedProduct.minDenomination && value <= selectedProduct.maxDenomination) {
                amountError.style.display = 'none';
                selectedDenomination = value;
                updateOrderSummary();
            } else {
                amountError.style.display = 'none'; // Optional: hide if < min, strictly following "greater than max" request
                selectedDenomination = null;
                updateOrderSummary();
            }
        });
    }
}

function renderWallets() {
    if (wallets.length === 0) {
        walletContainer.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #666;">
                No tienes balance disponible en ninguna billetera.
                <br><a href="/deposit" style="color: #ee6a3e;">Depositar fondos</a>
            </div>
        `;
        return;
    }

    walletContainer.className = 'wallet-select-grid';
    walletContainer.innerHTML = wallets.map(wallet => {
        // Map symbol to icon filename
        const iconMap = {
            'USDT': 'usdt.svg',
            'USDC': 'usdc.svg',
            'BTC': 'btc.svg',
            'ETH': 'eth.svg',
            'LTC': 'ltc.svg',
            'BIUSD': 'biusd.svg'
        };
        const iconFile = iconMap[wallet.symbol] || 'usdt.svg';

        return `
        <label class="wallet-option" data-symbol="${wallet.symbol}">
            <input type="radio" name="wallet" value="${wallet.walletId}" data-symbol="${wallet.symbol}">
            <div class="wallet-icon">
                <img src="/assets/coins/${iconFile}" alt="${wallet.symbol}">
            </div>
            <div class="wallet-info">
                <strong>${wallet.symbol}</strong>
            </div>
            <div class="wallet-balance">
                <strong>${formatNumber(wallet.totalBalance)}</strong>
                <small style="font-size: 0.75rem; color: #28a745;">disponible</small>
            </div>
        </label>
    `}).join('');
}

async function updateOrderSummary() {
    if (!selectedDenomination || !selectedWallet) {
        orderSummary.style.display = 'none';
        confirmPurchaseBtn.disabled = true;
        return;
    }

    // Show loading state
    orderSummary.style.display = 'block';
    confirmPurchaseBtn.disabled = true;
    summaryAmount.textContent = 'Calculando...';
    document.getElementById('summaryProviderFee').textContent = '-';
    document.getElementById('summaryServiceFee').textContent = '-';
    summaryTotal.textContent = '-';

    try {
        const response = await fetch(`${API_BASE}/quote`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                productId: selectedProduct.id,
                unitPriceUsd: selectedDenomination,
                quantity: 1,
                currency: selectedWallet
            })
        });

        const data = await response.json();

        if (!data.success) {
            showAlert(data.error || 'Error al obtener cotización', 'danger');
            orderSummary.style.display = 'none';
            return;
        }

        const quote = data.data;

        // Display itemized fees
        summaryAmount.textContent = `$${quote.giftValue.toFixed(2)} USD`;
        document.getElementById('summaryProviderFee').textContent = `$${quote.providerFee.toFixed(2)} USD`;
        document.getElementById('summaryServiceFee').textContent = `$${quote.serviceFee.toFixed(2)} USD`;
        summaryTotal.textContent = `$${quote.totalUsd.toFixed(2)} USD`;

        // Show crypto conversion for non-stablecoins
        const cryptoConversionRow = document.getElementById('cryptoConversion');
        const isStable = ['USDT', 'USDC', 'BIUSD'].includes(selectedWallet.toUpperCase());

        if (!isStable && quote.cryptoAmount) {
            cryptoConversionRow.style.display = 'flex';
            document.getElementById('summaryCrypto').textContent =
                `${quote.cryptoAmount.toFixed(8)} ${selectedWallet}`;
        } else {
            cryptoConversionRow.style.display = 'none';
        }

        // Check wallet balance
        const wallet = wallets.find(w => w.symbol === selectedWallet);
        const requiredAmount = isStable ? quote.totalUsd : quote.cryptoAmount;

        if (!wallet || wallet.totalBalance < requiredAmount) {
            showAlert('Balance insuficiente en la billetera seleccionada', 'danger');
            confirmPurchaseBtn.disabled = true;
            return;
        }

        confirmPurchaseBtn.disabled = false;
    } catch (error) {
        console.error('Error getting quote:', error);
        showAlert('Error al obtener cotización', 'danger');
        orderSummary.style.display = 'none';
    }
}

// Confirm Purchase
async function confirmPurchase() {
    if (!selectedProduct || !selectedDenomination || !selectedWallet) {
        showAlert('Selecciona todos los campos', 'danger');
        return;
    }

    confirmPurchaseBtn.disabled = true;
    confirmPurchaseBtn.innerHTML = '<i class="ri-loader-4-line"></i> Procesando...';

    try {
        // Find the wallet with the highest balance for the selected currency
        const walletGroup = wallets.find(w => w.symbol === selectedWallet);
        const bestWallet = walletGroup.wallets.reduce((prev, current) =>
            (parseFloat(prev.balance) > parseFloat(current.balance)) ? prev : current
        );

        const response = await fetch(`${API_BASE}/orders`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                productId: selectedProduct.id,
                countryCode: COUNTRY_CODE,
                quantity: 1,
                unitPriceUsd: selectedDenomination,
                walletId: bestWallet.id,
                currency: selectedWallet
            })
        });

        const data = await response.json();

        if (data.success) {
            // Close purchase modal
            purchaseModal.classList.remove('active');

            // Get order details with codes
            await showSuccessModal(data.data);

            // Reload wallets to update balances
            loadWallets();
        } else {
            showAlert(data.error || 'Error al procesar la compra', 'danger');
        }
    } catch (error) {
        console.error('Error confirming purchase:', error);
        showAlert('Error de conexión', 'danger');
    } finally {
        confirmPurchaseBtn.disabled = false;
        confirmPurchaseBtn.innerHTML = '<i class="ri-shopping-cart-2-line"></i> Confirmar Compra';
    }
}

async function showSuccessModal(order) {
    try {
        const orderId = order.orderId || order.id;

        // If we already have the codes in the initial object, use them
        // The API returns 'giftcardCodes' in the POST response
        let finalOrderData = order;

        // Only fetch if we don't have codes or if we want to confirm details
        // But usually POST response is enough if successful
        if (!order.giftcardCodes || order.giftcardCodes.length === 0) {
            // Try fetching details if codes are missing (maybe async processing?)
            // Only fetch if we have a valid ID
            if (orderId) {
                const response = await fetch(`${API_BASE}/orders/${orderId}`, {
                    headers: getAuthHeaders()
                });
                const data = await response.json();
                if (data.success && data.data) {
                    finalOrderData = data.data;
                }
            }
        }

        // Display codes
        // Check for 'giftcardCodes' (from POST DTO) or 'codes' (from GET DTO - inconsistencies in naming?)
        // GiftcardService GET returns: codes: Array<{...}>
        // GiftcardService POST returns: giftcardCodes: Array<{...}>
        const codesList = finalOrderData.giftcardCodes || finalOrderData.codes;

        if (codesList && codesList.length > 0) {
            const codes = codesList.map(c => c.cardNumber || c.pinCode || c).join('\n');
            giftCardCode.textContent = codes;
            copyCodeBtn.style.display = 'block'; // Show button
        } else {
            // Show message with link to my-giftcards
            giftCardCode.innerHTML = 'Estamos procesando tu orden...<br>el código lo visualizarás <a href="/giftcards/my-giftcards" style="color: #ee6a3e; text-decoration: underline; font-weight: bold;">aquí</a>';
            copyCodeBtn.style.display = 'none'; // Hide button
        }

        // Display redemption instructions
        if (finalOrderData.redemptionInstructions) {
            instructionsText.textContent = finalOrderData.redemptionInstructions;
        } else {
            instructionsText.textContent = 'Visita el sitio web del proveedor para canjear tu gift card.';
        }

    } catch (error) {
        console.error('Error fetching order details:', error);
        giftCardCode.innerHTML = 'Estamos procesando tu orden...<br>el código lo visualizarás <a href="/giftcards/my-giftcards" style="color: #ee6a3e; text-decoration: underline; font-weight: bold;">aquí</a>';
        instructionsText.textContent = 'Consulta tu historial para ver los detalles.';
    }

    successModal.classList.add('active');
}

// Event Listeners
function setupEventListeners() {
    // Search
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(handleSearch, 300);
    });

    // Pagination
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderProducts();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
        if (currentPage < totalPages) {
            currentPage++;
            renderProducts();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    // Modal close
    closeModal.addEventListener('click', () => {
        purchaseModal.classList.remove('active');
    });

    purchaseModal.addEventListener('click', (e) => {
        if (e.target === purchaseModal) {
            purchaseModal.classList.remove('active');
        }
    });

    // Denomination selection (delegated)
    denominationContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('denomination-btn')) {
            // Remove previous selection
            denominationContainer.querySelectorAll('.denomination-btn').forEach(btn => {
                btn.classList.remove('selected');
            });
            // Add selection
            e.target.classList.add('selected');
            selectedDenomination = parseFloat(e.target.dataset.value);
            updateOrderSummary();
        }
    });

    // Wallet selection (delegated)
    walletContainer.addEventListener('click', (e) => {
        const option = e.target.closest('.wallet-option');
        if (option && !option.classList.contains('disabled')) {
            // Remove previous selection
            walletContainer.querySelectorAll('.wallet-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            // Add selection
            option.classList.add('selected');
            option.querySelector('input').checked = true;
            selectedWallet = option.dataset.symbol;
            updateOrderSummary();
        }
    });

    // Confirm purchase
    confirmPurchaseBtn.addEventListener('click', confirmPurchase);

    // Success modal
    copyCodeBtn.addEventListener('click', () => {
        const code = giftCardCode.textContent;
        navigator.clipboard.writeText(code).then(() => {
            copyCodeBtn.innerHTML = '<i class="ri-check-line"></i> Copiado!';
            setTimeout(() => {
                copyCodeBtn.innerHTML = '<i class="ri-file-copy-line"></i> Copiar código';
            }, 2000);
        });
    });

    closeSuccessBtn.addEventListener('click', () => {
        successModal.classList.remove('active');
    });

    successModal.addEventListener('click', (e) => {
        if (e.target === successModal) {
            successModal.classList.remove('active');
        }
    });

    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('show');
        });
    }

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
}

// Utility Functions
function formatNumber(num) {
    return parseFloat(num).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
    });
}

function showAlert(message, type = 'info') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.innerHTML = `<i class="ri-${type === 'danger' ? 'error' : 'check'}-circle-line"></i> ${message}`;

    alertContainer.innerHTML = '';
    alertContainer.appendChild(alert);

    setTimeout(() => {
        alert.remove();
    }, 5000);
}

// Make function globally accessible
window.openPurchaseModal = openPurchaseModal;
