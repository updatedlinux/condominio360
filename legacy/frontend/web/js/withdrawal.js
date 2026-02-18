// Variables globales
let userBalance = 0;
let userWallets = [];
let totalBalanceUsd = 0; // Balance total convertido a USD
let withdrawalHistoryPage = 1;
let withdrawalHistoryTotalPages = 1;
const WITHDRAWAL_HISTORY_PAGE_SIZE = 5;

// OTC Retiro moneda nacional
let otcWithdrawNationalInfo = null;
const OTC_WITHDRAWAL_ACTIVE_ORDER_KEY = 'otc_withdrawal_active_order';
const OTC_WITHDRAWAL_CRYPTO_OPTIONS = [
    { value: 'USDT', label: 'USDT', symbol: 'USDT' },
    { value: 'USDC', label: 'USDC', symbol: 'USDC' },
    { value: 'BIUSD', label: 'BiUSD', symbol: 'BIUSD' }
];

function getNationalCurrencyFromCountry(country) {
    const c = (country || '').toLowerCase();
    if (c.includes('venezuela')) return { currency: 'Bolívares Venezolanos', flag: '🇻🇪', fiatCode: 'VES' };
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

// Opciones de criptomoneda para retiro (estilo móvil)
const WITHDRAWAL_CRYPTO_CURRENCIES = [
    { value: 'usdtmatic', label: 'USDT (Polygon)', symbol: 'USDT' },
    { value: 'usdttrc20', label: 'USDT (TRC20)', symbol: 'USDT' },
    { value: 'usdcbsc', label: 'USDC (BSC)', symbol: 'USDC' },
    { value: 'btc', label: 'Bitcoin (BTC)', symbol: 'BTC' },
    { value: 'ltc', label: 'Litecoin (LTC)', symbol: 'LTC' },
    { value: 'eth', label: 'Ethereum (ETH)', symbol: 'ETH' }
];

// Inicialización cuando se carga la página
document.addEventListener('DOMContentLoaded', async function () {
    loadUserBalance();
    loadWithdrawalHistory();

    const withdrawalForm = document.getElementById('withdrawalForm');
    if (withdrawalForm) {
        withdrawalForm.addEventListener('submit', handleWithdrawalSubmit);
    }
    document.getElementById('amount')?.addEventListener('input', handleAmountChange);
    document.getElementById('cryptoCurrency')?.addEventListener('change', handleCurrencyChange);

    const cryptoCurrencyTrigger = document.getElementById('cryptoCurrencyTrigger');
    if (cryptoCurrencyTrigger) {
        cryptoCurrencyTrigger.addEventListener('click', function () {
            if (this.classList.contains('disabled')) return;
            openWithdrawalCryptoSelector();
        });
    }

    const otcWithdrawCryptoTrigger = document.getElementById('otcWithdrawCryptoTrigger');
    if (otcWithdrawCryptoTrigger) {
        otcWithdrawCryptoTrigger.addEventListener('click', openOtcWithdrawCryptoSelector);
    }
    document.getElementById('otcWithdrawAmount')?.addEventListener('input', scheduleOtcWithdrawRateUpdate);
    document.getElementById('otcWithdrawCrypto')?.addEventListener('change', function () {
        updateOtcWithdrawBalanceDisplay();
        scheduleOtcWithdrawRateUpdate();
    });

    await checkOtcWithdrawEligibility();

    const token = localStorage.getItem('accessToken');
    if (token) {
        let order = null;
        const res = await fetch('/api/otc/requester/active', { headers: { 'Authorization': 'Bearer ' + token } });
        if (res.ok) {
            const data = await res.json();
            order = data.order;
        }
        if (!order || order.orderType !== 'WITHDRAWAL' || order.status !== 'WAITING_PAYMENT') {
            const storedId = sessionStorage.getItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY) || localStorage.getItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY);
            if (storedId && storedId.length > 10) {
                const ordRes = await fetch(`/api/otc/orders/${storedId}`, { headers: { 'Authorization': 'Bearer ' + token } });
                if (ordRes.ok) {
                    const ordData = await ordRes.json();
                    const o = ordData.order;
                    if (o && o.orderType === 'WITHDRAWAL' && o.status === 'WAITING_PAYMENT') order = o;
                }
            }
        }
        if (order && order.orderType === 'WITHDRAWAL' && order.status === 'WAITING_PAYMENT') {
            sessionStorage.setItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY, order.id);
            try { localStorage.setItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY, order.id); } catch (e) { /* incógnito */ }
            otcWithdrawNationalInfo = getNationalCurrencyFromCountry(order.requester?.profile?.country || '') || { fiatCode: order.fiatCurrency, flag: '', currency: order.fiatCurrency };
            selectWithdrawalType('fiat');
            loadOtcWithdrawData();
            showOtcWithdrawSearchModal(order);
            startOtcWithdrawOrderPolling(order.id);
        }
    }

    const otcWithdrawSearchModal = document.getElementById('otcWithdrawSearchModal');
    if (otcWithdrawSearchModal) {
        otcWithdrawSearchModal.addEventListener('hidden.bs.modal', function () {
            stopOtcWithdrawPolling();
            if (otcWithdrawSearchTimerInterval) {
                clearInterval(otcWithdrawSearchTimerInterval);
                otcWithdrawSearchTimerInterval = null;
            }
        });
    }
    const otcWithdrawCancelSearchBtn = document.getElementById('otcWithdrawCancelSearchBtn');
    if (otcWithdrawCancelSearchBtn) {
        otcWithdrawCancelSearchBtn.addEventListener('click', handleOtcWithdrawCancelSearch);
    }

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
 * Abre el modal para seleccionar criptomoneda (estilo móvil)
 */
window.openWithdrawalCryptoSelector = function () {
    const modalEl = document.getElementById('cryptoCurrencyModal');
    const listEl = document.getElementById('cryptoCurrencyList');
    const current = document.getElementById('cryptoCurrency')?.value || '';
    if (!modalEl || !listEl) return;
    listEl.innerHTML = WITHDRAWAL_CRYPTO_CURRENCIES.map(c => {
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
            selectWithdrawalCryptoCurrency(this.dataset.value);
            bootstrap.Modal.getInstance(modalEl)?.hide();
        });
    });
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
};

/**
 * Selecciona una criptomoneda y actualiza el formulario
 */
window.selectWithdrawalCryptoCurrency = function (value) {
    const c = WITHDRAWAL_CRYPTO_CURRENCIES.find(x => x.value === value);
    if (!c) return;
    const cryptoCurrencyInput = document.getElementById('cryptoCurrency');
    const cryptoCurrencyLabel = document.getElementById('cryptoCurrencyLabel');
    const cryptoCurrencyIcon = document.getElementById('cryptoCurrencyIcon');
    if (cryptoCurrencyInput) cryptoCurrencyInput.value = value;
    if (cryptoCurrencyLabel) {
        cryptoCurrencyLabel.textContent = c.label;
        cryptoCurrencyLabel.classList.remove('unselected');
    }
    if (cryptoCurrencyIcon) cryptoCurrencyIcon.src = `/assets/coins/${c.symbol.toLowerCase()}.svg`;
    cryptoCurrencyInput?.dispatchEvent(new Event('change'));
};

