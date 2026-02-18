/**
 * Recargas Telefónicas (proveedor de recargas)
 * Flujo: países → operadores + monto + teléfono → billetera (USDT/USDC/BiUSD) → confirmar
 */

const API = '/api/recargas';

let countries = [];
let operators = [];
let wallets = [];
let selectedCountry = null;
let selectedOperator = null;
let selectedAmount = null;
let selectedWalletSymbol = null;
let quote = null;

function getAuthHeaders() {
    const token = localStorage.getItem('accessToken');
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function checkAuth() {
    if (!localStorage.getItem('accessToken')) {
        window.location.href = '/login';
        return false;
    }
    return true;
}

function showAlert(msg, type) {
    const el = document.getElementById('alertRecargas');
    el.className = 'alert alert-' + (type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info');
    el.textContent = msg;
    el.style.display = 'block';
}

function hideAlert() {
    document.getElementById('alertRecargas').style.display = 'none';
}

/** Muestra mensaje de éxito o error en un modal estilizado */
function showRecargaModal(msg, type) {
    const overlay = document.getElementById('recargaModalOverlay');
    const header = document.getElementById('recargaModalHeader');
    const icon = document.getElementById('recargaModalIcon');
    const title = document.getElementById('recargaModalTitle');
    const body = document.getElementById('recargaModalBody');
    const isSuccess = type === 'success';
    header.className = 'recarga-modal-header ' + (isSuccess ? 'success' : 'error');
    icon.className = isSuccess ? 'ri-checkbox-circle-line' : 'ri-error-warning-line';
    title.textContent = isSuccess ? 'Recarga exitosa' : 'Error';
    body.textContent = msg;
    overlay.classList.add('show');
}

function closeRecargaModal() {
    document.getElementById('recargaModalOverlay').classList.remove('show');
}

document.getElementById('recargaModalClose').addEventListener('click', closeRecargaModal);
document.getElementById('recargaModalOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeRecargaModal();
});

async function loadCountries() {
    const res = await fetch(API + '/countries', { headers: getAuthHeaders() });
    if (!res.ok) { showAlert('Error al cargar países', 'error'); return; }
    const data = await res.json();
    countries = data.countries || [];
    const grid = document.getElementById('countriesGrid');
    grid.innerHTML = countries.map(c => `
        <div class="country-card" data-iso="${c.isoName}">
            <img src="${c.flag || ''}" alt="${c.name}" onerror="this.style.display='none'">
            <span>${c.name}</span>
        </div>
    `).join('');
    grid.querySelectorAll('.country-card').forEach(card => {
        card.addEventListener('click', () => selectCountry(card.dataset.iso));
    });
}

function selectCountry(iso) {
    selectedCountry = countries.find(c => c.isoName === iso);
    if (!selectedCountry) return;
    document.getElementById('stepCountries').style.display = 'none';
    document.getElementById('stepOperators').style.display = 'block';
    document.getElementById('stepWallet').style.display = 'none';
    const codeEl = document.getElementById('phoneCountryCode');
    const calling = (selectedCountry.callingCodes && selectedCountry.callingCodes[0]) ? selectedCountry.callingCodes[0] : '';
    codeEl.textContent = calling ? (calling.startsWith('+') ? calling : '+' + calling) : '—';
    document.getElementById('phoneInput').value = '';
    loadOperators(iso);
}

document.getElementById('backToCountries').addEventListener('click', () => {
    document.getElementById('stepCountries').style.display = 'block';
    document.getElementById('stepOperators').style.display = 'none';
    selectedCountry = null;
    selectedOperator = null;
    selectedAmount = null;
});

async function loadOperators(countryCode) {
    const list = document.getElementById('operatorsList');
    list.innerHTML = '<p>Cargando operadores...</p>';
    const res = await fetch(API + '/operators/' + countryCode, { headers: getAuthHeaders() });
    if (!res.ok) { list.innerHTML = 'Error al cargar operadores.'; return; }
    const data = await res.json();
    operators = data.operators || [];
    list.innerHTML = operators.map((op, i) => `
        <div class="operator-card" data-id="${op.operatorId || op.id}" data-idx="${i}">
            <img src="${(op.logoUrls && op.logoUrls[0]) || ''}" alt="" onerror="this.src=''">
            <span>${(op.name || '').replace(/</g, '&lt;')}</span>
        </div>
    `).join('');
    list.querySelectorAll('.operator-card').forEach(card => {
        card.addEventListener('click', () => {
            const op = operators[parseInt(card.dataset.idx)];
            if (op) selectOperator(op.operatorId || op.id, op.name || '');
        });
    });
    document.getElementById('amountSection').style.display = 'none';
    document.getElementById('amountChips').innerHTML = '';
    document.getElementById('amountInput').value = '';
}

/** Update the "Equiv. ~X VES" (or local fiat) line under the amount; hide if no fx or no amount */
function updateAmountEquivFiat(amountUsd, op) {
    const el = document.getElementById('amountEquivFiat');
    if (!el) return;
    if (!op || !op.fx || op.fx.rate == null || amountUsd == null || amountUsd <= 0) {
        el.style.display = 'none';
        el.textContent = '';
        return;
    }
    const localAmount = amountUsd * op.fx.rate;
    const currency = op.destinationCurrencyCode || op.fx.currencyCode || 'LOCAL';
    el.textContent = 'Equiv. ~' + Number(localAmount).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' ' + currency;
    el.style.display = 'block';
}

/**
 * Get allowed min/max and list of amounts from operator (proveedor de recargas; no hardcoded 100).
 * FIXED: only fixedAmounts are valid. RANGE: minAmount–maxAmount.
 */
function getOperatorAmountLimits(op) {
    if (!op) return { minAmt: 1, maxAmt: 20, amounts: [5, 10, 15, 20], fixedOnly: false };
    const isFixed = (op.denominationType || '').toUpperCase() === 'FIXED';
    const fixedAmounts = op.fixedAmounts && op.fixedAmounts.length ? op.fixedAmounts : null;
    if (isFixed && fixedAmounts && fixedAmounts.length) {
        const minAmt = Math.min(...fixedAmounts);
        const maxAmt = Math.max(...fixedAmounts);
        return { minAmt, maxAmt, amounts: [...fixedAmounts].sort((a, b) => a - b), fixedOnly: true };
    }
    const minAmt = op.minAmount != null && !isNaN(op.minAmount) ? Number(op.minAmount) : 1;
    const maxAmt = op.maxAmount != null && !isNaN(op.maxAmount) ? Number(op.maxAmount) : (op.suggestedAmounts && op.suggestedAmounts.length ? Math.max(...op.suggestedAmounts) : 20);
    const amounts = (op.suggestedAmounts && op.suggestedAmounts.length) ? op.suggestedAmounts : (minAmt !== maxAmt ? [minAmt, minAmt + 5, minAmt + 10, maxAmt].filter((a, i, arr) => a <= maxAmt && (arr.indexOf(a) === i)).sort((a, b) => a - b) : [minAmt]);
    return { minAmt, maxAmt, amounts: amounts.length ? amounts : [minAmt], fixedOnly: false };
}

function selectOperator(operatorId, operatorName) {
    selectedOperator = { operatorId, operatorName };
    const op = operators.find(o => (o.operatorId || o.id) === operatorId);
    selectedOperator.operatorName = operatorName || op?.name || '';
    document.querySelectorAll('.operator-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.operator-card[data-id="${operatorId}"]`);
    if (card) card.classList.add('selected');

    const { minAmt, maxAmt, amounts, fixedOnly } = getOperatorAmountLimits(op);
    const chips = document.getElementById('amountChips');
    chips.innerHTML = amounts.map(a => `<span class="amount-chip" data-amount="${a}">$${a}</span>`).join('');
    const amountInput = document.getElementById('amountInput');
    amountInput.min = minAmt;
    amountInput.max = maxAmt;
    amountInput.placeholder = fixedOnly ? `Solo montos fijos ($${minAmt} – $${maxAmt})` : `Min $${minAmt} – Max $${maxAmt}`;
    amountInput.disabled = fixedOnly;
    chips.querySelectorAll('.amount-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const val = parseFloat(chip.dataset.amount);
            selectedAmount = val;
            document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            amountInput.value = val;
            updateAmountEquivFiat(val, op);
        });
    });
    document.getElementById('amountSection').style.display = 'block';
    amountInput.value = '';
    selectedAmount = null;
    updateAmountEquivFiat(null, op);
    amountInput.oninput = () => {
        if (fixedOnly) return;
        let val = parseFloat(amountInput.value);
        if (isNaN(val) || val <= 0) {
            selectedAmount = null;
            document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));
            updateAmountEquivFiat(null, op);
            return;
        }
        val = Math.min(maxAmt, Math.max(minAmt, val));
        amountInput.value = val;
        selectedAmount = val;
        document.querySelectorAll('.amount-chip').forEach(c => {
            c.classList.toggle('selected', parseFloat(c.dataset.amount) === val);
        });
        updateAmountEquivFiat(val, op);
    };
}

