// Variables globales
let currentDepositId = null;
let pollingInterval = null;
let currentPrice = null;
let currentMinAmountUsd = null; // Cached minimum amount for validation
let depositHistoryPage = 1;
let depositHistoryTotalPages = 1;
const DEPOSIT_HISTORY_PAGE_SIZE = 5;

// Opciones de criptomoneda para depósito (estilo móvil)
const DEPOSIT_CRYPTO_CURRENCIES = [
    { value: 'usdtmatic', label: 'USDT (Polygon)', symbol: 'USDT' },
    { value: 'usdttrc20', label: 'USDT (TRC20)', symbol: 'USDT' },
    { value: 'usdcbsc', label: 'USDC (BSC)', symbol: 'USDC' },
    { value: 'btc', label: 'Bitcoin (BTC)', symbol: 'BTC' },
    { value: 'ltc', label: 'Litecoin (LTC)', symbol: 'LTC' },
    { value: 'eth', label: 'Ethereum (ETH)', symbol: 'ETH' }
];

// Opciones de moneda para depósito fiat (PayPal/TDC) - estilo móvil
const FIAT_ASSET_OPTIONS = [
    { value: 'USDT', label: 'USDT', symbol: 'USDT' },
    { value: 'USDC', label: 'USDC', symbol: 'USDC' },
    { value: 'BIUSD', label: 'BiUSD', symbol: 'BIUSD' }
];

// Claves para persistir orden OTC ante recargas/caídas (sessionStorage + localStorage como respaldo)
const OTC_ACTIVE_ORDER_KEY = 'otc_requester_active_order';

// Inicialización cuando se carga la página
document.addEventListener('DOMContentLoaded', async function () {
    // PayPal return: capturar depósito si viene de aprobación
    const urlParams = new URLSearchParams(window.location.search);
    const paypalToken = urlParams.get('token');
    const paypalReturn = urlParams.get('paypal_return');
    if (paypalReturn === '1' && paypalToken) {
        await handlePayPalReturn(paypalToken);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    if (urlParams.get('paypal_cancel') === '1') {
        showError('Pago cancelado.');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Restaurar flujo OTC cuanto antes (no bloquear carga) - persistencia ante caídas
    checkOtcRequesterActive();

    // Cargar métodos fiat y habilitar/deshabilitar card
    await loadFiatMethods();

    // Iniciar PayPal Express (SDK) si está configurado - pago en popup en lugar de redirect
    await initPayPalExpress();

    // Cargar historial (con manejo de errores)
    await loadDepositHistory().catch(error => {
        console.error('Error al cargar historial inicial:', error);
    });

    // Verificar si hay depósitos pendientes y deshabilitar formulario si es necesario
    checkPendingDeposits();

    // Event listeners (solo si el formulario está visible)
    const depositForm = document.getElementById('depositForm');
    if (depositForm) {
        depositForm.addEventListener('submit', handleDepositSubmit);
        const priceAmountInput = document.getElementById('priceAmount');
        const payCurrencyInput = document.getElementById('payCurrency');
        const payCurrencyTrigger = document.getElementById('payCurrencyTrigger');
        if (priceAmountInput) {
            priceAmountInput.addEventListener('input', handleAmountChange);
        }
        if (payCurrencyInput) {
            payCurrencyInput.addEventListener('change', handleCurrencyChange);
        }
        if (payCurrencyTrigger) {
            payCurrencyTrigger.addEventListener('click', function (e) {
                if (this.classList.contains('disabled')) return;
                openCryptoCurrencySelector();
            });
        }
    }

    // Fiat deposit form
    const fiatForm = document.getElementById('fiatDepositForm');
    if (fiatForm) {
        fiatForm.addEventListener('submit', handleFiatDepositSubmit);
        const fiatAmount = document.getElementById('fiatAmountUsd');
        if (fiatAmount) {
            fiatAmount.addEventListener('input', scheduleFiatCommissionUpdate);
        }
        const fiatAssetTrigger = document.getElementById('fiatAssetTrigger');
        if (fiatAssetTrigger) {
            fiatAssetTrigger.addEventListener('click', function () {
                openFiatAssetSelector();
            });
        }
    }

    // OTC trigger click
    const otcCryptoTrigger = document.getElementById('otcCryptoAssetTrigger');
    if (otcCryptoTrigger) {
        otcCryptoTrigger.addEventListener('click', function () { openOtcCryptoSelector(); });
    }

    // OTC search modal: stop polling when closed
    const otcSearchModal = document.getElementById('otcSearchModal');
    if (otcSearchModal) {
        otcSearchModal.addEventListener('hidden.bs.modal', function () {
            stopOtcPolling();
            if (otcSearchTimerInterval) {
                clearInterval(otcSearchTimerInterval);
                otcSearchTimerInterval = null;
            }
        });
    }

    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function (e) {
            e.preventDefault();
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            window.location.href = '/login';
        });
    }
});

/**
 * Selecciona el tipo de depósito
 * Disponible globalmente para onclick handlers
 */
window.selectDepositType = function (type) {
    const typeSelection = document.getElementById('depositTypeSelection');
    const fiatMethods = document.getElementById('fiatMethodsSection');
    const fiatDeposit = document.getElementById('fiatDepositSection');
    const cryptoForm = document.getElementById('cryptoDepositForm');

    if (type === 'crypto') {
        typeSelection.style.display = 'none';
        if (fiatMethods) fiatMethods.style.display = 'none';
        if (fiatDeposit) fiatDeposit.style.display = 'none';
        cryptoForm.style.display = 'block';
    } else if (type === 'fiat') {
        typeSelection.style.display = 'none';
        cryptoForm.style.display = 'none';
        if (fiatDeposit) fiatDeposit.style.display = 'none';
        if (fiatMethods) fiatMethods.style.display = 'block';
    }
};

/**
 * Abre el modal para seleccionar criptomoneda (estilo móvil)
 */
window.openCryptoCurrencySelector = function () {
    const modalEl = document.getElementById('cryptoCurrencyModal');
    const listEl = document.getElementById('cryptoCurrencyList');
    const current = document.getElementById('payCurrency')?.value || '';
    if (!modalEl || !listEl) return;
    listEl.innerHTML = DEPOSIT_CRYPTO_CURRENCIES.map(c => {
        const isSelected = c.value === current;
        const iconPath = `/assets/coins/${c.symbol.toLowerCase()}.svg`;
        return `
            <li class="list-group-item list-group-item-action d-flex align-items-center py-3" data-value="${c.value}" role="button">
                <img src="${iconPath}" alt="${c.symbol}" class="asset-icon-small me-3" style="width: 32px; height: 32px;" onerror="this.src='/assets/coins/usdt.svg'">
                <span class="flex-grow-1 fw-semibold">${c.label}</span>
                ${isSelected ? '<i class="ri-check-line text-success fs-5"></i>' : ''}
            </li>
        `;
    }).join('');
    listEl.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', function () {
            selectCryptoCurrency(this.dataset.value);
            bootstrap.Modal.getInstance(modalEl)?.hide();
        });
    });
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
};

/**
 * Restablece la UI del selector de criptomoneda al estado inicial
 */
function resetCryptoSelectorUI() {
    const payCurrencyInput = document.getElementById('payCurrency');
    const payCurrencyLabel = document.getElementById('payCurrencyLabel');
    const payCurrencyIcon = document.getElementById('payCurrencyIcon');
    if (payCurrencyInput) payCurrencyInput.value = '';
    if (payCurrencyLabel) {
        payCurrencyLabel.textContent = 'Haz clic para seleccionar la moneda';
        payCurrencyLabel.classList.add('unselected');
    }
    if (payCurrencyIcon) payCurrencyIcon.src = '/assets/coins/usdt.svg';
}

/**
 * Selecciona una criptomoneda y actualiza el formulario
 */
window.selectCryptoCurrency = function (value) {
    const c = DEPOSIT_CRYPTO_CURRENCIES.find(x => x.value === value);
    if (!c) return;
    const payCurrencyInput = document.getElementById('payCurrency');
    const payCurrencyLabel = document.getElementById('payCurrencyLabel');
    const payCurrencyIcon = document.getElementById('payCurrencyIcon');
    if (payCurrencyInput) payCurrencyInput.value = value;
    if (payCurrencyLabel) {
        payCurrencyLabel.textContent = c.label;
        payCurrencyLabel.classList.remove('unselected');
    }
    if (payCurrencyIcon) payCurrencyIcon.src = `/assets/coins/${c.symbol.toLowerCase()}.svg`;
    payCurrencyInput?.dispatchEvent(new Event('change'));
};

/**
 * Abre el modal para seleccionar moneda fiat (Recibir en)
 */
window.openFiatAssetSelector = function () {
    const modalEl = document.getElementById('fiatAssetModal');
    const listEl = document.getElementById('fiatAssetList');
    const current = document.getElementById('fiatAsset')?.value || '';
    if (!modalEl || !listEl) return;
    listEl.innerHTML = FIAT_ASSET_OPTIONS.map(c => {
        const isSelected = c.value === current;
        const iconPath = `/assets/coins/${c.symbol.toLowerCase()}.svg`;
        return `
            <li class="list-group-item list-group-item-action d-flex align-items-center py-3" data-value="${c.value}" role="button">
                <img src="${iconPath}" alt="${c.symbol}" class="asset-icon-small me-3" style="width: 32px; height: 32px;" onerror="this.src='/assets/coins/usdt.svg'">
                <span class="flex-grow-1 fw-semibold">${c.label}</span>
                ${isSelected ? '<i class="ri-check-line text-success fs-5"></i>' : ''}
            </li>
        `;
    }).join('');
    listEl.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', function () {
            selectFiatAsset(this.dataset.value);
            bootstrap.Modal.getInstance(modalEl)?.hide();
        });
    });
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
};

/**
 * Selecciona una moneda fiat y actualiza el formulario
 */
window.selectFiatAsset = function (value) {
    const c = FIAT_ASSET_OPTIONS.find(x => x.value === value);
    if (!c) return;
    const fiatAssetInput = document.getElementById('fiatAsset');
    const fiatAssetLabel = document.getElementById('fiatAssetLabel');
    const fiatAssetIcon = document.getElementById('fiatAssetIcon');
    if (fiatAssetInput) fiatAssetInput.value = value;
    if (fiatAssetLabel) {
        fiatAssetLabel.textContent = c.label;
        fiatAssetLabel.classList.remove('unselected');
    }
    if (fiatAssetIcon) fiatAssetIcon.src = `/assets/coins/${c.symbol.toLowerCase()}.svg`;
    scheduleFiatCommissionUpdate();
};

let selectedFiatMethodCode = 'PAYPAL';
let paypalClientId = null;
let paypalLoaded = false;

function updateFiatPayButton() {
    const btn = document.getElementById('fiatPayPalBtn');
    if (!btn) return;
    if (selectedFiatMethodCode === 'PAYPAL_CARD') {
        btn.innerHTML = '<i class="ri-bank-card-line"></i> Paga con tu TDD/TDC a través de PayPal';
    } else {
        btn.innerHTML = '<i class="ri-paypal-line"></i> Pagar con PayPal';
    }
}