/**
 * Carga el balance del usuario y calcula el total en USD
 */
async function loadUserBalance() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        return;
    }

    try {
        const response = await fetch('/api/auth/me', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al cargar balance');
        }

        const data = await response.json();
        userWallets = data.wallets || [];

        // Calcular balance total en USD convirtiendo todos los assets
        totalBalanceUsd = await calculateTotalBalanceInUsd(userWallets);

        // Mostrar balance total con tooltip
        const balanceElement = document.getElementById('balanceAmount');
        balanceElement.innerHTML = `
            $${totalBalanceUsd.toFixed(2)} USD
            <span class="balance-tooltip" data-tooltip="Este monto es la suma de todos tus balances convertidos a USD. Para retirar, solo puedes usar el disponible en la wallet seleccionada.">
                <i class="ri-information-line"></i>
            </span>
        `;

        // Agregar tooltip interactivo
        const tooltip = balanceElement.querySelector('.balance-tooltip');
        if (tooltip) {
            tooltip.addEventListener('mouseenter', showBalanceTooltip);
            tooltip.addEventListener('mouseleave', hideBalanceTooltip);
            tooltip.style.cursor = 'help';
        }

    } catch (error) {
        console.error('Error al cargar balance:', error);
        document.getElementById('balanceAmount').textContent = 'Error al cargar';
    }
}

/**
 * Calcula el balance total en USD convirtiendo todos los assets
 */
async function calculateTotalBalanceInUsd(wallets) {
    let totalUsd = 0;

    // Agrupar wallets por asset (sumar todas las redes del mismo asset)
    const assetsBySymbol = {};

    for (const wallet of wallets) {
        const asset = wallet.assetSymbol;
        const balance = parseFloat(wallet.balance) || 0;

        if (!assetsBySymbol[asset]) {
            assetsBySymbol[asset] = 0;
        }

        assetsBySymbol[asset] += balance;
    }

    // Convertir cada asset a USD
    for (const [asset, totalBalance] of Object.entries(assetsBySymbol)) {
        if (totalBalance <= 0) {
            continue;
        }

        try {
            // Para stables (y BiUSD interno), 1:1 con USD
            if (asset === 'USDT' || asset === 'USDC' || asset === 'BIUSD') {
                totalUsd += totalBalance;
            } else {
                // Para otras monedas, convertir usando API de precios
                const convertResponse = await fetch(`/api/prices/convert?from=${asset}&to=USD&amount=${totalBalance}`);
                if (convertResponse.ok) {
                    const convertData = await convertResponse.json();
                    const usdValue = parseFloat(convertData.convertedAmount) || 0;
                    totalUsd += usdValue;
                }
            }
        } catch (error) {
            console.warn(`Error al convertir ${asset} a USD:`, error);
            // Si falla la conversión, no sumar nada (o podrías usar un precio por defecto)
        }
    }

    return totalUsd;
}

/**
 * Obtiene el balance disponible para un asset específico (sumando todas sus redes)
 */
function getAssetBalance(assetSymbol) {
    let total = 0;

    for (const wallet of userWallets) {
        if (wallet.assetSymbol === assetSymbol) {
            total += parseFloat(wallet.balance) || 0;
        }
    }

    return total;
}

/**
 * Maneja el cambio de criptomoneda
 */
async function handleCurrencyChange() {
    const cryptoCurrency = document.getElementById('cryptoCurrency').value;

    // Mostrar balance disponible del asset seleccionado
    if (cryptoCurrency) {
        const assetSymbol = extractAssetSymbol(cryptoCurrency);
        const assetBalance = getAssetBalance(assetSymbol);

        // Mostrar balance disponible debajo del selector
        let balanceInfo = document.getElementById('assetBalanceInfo');
        if (!balanceInfo) {
            balanceInfo = document.createElement('div');
            balanceInfo.id = 'assetBalanceInfo';
            balanceInfo.className = 'asset-balance-info';
            const cryptoTrigger = document.getElementById('cryptoCurrencyTrigger');
            const cryptoInput = document.getElementById('cryptoCurrency');
            const container = cryptoTrigger?.parentNode || cryptoInput?.parentNode;
            if (container && cryptoInput) container.insertBefore(balanceInfo, cryptoInput);
        }

        balanceInfo.innerHTML = `
            <div class="balance-available">
                <i class="ri-wallet-3-line"></i>
                <strong>Disponible:</strong> ${assetBalance.toFixed(8)} ${assetSymbol}
            </div>
        `;
        balanceInfo.style.display = 'block';
    } else {
        const balanceInfo = document.getElementById('assetBalanceInfo');
        if (balanceInfo) {
            balanceInfo.style.display = 'none';
        }
    }

    const amount = parseFloat(document.getElementById('amount').value);
    if (amount > 0) {
        await updateConversion(amount);
        await updateSummary();
    }
}

/**
 * Actualiza la información de conversión
 */
async function updateConversion(usdAmount) {
    const cryptoCurrency = document.getElementById('cryptoCurrency').value;
    if (!cryptoCurrency) {
        document.getElementById('conversionInfo').style.display = 'none';
        return;
    }

    try {
        // Extraer el símbolo del asset
        const assetSymbol = extractAssetSymbol(cryptoCurrency);

        // Obtener precio desde el API
        const response = await fetch(`/api/prices/latest?currency=${assetSymbol}`);
        if (!response.ok) {
            throw new Error('Error al obtener precio');
        }

        const data = await response.json();
        const price = parseFloat(data.price);

        // Calcular cantidad en crypto
        const cryptoAmount = usdAmount / price;

        // Mostrar información de conversión
        const conversionInfo = document.getElementById('conversionInfo');
        conversionInfo.innerHTML = `
            <strong>Equivalente estimado:</strong> ${cryptoAmount.toFixed(8)} ${assetSymbol}
            <br><small>Precio: $${price.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} por ${assetSymbol}</small>
        `;
        conversionInfo.style.display = 'block';
    } catch (error) {
        console.error('Error al actualizar conversión:', error);
        document.getElementById('conversionInfo').style.display = 'none';
    }
}

/**
 * Extrae el símbolo del asset desde cryptoCurrency
 */
function extractAssetSymbol(cryptoCurrency) {
    const currencyMap = {
        'usdtmatic': 'USDT',
        'usdttrc20': 'USDT',
        'usdcbsc': 'USDC',
        'btc': 'BTC',
        'ltc': 'LTC',
        'eth': 'ETH'
    };
    return currencyMap[cryptoCurrency.toLowerCase()] || cryptoCurrency.toUpperCase();
}

/**
 * Valida el balance para criptos volátiles (BTC, LTC, ETH, etc.)
 * Convierte el monto USD a la cripto y valida que no exceda el balance disponible
 */