document.getElementById('backToOperators').addEventListener('click', () => {
    document.getElementById('stepWallet').style.display = 'none';
    document.getElementById('stepOperators').style.display = 'block';
});

document.getElementById('btnContinueToWallet').addEventListener('click', async () => {
    const national = (document.getElementById('phoneInput').value || '').replace(/\D/g, '');
    const amount = selectedAmount ?? parseFloat(document.getElementById('amountInput').value);
    const op = selectedOperator ? operators.find(o => (o.operatorId || o.id) === selectedOperator.operatorId) : null;
    const { minAmt, maxAmt, fixedOnly } = getOperatorAmountLimits(op);
    if (!selectedOperator || amount == null || amount <= 0) {
        showAlert('Selecciona operador, monto e ingresa el número de teléfono.', 'error');
        return;
    }
    if (fixedOnly) {
        const allowed = op && op.fixedAmounts && op.fixedAmounts.length ? op.fixedAmounts : [minAmt];
        if (!allowed.includes(amount)) {
            showAlert('Este operador solo permite montos fijos: ' + allowed.map(a => '$' + a).join(', ') + ' USD.', 'error');
            return;
        }
    } else if (amount < minAmt || amount > maxAmt) {
        showAlert(`El monto debe estar entre $${minAmt} y $${maxAmt} USD para este operador.`, 'error');
        return;
    }
    if (!national || national.length < 7) {
        showAlert('Ingresa un número válido (sin código de país).', 'error');
        return;
    }
    hideAlert();
    selectedAmount = amount;
    document.getElementById('stepOperators').style.display = 'none';
    document.getElementById('stepWallet').style.display = 'block';
    await loadWallets();
    renderWallets();
    const qRes = await fetch(API + '/quote', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ amountUsd: amount, currency: 'USDT', operatorId: selectedOperator.operatorId })
    });
    if (qRes.ok) {
        const qData = await qRes.json();
        quote = qData.quote;
        updateQuoteSummary();
    }
});