window.selectFiatMethod = function (code) {
    const el = document.getElementById('fiatMethod' + (code === 'PAYPAL' ? 'PayPal' : 'Card'));
    if (el && el.classList.contains('disabled')) return;
    if (!localStorage.getItem('accessToken')) {
        const err = document.getElementById('fiatMethodsError');
        if (err) { err.textContent = 'Debes iniciar sesión para depositar.'; err.style.display = 'block'; }
        setTimeout(() => window.location.href = '/login', 2000);
        return;
    }
    selectedFiatMethodCode = code;
    const fiatMethods = document.getElementById('fiatMethodsSection');
    const fiatDeposit = document.getElementById('fiatDepositSection');
    if (fiatMethods) fiatMethods.style.display = 'none';
    if (fiatDeposit) fiatDeposit.style.display = 'block';
    const fiatErr = document.getElementById('fiatError');
    if (fiatErr) fiatErr.style.display = 'none';
    updateFiatPayButton();
    updateFiatCommissionNotice();
    renderPayPalButtonsIfActive();
};

window.goBackToFiatMethods = function () {
    const fiatMethods = document.getElementById('fiatMethodsSection');
    const fiatDeposit = document.getElementById('fiatDepositSection');
    if (fiatDeposit) fiatDeposit.style.display = 'none';
    if (fiatMethods) fiatMethods.style.display = 'block';
};

function loadPayPalScript(clientId) {
    return new Promise((resolve) => {
        if (window.paypal) {
            paypalLoaded = true;
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&locale=es_ES`;
        script.async = true;
        script.onload = () => {
            paypalLoaded = true;
            resolve();
        };
        script.onerror = () => resolve();
        document.head.appendChild(script);
    });
}

async function initPayPalExpress() {
    try {
        const res = await fetch('/api/config/paypal-client-id');
        const data = await res.json();
        if (data.clientId) {
            paypalClientId = data.clientId;
            await loadPayPalScript(data.clientId);
        }
    } catch (e) {
        console.warn('PayPal Express no disponible:', e);
    }
}

function renderPayPalButtonsIfActive() {
    const redirectWrap = document.getElementById('fiatPayRedirectWrapper');
    const container = document.getElementById('paypalButtonsContainer');
    if (!redirectWrap || !container) return;
    if (paypalLoaded && window.paypal && paypalClientId) {
        redirectWrap.style.display = 'none';
        container.style.display = 'block';
        container.innerHTML = '';
        const fundingSource = selectedFiatMethodCode === 'PAYPAL_CARD' ? window.paypal.FUNDING.CARD : window.paypal.FUNDING.PAYPAL;
        try {
            window.paypal.Buttons({
                fundingSource,
                style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'pay' },
                createOrder: async () => {
                    const amountUsd = parseFloat(document.getElementById('fiatAmountUsd')?.value) || 0;
                    const asset = document.getElementById('fiatAsset')?.value;
                    const errEl = document.getElementById('fiatError');
                    if (!amountUsd || amountUsd < 5 || amountUsd > 5000) {
                        errEl.textContent = 'Monto debe estar entre 5 y 5000 USD.';
                        errEl.style.display = 'block';
                        throw new Error('Monto inválido');
                    }
                    if (!asset) {
                        errEl.textContent = 'Selecciona la moneda a recibir.';
                        errEl.style.display = 'block';
                        throw new Error('Selecciona moneda');
                    }
                    const token = localStorage.getItem('accessToken');
                    if (!token) throw new Error('Debes iniciar sesión');
                    errEl.style.display = 'none';
                    const res = await fetch('/api/deposits/fiat', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ amountUsd, asset, paymentMethodCode: selectedFiatMethodCode })
                    });
                    const data = await res.json();
                    if (res.status === 401) throw new Error('Sesión expirada');
                    if (!res.ok) throw new Error(data.message || data.error || 'Error al crear depósito');
                    if (!data.orderId) throw new Error('No se recibió orden');
                    return data.orderId;
                },
                onApprove: async (data) => {
                    const token = localStorage.getItem('accessToken');
                    if (!token) return;
                    try {
                        const res = await fetch('/api/deposits/fiat/capture', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ orderId: data.orderID })
                        });
                        const result = await res.json();
                        if (!res.ok) throw new Error(result.message || result.error);
                        const successEl = document.getElementById('fiatSuccess');
                        if (successEl) {
                            successEl.textContent = '¡Depósito acreditado! Recibiste ' + (result.deposit?.creditedAmount || '') + ' ' + (result.deposit?.asset || '');
                            successEl.style.display = 'block';
                            successEl.classList.remove('alert-danger');
                            successEl.classList.add('alert-success');
                        }
                        document.getElementById('fiatError').style.display = 'none';
                        loadDepositHistory();
                        selectDepositType('fiat');
                        selectFiatMethod(selectedFiatMethodCode || 'PAYPAL');
                    } catch (err) {
                        document.getElementById('fiatError').textContent = err.message || 'Error al acreditar';
                        document.getElementById('fiatError').style.display = 'block';
                    }
                },
                onCancel: () => {},
                onError: (err) => {
                    document.getElementById('fiatError').textContent = err?.message || 'Error de PayPal';
                    document.getElementById('fiatError').style.display = 'block';
                }
            }).render('#paypalButtonsContainer');
        } catch (e) {
            console.error('Error renderizando PayPal:', e);
            redirectWrap.style.display = 'block';
            container.style.display = 'none';
        }
    } else {
        redirectWrap.style.display = 'block';
        container.style.display = 'none';
    }
}


/**
 * Vuelve a la selección de tipo de depósito
 * Disponible globalmente para onclick handlers
 */
window.goBackToDepositTypeSelection = function () {
    const typeSelection = document.getElementById('depositTypeSelection');
    const fiatMethods = document.getElementById('fiatMethodsSection');
    const fiatDeposit = document.getElementById('fiatDepositSection');
    const cryptoForm = document.getElementById('cryptoDepositForm');

    typeSelection.style.display = 'block';
    if (fiatMethods) fiatMethods.style.display = 'none';
    if (fiatDeposit) fiatDeposit.style.display = 'none';
    cryptoForm.style.display = 'none';

    // Limpiar formulario si existe
    const depositForm = document.getElementById('depositForm');
    if (depositForm) {
        depositForm.reset();
        resetCryptoSelectorUI();
    }

    // Ocultar sección de dirección si está visible
    const addressSection = document.getElementById('depositAddressSection');
    if (addressSection) {
        addressSection.classList.remove('active');
    }

    // Detener polling si está activo
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
};

/**
 * Maneja el cambio de monto - actualiza la conversión
 */
async function handleAmountChange() {
    const amount = parseFloat(document.getElementById('priceAmount').value);
    const payCurrency = document.getElementById('payCurrency').value;

    if (amount > 0 && payCurrency) {
        await updateConversion(amount, payCurrency);
    } else {
        document.getElementById('conversionInfo').style.display = 'none';
    }
}

/**
 * Maneja el cambio de criptomoneda - actualiza la conversión y muestra monto mínimo
 */
async function handleCurrencyChange() {
    const amount = parseFloat(document.getElementById('priceAmount').value);
    const payCurrency = document.getElementById('payCurrency').value;

    if (amount > 0 && payCurrency) {
        await updateConversion(amount, payCurrency);
    }

    // Fetch and display minimum amount when currency is selected
    if (payCurrency) {
        await fetchAndShowMinAmount(payCurrency);
    } else {
        hideMinAmountInfo();
    }
}

/**
 * Obtiene y muestra el monto mínimo de depósito para una moneda
 */
async function fetchAndShowMinAmount(payCurrency) {
    const minAmountInfo = document.getElementById('minAmountInfo');
    const minAmountText = document.getElementById('minAmountText');

    if (!minAmountInfo || !minAmountText) return;

    try {
        const accessToken = localStorage.getItem('accessToken');
        const response = await fetch(`/api/deposits/min-amount/${payCurrency}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error('Error fetching min amount');
            hideMinAmountInfo();
            return;
        }

        const data = await response.json();

        // Format the currency name and get base asset
        const currencyInfo = {
            'usdtmatic': { name: 'USDT (Polygon)', asset: 'USDT' },
            'usdttrc20': { name: 'USDT (TRC20)', asset: 'USDT' },
            'usdcbsc': { name: 'USDC (BSC)', asset: 'USDC' },
            'btc': { name: 'Bitcoin', asset: 'BTC' },
            'ltc': { name: 'Litecoin', asset: 'LTC' },
            'eth': { name: 'Ethereum', asset: 'ETH' }
        };
        const info = currencyInfo[payCurrency.toLowerCase()] || { name: payCurrency.toUpperCase(), asset: payCurrency.toUpperCase() };

        // Format crypto amount (fewer decimals for stablecoins, more for BTC/ETH)
        const isStablecoin = ['USDT', 'USDC'].includes(info.asset);
        const cryptoDecimals = isStablecoin ? 2 : 6;
        const minCrypto = data.minAmountCrypto.toFixed(cryptoDecimals);

        // Show minimum amount in crypto (this is what the provider validates)
        minAmountText.innerHTML = `<strong>Monto mínimo:</strong> ${minCrypto} ${info.asset} (≈ $${data.minAmountUsd.toFixed(2)} USD)`;
        minAmountInfo.style.display = 'block';

        // Cache the minimum for form validation
        currentMinAmountUsd = data.minAmountUsd;

    } catch (error) {
        console.error('Error fetching min amount:', error);
        hideMinAmountInfo();
    }
}


/**
 * Oculta la información de monto mínimo
 */
function hideMinAmountInfo() {
    const minAmountInfo = document.getElementById('minAmountInfo');
    if (minAmountInfo) {
        minAmountInfo.style.display = 'none';
    }
    // Clear cached minimum amount
    currentMinAmountUsd = null;
}

/**
 * Actualiza la información de conversión USD a crypto
 */
async function updateConversion(usdAmount, payCurrency) {
    try {
        // Extraer el símbolo del asset (ej: "usdtmatic" -> "USDT")
        const assetSymbol = extractAssetSymbol(payCurrency);

        // Obtener precio desde el API
        const response = await fetch(`/api/prices/latest?currency=${assetSymbol}`);
        if (!response.ok) {
            throw new Error('Error al obtener precio');
        }

        const data = await response.json();
        currentPrice = parseFloat(data.price);

        // Calcular cantidad en crypto
        const cryptoAmount = usdAmount / currentPrice;

        // Mostrar información de conversión
        const conversionInfo = document.getElementById('conversionInfo');
        conversionInfo.innerHTML = `
            <strong>Equivalente:</strong> ${cryptoAmount.toFixed(8)} ${assetSymbol}
            <br><small>Precio: $${currentPrice.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} por ${assetSymbol}</small>
        `;
        conversionInfo.style.display = 'block';
    } catch (error) {
        console.error('Error al actualizar conversión:', error);
        document.getElementById('conversionInfo').style.display = 'none';
    }
}

/**
 * Extrae el símbolo del asset desde payCurrency
 */
function extractAssetSymbol(payCurrency) {
    const currencyMap = {
        'usdtmatic': 'USDT',
        'usdttrc20': 'USDT',
        'usdcbsc': 'USDC',
        'btc': 'BTC',
        'ltc': 'LTC',
        'eth': 'ETH'
    };
    return currencyMap[payCurrency.toLowerCase()] || payCurrency.toUpperCase();
}

/**
 * Maneja el envío del formulario de depósito
 */
async function handleDepositSubmit(e) {
    e.preventDefault();

    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showError('No estás autenticado. Por favor, inicia sesión.');
        setTimeout(() => window.location.href = '/login', 2000);
        return;
    }

    const priceAmount = parseFloat(document.getElementById('priceAmount').value);
    const payCurrency = document.getElementById('payCurrency').value;

    if (!priceAmount || priceAmount <= 0) {
        showError('Por favor, ingresa un monto válido mayor a cero.');
        return;
    }

    if (!payCurrency) {
        showError('Por favor, selecciona una criptomoneda.');
        return;
    }

    // Validate against minimum amount if we have it cached
    // Now using consistent parameters (is_fixed_rate=true) with createPayment API
    if (currentMinAmountUsd && priceAmount < currentMinAmountUsd) {
        showError(`El monto mínimo de depósito es $${currentMinAmountUsd.toFixed(2)} USD. Por favor, ingrese un monto mayor.`);
        return;
    }

    // Deshabilitar botón
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="ri-loader-4-line"></i> Creando depósito...';

    try {
        const response = await fetch('/api/deposits', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                priceAmount: priceAmount,
                payCurrency: payCurrency
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Error al crear depósito');
        }

        // Mostrar dirección y QR
        showDepositAddress(data.deposit);

        // Iniciar polling
        currentDepositId = data.deposit.id;
        startPolling(data.deposit.id);

        // Deshabilitar formulario mientras hay depósito pendiente
        disableDepositForm();

        // Ocultar formulario
        document.getElementById('depositForm').style.display = 'none';

        // Recargar historial
        loadDepositHistory();

    } catch (error) {
        console.error('Error al crear depósito:', error);
        showError(error.message || 'Error al crear depósito. Por favor, intenta nuevamente.');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="ri-add-circle-line"></i> Crear Depósito';
    }
}