async function validateVolatileCryptoBalance(usdAmount, assetSymbol, assetBalance, totalDebitedUsd) {
    try {
        // Obtener precio actual de la cripto
        const response = await fetch(`/api/prices/latest?currency=${assetSymbol}`);
        if (!response.ok) {
            throw new Error('Error al obtener precio');
        }

        const data = await response.json();
        const price = parseFloat(data.price);

        if (price <= 0) {
            throw new Error('Precio inválido');
        }

        // Convertir el monto total a debitar (USD) a la cripto
        const totalDebitedInCrypto = totalDebitedUsd / price;

        // Validar que el equivalente en cripto no exceda el balance disponible
        if (totalDebitedInCrypto > assetBalance) {
            const amountInCrypto = usdAmount / price;
            showError(
                `Saldo insuficiente en ${assetSymbol}. ` +
                `Disponible: ${assetBalance.toFixed(8)} ${assetSymbol}. ` +
                `El monto solicitado ($${usdAmount.toFixed(2)} USD = ${amountInCrypto.toFixed(8)} ${assetSymbol}) ` +
                `más comisión (${(totalDebitedInCrypto - amountInCrypto).toFixed(8)} ${assetSymbol}) ` +
                `excede tu balance disponible. Total requerido: ${totalDebitedInCrypto.toFixed(8)} ${assetSymbol}.`
            );
            document.getElementById('submitBtn').disabled = true;
        } else {
            document.getElementById('submitBtn').disabled = false;
            hideError();
        }
    } catch (error) {
        console.error('Error al validar balance de cripto volátil:', error);
        // Si falla la validación, permitir que el backend valide
        document.getElementById('submitBtn').disabled = false;
        hideError();
    }
}

/**
 * Maneja el cambio en el campo de monto
 */
async function handleAmountChange() {
    const amount = parseFloat(document.getElementById('amount').value) || 0;
    const cryptoCurrency = document.getElementById('cryptoCurrency').value;

    // Actualizar conversión si hay monto y criptomoneda seleccionada
    if (amount > 0 && cryptoCurrency) {
        await updateConversion(amount);
    } else {
        // Ocultar conversión si no hay monto o criptomoneda
        const conversionInfo = document.getElementById('conversionInfo');
        if (conversionInfo) {
            conversionInfo.style.display = 'none';
        }
    }

    // Actualizar resumen
    await updateSummary();
}

/**
 * Actualiza el resumen con fees
 */
async function updateSummary() {
    const amount = parseFloat(document.getElementById('amount').value) || 0;
    const cryptoCurrency = document.getElementById('cryptoCurrency').value;

    if (amount <= 0) {
        document.getElementById('summaryBox').style.display = 'none';
        return;
    }

    if (!cryptoCurrency) {
        document.getElementById('summaryBox').style.display = 'none';
        return;
    }

    // Calcular fee (2%): el fee se deduce DEL monto solicitado. Total a debitar = amount.
    const feePercent = 2.0;
    const feeAmount = amount * (feePercent / 100);
    const totalDebited = amount; // Lo que se debita (el fee va incluido en este monto)
    const netToUser = amount - feeAmount; // Lo que recibe el usuario

    // Actualizar resumen
    document.getElementById('summaryAmount').textContent = `$${amount.toFixed(2)}`;
    document.getElementById('summaryFee').textContent = `$${feeAmount.toFixed(2)}`;
    document.getElementById('summaryTotal').textContent = `$${totalDebited.toFixed(2)}`;
    const netEl = document.getElementById('summaryNet');
    if (netEl) netEl.textContent = `$${netToUser.toFixed(2)}`;

    // Mostrar resumen
    document.getElementById('summaryBox').style.display = 'block';

    // Validar balance suficiente del asset específico
    const assetSymbol = extractAssetSymbol(cryptoCurrency);
    const assetBalance = getAssetBalance(assetSymbol);

    // Para stables (USDT/USDC), validar directamente
    if (assetSymbol === 'USDT' || assetSymbol === 'USDC') {
        if (totalDebited > assetBalance) {
            showError(`Saldo insuficiente en ${assetSymbol}. Disponible: ${assetBalance.toFixed(8)} ${assetSymbol}. El monto solicitado ($${totalDebited.toFixed(2)} USD) excede tu balance disponible.`);
            document.getElementById('submitBtn').disabled = true;
        } else {
            document.getElementById('submitBtn').disabled = false;
            hideError();
        }
    } else {
        // Para criptos no estables (BTC, LTC, ETH, etc.):
        // Convertir el monto USD a la cripto y validar que no exceda el balance disponible
        await validateVolatileCryptoBalance(amount, assetSymbol, assetBalance, totalDebited);
    }
}

/**
 * Maneja el envío del formulario de retiro
 */
async function handleWithdrawalSubmit(e) {
    e.preventDefault();

    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        showError('No estás autenticado. Por favor, inicia sesión.');
        setTimeout(() => window.location.href = '/login', 2000);
        return;
    }

    const amount = parseFloat(document.getElementById('amount').value);
    const cryptoCurrency = document.getElementById('cryptoCurrency').value;
    const address = document.getElementById('address').value.trim();

    // Validaciones
    if (!amount || amount <= 0) {
        showError('Por favor, ingresa un monto válido mayor a cero.');
        return;
    }

    if (!cryptoCurrency) {
        showError('Por favor, selecciona una criptomoneda.');
        return;
    }

    if (!address || address.length < 10) {
        showError('Por favor, ingresa una dirección de wallet válida.');
        return;
    }

    // Validar balance del asset específico
    const assetSymbol = extractAssetSymbol(cryptoCurrency);
    const assetBalance = getAssetBalance(assetSymbol);

    // El retiro es sobre el asset específico, no sobre la suma total
    // Validamos que el usuario tenga suficiente balance en ese asset
    if (assetBalance <= 0) {
        showError(`No tienes balance disponible en ${assetSymbol}. Tu balance en esta wallet es 0.`);
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="ri-send-plane-line"></i> Confirmar Retiro';
        return;
    }

    // Para stables (USDT/USDC), el monto en USD debe ser <= al balance
    // Para otras monedas, el backend validará la conversión
    if (assetSymbol === 'USDT' || assetSymbol === 'USDC') {
        if (amount > assetBalance) {
            showError(`Saldo insuficiente en ${assetSymbol}. Disponible: ${assetBalance.toFixed(8)} ${assetSymbol}. El monto solicitado ($${amount.toFixed(2)} USD) excede tu balance disponible.`);
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="ri-send-plane-line"></i> Confirmar Retiro';
            return;
        }
    }

    // Deshabilitar botón
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="ri-loader-4-line"></i> Procesando...';

    try {
        const response = await fetch('/api/withdrawals/requests', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: amount,
                cryptoCurrency: cryptoCurrency,
                address: address
            })
        });

        const data = await response.json();

        if (!response.ok) {
            if (data.error === 'INSUFFICIENT_BALANCE') {
                throw new Error('Saldo insuficiente para realizar el retiro.');
            } else if (data.error === 'INVALID_ADDRESS') {
                throw new Error('Dirección de wallet inválida.');
            } else {
                throw new Error(data.message || 'Error al crear solicitud de retiro');
            }
        }

        // Mostrar éxito
        showSuccess('Solicitud de retiro creada exitosamente. Tu solicitud está siendo procesada.');

        // Limpiar formulario
        document.getElementById('withdrawalForm').reset();
        document.getElementById('summaryBox').style.display = 'none';
        document.getElementById('conversionInfo').style.display = 'none';

        // Recargar balance y historial
        loadUserBalance();
        loadWithdrawalHistory();

    } catch (error) {
        console.error('Error al crear retiro:', error);
        showError(error.message || 'Error al crear solicitud de retiro. Por favor, intenta nuevamente.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="ri-send-plane-line"></i> Confirmar Retiro';
    }
}