async function loadWallets() {
    const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const walletMap = {};
    (data.wallets || []).forEach(w => {
        const sym = (w.assetSymbol || '').toUpperCase();
        if (['USDT', 'USDC', 'BIUSD'].includes(sym)) {
            if (!walletMap[sym]) walletMap[sym] = { symbol: sym, totalBalance: 0, wallets: [] };
            walletMap[sym].totalBalance += parseFloat(w.balance) || 0;
            walletMap[sym].wallets.push(w);
        }
    });
    wallets = Object.values(walletMap).filter(w => w.totalBalance > 0);
}

function renderWallets() {
    const list = document.getElementById('walletsList');
    if (!wallets.length) {
        list.innerHTML = '<p class="text-muted">No tienes balance en USDT, USDC o BiUSD. <a href="/converter">Convierte fondos</a>.</p>';
        return;
    }
    const coinIcon = (sym) => '/assets/coins/' + (sym === 'BIUSD' ? 'biusd' : sym.toLowerCase()) + '.svg';
    list.innerHTML = wallets.map(w => `
        <div class="wallet-option" data-symbol="${w.symbol}">
            <img src="${coinIcon(w.symbol)}" alt="" class="wallet-option-icon" onerror="this.style.display='none'">
            <div>
                <strong>${w.symbol}</strong>
                <span>Disponible: ${Number(w.totalBalance).toFixed(2)}</span>
            </div>
        </div>
    `).join('');
    list.querySelectorAll('.wallet-option').forEach(el => {
        el.addEventListener('click', () => {
            selectedWalletSymbol = el.dataset.symbol;
            document.querySelectorAll('.wallet-option').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            fetchQuoteForCurrency(selectedWalletSymbol);
        });
    });
}

async function fetchQuoteForCurrency(currency) {
    const res = await fetch(API + '/quote', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ amountUsd: selectedAmount, currency, operatorId: selectedOperator ? selectedOperator.operatorId : undefined })
    });
    if (res.ok) {
        const data = await res.json();
        quote = data.quote;
        updateQuoteSummary();
        document.getElementById('btnConfirmRecarga').disabled = false;
    }
}