/**
 * Muestra la dirección de depósito y genera el QR
 */
async function showDepositAddress(deposit) {
    const section = document.getElementById('depositAddressSection');
    const addressSpan = document.getElementById('payAddress');
    const payAmountDisplay = document.getElementById('payAmountDisplay');
    const payCurrencyDisplay = document.getElementById('payCurrencyDisplay');
    const statusBadge = document.getElementById('depositStatus');

    // Si el depósito está confirmado o completado, mostrar vista de éxito
    const statusLower = (deposit.status || '').toLowerCase();
    console.log('showDepositAddress - Estado del depósito:', deposit.status, '->', statusLower);
    if (statusLower === 'confirmed' || statusLower === 'finished') {
        console.log('Depósito confirmado, llamando a showDepositSuccess');
        showDepositSuccess(deposit);
        return;
    }
    console.log('Depósito no confirmado, mostrando dirección y QR');

    // Mostrar dirección
    addressSpan.textContent = deposit.payAddress;
    payAmountDisplay.textContent = deposit.payAmount.toFixed(8);
    payCurrencyDisplay.textContent = deposit.payCurrency.toUpperCase();

    // Calcular y mostrar monto a acreditar y comisiones
    await updateDepositDetails(deposit);

    // Preparar datos del contador antes de actualizar estado
    const shouldAddCountdown = (deposit.status === 'waiting') && deposit.createdAt;
    let countdownExpirationTime = null;
    if (shouldAddCountdown) {
        const depositTime = new Date(deposit.createdAt).getTime();
        countdownExpirationTime = depositTime + (10 * 60 * 1000); // 10 minutos
    }

    // Actualizar estado (esto puede limpiar el contenido)
    updateDepositStatus(deposit.status, statusBadge);

    // Agregar contador regresivo DESPUÉS de actualizar el estado
    if (shouldAddCountdown && countdownExpirationTime) {
        const countdownId = 'deposit-countdown';

        // Limpiar contador anterior si existe
        const existingCountdown = document.getElementById(countdownId);
        if (existingCountdown) {
            existingCountdown.remove();
        }

        // Agregar contador inmediatamente después de actualizar el estado
        // Usar requestAnimationFrame para asegurar que el DOM esté listo
        requestAnimationFrame(() => {
            // Verificar que el badge aún existe
            if (!statusBadge || !statusBadge.parentNode) {
                console.warn('Badge no encontrado para agregar contador');
                return;
            }

            // Verificar que no exista ya un contador (doble verificación)
            const existingCountdown = document.getElementById(countdownId);
            if (existingCountdown) {
                console.log('Contador ya existe, removiendo duplicado');
                existingCountdown.remove();
            }

            // Crear contador
            const countdownElement = document.createElement('span');
            countdownElement.id = countdownId;
            countdownElement.className = 'countdown-timer';
            countdownElement.style.marginLeft = '8px';
            countdownElement.style.fontWeight = 'bold';
            countdownElement.style.color = '#dc3545';
            countdownElement.style.display = 'inline-block';

            // Agregar al badge
            statusBadge.appendChild(countdownElement);

            console.log('Contador agregado al badge:', countdownId);

            // Iniciar contador inmediatamente
            startCountdown(countdownId, countdownExpirationTime);
        });
    }

    // Mostrar elementos de dirección y QR
    const addressDisplay = document.getElementById('addressDisplay');
    const qrCodeContainer = document.querySelector('.qr-code-container');
    const alertInfo = document.querySelector('#depositAddressSection .alert-info');
    const checkStatusBtn = document.getElementById('checkStatusBtn');

    if (addressDisplay) addressDisplay.style.display = 'flex';
    if (qrCodeContainer) qrCodeContainer.style.display = 'block';
    if (alertInfo) alertInfo.style.display = 'block';
    if (checkStatusBtn) checkStatusBtn.style.display = 'block';

    // Generar QR
    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = ''; // Limpiar QR anterior
    new QRCode(qrContainer, {
        text: deposit.payAddress,
        width: 256,
        height: 256,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
    });

    // Mostrar sección
    section.classList.add('active');

    // Scroll a la sección
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Muestra la vista de éxito cuando el depósito está confirmado
 */
function showDepositSuccess(deposit) {
    console.log('=== showDepositSuccess INICIADA ===');
    console.log('Depósito recibido:', deposit);

    const section = document.getElementById('depositAddressSection');
    if (!section) {
        console.error('ERROR: Sección depositAddressSection no encontrada');
        return;
    }
    console.log('Sección encontrada:', section);

    const statusBadge = document.getElementById('depositStatus');
    const addressDisplay = document.getElementById('addressDisplay');
    const qrCodeContainer = document.querySelector('.qr-code-container');
    const alertInfo = document.querySelector('#depositAddressSection .alert-info');
    const checkStatusBtn = document.getElementById('checkStatusBtn');

    console.log('Elementos encontrados:');
    console.log('- addressDisplay:', addressDisplay);
    console.log('- qrCodeContainer:', qrCodeContainer);
    console.log('- alertInfo:', alertInfo);
    console.log('- checkStatusBtn:', checkStatusBtn);

    // Ocultar elementos de dirección y QR de forma explícita
    if (addressDisplay) {
        addressDisplay.style.display = 'none';
        console.log('✅ Dirección ocultada');
    } else {
        console.warn('⚠️ addressDisplay no encontrado');
    }

    if (qrCodeContainer) {
        qrCodeContainer.style.display = 'none';
        console.log('✅ QR ocultado');
    } else {
        console.warn('⚠️ qrCodeContainer no encontrado');
    }

    if (alertInfo) {
        alertInfo.style.display = 'none';
        console.log('✅ Alerta ocultada');
    } else {
        console.warn('⚠️ alertInfo no encontrado');
    }

    if (checkStatusBtn) {
        checkStatusBtn.style.display = 'none';
        console.log('✅ Botón verificar ocultado');
    } else {
        console.warn('⚠️ checkStatusBtn no encontrado');
    }

    // Remover contador si existe
    const countdown = document.getElementById('deposit-countdown');
    if (countdown) {
        countdown.remove();
        console.log('Contador removido');
    }

    // Actualizar estado
    if (statusBadge) {
        updateDepositStatus(deposit.status, statusBadge);
    }

    // Cambiar título
    const title = section.querySelector('h3');
    if (title) {
        title.textContent = '¡Depósito Confirmado!';
    }

    // Crear o actualizar sección de éxito
    let successSection = document.getElementById('depositSuccessSection');
    if (!successSection) {
        successSection = document.createElement('div');
        successSection.id = 'depositSuccessSection';
        successSection.className = 'deposit-success-section';
        successSection.style.textAlign = 'center';
        successSection.style.padding = '40px 20px';

        // Insertar después del badge de estado
        statusBadge.parentNode.insertBefore(successSection, statusBadge.nextSibling);
    }

    // Calcular monto acreditado
    const creditedAmount = parseFloat(deposit.creditedAmount) || parseFloat(deposit.priceAmount) || 0;
    const assetSymbol = deposit.asset || deposit.payCurrency?.replace(/MATIC|TRC20|BSC|ERC20/gi, '').toUpperCase() || 'USDT';

    successSection.innerHTML = `
        <div style="margin-bottom: 30px;">
            <div style="width: 120px; height: 120px; margin: 0 auto 20px; background: linear-gradient(135deg, #28a745 0%, #20c997 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 30px rgba(40, 167, 69, 0.3);">
                <i class="ri-check-line" style="font-size: 60px; color: white; font-weight: bold;"></i>
            </div>
            <h2 style="color: #28a745; margin-bottom: 15px; font-size: 28px; font-weight: 600;">¡Depósito Acreditado!</h2>
            <p style="color: #666; font-size: 16px; margin-bottom: 25px; line-height: 1.6;">
                Tu depósito de <strong style="color: #333; font-size: 18px;">${creditedAmount.toFixed(8)} ${assetSymbol}</strong> ha sido confirmado y acreditado exitosamente en tu balance.
            </p>
            <div style="background: #f8f9fa; border-radius: 10px; padding: 20px; margin: 20px 0; border-left: 4px solid #28a745;">
                <p style="margin: 0; color: #495057; font-size: 14px;">
                    <i class="ri-information-line" style="color: #28a745; margin-right: 8px;"></i>
                    El monto ya está disponible en tu cuenta y puedes utilizarlo para realizar transacciones.
                </p>
            </div>
        </div>
    `;

    // Mostrar sección
    section.classList.add('active');

    // Scroll a la sección
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Calcula y muestra el monto a acreditar y las comisiones
 */
async function updateDepositDetails(deposit) {
    const creditedAmountDisplay = document.getElementById('creditedAmountDisplay');
    const feeAmountDisplay = document.getElementById('feeAmountDisplay');

    if (!creditedAmountDisplay || !feeAmountDisplay) {
        return;
    }

    try {
        const assetSymbol = extractAssetSymbol(deposit.payCurrency);
        const priceAmount = parseFloat(deposit.priceAmount) || 0;
        const payAmount = parseFloat(deposit.payAmount) || 0;

        let creditedAmount = 0;

        // Para stables (USDT/USDC), el monto a acreditar es 1:1 con USD
        if (assetSymbol === 'USDT' || assetSymbol === 'USDC') {
            creditedAmount = priceAmount;
        } else {
            // Para monedas volátiles, convertir USD a cripto usando precio actual
            const response = await fetch(`/api/prices/latest?currency=${assetSymbol}`);
            if (response.ok) {
                const data = await response.json();
                const price = parseFloat(data.price);
                if (price > 0) {
                    creditedAmount = priceAmount / price;
                }
            }
        }

        // Calcular comisión (diferencia entre lo que paga y lo que se acredita)
        // If fee is negative (is_fee_paid_by_user=false mode), show as 0
        let feeAmount = payAmount - creditedAmount;
        if (feeAmount < 0) {
            feeAmount = 0; // Never show negative commission to user
        }

        // Mostrar información
        creditedAmountDisplay.textContent = `${creditedAmount.toFixed(8)} ${assetSymbol}`;

        // Hide fee line if no fee
        if (feeAmount === 0) {
            feeAmountDisplay.parentElement.style.display = 'none';
        } else {
            feeAmountDisplay.parentElement.style.display = '';
            feeAmountDisplay.textContent = `${feeAmount.toFixed(8)} ${assetSymbol}`;
        }

    } catch (error) {
        console.error('Error al calcular detalles del depósito:', error);
        creditedAmountDisplay.textContent = 'Calculando...';
        feeAmountDisplay.textContent = 'Calculando...';
    }
}

/**
 * Actualiza el badge de estado del depósito
 */
function updateDepositStatus(status, badgeElement) {
    if (!badgeElement) {
        badgeElement = document.getElementById('depositStatus');
    }

    if (!badgeElement) {
        console.warn('Badge element no encontrado');
        return;
    }

    const statusMap = {
        'waiting': { text: 'Esperando pago...', class: 'waiting' },
        'confirming': { text: 'Confirmando...', class: 'confirming' },
        'confirmed': { text: 'Confirmado', class: 'confirmed' },
        'finished': { text: 'Completado', class: 'finished' },
        'expired': { text: 'Expirado', class: 'expired' },
        'failed': { text: 'Fallido', class: 'failed' }
    };

    const statusInfo = statusMap[status.toLowerCase()] || { text: status, class: 'waiting' };

    // Guardar contador si existe antes de actualizar
    const existingCountdown = badgeElement.querySelector('.countdown-timer');

    // Actualizar solo el texto, NO usar textContent que elimina todo
    // Primero limpiar solo los nodos de texto, preservando el contador
    const childNodes = Array.from(badgeElement.childNodes);
    childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            node.remove();
        } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('countdown-timer')) {
            node.remove();
        }
    });

    // Agregar el nuevo texto
    badgeElement.insertBefore(document.createTextNode(statusInfo.text), badgeElement.firstChild);
    badgeElement.className = `status-badge ${statusInfo.class}`;

    // El contador se agregará después en showDepositAddress si es necesario
}