/**
 * Carga el historial de retiros con paginación
 */
async function loadWithdrawalHistory(page = 1) {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        return;
    }

    const historyContainer = document.getElementById('withdrawalHistory');
    withdrawalHistoryPage = page;

    try {
        const response = await fetch('/api/withdrawals', {
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
        let allWithdrawals = data.withdrawals || [];

        const otcRes = await fetch('/api/otc/requester/history?limit=50', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (otcRes.ok) {
            const otcData = await otcRes.json();
            const otcWithdrawals = (otcData.orders || [])
                .filter(o => (o.orderType || '').toUpperCase() === 'WITHDRAWAL')
                .map(o => ({
                    id: o.id,
                    amount: parseFloat(o.fiatAmount) || 0,
                    fiatAmount: parseFloat(o.fiatAmount) || 0,
                    fiatCurrency: (o.fiatCurrency || 'USD').toUpperCase(),
                    cryptoAmount: parseFloat(o.cryptoAmount) || 0,
                    cryptoAsset: o.cryptoAsset || 'USDT',
                    cryptoCurrency: (o.cryptoAsset || 'usdt') + (o.requesterNetwork || '').toLowerCase(),
                    status: o.status === 'COMPLETED' ? 'completed' : o.status === 'CANCELLED' ? 'cancelled' : 'pending',
                    createdAt: o.completedAt || o.updatedAt || o.createdAt,
                    otcWithdrawal: true
                }));
            allWithdrawals = [...allWithdrawals, ...otcWithdrawals];
        }

        if (allWithdrawals.length === 0) {
            historyContainer.innerHTML = '<p class="text-muted">No hay retiros aún.</p>';
            return;
        }

        allWithdrawals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Calculate pagination
        withdrawalHistoryTotalPages = Math.ceil(allWithdrawals.length / WITHDRAWAL_HISTORY_PAGE_SIZE);
        const startIndex = (page - 1) * WITHDRAWAL_HISTORY_PAGE_SIZE;
        const endIndex = startIndex + WITHDRAWAL_HISTORY_PAGE_SIZE;
        const withdrawals = allWithdrawals.slice(startIndex, endIndex);

        // Renderizar historial
        let html = withdrawals.map(withdrawal => {
            const date = new Date(withdrawal.createdAt).toLocaleDateString('es-VE', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            const statusBadge = getStatusBadge(withdrawal.status);

            let feeAmount = 0;
            if (!withdrawal.otcWithdrawal) {
                const feePercent = 2.0;
                feeAmount = parseFloat(withdrawal.feeAmount) || 0;
                if (feeAmount === 0) feeAmount = (parseFloat(withdrawal.amount) || 0) * (feePercent / 100);
            }

            const assetSymbol = extractAssetSymbol(withdrawal.cryptoCurrency);
            const label = withdrawal.otcWithdrawal ? 'Retiro OTC' : assetSymbol;
            const detail = withdrawal.otcWithdrawal
                ? `${label} • ${date}`
                : `${label} • Comisión: $${feeAmount.toFixed(2)} • ${date}${withdrawal.txHash ? '<br>TX: ' + withdrawal.txHash.substring(0, 20) + '...' : ''}`;

            const mainAmount = withdrawal.otcWithdrawal && withdrawal.fiatAmount != null && withdrawal.fiatCurrency
                ? `${Number(withdrawal.fiatAmount).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${withdrawal.fiatCurrency}`
                : `$${parseFloat(withdrawal.amount).toFixed(2)} USD`;
            const cryptoLine = withdrawal.otcWithdrawal && withdrawal.cryptoAmount != null && withdrawal.cryptoAsset
                ? `${Number(withdrawal.cryptoAmount).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${withdrawal.cryptoAsset}`
                : null;

            return `
                <div class="withdrawal-item">
                    <div class="withdrawal-item-info">
                        <strong>${mainAmount}</strong>
                        ${cryptoLine ? `<br><span class="text-muted">${cryptoLine}</span>` : ''}
                        <small>${detail}</small>
                    </div>
                    <div>
                        ${statusBadge}
                    </div>
                </div>
            `;
        }).join('');

        // Add pagination controls if more than 1 page
        if (withdrawalHistoryTotalPages > 1) {
            html += `
                <div class="pagination-controls">
                    <button onclick="loadWithdrawalHistory(${page - 1})" ${page <= 1 ? 'disabled' : ''}>
                        <i class="ri-arrow-left-s-line"></i> Anterior
                    </button>
                    <span class="page-info">Página ${page} de ${withdrawalHistoryTotalPages}</span>
                    <button onclick="loadWithdrawalHistory(${page + 1})" ${page >= withdrawalHistoryTotalPages ? 'disabled' : ''}>
                        Siguiente <i class="ri-arrow-right-s-line"></i>
                    </button>
                </div>
            `;
        }

        historyContainer.innerHTML = html;

    } catch (error) {
        console.error('Error al cargar historial:', error);
        historyContainer.innerHTML = '<p class="text-muted">Error al cargar historial de retiros.</p>';
    }
}

/**
 * Genera el HTML del badge de estado
 */
function getStatusBadge(status) {
    const statusMap = {
        'pending': { text: 'Pendiente', class: 'pending' },
        'processing': { text: 'Procesando', class: 'processing' },
        'completed': { text: 'Completado', class: 'completed' },
        'failed': { text: 'Fallido', class: 'failed' },
        'cancelled': { text: 'Cancelado', class: 'cancelled' }
    };

    const statusInfo = statusMap[status.toLowerCase()] || { text: status, class: 'pending' };
    return `<span class="status-badge ${statusInfo.class}">${statusInfo.text}</span>`;
}

/**
 * Muestra un mensaje de error
 */
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';

    // Scroll al error
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Ocultar después de 5 segundos
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

/**
 * Oculta el mensaje de error
 */
function hideError() {
    document.getElementById('errorMessage').style.display = 'none';
}

// --- OTC Retiro Moneda Nacional ---

window.selectWithdrawalType = function (type) {
    const selection = document.getElementById('withdrawalTypeSelection');
    const cryptoSection = document.getElementById('cryptoWithdrawalSection');
    const otcSection = document.getElementById('otcWithdrawalSection');
    if (!selection || !cryptoSection || !otcSection) return;

    selection.style.display = 'none';
    cryptoSection.style.display = 'none';
    otcSection.style.display = 'none';

    if (type === 'back') {
        selection.style.display = 'block';
    } else if (type === 'crypto') {
        cryptoSection.style.display = 'block';
    } else if (type === 'fiat' && otcWithdrawNationalInfo) {
        otcSection.style.display = 'block';
        loadUserBalance().then(() => loadOtcWithdrawData());
    }
};

async function checkOtcWithdrawEligibility() {
    const token = localStorage.getItem('accessToken');
    const wrapper = document.getElementById('otcWithdrawalCardWrapper');
    if (!wrapper) return;
    if (!token) {
        wrapper.style.display = 'none';
        return;
    }
    try {
        const res = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) { wrapper.style.display = 'none'; return; }
        const data = await res.json();
        const country = data.profile?.country || data.user?.profile?.country || '';
        otcWithdrawNationalInfo = getNationalCurrencyFromCountry(country);
        wrapper.style.display = otcWithdrawNationalInfo ? 'block' : 'none';
        // Personalizar texto con moneda y bandera según nacionalidad
        const flagEl = document.getElementById('otcNationalCardFlag');
        const currencyEl = document.getElementById('otcNationalCardCurrency');
        if (otcWithdrawNationalInfo && flagEl && currencyEl) {
            flagEl.textContent = otcWithdrawNationalInfo.flag || '';
            currencyEl.textContent = otcWithdrawNationalInfo.currency || otcWithdrawNationalInfo.fiatCode;
        }
    } catch {
        wrapper.style.display = 'none';
    }
}

async function loadOtcWithdrawData() {
    if (!otcWithdrawNationalInfo) return;
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const fiatDisplay = document.getElementById('otcWithdrawFiatDisplay');
    const pmCardsEl = document.getElementById('otcWithdrawPaymentMethodCards');
    const noPmEl = document.getElementById('otcWithdrawNoPaymentMethods');
    const pmHidden = document.getElementById('otcWithdrawPaymentMethod');

    if (fiatDisplay) fiatDisplay.textContent = `${otcWithdrawNationalInfo.flag || ''} ${otcWithdrawNationalInfo.currency || otcWithdrawNationalInfo.fiatCode}`;

    try {
        const pmRes = await fetch(`/api/otc/requester/payment-methods/${otcWithdrawNationalInfo.fiatCode}`, { headers: { 'Authorization': 'Bearer ' + token } });
        const pmData = pmRes.ok ? await pmRes.json() : { paymentMethods: [] };
        const methods = pmData.paymentMethods || [];

        if (pmHidden) pmHidden.value = '';

        if (methods.length === 0) {
            if (pmCardsEl) {
                pmCardsEl.innerHTML = '';
                pmCardsEl.style.display = 'none';
            }
            if (noPmEl) {
                noPmEl.innerHTML = `<p>No tienes métodos de pago agregados para recibir en ${otcWithdrawNationalInfo.currency || otcWithdrawNationalInfo.fiatCode}.</p>
                    <a href="/profile#payment-methods" class="btn btn-sm btn-outline-primary mt-2"><i class="ri-add-line"></i> Agregar método de pago</a>`;
                noPmEl.style.display = 'block';
            }
        } else {
            if (noPmEl) noPmEl.style.display = 'none';
            if (pmCardsEl) {
                pmCardsEl.style.display = 'flex';
                pmCardsEl.innerHTML = methods.map(m => `
                    <div class="payment-method-card" data-id="${m.id}" role="button" tabindex="0">
                        ${m.logoUrl ? `<img src="${m.logoUrl}" alt="${m.name || m.type}" class="pm-logo" onerror="this.style.display='none'">` : '<div class="pm-logo" style="display:flex;align-items:center;justify-content:center;font-size:18px;"><i class="ri-bank-card-line"></i></div>'}
                        <span class="pm-name">${m.name || m.type}</span>
                    </div>
                `).join('');
                pmCardsEl.querySelectorAll('.payment-method-card').forEach(card => {
                    card.addEventListener('click', () => selectOtcPaymentMethod(card.dataset.id));
                    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOtcPaymentMethod(card.dataset.id); } });
                });
            }
        }

        updateOtcWithdrawBalanceDisplay();
        scheduleOtcWithdrawRateUpdate();
    } catch (e) {
        console.error('loadOtcWithdrawData:', e);
    }
}