function updateQuoteSummary() {
    const div = document.getElementById('quoteSummary');
    if (!quote) { div.style.display = 'none'; return; }
    div.style.display = 'block';
    const providerFee = quote.providerFeeUsd != null ? quote.providerFeeUsd : 0;
    const lines = [
        '<strong>Resumen</strong>',
        'Monto a recargar: $' + quote.amountUsd.toFixed(2) + ' USD',
        providerFee > 0 ? ('Comisión de Proveedor: $' + providerFee.toFixed(2)) : null,
        'Comisión de Servicio (BidiPago): $' + (quote.serviceFeeUsd || 0).toFixed(2),
        quote.localAmount != null && quote.localCurrencyCode ? ('Equiv. ~' + Number(quote.localAmount).toFixed(0) + ' ' + quote.localCurrencyCode) : null,
        '<strong>Total a debitar: ' + quote.cryptoAmount.toFixed(2) + ' ' + quote.currency + '</strong>'
    ].filter(Boolean).join('<br>');
    div.innerHTML = lines;
}

document.getElementById('btnConfirmRecarga').addEventListener('click', async () => {
    if (!selectedCountry || !selectedOperator || !selectedAmount || !selectedWalletSymbol) return;
    const national = (document.getElementById('phoneInput').value || '').replace(/\D/g, '');
    const callingDigits = (selectedCountry.callingCodes && selectedCountry.callingCodes[0]) ? selectedCountry.callingCodes[0].replace(/\D/g, '') : '';
    const phone = callingDigits + national;
    const walletGroup = wallets.find(w => w.symbol === selectedWalletSymbol);
    const wallet = walletGroup && walletGroup.wallets.length ? walletGroup.wallets.reduce((a, b) => parseFloat(a.balance) >= parseFloat(b.balance) ? a : b) : null;
    if (!wallet) {
        showAlert('No se encontró billetera para ' + selectedWalletSymbol, 'error');
        return;
    }
    if (quote && wallet && parseFloat(wallet.balance) < quote.cryptoAmount) {
        showAlert('Balance insuficiente en ' + selectedWalletSymbol, 'error');
        return;
    }
    document.getElementById('btnConfirmRecarga').disabled = true;
    hideAlert();
    try {
        const res = await fetch(API + '/orders', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                operatorId: selectedOperator.operatorId,
                operatorName: selectedOperator.operatorName,
                countryCode: selectedCountry.isoName,
                recipientPhone: phone,
                recipientCountryCode: selectedCountry.isoName,
                amountUsd: selectedAmount,
                walletId: wallet.id,
                currency: selectedWalletSymbol
            })
        });
        const data = await res.json();
        if (data.success && data.data && data.data.status === 'SUCCESS') {
            showRecargaModal('Recarga realizada correctamente. El saldo se acreditará al número indicado.', 'success');
            loadHistory();
            selectedOperator = null;
            selectedAmount = null;
            selectedWalletSymbol = null;
            document.getElementById('stepWallet').style.display = 'none';
            document.getElementById('stepOperators').style.display = 'block';
        } else {
            showRecargaModal(data.error || (data.data && data.data.errorMessage) || 'Error al procesar la recarga', 'error');
        }
    } catch (e) {
        showRecargaModal('Error de conexión', 'error');
    }
    document.getElementById('btnConfirmRecarga').disabled = false;
});

async function loadHistory() {
    const el = document.getElementById('historyList');
    const res = await fetch(API + '/orders?limit=10', { headers: getAuthHeaders() });
    if (!res.ok) { el.innerHTML = 'No se pudo cargar el historial.'; return; }
    const data = await res.json();
    const orders = data.orders || [];
    if (!orders.length) { el.innerHTML = 'Aún no tienes recargas.'; return; }
    el.innerHTML = orders.map(o => `
        <div class="border-bottom py-2">
            <strong>${o.operatorName || 'Recarga'}</strong> — $${Number(o.amountUsd).toFixed(2)} USD
            <span class="badge bg-${o.status === 'SUCCESS' ? 'success' : o.status === 'FAILED' || o.status === 'REFUNDED' ? 'danger' : 'secondary'}">${o.status}</span>
            <br><small class="text-muted">${o.recipientPhone} · ${new Date(o.createdAt).toLocaleString()}</small>
        </div>
    `).join('');
}

// Sidebar toggle
document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('mainContent').classList.toggle('sidebar-collapsed');
});

document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;
    loadCountries();
    loadHistory();
});