/**
 * Inicia el polling para verificar el estado del depósito
 */
function startPolling(depositId) {
    // Limpiar intervalo anterior si existe
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }

    // Verificar inmediatamente
    checkDepositStatus(depositId);

    // Configurar polling cada 15 segundos
    pollingInterval = setInterval(() => {
        checkDepositStatus(depositId);
    }, 15000);
}

/**
 * Verifica el estado del depósito
 */
async function checkDepositStatus(depositId) {
    if (!depositId) {
        depositId = currentDepositId;
    }

    if (!depositId) {
        return;
    }

    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        return;
    }

    try {
        const response = await fetch(`/api/deposits/${depositId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al verificar estado');
        }

        const data = await response.json();
        const deposit = data.deposit;

        console.log('checkDepositStatus - Estado recibido:', deposit.status);
        console.log('checkDepositStatus - Depósito completo:', deposit);

        // Normalizar el estado a minúsculas para comparación
        const statusLower = (deposit.status || '').toLowerCase();
        console.log('checkDepositStatus - Estado normalizado:', statusLower);

        // Si está confirmado o completado, mostrar vista de éxito y detener polling
        if (statusLower === 'confirmed' || statusLower === 'finished') {
            console.log('✅ Depósito confirmado en checkDepositStatus, llamando a showDepositSuccess');
            clearInterval(pollingInterval);
            pollingInterval = null;
            currentDepositId = null; // Limpiar depósito actual

            // Mostrar vista de éxito (esto oculta dirección, QR y botón)
            showDepositSuccess(deposit);

            // Habilitar formulario para nuevos depósitos
            enableDepositForm();

            // Recargar historial después de un momento
            setTimeout(() => {
                loadDepositHistory();
            }, 2000);
            return; // Salir temprano, no actualizar estado visual aquí
        }

        console.log('Depósito aún no confirmado, actualizando estado visual');

        // Actualizar estado visual solo si no está confirmado
        updateDepositStatus(deposit.status, document.getElementById('depositStatus'));

        // Si expiró o falló, permitir reintentar
        if (deposit.status === 'expired' || deposit.status === 'failed') {
            clearInterval(pollingInterval);
            pollingInterval = null;
            currentDepositId = null; // Limpiar depósito actual

            showError('El depósito ha expirado o falló. Puedes crear uno nuevo.');

            // Verificar si ya existe un botón de "Crear Nuevo Depósito" para evitar duplicados
            const section = document.getElementById('depositAddressSection');
            const existingRetryBtn = section.querySelector('.retry-deposit-btn');

            if (!existingRetryBtn) {
                // Mostrar botón para crear nuevo depósito solo si no existe
                const retryBtn = document.createElement('button');
                retryBtn.className = 'btn-primary retry-deposit-btn';
                retryBtn.innerHTML = '<i class="ri-refresh-line"></i> Crear Nuevo Depósito';
                retryBtn.onclick = () => {
                    section.classList.remove('active');
                    document.getElementById('depositForm').style.display = 'block';
                    document.getElementById('depositForm').reset();
                    resetCryptoSelectorUI();
                    document.getElementById('conversionInfo').style.display = 'none';
                    currentDepositId = null;
                    enableDepositForm(); // Habilitar formulario
                    retryBtn.remove(); // Remover el botón después de usarlo
                };

                const checkStatusBtn = document.getElementById('checkStatusBtn');
                if (checkStatusBtn && checkStatusBtn.parentNode) {
                    checkStatusBtn.parentNode.insertBefore(retryBtn, checkStatusBtn);
                }
            }

            // Habilitar formulario cuando el depósito expira o falla
            enableDepositForm();
        }

    } catch (error) {
        console.error('Error al verificar estado:', error);
    }
}

/**
 * Copia la dirección al portapapeles
 */
function copyAddress() {
    const address = document.getElementById('payAddress').textContent;
    navigator.clipboard.writeText(address).then(() => {
        const copyBtn = event.target.closest('.copy-btn');
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="ri-check-line"></i> Copiado';
        copyBtn.style.background = '#28a745';

        setTimeout(() => {
            copyBtn.innerHTML = originalText;
            copyBtn.style.background = '#ee6a3e';
        }, 2000);
    }).catch(err => {
        console.error('Error al copiar:', err);
        showError('Error al copiar dirección');
    });
}

/**
 * Carga el historial de depósitos con paginación
 */
async function loadDepositHistory(page = 1) {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        const historyContainer = document.getElementById('depositHistory');
        if (historyContainer) {
            historyContainer.innerHTML = '<p class="text-muted">No hay sesión activa.</p>';
        }
        return;
    }

    const historyContainer = document.getElementById('depositHistory');
    if (!historyContainer) {
        console.warn('Elemento depositHistory no encontrado');
        return;
    }

    depositHistoryPage = page;

    try {
        const response = await fetch('/api/deposits', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al cargar historial');
        }

        const data = await response.json();
        const allDeposits = data.deposits || [];

        if (allDeposits.length === 0) {
            historyContainer.innerHTML = '<p class="text-muted">No hay depósitos aún.</p>';
            return;
        }

        // Ordenar por fecha más reciente
        allDeposits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Calculate pagination
        depositHistoryTotalPages = Math.ceil(allDeposits.length / DEPOSIT_HISTORY_PAGE_SIZE);
        const startIndex = (page - 1) * DEPOSIT_HISTORY_PAGE_SIZE;
        const endIndex = startIndex + DEPOSIT_HISTORY_PAGE_SIZE;
        const deposits = allDeposits.slice(startIndex, endIndex);

        // Renderizar historial
        let html = deposits.map(deposit => {
            try {
                // Validar campos que pueden ser null antes de usarlos
                const priceAmount = parseFloat(deposit.priceAmount ?? deposit.amountPaidUsd) || 0;
                const isFiat = deposit.depositType === 'fiat';
                // Fiat: creditedAmount + asset; Crypto: payAmount + payCurrency
                const creditedCrypto = isFiat
                    ? (parseFloat(deposit.creditedAmount ?? deposit.outcomeAmount) || 0)
                    : (parseFloat(deposit.payAmount) || 0);
                const creditedAsset = isFiat
                    ? (deposit.asset || deposit.outcomeCurrency || 'USD')
                    : (deposit.payCurrency || deposit.asset || 'N/A');
                const status = deposit.status || 'unknown';
                const createdAt = deposit.createdAt || new Date().toISOString();

                // Formatear fecha de forma segura
                let date = 'Fecha no disponible';
                try {
                    date = new Date(createdAt).toLocaleDateString('es-VE', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                } catch (dateError) {
                    console.warn('Error al formatear fecha:', dateError);
                }

                const statusBadge = getStatusBadge(status, createdAt);
                const fiatPart = deposit.otcFiatAmount != null && deposit.otcFiatCurrency
                    ? `${Number(deposit.otcFiatAmount).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${deposit.otcFiatCurrency}`
                    : null;
                const cryptoPart = creditedCrypto > 0
                    ? `${Number(creditedCrypto).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${creditedAsset.toUpperCase()} recargados`
                    : 'N/A';

                // Hacer clickeable si está en estado waiting o confirming
                const isClickable = status === 'waiting' || status === 'confirming';
                const itemId = `deposit-item-${deposit.id}`;

                const mainAmount = isFiat && fiatPart ? fiatPart : `$${priceAmount.toFixed(2)} USD`;
                const secondary = isFiat && fiatPart ? `$${priceAmount.toFixed(2)} USD` : (fiatPart || null);
                const typeLabel = isFiat ? 'Depósito Fiat' : 'Depósito Cripto';
                return `
                <div class="deposit-item ${isClickable ? 'deposit-item-clickable' : ''}" id="${itemId}" data-deposit-id="${deposit.id}" data-clickable="${isClickable}">
                    <div class="deposit-item-info">
                        <span class="text-muted small d-block mb-0">${typeLabel}</span>
                        <strong>${mainAmount}</strong>
                        ${secondary ? `<br><span class="text-muted">${secondary}</span>` : ''}
                        <small>
                            ${cryptoPart} • ${date}
                        </small>
                    </div>
                    <div>
                        ${statusBadge}
                    </div>
                </div>
            `;
            } catch (itemError) {
                console.error('Error al renderizar item de depósito:', itemError, deposit);
                return `
                    <div class="deposit-item">
                        <div class="deposit-item-info">
                            <strong>Error al cargar depósito</strong>
                            <small>ID: ${deposit.id || 'N/A'}</small>
                        </div>
                    </div>
                `;
            }
        }).join('');

        // Add pagination controls if more than 1 page
        if (depositHistoryTotalPages > 1) {
            html += `
                <div class="pagination-controls">
                    <button onclick="loadDepositHistory(${page - 1})" ${page <= 1 ? 'disabled' : ''}>
                        <i class="ri-arrow-left-s-line"></i> Anterior
                    </button>
                    <span class="page-info">Página ${page} de ${depositHistoryTotalPages}</span>
                    <button onclick="loadDepositHistory(${page + 1})" ${page >= depositHistoryTotalPages ? 'disabled' : ''}>
                        Siguiente <i class="ri-arrow-right-s-line"></i>
                    </button>
                </div>
            `;
        }

        historyContainer.innerHTML = html;

        // Agregar event listeners para depósitos clickeables después de renderizar
        setTimeout(() => {
            deposits.forEach(deposit => {
                if (deposit.status === 'waiting' || deposit.status === 'confirming') {
                    const itemElement = document.getElementById(`deposit-item-${deposit.id}`);
                    if (itemElement) {
                        itemElement.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            restoreDepositAddress(deposit.id);
                        });
                    }
                }
            });
        }, 100);

    } catch (error) {
        console.error('Error al cargar historial:', error);
        console.error('Error details:', error.stack);
        historyContainer.innerHTML = '<p class="text-muted">Error al cargar historial de depósitos. Por favor, recarga la página.</p>';
    }
}

/**
 * Genera el HTML del badge de estado con contador regresivo si aplica
 */
function getStatusBadge(status, createdAt) {
    const statusMap = {
        'waiting': { text: 'Esperando', class: 'waiting' },
        'confirming': { text: 'Confirmando', class: 'confirming' },
        'confirmed': { text: 'Confirmado', class: 'confirmed' },
        'finished': { text: 'Completado', class: 'finished' },
        'expired': { text: 'Expirado', class: 'expired' },
        'failed': { text: 'Fallido', class: 'failed' }
    };

    const statusInfo = statusMap[status.toLowerCase()] || { text: status, class: 'waiting' };

    // Agregar contador regresivo SOLO para estado waiting
    let countdownHtml = '';
    if (status === 'waiting' && createdAt) {
        const depositTime = new Date(createdAt).getTime();
        const expirationTime = depositTime + (10 * 60 * 1000); // 10 minutos
        const countdownId = `countdown-${createdAt}`;
        countdownHtml = ` <span class="countdown-timer" id="${countdownId}"></span>`;

        // Iniciar contador después de renderizar
        setTimeout(() => {
            startCountdown(countdownId, expirationTime);
        }, 100);
    }

    return `<span class="status-badge ${statusInfo.class}">${statusInfo.text}${countdownHtml}</span>`;
}

/**
 * Inicia un contador regresivo
 */
function startCountdown(elementId, expirationTime) {
    // Buscar el elemento
    let element = document.getElementById(elementId);
    if (!element) {
        console.warn(`No se encontró el elemento con ID ${elementId} para el contador`);
        return;
    }

    function updateCountdown() {
        // Re-buscar el elemento por si fue eliminado y recreado
        element = document.getElementById(elementId);
        if (!element) {
            return; // El elemento fue eliminado, detener el contador
        }

        const now = Date.now();
        const remaining = expirationTime - now;

        if (remaining <= 0) {
            element.textContent = ' (Expirado)';
            element.style.color = '#dc3545';
            element.style.fontWeight = 'bold';
            return;
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        element.textContent = ` (${minutes}:${seconds.toString().padStart(2, '0')})`;
        element.style.color = '#dc3545';
        element.style.fontWeight = 'bold';

        // Actualizar cada segundo
        setTimeout(updateCountdown, 1000);
    }

    // Iniciar inmediatamente
    updateCountdown();
}

/**
 * Restaura la dirección y QR de un depósito desde el historial
 */
async function restoreDepositAddress(depositId) {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showError('Sesión expirada. Por favor, inicia sesión nuevamente.');
        return;
    }

    try {
        const response = await fetch(`/api/deposits/${depositId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al cargar depósito');
        }

        const data = await response.json();
        const deposit = data.deposit;

        // Normalizar el estado a minúsculas para comparación
        const statusLower = (deposit.status || '').toLowerCase();

        // Verificar si está confirmado antes de mostrar dirección
        if (statusLower === 'confirmed' || statusLower === 'finished') {
            console.log('restoreDepositAddress - Depósito confirmado, mostrando vista de éxito');
            // Si está confirmado, mostrar vista de éxito directamente
            showDepositSuccess(deposit);
            currentDepositId = null; // No hay depósito pendiente
            document.getElementById('depositAddressSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

        // Verificar que tenga dirección
        if (!deposit.payAddress) {
            showError('Este depósito no tiene dirección de pago disponible.');
            return;
        }

        // Mostrar dirección y QR solo si no está confirmado
        showDepositAddress(deposit);

        // Establecer como depósito actual
        currentDepositId = deposit.id;

        // Iniciar polling si está en waiting o confirming
        if (deposit.status === 'waiting' || deposit.status === 'confirming') {
            startPolling(deposit.id);
        }

        // Scroll a la sección de dirección
        document.getElementById('depositAddressSection').scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        console.error('Error al restaurar depósito:', error);
        showError('Error al cargar la información del depósito. Por favor, intenta nuevamente.');
    }
}

/**
 * Muestra un mensaje de error
 */
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';

    // Ocultar después de 5 segundos
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

/**
 * Deshabilita el formulario de depósito
 */
function disableDepositForm() {
    const form = document.getElementById('depositForm');
    if (!form) return;

    const priceAmountInput = document.getElementById('priceAmount');
    const payCurrencyTrigger = document.getElementById('payCurrencyTrigger');
    const submitBtn = document.getElementById('submitBtn');

    if (priceAmountInput) {
        priceAmountInput.disabled = true;
        priceAmountInput.style.opacity = '0.6';
        priceAmountInput.style.cursor = 'not-allowed';
    }

    if (payCurrencyTrigger) {
        payCurrencyTrigger.classList.add('disabled');
        payCurrencyTrigger.style.opacity = '0.6';
        payCurrencyTrigger.style.cursor = 'not-allowed';
        payCurrencyTrigger.style.pointerEvents = 'none';
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.6';
        submitBtn.style.cursor = 'not-allowed';
    }
}

/**
 * Habilita el formulario de depósito
 */
function enableDepositForm() {
    const form = document.getElementById('depositForm');
    if (!form) return;

    const priceAmountInput = document.getElementById('priceAmount');
    const payCurrencyTrigger = document.getElementById('payCurrencyTrigger');
    const submitBtn = document.getElementById('submitBtn');

    if (priceAmountInput) {
        priceAmountInput.disabled = false;
        priceAmountInput.style.opacity = '1';
        priceAmountInput.style.cursor = 'text';
    }

    if (payCurrencyTrigger) {
        payCurrencyTrigger.classList.remove('disabled');
        payCurrencyTrigger.style.opacity = '1';
        payCurrencyTrigger.style.cursor = 'pointer';
        payCurrencyTrigger.style.pointerEvents = '';
    }

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
    }
}

/**
 * Verifica si hay depósitos pendientes y deshabilita el formulario si es necesario
 */
async function checkPendingDeposits() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        return;
    }

    try {
        const response = await fetch('/api/deposits?limit=10', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return;
        }

        const data = await response.json();
        const deposits = data.deposits || [];

        // Buscar depósitos pendientes (waiting o confirming)
        const pendingDeposit = deposits.find(d =>
            d.status === 'waiting' || d.status === 'confirming'
        );

        if (pendingDeposit) {
            // Hay un depósito pendiente, deshabilitar formulario
            disableDepositForm();
            currentDepositId = pendingDeposit.id;

            // Si el depósito está visible, iniciar polling
            if (document.getElementById('depositAddressSection')?.classList.contains('active')) {
                startPolling(pendingDeposit.id);
            }
        } else {
            // No hay depósitos pendientes, habilitar formulario
            enableDepositForm();
        }
    } catch (error) {
        console.error('Error al verificar depósitos pendientes:', error);
    }
}

/**
 * Mapeo país (profile.country) → { currency, flag, fiatCode } para depósito OTC moneda nacional.
 * Reutiliza la misma lógica que el badge del P2P. Retorna null si el país no está soportado.
 * @param {string} country - País del usuario (ej. "Venezuela", "Colombia")
 * @returns {{ currency: string, flag: string, fiatCode: string }|null}
 */
function getNationalCurrencyFromCountry(country) {
    const c = (country || '').toLowerCase();
    if (c.includes('venezuela')) return { currency: 'Bolívares', flag: '🇻🇪', fiatCode: 'VES' };
    if (c.includes('colombia')) return { currency: 'Pesos Colombianos', flag: '🇨🇴', fiatCode: 'COP' };
    if (c.includes('argentina')) return { currency: 'Pesos Argentinos', flag: '🇦🇷', fiatCode: 'ARS' };
    if (c.includes('chile')) return { currency: 'Pesos Chilenos', flag: '🇨🇱', fiatCode: 'CLP' };
    if (c.includes('méxico') || c.includes('mexico')) return { currency: 'Pesos Mexicanos', flag: '🇲🇽', fiatCode: 'MXN' };
    if (c.includes('brasil') || c.includes('brazil')) return { currency: 'Reales Brasileños', flag: '🇧🇷', fiatCode: 'BRL' };
    if (c.includes('perú') || c.includes('peru')) return { currency: 'Soles Peruanos', flag: '🇵🇪', fiatCode: 'PEN' };
    if (c.includes('bolivia')) return { currency: 'Bolivianos', flag: '🇧🇴', fiatCode: 'BOB' };
    if (c.includes('uruguay')) return { currency: 'Pesos Uruguayos', flag: '🇺🇾', fiatCode: 'UYU' };
    if (c.includes('dominicana') || c.includes('república dominicana')) return { currency: 'Pesos Dominicanos', flag: '🇩🇴', fiatCode: 'DOP' };
    if (c.includes('paraguay')) return { currency: 'Guaraníes', flag: '🇵🇾', fiatCode: 'PYG' };
    return null;
}

// OTC Moneda Nacional - estado
let otcNationalInfo = null;
let otcOrderPollInterval = null;
let otcSearchTimerInterval = null;
let otcSearchExpiresAt = null;

const OTC_CRYPTO_OPTIONS = [
    { value: 'USDT', label: 'USDT', symbol: 'USDT' },
    { value: 'USDC', label: 'USDC', symbol: 'USDC' },
    { value: 'BIUSD', label: 'BiUSD', symbol: 'BIUSD' }
];

window.selectOtcNationalDeposit = function (info) {
    otcNationalInfo = info;
    document.getElementById('fiatMethodsSection').style.display = 'none';
    document.getElementById('otcDepositSection').style.display = 'block';
    document.getElementById('otcFiatDisplay').textContent = `${info.flag} ${info.currency}`;
    document.getElementById('otcError').style.display = 'none';
    resetOtcForm();
};

window.goBackOtcToFiatMethods = function () {
    stopOtcPolling();
    otcNationalInfo = null;
    document.getElementById('otcDepositSection').style.display = 'none';
    document.getElementById('fiatMethodsSection').style.display = 'block';
};

function resetOtcForm() {
    document.getElementById('otcCryptoAsset').value = '';
    document.getElementById('otcCryptoAssetLabel').textContent = 'Haz clic para seleccionar la moneda';
    document.getElementById('otcCryptoAssetLabel').classList.add('unselected');
    document.getElementById('otcCryptoAssetIcon').src = '/assets/coins/usdt.svg';
    document.getElementById('otcCryptoAmount').value = '';
    document.getElementById('otcRateDisplay').textContent = '—';
    document.getElementById('otcFiatAmountDisplay').textContent = '—';
}

window.openOtcCryptoSelector = function () {
    const modalEl = document.getElementById('otcCryptoModal');
    const listEl = document.getElementById('otcCryptoList');
    const current = document.getElementById('otcCryptoAsset')?.value || '';
    if (!modalEl || !listEl) return;
    listEl.innerHTML = OTC_CRYPTO_OPTIONS.map(c => {
        const isSelected = c.value === current;
        const iconPath = `/assets/coins/${c.symbol.toLowerCase()}.svg`;
        return `
            <li class="list-group-item list-group-item-action d-flex align-items-center py-3" data-value="${c.value}" role="button">
                <img src="${iconPath}" alt="${c.symbol}" class="asset-icon-small me-3" style="width: 32px; height: 32px;" onerror="this.src='/assets/coins/usdt.svg'">
                <span class="flex-grow-1 fw-semibold">${c.label}</span>
                ${isSelected ? '<i class="ri-check-line text-success fs-5"></i>' : ''}
            </li>
        `;
    }).join('');
    listEl.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', function () {
            selectOtcCryptoAsset(this.dataset.value);
            bootstrap.Modal.getInstance(modalEl)?.hide();
        });
    });
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
};