function selectOtcPaymentMethod(id) {
    const pmHidden = document.getElementById('otcWithdrawPaymentMethod');
    if (pmHidden) pmHidden.value = id || '';
    document.querySelectorAll('.payment-method-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.id === id);
    });
    scheduleOtcWithdrawRateUpdate();
}

window.openOtcWithdrawCryptoSelector = function () {
    const modal = document.getElementById('otcWithdrawCryptoModal');
    const list = document.getElementById('otcWithdrawCryptoList');
    const current = document.getElementById('otcWithdrawCrypto')?.value || '';
    if (!modal || !list) return;
    list.innerHTML = OTC_WITHDRAWAL_CRYPTO_OPTIONS.map(c => {
        const sel = c.value === current;
        const bal = getAssetBalance(c.symbol);
        const balStr = bal >= 0 ? bal.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : '—';
        return `<li class="list-group-item list-group-item-action d-flex align-items-center py-3" data-value="${c.value}" role="button">
            <img src="/assets/coins/${c.symbol.toLowerCase()}.svg" alt="${c.symbol}" class="asset-icon-small me-3" style="width: 32px; height: 32px;" onerror="this.src='/assets/coins/usdt.svg'">
            <span class="flex-grow-1 fw-semibold">${c.label}</span>
            <span class="otc-crypto-balance text-muted small">Disponible: ${balStr} ${c.symbol}</span>
            ${sel ? '<i class="ri-check-line text-success fs-5 ms-2"></i>' : ''}
        </li>`;
    }).join('');
    list.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', function () {
            selectOtcWithdrawCrypto(this.dataset.value);
            bootstrap.Modal.getInstance(modal)?.hide();
        });
    });
    bootstrap.Modal.getOrCreateInstance(modal).show();
};

window.selectOtcWithdrawCrypto = function (value) {
    const c = OTC_WITHDRAWAL_CRYPTO_OPTIONS.find(x => x.value === value);
    if (!c) return;
    document.getElementById('otcWithdrawCrypto').value = value;
    document.getElementById('otcWithdrawCryptoLabel').textContent = c.label;
    document.getElementById('otcWithdrawCryptoLabel').classList.remove('unselected');
    document.getElementById('otcWithdrawCryptoIcon').src = `/assets/coins/${c.symbol.toLowerCase()}.svg`;
    updateOtcWithdrawBalanceDisplay();
    loadOtcWithdrawData();
};

function updateOtcWithdrawBalanceDisplay() {
    const crypto = document.getElementById('otcWithdrawCrypto')?.value;
    const balEl = document.getElementById('otcWithdrawBalanceInfo');
    if (!balEl) return;
    if (!crypto) {
        balEl.style.display = 'none';
        return;
    }
    const bal = getAssetBalance(crypto);
    balEl.innerHTML = `Disponible: <strong>${bal.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${crypto}</strong>`;
    balEl.style.display = 'block';
}

let otcWithdrawRateDebounce = null;
function scheduleOtcWithdrawRateUpdate() {
    if (otcWithdrawRateDebounce) clearTimeout(otcWithdrawRateDebounce);
    otcWithdrawRateDebounce = setTimeout(updateOtcWithdrawRateDisplay, 300);
}

async function updateOtcWithdrawRateDisplay() {
    if (!otcWithdrawNationalInfo) return;
    const crypto = document.getElementById('otcWithdrawCrypto')?.value;
    const amount = parseFloat(document.getElementById('otcWithdrawAmount')?.value) || 0;
    const rateEl = document.getElementById('otcWithdrawRateDisplay');
    const amountEl = document.getElementById('otcWithdrawAmountDisplay');
    const feeEl = document.getElementById('otcWithdrawFeeDisplay');
    const fiatEl = document.getElementById('otcWithdrawFiatAmount');
    if (!crypto || amount <= 0) {
        if (rateEl) rateEl.textContent = '—';
        if (amountEl) amountEl.textContent = '—';
        if (feeEl) feeEl.textContent = '—';
        if (fiatEl) fiatEl.textContent = '—';
        const balErr = document.getElementById('otcWithdrawBalanceError');
        if (balErr) balErr.style.display = 'none';
        const submitBtn = document.getElementById('otcWithdrawSubmitBtn');
        if (submitBtn) submitBtn.disabled = false;
        return;
    }
    try {
        const token = localStorage.getItem('accessToken');
        if (!token) return;
        const res = await fetch(`/api/otc/withdrawal/rate?cryptoAsset=${encodeURIComponent(crypto)}&fiatCurrency=${encodeURIComponent(otcWithdrawNationalInfo.fiatCode)}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const rate = data.rate || 0;
        const feeCrypto = amount * 0.02;
        const fiatAmount = amount * 0.98 * rate;
        if (rateEl) rateEl.textContent = `1 ${crypto} = ${rate.toLocaleString('es', { minimumFractionDigits: 2 })} ${otcWithdrawNationalInfo.fiatCode}`;
        if (amountEl) amountEl.textContent = `${amount.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${crypto}`;
        if (feeEl) feeEl.textContent = `${feeCrypto.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${crypto}`;
        if (fiatEl) fiatEl.textContent = `${fiatAmount.toLocaleString('es', { minimumFractionDigits: 2 })} ${otcWithdrawNationalInfo.fiatCode}`;

        const availableBalance = getAssetBalance(crypto);
        const submitBtn = document.getElementById('otcWithdrawSubmitBtn');
        const balErr = document.getElementById('otcWithdrawBalanceError');
        if (amount > availableBalance && balErr) {
            balErr.textContent = `Saldo insuficiente. Disponible: ${availableBalance.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${crypto}.`;
            balErr.style.display = 'block';
            if (submitBtn) submitBtn.disabled = true;
        } else {
            if (balErr) balErr.style.display = 'none';
            if (submitBtn) submitBtn.disabled = false;
        }
    } catch {
        if (rateEl) rateEl.textContent = 'Error';
        if (amountEl) amountEl.textContent = '—';
        if (feeEl) feeEl.textContent = '—';
        if (fiatEl) fiatEl.textContent = '—';
    }
}

async function handleOtcWithdrawalSubmit() {
    if (!otcWithdrawNationalInfo) return;
    const token = localStorage.getItem('accessToken');
    if (!token) {
        document.getElementById('otcWithdrawalError').textContent = 'Debes iniciar sesión.';
        document.getElementById('otcWithdrawalError').style.display = 'block';
        return;
    }

    const cryptoAsset = document.getElementById('otcWithdrawCrypto')?.value;
    const paymentMethodId = document.getElementById('otcWithdrawPaymentMethod')?.value;
    const cryptoAmount = parseFloat(document.getElementById('otcWithdrawAmount')?.value) || 0;
    const errEl = document.getElementById('otcWithdrawalError');

    if (!cryptoAsset || !paymentMethodId || cryptoAmount <= 0) {
        errEl.textContent = !paymentMethodId
            ? 'Selecciona un método de pago para recibir el fiat. Si no tienes, agrega uno en Perfil.'
            : 'Completa todos los campos.';
        errEl.style.display = 'block';
        return;
    }

    const availableBalance = getAssetBalance(cryptoAsset);
    if (cryptoAmount > availableBalance) {
        errEl.textContent = `Saldo insuficiente. Disponible: ${availableBalance.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${cryptoAsset}.`;
        errEl.style.display = 'block';
        return;
    }

    const btn = document.getElementById('otcWithdrawSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line"></i> Procesando...';
    errEl.style.display = 'none';

    try {
        const res = await fetch('/api/otc/withdrawal/request', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cryptoAsset,
                fiatCurrency: otcWithdrawNationalInfo.fiatCode,
                cryptoAmount,
                paymentMethodId
            })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || data.message || 'Error al crear solicitud');

        document.getElementById('otcWithdrawalSuccess').style.display = 'none';
        document.getElementById('otcWithdrawAmount').value = '';
        updateOtcWithdrawRateDisplay();
        loadUserBalance();
        loadWithdrawalHistory();
        const order = data.order;
        showOtcWithdrawSearchModal(order);
        startOtcWithdrawOrderPolling(order.id);
    } catch (e) {
        errEl.textContent = e.message || 'Error al crear solicitud';
        errEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="ri-arrow-right-line"></i> Solicitar Retiro';
    }
}

let otcWithdrawSearchTimerInterval = null;
let otcWithdrawSearchExpiresAt = null;
let currentOtcWithdrawOrderId = null;

function showOtcWithdrawSearchModal(order) {
    currentOtcWithdrawOrderId = order.id;
    otcWithdrawSearchExpiresAt = new Date(order.expiresAt);
    const modal = document.getElementById('otcWithdrawSearchModal');
    const content = document.getElementById('otcWithdrawSearchContent');
    const statusEl = document.getElementById('otcWithdrawSearchStatus');
    const footer = document.getElementById('otcWithdrawSearchFooter');
    const cancelBtn = document.getElementById('otcWithdrawCancelSearchBtn');

            if (order.status === 'WAITING_PAYMENT') {
        content.innerHTML = `
            <div class="mb-4"><i class="ri-user-follow-fill" style="font-size: 64px; color: #ee6a3e;"></i></div>
            <p id="otcWithdrawSearchStatus" class="fw-semibold mb-2" style="color: #2d3748;">Solicitud en proceso</p>
            <p class="text-muted mb-0">Tu retiro está siendo procesado. Recibirás el fiat en tu método de pago en breve.</p>
        `;
        if (footer) footer.style.display = 'none';
    } else if (order.status === 'CANCELLED') {
            content.innerHTML = `
            <div class="mb-4"><i class="ri-close-circle-line" style="font-size: 64px; color: #e53e3e;"></i></div>
            <p id="otcWithdrawSearchStatus" class="fw-semibold mb-2" style="color: #2d3748;">Solicitud cancelada</p>
            <p class="text-muted mb-0">La solicitud fue cancelada o expiró. Puedes intentar de nuevo haciendo clic en "Solicitar Retiro".</p>
        `;
        if (footer) {
            footer.style.display = 'flex';
            footer.innerHTML = '<button type="button" class="btn btn-primary" data-bs-dismiss="modal"><i class="ri-check-line"></i> Cerrar</button>';
        }
    } else {
        content.innerHTML = `
            <div class="otc-withdraw-search-animation" style="display: flex; align-items: center; justify-content: center; gap: 20px; margin: 30px 0; flex-wrap: wrap;">
                <div><i class="ri-cloud-fill" style="font-size: 64px; color: #ee6a3e;"></i><div style="margin-top: 8px; font-size: 12px; color: #4a5568;">Tú</div></div>
                <div class="connection-dots" style="display: flex; gap: 5px;">
                    <span style="width: 8px; height: 8px; background: #ee6a3e; border-radius: 50%; animation: otcPulse 1.5s infinite;"></span>
                    <span style="width: 8px; height: 8px; background: #ee6a3e; border-radius: 50%; animation: otcPulse 1.5s infinite 0.2s;"></span>
                    <span style="width: 8px; height: 8px; background: #ee6a3e; border-radius: 50%; animation: otcPulse 1.5s infinite 0.4s;"></span>
                </div>
                <div><i class="ri-earth-fill" style="font-size: 64px; color: #ee6a3e;"></i><div style="margin-top: 8px; font-size: 12px; color: #4a5568;">BidiPago</div></div>
            </div>
            <p id="otcWithdrawSearchStatus" style="color: #718096; margin-bottom: 20px;">Procesando tu solicitud...</p>
            <p class="text-muted small">Tienes 10 minutos. Si no hay disponibilidad, puedes cancelar e intentar más tarde.</p>
        `;
        if (footer) {
            footer.style.display = 'flex';
            footer.innerHTML = '<button type="button" class="btn btn-outline-secondary" id="otcWithdrawCancelSearchBtn"><i class="ri-close-line"></i> Cancelar solicitud</button>';
            document.getElementById('otcWithdrawCancelSearchBtn')?.addEventListener('click', handleOtcWithdrawCancelSearch);
        }
    }

    if (order.status === 'PENDING') {
        startOtcWithdrawSearchTimer();
        if (footer && cancelBtn) footer.style.display = 'flex';
    }
    bootstrap.Modal.getOrCreateInstance(modal).show();
}

function startOtcWithdrawSearchTimer() {
    const timerEl = document.getElementById('otcWithdrawSearchTimer');
    if (!timerEl) return;
    if (otcWithdrawSearchTimerInterval) clearInterval(otcWithdrawSearchTimerInterval);
    const update = () => {
        const now = new Date();
        const remaining = Math.max(0, Math.floor((otcWithdrawSearchExpiresAt - now) / 1000));
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
        if (remaining <= 0) {
            clearInterval(otcWithdrawSearchTimerInterval);
            otcWithdrawSearchTimerInterval = null;
            handleOtcWithdrawSearchExpired();
        }
    };
    update();
    otcWithdrawSearchTimerInterval = setInterval(update, 1000);
}

async function handleOtcWithdrawCancelSearch() {
    if (!currentOtcWithdrawOrderId) return;
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    try {
        const res = await fetch('/api/otc/cancel', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: currentOtcWithdrawOrderId })
        });
        if (res.ok) {
            stopOtcWithdrawPolling();
            if (otcWithdrawSearchTimerInterval) {
                clearInterval(otcWithdrawSearchTimerInterval);
                otcWithdrawSearchTimerInterval = null;
            }
            sessionStorage.removeItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY);
            localStorage.removeItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY);
            bootstrap.Modal.getInstance(document.getElementById('otcWithdrawSearchModal'))?.hide();
            loadUserBalance();
            loadWithdrawalHistory();
        } else {
            const data = await res.json().catch(() => ({}));
            document.getElementById('otcWithdrawalError').textContent = data.error || 'No se pudo cancelar';
            document.getElementById('otcWithdrawalError').style.display = 'block';
        }
    } catch (e) {
        document.getElementById('otcWithdrawalError').textContent = 'Error al cancelar';
        document.getElementById('otcWithdrawalError').style.display = 'block';
    }
}

function handleOtcWithdrawSearchExpired() {
    stopOtcWithdrawPolling();
    sessionStorage.removeItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY);
    localStorage.removeItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY);
    const content = document.getElementById('otcWithdrawSearchContent');
    const footer = document.getElementById('otcWithdrawSearchFooter');
    if (content) {
        content.innerHTML = `
            <div class="mb-4"><i class="ri-time-line" style="font-size: 64px; color: #e53e3e;"></i></div>
            <p class="fw-semibold mb-2" style="color: #2d3748;">Tiempo agotado</p>
            <p class="text-muted mb-0">No hubo disponibilidad en 10 minutos. Puedes intentar de nuevo haciendo clic en "Solicitar Retiro".</p>
        `;
    }
    if (footer) {
        footer.style.display = 'flex';
        footer.innerHTML = '<button type="button" class="btn btn-primary" data-bs-dismiss="modal"><i class="ri-check-line"></i> Cerrar</button>';
    }
}

function startOtcWithdrawOrderPolling(orderId) {
    stopOtcWithdrawPolling();
    const poll = async () => {
        const token = localStorage.getItem('accessToken');
        if (!token) return;
        try {
            const res = await fetch(`/api/otc/orders/${orderId}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return;
            const data = await res.json();
            const order = data.order;
            const modal = document.getElementById('otcWithdrawSearchModal');
            const content = document.getElementById('otcWithdrawSearchContent');
            const footer = document.getElementById('otcWithdrawSearchFooter');

            if (order.status === 'PENDING') {
                otcWithdrawSearchExpiresAt = new Date(order.expiresAt);
                if (content) {
                    content.innerHTML = `
                        <div class="otc-withdraw-search-animation" style="display: flex; align-items: center; justify-content: center; gap: 20px; margin: 30px 0; flex-wrap: wrap;">
                            <div><i class="ri-cloud-fill" style="font-size: 64px; color: #ee6a3e;"></i><div style="margin-top: 8px; font-size: 12px; color: #4a5568;">Tú</div></div>
                            <div class="connection-dots" style="display: flex; gap: 5px;">
                                <span style="width: 8px; height: 8px; background: #ee6a3e; border-radius: 50%; animation: otcPulse 1.5s infinite;"></span>
                                <span style="width: 8px; height: 8px; background: #ee6a3e; border-radius: 50%; animation: otcPulse 1.5s infinite 0.2s;"></span>
                                <span style="width: 8px; height: 8px; background: #ee6a3e; border-radius: 50%; animation: otcPulse 1.5s infinite 0.4s;"></span>
                            </div>
                            <div><i class="ri-earth-fill" style="font-size: 64px; color: #ee6a3e;"></i><div style="margin-top: 8px; font-size: 12px; color: #4a5568;">BidiPago</div></div>
                        </div>
                        <p id="otcWithdrawSearchStatus" style="color: #718096; margin-bottom: 20px;">Buscando disponibilidad...</p>
                        <p class="text-muted small">Tienes 10 minutos. Si no hay disponibilidad, puedes cancelar e intentar más tarde.</p>
                    `;
                }
                if (footer) {
                    footer.style.display = 'flex';
                    footer.innerHTML = '<button type="button" class="btn btn-outline-secondary" id="otcWithdrawCancelSearchBtn"><i class="ri-close-line"></i> Cancelar solicitud</button>';
                    document.getElementById('otcWithdrawCancelSearchBtn')?.addEventListener('click', handleOtcWithdrawCancelSearch);
                }
                const timerEl = document.getElementById('otcWithdrawSearchTimer');
                if (timerEl) timerEl.style.display = '';
                startOtcWithdrawSearchTimer();
            } else if (order.status === 'WAITING_PAYMENT') {
                stopOtcWithdrawPolling();
                sessionStorage.setItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY, orderId);
                try { localStorage.setItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY, orderId); } catch (e) { /* incógnito */ }
                if (otcWithdrawSearchTimerInterval) {
                    clearInterval(otcWithdrawSearchTimerInterval);
                    otcWithdrawSearchTimerInterval = null;
                }
                if (content) {
                    content.innerHTML = `
                        <div class="mb-4"><i class="ri-user-follow-fill" style="font-size: 64px; color: #ee6a3e;"></i></div>
                        <p class="fw-semibold mb-2" style="color: #2d3748;">Solicitud en proceso</p>
                        <p class="text-muted mb-0">Tu retiro está siendo procesado. Recibirás el fiat en tu método de pago en breve.</p>
                    `;
                }
                if (footer) footer.style.display = 'none';
                const timerEl = document.getElementById('otcWithdrawSearchTimer');
                if (timerEl) timerEl.style.display = 'none';
                startOtcWithdrawOrderPolling(orderId);
            } else if (order.status === 'COMPLETED') {
                stopOtcWithdrawPolling();
                sessionStorage.removeItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY);
                localStorage.removeItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY);
                if (otcWithdrawSearchTimerInterval) {
                    clearInterval(otcWithdrawSearchTimerInterval);
                    otcWithdrawSearchTimerInterval = null;
                }
                if (content) {
                    content.innerHTML = `
                        <div class="mb-4"><i class="ri-checkbox-circle-fill" style="font-size: 64px; color: #38a169;"></i></div>
                        <p class="fw-semibold mb-2" style="color: #2d3748;">¡Retiro completado!</p>
                        <p class="text-muted mb-0">El fiat ha sido enviado a tu método de pago. El envío fue confirmado.</p>
                    `;
                }
                if (footer) {
                    footer.style.display = 'flex';
                    footer.innerHTML = '<button type="button" class="btn btn-primary" data-bs-dismiss="modal"><i class="ri-check-line"></i> Cerrar</button>';
                }
                loadUserBalance();
                loadWithdrawalHistory();
                showOtcWithdrawSuccessBadge(order);
                setTimeout(() => bootstrap.Modal.getInstance(modal)?.hide(), 2500);
            } else if (order.status === 'CANCELLED') {
                stopOtcWithdrawPolling();
                sessionStorage.removeItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY);
                localStorage.removeItem(OTC_WITHDRAWAL_ACTIVE_ORDER_KEY);
                if (otcWithdrawSearchTimerInterval) {
                    clearInterval(otcWithdrawSearchTimerInterval);
                    otcWithdrawSearchTimerInterval = null;
                }
                if (content) {
                    content.innerHTML = `
                        <div class="mb-4"><i class="ri-close-circle-line" style="font-size: 64px; color: #e53e3e;"></i></div>
                        <p class="fw-semibold mb-2" style="color: #2d3748;">Orden cancelada</p>
                        <p class="text-muted mb-0">La solicitud fue cancelada o expiró. Puedes intentar de nuevo haciendo clic en "Solicitar Retiro".</p>
                    `;
                }
                if (footer) {
                    footer.style.display = 'flex';
                    footer.innerHTML = '<button type="button" class="btn btn-primary" data-bs-dismiss="modal"><i class="ri-check-line"></i> Cerrar e intentar de nuevo</button>';
                }
                loadUserBalance();
                loadWithdrawalHistory();
            }
        } catch (e) { /* ignore */ }
    };
    otcWithdrawOrderPollInterval = setInterval(poll, 3000);
    poll();
}