window.selectOtcCryptoAsset = function (value) {
    const c = OTC_CRYPTO_OPTIONS.find(x => x.value === value);
    if (!c) return;
    document.getElementById('otcCryptoAsset').value = value;
    document.getElementById('otcCryptoAssetLabel').textContent = c.label;
    document.getElementById('otcCryptoAssetLabel').classList.remove('unselected');
    document.getElementById('otcCryptoAssetIcon').src = `/assets/coins/${c.symbol.toLowerCase()}.svg`;
    scheduleOtcFiatUpdate();
};

let otcFiatDebounce = null;
function scheduleOtcFiatUpdate() {
    if (otcFiatDebounce) clearTimeout(otcFiatDebounce);
    otcFiatDebounce = setTimeout(updateOtcFiatDisplay, 300);
}

async function updateOtcFiatDisplay() {
    if (!otcNationalInfo) return;
    const cryptoAsset = document.getElementById('otcCryptoAsset')?.value;
    const cryptoAmount = parseFloat(document.getElementById('otcCryptoAmount')?.value) || 0;
    if (!cryptoAsset || cryptoAmount <= 0) {
        document.getElementById('otcRateDisplay').textContent = '—';
        document.getElementById('otcFiatAmountDisplay').textContent = '—';
        return;
    }
    try {
        const token = localStorage.getItem('accessToken');
        if (!token) return;
        const res = await fetch(`/api/otc/rate?cryptoAsset=${encodeURIComponent(cryptoAsset)}&fiatCurrency=${encodeURIComponent(otcNationalInfo.fiatCode)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Error al obtener tasa');
        const data = await res.json();
        const rate = data.rate || 0;
        const fiatAmount = cryptoAmount * rate;
        document.getElementById('otcRateDisplay').textContent = `1 ${cryptoAsset} = ${rate.toLocaleString('es', { minimumFractionDigits: 2 })} ${otcNationalInfo.fiatCode}`;
        document.getElementById('otcFiatAmountDisplay').textContent = `${fiatAmount.toLocaleString('es', { minimumFractionDigits: 2 })} ${otcNationalInfo.fiatCode}`;
    } catch (e) {
        document.getElementById('otcRateDisplay').textContent = 'Error al cargar tasa';
        document.getElementById('otcFiatAmountDisplay').textContent = '—';
    }
}

async function handleOtcContinue() {
    if (!otcNationalInfo) return;
    const cryptoAsset = document.getElementById('otcCryptoAsset')?.value;
    const cryptoAmount = parseFloat(document.getElementById('otcCryptoAmount')?.value) || 0;
    const errEl = document.getElementById('otcError');

    if (!cryptoAsset) {
        errEl.textContent = 'Selecciona la criptomoneda a recibir.';
        errEl.style.display = 'block';
        return;
    }
    if (!cryptoAmount || cryptoAmount <= 0) {
        errEl.textContent = 'Ingresa un monto válido.';
        errEl.style.display = 'block';
        return;
    }

    const token = localStorage.getItem('accessToken');
    if (!token) {
        errEl.textContent = 'Debes iniciar sesión.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';
    document.getElementById('otcContinueBtn').disabled = true;

    try {
        const res = await fetch('/api/otc/request', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cryptoAsset,
                fiatCurrency: otcNationalInfo.fiatCode,
                cryptoAmount
            })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Error al crear solicitud');

        const order = data.order;
        showOtcSearchModal(order);
        startOtcOrderPolling(order.id);
    } catch (e) {
        errEl.textContent = e.message || 'Error al crear solicitud';
        errEl.style.display = 'block';
    } finally {
        document.getElementById('otcContinueBtn').disabled = false;
    }
}

let currentOtcOrderId = null;

/**
 * Restaura el flujo OTC solo si la orden DEPÓSITO está en WAITING_PAYMENT (un tomador ya tomó la orden).
 * NO se restaura si está PENDING (buscando tomador) ni si expiró/sin disponibilidad.
 */
async function checkOtcRequesterActive() {
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    const otcPaymentModal = document.getElementById('otcPaymentModal');
    if (!otcPaymentModal) return;
    let order = null;
    let wasRestored = false;
    try {
        const res = await fetch('/api/otc/requester/active', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            order = data.order;
        }
        if (!order || order.orderType !== 'DEPOSIT' || order.status !== 'WAITING_PAYMENT') {
            const storedId = sessionStorage.getItem(OTC_ACTIVE_ORDER_KEY) || localStorage.getItem(OTC_ACTIVE_ORDER_KEY);
            if (storedId && storedId.length > 10) {
                const ordRes = await fetch(`/api/otc/orders/${storedId}`, { headers: { 'Authorization': `Bearer ${token}` } });
                if (ordRes.ok) {
                    const ordData = await ordRes.json();
                    const o = ordData.order;
                    if (o && o.orderType === 'DEPOSIT' && o.status === 'WAITING_PAYMENT') {
                        order = o;
                        wasRestored = true;
                    }
                }
            }
        } else {
            wasRestored = true;
        }
        if (!order || order.orderType !== 'DEPOSIT' || order.status !== 'WAITING_PAYMENT') return;

        sessionStorage.setItem(OTC_ACTIVE_ORDER_KEY, order.id);
        try { localStorage.setItem(OTC_ACTIVE_ORDER_KEY, order.id); } catch (e) { /* incógnito */ }
        selectDepositType('fiat');
        await showOtcPaymentModal(order, wasRestored);
        startOtcOrderPolling(order.id);
    } catch (e) {
        console.warn('checkOtcRequesterActive:', e);
    }
}

function showOtcRestoredToast() {
    const toast = document.createElement('div');
    toast.className = 'position-fixed top-0 start-50 translate-middle-x mt-3 px-4 py-2 rounded shadow';
    toast.style.cssText = 'z-index: 1100; background: #0d6efd; color: #fff; font-size: 14px; max-width: 90%;';
    toast.innerHTML = '<i class="ri-information-line me-2"></i>Tu operación pendiente ha sido restaurada. Puedes continuar subiendo tu comprobante.';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

function showOtcSearchModal(order) {
    otcSearchExpiresAt = new Date(order.expiresAt);
    const modal = document.getElementById('otcSearchModal');
    const content = document.getElementById('otcSearchContent');
    const statusEl = content.querySelector('#otcSearchStatus');
    if (statusEl) statusEl.textContent = 'Procesando tu solicitud...';
    if (!content.querySelector('.connection-dots')) {
        content.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 20px; margin: 30px 0; flex-wrap: wrap;">
                <div><i class="ri-cloud-fill" style="font-size: 64px; color: #ee6a3e;"></i><div style="margin-top: 8px; font-size: 12px; color: #4a5568;">Tú</div></div>
                <div class="connection-dots" style="display: flex; gap: 5px;">
                    <span style="width: 8px; height: 8px; background: #ee6a3e; border-radius: 50%; animation: otcPulse 1.5s infinite;"></span>
                    <span style="width: 8px; height: 8px; background: #ee6a3e; border-radius: 50%; animation: otcPulse 1.5s infinite 0.2s;"></span>
                    <span style="width: 8px; height: 8px; background: #ee6a3e; border-radius: 50%; animation: otcPulse 1.5s infinite 0.4s;"></span>
                </div>
                <div><i class="ri-earth-fill" style="font-size: 64px; color: #ee6a3e;"></i><div style="margin-top: 8px; font-size: 12px; color: #4a5568;">Mercado OTC BidiPago</div></div>
            </div>
            <p id="otcSearchStatus" style="color: #718096; margin-bottom: 20px;">Procesando tu solicitud...</p>
            <p class="text-muted small">Tienes 10 minutos. Si no hay disponibilidad, te invitamos a usar el Mercado P2P.</p>
        `;
    }
    document.getElementById('otcSearchFooter').style.display = 'none';
    bootstrap.Modal.getOrCreateInstance(modal).show();
    startOtcSearchTimer();
}

function startOtcSearchTimer() {
    if (otcSearchTimerInterval) clearInterval(otcSearchTimerInterval);
    const update = () => {
        const now = new Date();
        const remaining = Math.max(0, Math.floor((otcSearchExpiresAt - now) / 1000));
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        document.getElementById('otcSearchTimer').textContent = `${m}:${String(s).padStart(2, '0')}`;
        if (remaining <= 0) {
            clearInterval(otcSearchTimerInterval);
            otcSearchTimerInterval = null;
            handleOtcSearchExpired();
        }
    };
    update();
    otcSearchTimerInterval = setInterval(update, 1000);
}

function startOtcOrderPolling(orderId) {
    stopOtcPolling();
    const poll = async () => {
        const token = localStorage.getItem('accessToken');
        if (!token) return;
        try {
            const res = await fetch(`/api/otc/orders/${orderId}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return;
            const data = await res.json();
            const order = data.order;
            if (order.status === 'WAITING_PAYMENT') {
                stopOtcPolling();
                if (otcSearchTimerInterval) {
                    clearInterval(otcSearchTimerInterval);
                    otcSearchTimerInterval = null;
                }
                bootstrap.Modal.getInstance(document.getElementById('otcSearchModal'))?.hide();
                const pm = document.getElementById('otcPaymentModal');
                const inst = bootstrap.Modal.getInstance(pm);
                if (!inst || !pm.classList.contains('show')) showOtcPaymentModal(order);
                else {
                    const instr = formatTakerPaymentMethodDisplay(order.takerPaymentMethodDisplay) || formatOtcPaymentInstructions(order.paymentInstructions);
                    document.getElementById('otcPaymentInstructions').innerHTML = instr;
                    const statusEl = document.getElementById('otcPaymentStatusMsg');
                    if (order.paymentProof) {
                        statusEl.textContent = 'Verificando Pago';
                        statusEl.className = 'alert alert-info mb-3';
                        document.getElementById('otcPaymentProofSection').style.display = 'none';
                        document.getElementById('otcProofUploaded').style.display = 'block';
                    } else {
                        statusEl.textContent = 'Envíe el Pago al método de pago seleccionado';
                        statusEl.className = 'alert alert-warning mb-3';
                    }
                }
                startOtcOrderPolling(orderId);
            } else if (order.status === 'COMPLETED') {
                stopOtcPolling();
                sessionStorage.removeItem(OTC_ACTIVE_ORDER_KEY);
                localStorage.removeItem(OTC_ACTIVE_ORDER_KEY);
                if (order.id) { sessionStorage.removeItem(`otc_ref_${order.id}`); localStorage.removeItem(`otc_ref_${order.id}`); }
                bootstrap.Modal.getInstance(document.getElementById('otcPaymentModal'))?.hide();
                showOtcSuccess('¡Fondos liberados! Las criptos han sido acreditadas en tu cuenta.');
                loadDepositHistory();
            } else if (order.status === 'CANCELLED') {
                stopOtcPolling();
                sessionStorage.removeItem(OTC_ACTIVE_ORDER_KEY);
                localStorage.removeItem(OTC_ACTIVE_ORDER_KEY);
                if (order.id) { sessionStorage.removeItem(`otc_ref_${order.id}`); localStorage.removeItem(`otc_ref_${order.id}`); }
                bootstrap.Modal.getInstance(document.getElementById('otcPaymentModal'))?.hide();
                loadDepositHistory();
            }
        } catch (e) { /* ignore */ }
    };
    otcOrderPollInterval = setInterval(poll, 3000);
    poll();
}

function stopOtcPolling() {
    if (otcOrderPollInterval) {
        clearInterval(otcOrderPollInterval);
        otcOrderPollInterval = null;
    }
}

async function showOtcPaymentModal(order, wasRestored) {
    currentOtcOrderId = order.id;
    sessionStorage.setItem(OTC_ACTIVE_ORDER_KEY, order.id);
    try { localStorage.setItem(OTC_ACTIVE_ORDER_KEY, order.id); } catch (e) { /* privado/incógnito */ }
    const contentEl = document.getElementById('otcPaymentContent');
    let restoredBanner = document.getElementById('otcRestoredBanner');
    if (wasRestored) {
        if (!restoredBanner) {
            restoredBanner = document.createElement('div');
            restoredBanner.id = 'otcRestoredBanner';
            restoredBanner.className = 'alert alert-success d-flex align-items-center mb-3';
            restoredBanner.innerHTML = '<i class="ri-checkbox-circle-fill me-2" style="font-size: 1.2rem;"></i><span>Tu operación se ha restaurado. Puedes continuar subiendo tu comprobante.</span>';
            contentEl.insertBefore(restoredBanner, contentEl.firstChild);
        }
        restoredBanner.style.display = '';
    } else if (restoredBanner) restoredBanner.style.display = 'none';
    const statusEl = document.getElementById('otcPaymentStatusMsg');
    const proofSection = document.getElementById('otcPaymentProofSection');
    const proofUploaded = document.getElementById('otcProofUploaded');
    const methodsSelector = document.getElementById('otcPaymentMethodsSelector');
    const instructionsEl = document.getElementById('otcPaymentInstructions');

    if (order.paymentProof) {
        statusEl.textContent = 'Verificando Pago';
        statusEl.className = 'alert alert-info mb-3';
        statusEl.style.display = 'block';
        proofSection.style.display = 'none';
        proofUploaded.style.display = 'block';
        methodsSelector.style.display = 'none';
        instructionsEl.innerHTML = formatTakerPaymentMethodDisplay(order.takerPaymentMethodDisplay) || formatOtcPaymentInstructions(order.paymentInstructions);
    } else {
        statusEl.textContent = 'Envíe el Pago al método de pago seleccionado';
        statusEl.className = 'alert alert-warning mb-3';
        statusEl.style.display = 'block';
        proofSection.style.display = 'block';
        proofUploaded.style.display = 'none';

        const displayFromOrder = formatTakerPaymentMethodDisplay(order.takerPaymentMethodDisplay);
        if (displayFromOrder) {
            methodsSelector.style.display = 'none';
            instructionsEl.innerHTML = displayFromOrder;
        } else {
            try {
                const res = await fetch(`/api/otc/orders/${order.id}/taker-payment-methods`, {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('accessToken') }
                });
                if (res.ok) {
                    const data = await res.json();
                    const methods = data.paymentMethods || [];
                    const renderLabeledMethod = (pm) => {
                        if (pm.labeledFields && pm.labeledFields.length > 0) {
                            return `Método de Pago: <strong>${escapeHtml(pm.name)}</strong><br>` +
                                pm.labeledFields.map(f => `${escapeHtml(f.label)}: ${escapeHtml(f.value)}`).join('<br>');
                        }
                        return pm.instructions || '—';
                    };
                    if (methods.length > 1) {
                        methodsSelector.style.display = 'block';
                        methodsSelector.innerHTML = methods.map((pm, i) => `
                            <label class="form-check border rounded p-3 mb-2 d-flex align-items-start cursor-pointer" style="cursor:pointer;">
                                <input type="radio" name="otcSelectedMethod" value="${pm.id}" data-labeled="${escapeHtml(renderLabeledMethod(pm))}" data-instructions="${escapeHtml(pm.instructions || '')}" ${i === 0 ? 'checked' : ''} class="form-check-input mt-1">
                                <span class="form-check-label ms-2"><strong>${escapeHtml(pm.name)}</strong><br><small class="text-muted">${escapeHtml((pm.field1 || '') + ' ' + (pm.field2 || '')).trim() || pm.type}</small></span>
                            </label>
                        `).join('');
                        instructionsEl.innerHTML = renderLabeledMethod(methods[0]) || order.paymentInstructions || '—';
                        methodsSelector.querySelectorAll('input[name="otcSelectedMethod"]').forEach(radio => {
                            radio.addEventListener('change', () => {
                                const sel = document.querySelector('input[name="otcSelectedMethod"]:checked');
                                if (sel) instructionsEl.innerHTML = sel.getAttribute('data-labeled') || sel.getAttribute('data-instructions') || '—';
                            });
                        });
                    } else if (methods.length === 1) {
                        methodsSelector.style.display = 'none';
                        instructionsEl.innerHTML = renderLabeledMethod(methods[0]) || order.paymentInstructions || '—';
                    } else {
                        methodsSelector.style.display = 'none';
                        instructionsEl.innerHTML = formatOtcPaymentInstructions(order.paymentInstructions);
                    }
                } else {
                    methodsSelector.style.display = 'none';
                    instructionsEl.innerHTML = formatOtcPaymentInstructions(order.paymentInstructions);
                }
            } catch (e) {
                methodsSelector.style.display = 'none';
                instructionsEl.innerHTML = formatOtcPaymentInstructions(order.paymentInstructions);
            }
        }
    }
    document.getElementById('otcPaymentProofFile').value = '';
    const refInput = document.getElementById('otcPaymentReference');
    if (refInput) {
        const savedRef = sessionStorage.getItem(`otc_ref_${order.id}`) || localStorage.getItem(`otc_ref_${order.id}`);
        if (savedRef) refInput.value = savedRef;
        refInput.removeEventListener('input', _otcRefInputHandler);
        refInput.addEventListener('input', (_otcRefInputHandler = () => {
            const v = refInput.value || '';
            sessionStorage.setItem(`otc_ref_${order.id}`, v);
            try { localStorage.setItem(`otc_ref_${order.id}`, v); } catch (e) {}
        }));
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('otcPaymentModal')).show();
    if (wasRestored) showOtcRestoredToast();
}
let _otcRefInputHandler;
function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function formatTakerPaymentMethodDisplay(display) {
    if (!display || !display.trim()) return null;
    return escapeHtml(display.trim()).replace(/\n/g, '<br>');
}

function formatOtcPaymentInstructions(instructions) {
    if (!instructions || !instructions.trim()) return '—';
    const lines = instructions.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return escapeHtml(instructions);
    if (lines.length === 1) return `Método de Pago: <strong>${escapeHtml(lines[0])}</strong>`;
    let html = `Método de Pago: <strong>${escapeHtml(lines[0])}</strong><br>`;
    const genericLabels = ['Número de identificación', 'Número de teléfono', 'Número de cuenta', 'Tipo de cuenta', 'Número de ID del titular'];
    lines.slice(1).forEach((val, i) => {
        html += (genericLabels[i] || `Dato ${i + 1}`) + ': ' + escapeHtml(val) + '<br>';
    });
    return html;
}

async function submitOtcPaymentProof() {
    const orderId = currentOtcOrderId;
    const fileInput = document.getElementById('otcPaymentProofFile');
    if (!orderId || !fileInput?.files?.length) {
        alert('Selecciona el comprobante de pago.');
        return;
    }
    const btn = document.getElementById('otcUploadProofBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Enviando...';
    try {
        const formData = new FormData();
        formData.append('paymentProof', fileInput.files[0]);
        const ref = document.getElementById('otcPaymentReference')?.value?.trim();
        if (ref) formData.append('paymentReference', ref);
        const res = await fetch(`/api/otc/orders/${orderId}/payment-proof`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('accessToken') },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al subir');
        document.getElementById('otcPaymentStatusMsg').textContent = 'Verificando Pago';
        document.getElementById('otcPaymentStatusMsg').className = 'alert alert-info mb-3';
        document.getElementById('otcPaymentProofSection').style.display = 'none';
        document.getElementById('otcProofUploaded').style.display = 'block';
    } catch (e) {
        alert(e.message || 'Error al subir comprobante');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="ri-upload-line"></i> Enviar Comprobante';
    }
}

window.submitOtcPaymentProof = submitOtcPaymentProof;


function handleOtcSearchExpired() {
    stopOtcPolling();
    if (otcSearchTimerInterval) {
        clearInterval(otcSearchTimerInterval);
        otcSearchTimerInterval = null;
    }
    sessionStorage.removeItem(OTC_ACTIVE_ORDER_KEY);
    localStorage.removeItem(OTC_ACTIVE_ORDER_KEY);
    document.getElementById('otcSearchContent').innerHTML = `
        <div class="mb-3"><i class="ri-search-eye-line" style="font-size: 3rem; color: #718096;"></i></div>
        <h5>No hay disponibilidad</h5>
        <p class="text-muted">No hay disponibilidad en este momento. Te invitamos a usar el Mercado P2P.</p>
    `;
    document.getElementById('otcSearchFooter').style.display = 'flex';
    document.getElementById('otcSearchTimer').textContent = '0:00';
}

/**
 * Carga métodos de pago fiat y habilita/deshabilita PayPal y TDC/TDD.
 * Si el país del usuario coincide con monedas fiat soportadas, añade una card de "Depósito en Moneda Nacional".
 */
async function loadFiatMethods() {
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    try {
        const res = await fetch('/api/deposits/fiat/methods', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401) {
            console.warn('Sesión expirada o no autorizada');
            return;
        }
        if (!res.ok) return;
        const data = await res.json();
        const methods = data.methods || [];
        const codes = methods.map(m => m.code);
        const setMethodState = (code, enabled) => {
            const id = code === 'PAYPAL' ? 'fiatMethodPayPal' : 'fiatMethodCard';
            const badgeId = code === 'PAYPAL' ? 'paypalBadge' : 'cardBadge';
            const el = document.getElementById(id);
            const badge = document.getElementById(badgeId);
            if (el && badge) {
                if (enabled) {
                    el.classList.remove('disabled');
                    el.onclick = () => selectFiatMethod(code);
                    badge.innerHTML = '<span class="available-tag">Disponible</span>';
                } else {
                    el.classList.add('disabled');
                    el.onclick = null;
                    badge.innerHTML = '<span class="coming-soon-tag">No disponible</span>';
                }
            }
        };
        setMethodState('PAYPAL', codes.includes('PAYPAL'));
        setMethodState('PAYPAL_CARD', codes.includes('PAYPAL_CARD'));
        const hasAnyFiat = codes.includes('PAYPAL') || codes.includes('PAYPAL_CARD');
        const mainFiatCard = document.getElementById('depositTypeFiatCard');
        const mainBadge = document.getElementById('fiatMethodBadge');
        if (mainFiatCard && mainBadge) {
            if (!hasAnyFiat) {
                mainFiatCard.classList.add('disabled');
                mainBadge.className = 'deposit-method-badge coming-soon-badge';
                mainBadge.innerHTML = '<i class="ri-time-line"></i> No disponible';
            } else {
                mainFiatCard.classList.remove('disabled');
                mainBadge.className = 'deposit-method-badge active-badge';
                mainBadge.innerHTML = '<i class="ri-check-line"></i> Disponible';
            }
        }

        // Cards de depósito en moneda nacional según país del usuario (solo si OTC está activo en admin)
        const wrapper = document.getElementById('nationalFiatCardsWrapper');
        if (wrapper) {
            wrapper.innerHTML = '';
            const otcEnabled = !!data.otcEnabled;
            if (otcEnabled) try {
                const meRes = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
                if (meRes.ok) {
                    const meData = await meRes.json();
                    const profile = meData.profile || meData.user?.profile;
                    const country = profile?.country || '';
                    const info = getNationalCurrencyFromCountry(country);
                    if (info) {
                        const card = document.createElement('div');
                        card.className = 'fiat-method-item';
                        card.dataset.fiatCode = info.fiatCode;
                        card.dataset.currency = info.currency;
                        card.dataset.flag = info.flag;
                        card.onclick = () => selectOtcNationalDeposit(info);
                        card.innerHTML = `
                            <div class="fiat-method-item-icon national">
                                <i class="ri-exchange-dollar-line"></i>
                            </div>
                            <div class="fiat-method-item-content">
                                <h4>Depósito en moneda nacional: ${info.flag} ${info.currency}</h4>
                                <p>Deposita usando tu moneda local de forma instantánea (OTC)</p>
                            </div>
                            <div class="fiat-method-item-badge">
                                <span class="available-tag">Disponible</span>
                            </div>
                        `;
                        wrapper.appendChild(card);
                    }
                }
            } catch (profileErr) {
                console.warn('Error al cargar perfil para moneda nacional:', profileErr);
            }
        }
    } catch (e) {
        console.warn('Error loading fiat methods:', e);
    }
}

let fiatEstimateDebounce = null;

/**
 * Actualiza el desglose de comisiones en el formulario fiat desde el backend.
 * Usa la API /api/deposits/fiat/estimate para obtener valores reales (5%+$1 PayPal, 3% servicio).
 */
async function updateFiatCommissionNotice() {
    const amount = parseFloat(document.getElementById('fiatAmountUsd')?.value) || 0;
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = typeof val === 'number' ? val.toFixed(2) : String(val);
    };
    if (amount < 5 || amount > 5000) {
        set('fiatAmountLabel', amount || 0);
        set('fiatPaypalPctLabel', '—');
        set('fiatPaypalFeeLabel', 0);
        set('fiatServicePctLabel', '—');
        set('fiatServiceFeeLabel', 0);
        set('fiatNetLabel', 0);
        return;
    }
    const token = localStorage.getItem('accessToken');
    if (!token) {
        set('fiatAmountLabel', amount);
        set('fiatPaypalPctLabel', '—');
        set('fiatPaypalFeeLabel', '…');
        set('fiatServicePctLabel', '—');
        set('fiatServiceFeeLabel', '…');
        set('fiatNetLabel', '…');
        return;
    }
    try {
        const res = await fetch(`/api/deposits/fiat/estimate?amountUsd=${encodeURIComponent(amount)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Error al obtener estimación');
        const data = await res.json();
        set('fiatAmountLabel', data.amountUsd);
        set('fiatPaypalPctLabel', data.paypalFeePercent != null ? data.paypalFeePercent + '%' : '—');
        set('fiatPaypalFeeLabel', data.paypalFeeAmount ?? 0);
        set('fiatServicePctLabel', data.serviceFeePercent != null ? data.serviceFeePercent + '%' : '—');
        set('fiatServiceFeeLabel', data.serviceFeeAmount ?? 0);
        set('fiatNetLabel', data.netAmountUsd ?? 0);
    } catch (e) {
        set('fiatAmountLabel', amount);
        set('fiatPaypalPctLabel', '—');
        set('fiatPaypalFeeLabel', '?');
        set('fiatServicePctLabel', '—');
        set('fiatServiceFeeLabel', '?');
        set('fiatNetLabel', '?');
    }
}

/**
 * Versión debounced para llamar al cambiar el input (evita muchas peticiones)
 */
function scheduleFiatCommissionUpdate() {
    if (fiatEstimateDebounce) clearTimeout(fiatEstimateDebounce);
    fiatEstimateDebounce = setTimeout(updateFiatCommissionNotice, 300);
}

/**
 * Envía el formulario de depósito fiat y redirige a PayPal
 */
async function handleFiatDepositSubmit(e) {
    e.preventDefault();
    if (paypalLoaded && document.getElementById('fiatPayRedirectWrapper')?.style.display === 'none') {
        return;
    }
    const token = localStorage.getItem('accessToken');
    if (!token) {
        showFiatError('Debes iniciar sesión para depositar.');
        setTimeout(() => window.location.href = '/login', 2000);
        return;
    }
    const amountUsd = parseFloat(document.getElementById('fiatAmountUsd').value);
    const asset = document.getElementById('fiatAsset').value;
    if (!amountUsd || amountUsd < 5 || amountUsd > 5000) {
        showFiatError('Monto debe estar entre 5 y 5000 USD.');
        return;
    }
    if (!asset) {
        showFiatError('Selecciona la moneda a recibir.');
        return;
    }
    const btn = document.getElementById('fiatPayPalBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line"></i> Creando...';
    const errEl = document.getElementById('fiatError');
    errEl.style.display = 'none';
    try {
        const res = await fetch('/api/deposits/fiat', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amountUsd, asset, paymentMethodCode: selectedFiatMethodCode })
        });
        const data = await res.json();
        if (res.status === 401) {
            showFiatError('Sesión expirada. Redirigiendo al inicio de sesión...');
            setTimeout(() => window.location.href = '/login', 1500);
            return;
        }
        if (!res.ok) throw new Error(data.message || data.error || 'Error al crear depósito');
        if (data.approveUrl) {
            window.location.href = data.approveUrl;
        } else {
            throw new Error('No se recibió URL de pago');
        }
    } catch (err) {
        errEl.textContent = err.message || 'Error al crear depósito';
        errEl.style.display = 'block';
        btn.disabled = false;
        updateFiatPayButton();
    }
}

function showFiatError(msg) {
    const errEl = document.getElementById('fiatError');
    if (errEl) {
        errEl.textContent = msg;
        errEl.style.display = 'block';
    }
}

/**
 * Procesa el retorno de PayPal (usuario aprobó el pago)
 */
async function handlePayPalReturn(orderId) {
    const token = localStorage.getItem('accessToken');
    if (!token) {
        showError('Sesión expirada.');
        return;
    }
    const errEl = document.getElementById('fiatError');
    const mainErr = document.getElementById('errorMessage');
    const showErr = (msg) => {
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        if (mainErr) { mainErr.textContent = msg; mainErr.style.display = 'block'; }
    };
    try {
        const res = await fetch('/api/deposits/fiat/capture', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'Error al acreditar');
        const successEl = document.getElementById('fiatSuccess');
        if (successEl) {
            successEl.textContent = '¡Depósito acreditado! Recibiste ' + (data.deposit?.creditedAmount || '') + ' ' + (data.deposit?.asset || '');
            successEl.style.display = 'block';
            successEl.classList.remove('alert-danger');
            successEl.classList.add('alert-success');
        }
        const errEl2 = document.getElementById('fiatError');
        if (errEl2) errEl2.style.display = 'none';
        loadDepositHistory();
        selectDepositType('fiat');
        selectFiatMethod(selectedFiatMethodCode || 'PAYPAL');
    } catch (err) {
        showErr(err.message || 'Error al procesar el pago');
    }
}

/**
 * Muestra un mensaje de éxito
 */
function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    if (!successDiv) return;
    successDiv.textContent = message;
    successDiv.style.display = 'block';

    // Ocultar después de 8 segundos
    setTimeout(() => {
        successDiv.style.display = 'none';
    }, 8000);
}

/**
 * Muestra éxito cuando el tomador OTC libera fondos (visible para el solicitante)
 */
function showOtcSuccess(message) {
    const el = document.getElementById('otcSuccessMessage');
    if (!el) return;
    el.innerHTML = '<i class="ri-checkbox-circle-fill"></i> ' + message;
    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { el.style.display = 'none'; }, 10000);
}