let otcWithdrawOrderPollInterval = null;
function stopOtcWithdrawPolling() {
    if (otcWithdrawOrderPollInterval) {
        clearInterval(otcWithdrawOrderPollInterval);
        otcWithdrawOrderPollInterval = null;
    }
}

function showOtcWithdrawStatus(order) {
    const errEl = document.getElementById('otcWithdrawalError');
    const okEl = document.getElementById('otcWithdrawalSuccess');
    if (order.status === 'PENDING') {
        okEl.textContent = 'Tu solicitud está pendiente. Se procesará en breve. Tienes 10 minutos.';
    } else if (order.status === 'WAITING_PAYMENT') {
        okEl.textContent = 'Tu retiro está en proceso. Recibirás el fiat en tu método de pago pronto.';
    }
    okEl.style.display = 'block';
}

/**
 * Muestra badge de éxito cuando el retiro OTC se completa (el modal se cierra automáticamente)
 */
function showOtcWithdrawSuccessBadge(order) {
    const el = document.getElementById('otcWithdrawalSuccess');
    if (!el) return;
    const crypto = (order.cryptoAsset || '').toUpperCase();
    const fiat = (order.fiatAmount || 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fiatCur = order.fiatCurrency || '';
    el.className = 'alert alert-success otc-withdraw-success-badge';
    el.innerHTML = '<i class="ri-checkbox-circle-fill"></i> ¡Retiro completado! El fiat (' + fiat + ' ' + fiatCur + ') ha sido enviado a tu método de pago. El balance de ' + crypto + ' se ha actualizado.';
    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { el.style.display = 'none'; }, 10000);
}

/**
 * Muestra un mensaje de éxito
 */
function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    successDiv.textContent = message;
    successDiv.style.display = 'block';

    // Scroll al mensaje
    successDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Ocultar después de 5 segundos
    setTimeout(() => {
        successDiv.style.display = 'none';
    }, 5000);
}

/**
 * Muestra el tooltip del balance
 */
function showBalanceTooltip(event) {
    const tooltip = event.target.closest('.balance-tooltip');
    if (!tooltip) return;

    const tooltipText = tooltip.getAttribute('data-tooltip');
    if (!tooltipText) return;

    // Crear tooltip flotante
    let tooltipElement = document.getElementById('balanceTooltipPopup');
    if (!tooltipElement) {
        tooltipElement = document.createElement('div');
        tooltipElement.id = 'balanceTooltipPopup';
        tooltipElement.className = 'balance-tooltip-popup';
        document.body.appendChild(tooltipElement);
    }

    tooltipElement.textContent = tooltipText;
    tooltipElement.style.display = 'block';

    // Posicionar tooltip
    const rect = tooltip.getBoundingClientRect();
    tooltipElement.style.top = (rect.bottom + 10) + 'px';
    tooltipElement.style.left = (rect.left + rect.width / 2 - 150) + 'px';
}

/**
 * Oculta el tooltip del balance
 */
function hideBalanceTooltip() {
    const tooltipElement = document.getElementById('balanceTooltipPopup');
    if (tooltipElement) {
        tooltipElement.style.display = 'none';
    }
}

