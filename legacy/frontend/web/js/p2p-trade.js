// Estado del trade
let currentTrade = null;
let currentUserId = null;
let messagePollingInterval = null;
let tradePollingInterval = null;
let socket = null;

// Obtener tradeId de la URL
const urlParams = new URLSearchParams(window.location.search);
const tradeId = urlParams.get('tradeId');

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    // Verificar autenticación
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }

    // Inicializar sidebar
    initSidebar();

    // Cargar información del trade
    if (tradeId) {
        loadTradeInfo();
        loadMessages();
        initializeWebSocket();
        startTradePolling();
    } else {
        showError('No se proporcionó un ID de trade válido');
    }
});

// Inicializar sidebar
function initSidebar() {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('dashboardSidebar');
    const main = document.getElementById('dashboardMain');
    const logoutBtn = document.getElementById('logoutBtn');

    if (sidebarToggle && sidebar && main) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            main.classList.toggle('sidebar-collapsed');
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            window.location.href = '/login';
        });
    }
}

// Cargar información del trade
async function loadTradeInfo() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }

    try {
        const response = await fetch(`/api/p2p/trades/${tradeId}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/login';
                return;
            }
            // Check if user is not part of this trade
            const errorData = await response.json().catch(() => ({}));
            if (errorData.message && errorData.message.includes('No eres parte')) {
                showNotPartOfTradeError();
                return;
            }
            throw new Error(errorData.message || 'Error al cargar información del trade');
        }

        const data = await response.json();
        currentTrade = data.trade;

        // Debug: verificar paymentProof
        console.log('Trade cargado:', {
            id: currentTrade.id,
            status: currentTrade.status,
            paymentProof: currentTrade.paymentProof,
            makerId: currentTrade.maker?.id
        });

        // Obtener información del usuario actual
        const userResponse = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (userResponse.ok) {
            const userData = await userResponse.json();
            currentUserId = userData.user?.id || userData.id;
        }

        displayTradeInfo();
        setupTradeActions();
        loadPaymentMethods();
        setupChatState();
    } catch (error) {
        console.error('Error loading trade info:', error);
        showError('Error al cargar información del trade: ' + error.message);
    }
}

// Mostrar mensaje cuando el usuario no es parte del trade
function showNotPartOfTradeError() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('tradeContainer').style.display = 'none';

    const errorState = document.getElementById('errorState');
    const errorText = document.getElementById('errorText');

    if (errorState && errorText) {
        errorText.innerHTML = `
            <div style="text-align: center; padding: 40px 20px;">
                <i class="ri-error-warning-line" style="font-size: 64px; color: #dc3545; margin-bottom: 20px; display: block;"></i>
                <h3 style="margin-bottom: 15px; color: #333;">Usted no forma parte de este trade</h3>
                <p style="color: #666; margin-bottom: 25px;">
                    Este trade pertenece a otros usuarios. Si deseas realizar operaciones P2P, 
                    dirígete a la sección de intercambio y crea tu orden de compra o venta según tu necesidad.
                </p>
                <a href="/p2p" style="display: inline-block; background: #ee6a3e; color: #fff; padding: 12px 30px; border-radius: 5px; text-decoration: none; font-weight: 600;">
                    <i class="ri-exchange-line"></i> Ir a P2P - Intercambio
                </a>
            </div>
        `;
        errorState.style.display = 'block';
        errorState.style.background = '#fff';
        errorState.style.border = '1px solid #e0e0e0';
        errorText.style.color = '#333';
    }
}

// Mostrar información del trade
function displayTradeInfo() {
    if (!currentTrade) return;

    const statusMap = {
        'WAITING_PAYMENT': { text: 'Esperando Pago', class: 'waiting-payment' },
        'PAYMENT_CONFIRMED': { text: 'Pago Confirmado', class: 'payment-confirmed' },
        'SETTLED': { text: 'Liquidado', class: 'settled' },
        'DISPUTED': { text: 'En Disputa', class: 'disputed' },
        'CANCELLED': { text: 'Cancelado', class: 'cancelled' }
    };

    const status = statusMap[currentTrade.status] || { text: currentTrade.status, class: '' };

    document.getElementById('tradeId').textContent = currentTrade.id;
    document.getElementById('orderType').textContent = currentTrade.order?.type === 'BUY' ? 'Compra' : 'Venta';
    document.getElementById('cryptoAsset').textContent = currentTrade.cryptoAsset;
    document.getElementById('fiatCurrency').textContent = currentTrade.fiatCurrency;
    document.getElementById('cryptoAmount').textContent = formatNumber(currentTrade.cryptoAmount) + ' ' + currentTrade.cryptoAsset;
    document.getElementById('fiatAmount').textContent = formatNumber(currentTrade.fiatAmount) + ' ' + currentTrade.fiatCurrency;
    document.getElementById('rate').textContent = formatNumber(currentTrade.rate) + ' ' + currentTrade.fiatCurrency + '/' + currentTrade.cryptoAsset;
    // Comisiones ocultas por solicitud del usuario
    document.getElementById('makerName').textContent = currentTrade.maker?.profile?.firstName
        ? `${currentTrade.maker.profile.firstName} ${currentTrade.maker.profile.lastName || ''}`.trim()
        : currentTrade.maker?.email || 'N/A';
    document.getElementById('takerName').textContent = currentTrade.taker?.profile?.firstName
        ? `${currentTrade.taker.profile.firstName} ${currentTrade.taker.lastName || ''}`.trim()
        : currentTrade.taker?.email || 'N/A';

    // Mostrar términos y condiciones
    const terms = currentTrade.order?.terms;
    const termsSection = document.getElementById('termsSection');
    const termsElement = document.getElementById('tradeTerms');

    if (termsSection && termsElement) {
        if (terms && terms.trim().length > 0) {
            termsElement.textContent = terms;
            termsSection.style.display = 'block';
        } else {
            termsSection.style.display = 'none';
        }
    }

    // Determinar rol del usuario
    const userRole = currentUserId === currentTrade.maker?.id ? 'Creador (Maker)' : 'Tomador (Taker)';
    document.getElementById('userRole').textContent = userRole;

    const createdAt = new Date(currentTrade.createdAt);
    document.getElementById('createdAt').textContent = createdAt.toLocaleString('es-ES');

    const statusElement = document.getElementById('tradeStatus');
    statusElement.textContent = status.text;
    statusElement.className = 'trade-status ' + status.class;

    // Display Dispute Resolution if available
    const disputeSection = document.getElementById('disputeResolutionSection');
    // If element doesn't exist, create it dynamically after status or trade info
    // Assuming we can append it to a specific container for now, or check if we need to add html structure in p2p-trade.html first.
    // Ideally, we should check if 'disputeResolutionSection' exists in HTML. 
    // Since I can't easily edit HTML without verifying, I will modify JS to inject HTML if needed or assume I need to edit HTML too.
    // However, user prompt didn't strictly forbid HTML edits but preferred JS logic. 
    // Let's try to inject it into the 'trade-details-card' or similar. 
    // For now, I will create a container if it doesn't exist.

    let disputeContainer = document.getElementById('disputeResolutionContainer');
    if (!disputeContainer) {
        // Create it after trade-status
        disputeContainer = document.createElement('div');
        disputeContainer.id = 'disputeResolutionContainer';
        disputeContainer.style.marginTop = '20px';
        disputeContainer.style.display = 'none';

        // Find a good place to insert. Maybe after 'tradeStatus' parent?
        // Let's insert it after the main status element's parent container or header
        const header = document.querySelector('.trade-header');
        if (header && header.parentNode) {
            header.parentNode.insertBefore(disputeContainer, header.nextSibling);
        }
    }

    if (currentTrade.dispute && currentTrade.dispute.status === 'RESOLVED') {
        const resolutionMap = {
            'BUYER_WINS': 'Comprador Ganó',
            'SELLER_WINS': 'Vendedor Ganó',
            'CANCEL': 'Cancelado'
        };
        const resolutionText = resolutionMap[currentTrade.dispute.resolution] || currentTrade.dispute.resolution;

        disputeContainer.innerHTML = `
            <div class="alert alert-info" style="border-left: 4px solid #17a2b8; background-color: #e2e6ea; padding: 15px; margin-bottom: 20px;">
                <h4 style="margin-top: 0; color: #0c5460;"><i class="ri-scales-3-line"></i> Disputa Resuelta</h4>
                <p><strong>Resolución:</strong> ${resolutionText}</p>
                <div style="margin-top: 10px; background: rgba(255,255,255,0.5); padding: 10px; border-radius: 4px;">
                    <strong>Nota del Admin:</strong><br>
                    ${currentTrade.dispute.adminNotes || 'Sin nota explicativa.'}
                </div>
                <div style="margin-top: 5px; font-size: 0.85em; color: #666;">
                    Resuelto por Admin el ${new Date(currentTrade.dispute.resolvedAt).toLocaleString()}
                </div>
            </div>
        `;
        disputeContainer.style.display = 'block';
    } else {
        if (disputeContainer) disputeContainer.style.display = 'none';
    }

    // Iniciar Timer si aplica
    if (currentTrade.status === 'WAITING_PAYMENT' && currentTrade.expiresAt) {
        startTimer(currentTrade.expiresAt);
    } else {
        const timerElement = document.getElementById('tradeTimer');
        if (timerElement) timerElement.style.display = 'none';
    }

    // Ocultar loading y mostrar contenido
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('tradeContainer').style.display = 'grid';

    // Iniciar Timer si aplica
    if (currentTrade.status === 'WAITING_PAYMENT' && currentTrade.expiresAt) {
        startTimer(currentTrade.expiresAt);
    } else {
        document.getElementById('tradeTimer').style.display = 'none';
    }
}

// Configurar acciones del trade
function setupTradeActions() {
    if (!currentTrade || !currentUserId) return;

    const actionsContainer = document.getElementById('tradeActions');
    actionsContainer.innerHTML = '';

    const isMaker = currentUserId === currentTrade.maker?.id;
    const isTaker = currentUserId === currentTrade.taker?.id;
    const orderType = currentTrade.order?.type;

    // Debug: verificar condiciones para mostrar botón de comprobante
    console.log('setupTradeActions - Debug:', {
        currentUserId,
        makerId: currentTrade.maker?.id,
        takerId: currentTrade.taker?.id,
        isMaker,
        isTaker,
        orderType,
        status: currentTrade.status,
        paymentProof: currentTrade.paymentProof,
        hasPaymentProof: !!currentTrade.paymentProof
    });

    // Determinar quién es el comprador de fiat
    // Si la orden es SELL: maker vende crypto, taker compra crypto (taker paga fiat)
    // Si la orden es BUY: maker compra crypto, taker vende crypto (maker paga fiat)
    const fiatBuyerIsMaker = orderType === 'BUY';
    const fiatBuyerIsTaker = orderType === 'SELL';

    // Determinar quién es el vendedor de fiat
    const fiatSellerIsMaker = orderType === 'SELL';
    const fiatSellerIsTaker = orderType === 'BUY';

    console.log('setupTradeActions - Payment Logic:', {
        fiatBuyerIsMaker,
        fiatBuyerIsTaker,
        fiatSellerIsMaker,
        fiatSellerIsTaker,
        shouldShowConfirmButton: (fiatBuyerIsMaker && isMaker) || (fiatBuyerIsTaker && isTaker)
    });

    if (currentTrade.status === 'WAITING_PAYMENT') {
        // Solo el comprador de fiat puede confirmar el pago
        if ((fiatBuyerIsMaker && isMaker) || (fiatBuyerIsTaker && isTaker)) {
            const btn = document.createElement('button');
            btn.className = 'btn-trade-action btn-confirm-payment';
            btn.innerHTML = '<i class="ri-checkbox-circle-line"></i> Confirmar Pago (Subir Comprobante)';
            btn.onclick = () => confirmPayment();
            actionsContainer.appendChild(btn);
        } else {
            const info = document.createElement('div');
            info.style.padding = '15px';
            info.style.background = '#f8f9fa';
            info.style.borderRadius = '5px';
            info.style.color = '#666';
            info.innerHTML = '<i class="ri-information-line"></i> Esperando confirmación de pago del comprador';
            actionsContainer.appendChild(info);
        }
    } else if (currentTrade.status === 'PAYMENT_CONFIRMED') {
        // Solo el vendedor de fiat puede liquidar (confirmar recepción)
        if ((fiatSellerIsMaker && isMaker) || (fiatSellerIsTaker && isTaker)) {
            const btn = document.createElement('button');
            btn.className = 'btn-trade-action btn-settle';
            btn.innerHTML = '<i class="ri-checkbox-circle-line"></i> Confirmar Recepción de Fondos';
            btn.onclick = () => settleTrade();
            actionsContainer.appendChild(btn);
        } else {
            const info = document.createElement('div');
            info.style.padding = '15px';
            info.style.background = '#f8f9fa';
            info.style.borderRadius = '5px';
            info.style.color = '#666';
            info.innerHTML = '<i class="ri-information-line"></i> Esperando confirmación de recepción del vendedor';
            actionsContainer.appendChild(info);
        }

        // Mostrar comprobante de pago a ambos participantes si existe
        if (currentTrade.paymentProof) {
            const viewProofBtn = document.createElement('button');
            viewProofBtn.className = 'btn-trade-action btn-view-proof';
            viewProofBtn.style.background = '#17a2b8';
            viewProofBtn.style.marginTop = '10px';
            viewProofBtn.innerHTML = '<i class="ri-file-paper-line"></i> Ver Comprobante de Pago';
            viewProofBtn.onclick = () => openPaymentProofModal();
            actionsContainer.appendChild(viewProofBtn);
        }
    } else if (currentTrade.status === 'SETTLED') {
        const info = document.createElement('div');
        info.style.padding = '15px';
        info.style.background = '#d4edda';
        info.style.borderRadius = '5px';
        info.style.color = '#155724';
        info.innerHTML = '<i class="ri-checkbox-circle-line"></i> Trade liquidado exitosamente';
        actionsContainer.appendChild(info);

        // Feedback Button
        // Feedback Button
        const feedbackBtn = document.createElement('button');

        // Check if I already left feedback
        const myFeedback = currentTrade.feedbacks?.find(f => f.fromUserId === currentUserId);

        if (myFeedback) {
            feedbackBtn.className = 'btn-secondary';
            feedbackBtn.innerHTML = '<i class="ri-checkbox-circle-fill"></i> Usuario Ya Calificado';
            feedbackBtn.style.width = '100%';
            feedbackBtn.style.marginTop = '10px';
            feedbackBtn.disabled = true;
            feedbackBtn.style.opacity = '0.7';
            feedbackBtn.style.cursor = 'default';
        } else {
            feedbackBtn.className = 'btn-secondary';
            feedbackBtn.innerHTML = '<i class="ri-star-line"></i> Calificar Usuario';
            feedbackBtn.style.width = '100%';
            feedbackBtn.style.marginTop = '10px';
            feedbackBtn.onclick = () => openFeedbackModal();
        }
        actionsContainer.appendChild(feedbackBtn);

        // Si el Maker puede ver el comprobante de pago
        console.log('SETTLED - Verificando botón comprobante:', {
            isMaker,
            paymentProof: currentTrade.paymentProof,
            condition: isMaker && currentTrade.paymentProof
        });

        // Mostrar comprobante de pago a ambos participantes si existe
        if (currentTrade.paymentProof) {
            console.log('✅ Mostrando botón de comprobante (SETTLED)');
            const viewProofBtn = document.createElement('button');
            viewProofBtn.className = 'btn-trade-action btn-view-proof';
            viewProofBtn.style.background = '#17a2b8';
            viewProofBtn.style.marginTop = '10px';
            viewProofBtn.innerHTML = '<i class="ri-file-paper-line"></i> Ver Comprobante de Pago';
            viewProofBtn.onclick = () => openPaymentProofModal();
            actionsContainer.appendChild(viewProofBtn);
        } else {
            console.log('❌ No se muestra botón (SETTLED) porque:', {
                isMaker,
                hasPaymentProof: !!currentTrade.paymentProof,
                paymentProof: currentTrade.paymentProof
            });
        }
    } else if (currentTrade.status === 'DISPUTED') {
        const info = document.createElement('div');
        info.style.padding = '15px';
        info.style.background = '#f8d7da';
        info.style.borderRadius = '5px';
        info.style.color = '#721c24';
        info.innerHTML = '<i class="ri-error-warning-line"></i> Este trade está en disputa';
        actionsContainer.appendChild(info);
    } else if (currentTrade.status === 'CANCELLED') {
        const info = document.createElement('div');
        info.style.padding = '15px';
        info.style.background = '#e2e3e5';
        info.style.borderRadius = '5px';
        info.style.color = '#383d41';
        info.innerHTML = '<i class="ri-close-circle-line"></i> Este trade ha sido cancelado';
        actionsContainer.appendChild(info);
    }

    // Botón de disputa (solo disponible durante WAITING_PAYMENT o PAYMENT_CONFIRMED)
    if (currentTrade.status === 'WAITING_PAYMENT' || currentTrade.status === 'PAYMENT_CONFIRMED') {
        const btn = document.createElement('button');
        btn.className = 'btn-trade-action btn-dispute';
        btn.style.marginTop = '10px';
        btn.innerHTML = '<i class="ri-error-warning-line"></i> Abrir Disputa';
        btn.onclick = () => openDisputeModal();
        actionsContainer.appendChild(btn);
    }
}

// Cargar métodos de pago del maker
// Cargar métodos de pago del Vendedor de Fiat (quien recibe el dinero)
async function loadPaymentMethods() {
    if (!currentTrade || !currentUserId) return;

    const orderType = currentTrade.order?.type;
    const isMaker = currentUserId === currentTrade.maker?.id;
    const isTaker = currentUserId === currentTrade.taker?.id;

    // Detectar si viene de solicitud rápida (quick trade)
    // Las solicitudes rápidas no tienen paymentMethods ni terms en la orden
    const isQuickTrade = !currentTrade.order?.paymentMethods && !currentTrade.order?.terms;

    // Determinar quién es el Vendedor de Fiat (quien RECIBE el fiat y debe mostrar sus métodos de pago)
    // Lógica universal (aplica tanto para quick trades como órdenes normales):
    //   SELL: Maker Vende Crypto -> Maker Recibe Fiat -> Maker es Fiat Seller -> Mostrar métodos del Maker
    //   BUY: Maker Compra Crypto -> Taker Vende Crypto -> Taker Recibe Fiat -> Taker es Fiat Seller -> Mostrar métodos del Taker
    // 
    // Para quick trades específicamente:
    //   - DEPOSIT (usuario compra crypto): shadowOrder.type = SELL -> Cajero (maker) recibe fiat -> Mostrar métodos del Maker
    //   - WITHDRAW (usuario vende crypto): shadowOrder.type = BUY -> Usuario (taker) recibe fiat -> Mostrar métodos del Taker
    const fiatSellerIsMaker = orderType === 'SELL';

    // Determinar qué métodos mostrar
    // IMPORTANTE: Solo mostrar métodos de quien recibe el fiat, nunca mezclar ambos
    let methodsToShow = [];
    if (fiatSellerIsMaker) {
        // Maker recibe fiat -> Solo métodos del Maker
        methodsToShow = Array.isArray(currentTrade.makerPaymentMethods) 
            ? currentTrade.makerPaymentMethods 
            : [];
        // Asegurar que takerPaymentMethods no se muestre
        if (currentTrade.takerPaymentMethods && currentTrade.takerPaymentMethods.length > 0) {
            console.warn('[P2P TradeView] Warning: takerPaymentMethods found but should not be shown (fiatSellerIsMaker=true)');
        }
    } else {
        // Taker recibe fiat -> Solo métodos del Taker
        methodsToShow = Array.isArray(currentTrade.takerPaymentMethods) 
            ? currentTrade.takerPaymentMethods 
            : [];
        // Asegurar que makerPaymentMethods no se muestre
        if (currentTrade.makerPaymentMethods && currentTrade.makerPaymentMethods.length > 0) {
            console.warn('[P2P TradeView] Warning: makerPaymentMethods found but should not be shown (fiatSellerIsMaker=false)');
        }
    }
    
    console.log('[P2P TradeView] Payment methods to show:', {
        fiatSellerIsMaker,
        isQuickTrade,
        orderType,
        methodsCount: methodsToShow.length,
        methods: methodsToShow.map(m => ({ id: m.id, name: m.name, displayName: m.displayName }))
    });

    // Determinar si debo verlos
    // El Comprador de Fiat SIEMPRE debe verlos.
    // El Vendedor de Fiat TAMBIÉN debería verlos para confirmar? (Opcional, pero útil).
    // Mostremos siempre, la UI decidirá.

    // Si la lista está vacía, ocultar sección
    if (!methodsToShow || methodsToShow.length === 0) {
        document.getElementById('paymentMethodsSection').style.display = 'none';

        // Si soy el comprador de fiat y no hay métodos, mostrar advertencia?
        const amIFiatBuyer = (fiatSellerIsMaker && isTaker) || (!fiatSellerIsMaker && isMaker);
        if (amIFiatBuyer) {
            // Podríamos mostrar mensaje de "El vendedor no tiene métodos de pago configurados"
            document.getElementById('paymentMethodsSection').style.display = 'block';
            document.getElementById('paymentMethodsList').innerHTML = '<div class="alert alert-warning">El vendedor no ha configurado métodos de pago visibles. Contacta por chat.</div>';
        }
        return;
    }

    // Renderizar métodos de pago
    const methodsHtml = methodsToShow.map(method => {
        // Use fieldsSchema from backend if available, fallback to getFieldLabel
        const getLabel = (fieldNum) => {
            if (method.fieldsSchema && method.fieldsSchema.length > 0) {
                const fieldDef = method.fieldsSchema.find(f => f.mapping === `field${fieldNum}`);
                return fieldDef?.label || `Campo ${fieldNum}`;
            }
            return getFieldLabel(method.type, fieldNum);
        };

        let detailsHtml = '';
        if (method.field1) detailsHtml += `<p style="margin: 5px 0;"><strong>${getLabel(1)}:</strong> ${method.field1}</p>`;
        if (method.field2) detailsHtml += `<p style="margin: 5px 0;"><strong>${getLabel(2)}:</strong> ${method.field2}</p>`;
        if (method.field3) detailsHtml += `<p style="margin: 5px 0;"><strong>${getLabel(3)}:</strong> ${method.field3}</p>`;
        if (method.field4) detailsHtml += `<p style="margin: 5px 0;"><strong>${getLabel(4)}:</strong> ${method.field4}</p>`;

        // Use displayName from backend if available
        const methodTitle = method.displayName || method.type;

        return `
            <div style="margin-bottom: 15px; padding: 15px; background: #fff; border-radius: 5px; border: 1px solid #ddd;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    ${method.logoUrl ? `<img src="${method.logoUrl}" alt="" style="width: 32px; height: 32px; object-fit: contain; border-radius: 4px;">` : ''}
                    <h5 style="margin: 0; color: #333; font-size: 1.1rem;">${methodTitle}</h5>
                </div>
                ${detailsHtml || '<p style="color: #999; margin: 0;">Sin detalles adicionales</p>'}
            </div>
        `;
    }).join('');

    // Actualizar título de la sección (simplificado)
    const sectionTitle = document.querySelector('#paymentMethodsSection h3');
    if (sectionTitle) {
        sectionTitle.textContent = 'Métodos de Pago';
    }

    document.getElementById('paymentMethodsList').innerHTML = methodsHtml;
    document.getElementById('paymentMethodsSection').style.display = 'block';
}

// Helper para obtener etiquetas de campos según el tipo de método
function getFieldLabel(methodType, fieldNumber) {
    const labels = {
        'BANK_TRANSFER': { 1: 'Nombre del Banco', 2: 'Número de Cuenta', 3: 'Tipo de Cuenta', 4: 'ID del Titular' },
        'PAGO_MOVIL': { 1: 'Nombre del Banco', 2: 'Número de Teléfono', 3: 'ID del Titular', 4: '' },
        'PAYPAL': { 1: 'Correo Electrónico', 2: '', 3: '', 4: '' },
        'ZELLE': { 1: 'Correo Electrónico', 2: '', 3: '', 4: '' },
        'BANESCO_PANAMA': { 1: 'Número de Cuenta', 2: 'Nombre del Titular', 3: '', 4: '' },
        'WALLY_TECH': { 1: 'Número de Teléfono', 2: '', 3: '', 4: '' },
        'ZINLI': { 1: 'Correo Electrónico', 2: '', 3: '', 4: '' }
    };

    return labels[methodType]?.[fieldNumber] || `Campo ${fieldNumber}`;
}

// Variable global para almacenar el archivo seleccionado
let selectedPaymentProofFile = null;

// Confirmar pago (con subida de comprobante)
async function confirmPayment() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }

    // Mostrar selector de archivo primero
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/jpg,image/png,application/pdf';
    fileInput.style.display = 'none';

    fileInput.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) {
            console.log('⚠️ No se seleccionó ningún archivo');
            return;
        }

        console.log('📁 Archivo seleccionado:', {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified
        });

        // Validar tipo de archivo
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
        if (!allowedTypes.includes(file.type)) {
            showAlert('Tipo de archivo no permitido. Solo se aceptan JPG, PNG o PDF.', 'error');
            return;
        }

        // Validar tamaño (10 MB)
        if (file.size > 10 * 1024 * 1024) {
            showAlert('El archivo excede el tamaño máximo de 10 MB.', 'error');
            return;
        }

        // Guardar archivo y mostrar modal de confirmación
        selectedPaymentProofFile = file;
        console.log('✅ Archivo guardado en selectedPaymentProofFile:', {
            name: selectedPaymentProofFile.name,
            size: selectedPaymentProofFile.size,
            type: selectedPaymentProofFile.type
        });
        openConfirmPaymentModal();
    };

    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
}

// Abrir modal de confirmación de pago
function openConfirmPaymentModal() {
    const modal = document.getElementById('confirmPaymentModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

// Cerrar modal de confirmación de pago
function closeConfirmPaymentModal() {
    const modal = document.getElementById('confirmPaymentModal');
    if (modal) {
        modal.style.display = 'none';
    }
    selectedPaymentProofFile = null;
}

// Proceder con la confirmación de pago después de aceptar en el modal
async function proceedWithPaymentConfirmation() {
    // Guardar el archivo en una variable local ANTES de cerrar el modal
    // porque closeConfirmPaymentModal() resetea selectedPaymentProofFile a null
    const fileToUpload = selectedPaymentProofFile;

    if (!fileToUpload) {
        showAlert('No se ha seleccionado ningún archivo', 'error');
        closeConfirmPaymentModal();
        return;
    }

    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }

    // Cerrar el modal (esto resetea selectedPaymentProofFile a null, pero ya lo guardamos)
    closeConfirmPaymentModal();

    try {
        // Debug: verificar el archivo antes de enviarlo
        console.log('📤 Enviando archivo:', {
            name: fileToUpload.name,
            size: fileToUpload.size,
            type: fileToUpload.type,
            lastModified: fileToUpload.lastModified
        });

        const formData = new FormData();
        formData.append('paymentProof', fileToUpload, fileToUpload.name);

        // Debug: verificar FormData
        console.log('📦 FormData creado. Verificando contenido...');
        for (let pair of formData.entries()) {
            console.log('FormData entry:', pair[0], pair[1]);
        }

        const response = await fetch(`/api/p2p/trades/${tradeId}/confirm-payment`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`
                // No incluir Content-Type, el navegador lo establecerá automáticamente con el boundary
            },
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            showAlert('Pago confirmado exitosamente. El comprobante ha sido enviado.', 'success');
            loadTradeInfo();
        } else {
            throw new Error(data.error || 'Error al confirmar pago');
        }
    } catch (error) {
        console.error('Error confirming payment:', error);
        showAlert('Error al confirmar pago: ' + error.message, 'error');
    } finally {
        // Ya se reseteó en closeConfirmPaymentModal(), pero por si acaso
        selectedPaymentProofFile = null;
    }
}

// Abrir modal de comprobante de pago
function openPaymentProofModal() {
    if (!currentTrade || !currentTrade.paymentProof) {
        showAlert('No hay comprobante de pago disponible', 'error');
        return;
    }

    const modal = document.getElementById('paymentProofModal');
    const content = document.getElementById('paymentProofContent');

    if (!modal || !content) return;

    // Determinar si es imagen o PDF
    const proofUrl = currentTrade.paymentProof;
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(proofUrl);
    const isPdf = /\.pdf$/i.test(proofUrl);

    if (isImage) {
        content.innerHTML = `
            <img src="${proofUrl}" alt="Comprobante de Pago" style="max-width: 100%; height: auto; border-radius: 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
            <div style="margin-top: 15px;">
                <a href="${proofUrl}" target="_blank" download style="color: #007bff; text-decoration: none;">
                    <i class="ri-download-line"></i> Descargar imagen
                </a>
            </div>
        `;
    } else if (isPdf) {
        content.innerHTML = `
            <iframe src="${proofUrl}" style="width: 100%; height: 70vh; border: none; border-radius: 5px;" frameborder="0"></iframe>
            <div style="margin-top: 15px;">
                <a href="${proofUrl}" target="_blank" download style="color: #007bff; text-decoration: none;">
                    <i class="ri-download-line"></i> Descargar PDF
                </a>
            </div>
        `;
    } else {
        // Si no se puede determinar el tipo, intentar mostrar como imagen primero
        content.innerHTML = `
            <img src="${proofUrl}" alt="Comprobante de Pago" style="max-width: 100%; height: auto; border-radius: 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
            <iframe src="${proofUrl}" style="display: none; width: 100%; height: 70vh; border: none; border-radius: 5px;" frameborder="0"></iframe>
            <div style="margin-top: 15px;">
                <a href="${proofUrl}" target="_blank" download style="color: #007bff; text-decoration: none;">
                    <i class="ri-download-line"></i> Descargar comprobante
                </a>
            </div>
        `;
    }

    modal.style.display = 'block';
}

// Cerrar modal de comprobante de pago
function closePaymentProofModal() {
    const modal = document.getElementById('paymentProofModal');
    if (modal) {
        modal.style.display = 'none';
        // Limpiar contenido para liberar recursos
        const content = document.getElementById('paymentProofContent');
        if (content) {
            content.innerHTML = '<div class="loading"><i class="ri-loader-4-line"></i> Cargando comprobante...</div>';
        }
    }
}

// Cerrar modales al hacer clic fuera
document.addEventListener('click', function (event) {
    const confirmPaymentModal = document.getElementById('confirmPaymentModal');
    if (confirmPaymentModal && event.target === confirmPaymentModal) {
        closeConfirmPaymentModal();
    }

    const confirmReceiptModal = document.getElementById('confirmReceiptModal');
    if (confirmReceiptModal && event.target === confirmReceiptModal) {
        closeConfirmReceiptModal();
    }

    const paymentProofModal = document.getElementById('paymentProofModal');
    if (paymentProofModal && event.target === paymentProofModal) {
        closePaymentProofModal();
    }
});

// Liquidar trade
function settleTrade() {
    openConfirmReceiptModal();
}

// Abrir modal de confirmación de recepción
function openConfirmReceiptModal() {
    const modal = document.getElementById('confirmReceiptModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

// Cerrar modal de confirmación de recepción
function closeConfirmReceiptModal() {
    const modal = document.getElementById('confirmReceiptModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Proceder con la confirmación de recepción después de aceptar en el modal
async function proceedWithReceiptConfirmation() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }

    closeConfirmReceiptModal();

    try {
        const response = await fetch(`/api/p2p/trades/${tradeId}/settle`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al liquidar trade');
        }

        showAlert('Trade liquidado exitosamente', 'success');
        loadTradeInfo();

        // Auto-prompt feedback
        setTimeout(() => {
            openFeedbackModal();
        }, 1500);
    } catch (error) {
        console.error('Error settling trade:', error);
        showAlert('Error al liquidar trade: ' + error.message, 'error');
    }
}

// Abrir disputa
function openDispute() {
    const reason = prompt('Por favor, describe la razón de la disputa:');
    if (!reason || reason.trim().length === 0) {
        return;
    }

    createDispute(reason.trim());
}

// Crear disputa
async function createDispute(reason) {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }

    try {
        const response = await fetch('/api/p2p/disputes', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tradeId: tradeId,
                reason: reason
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al crear disputa');
        }

        showAlert('Disputa creada exitosamente', 'success');
        loadTradeInfo();
    } catch (error) {
        console.error('Error creating dispute:', error);
        showAlert('Error al crear disputa: ' + error.message, 'error');
    }
}

// Cargar mensajes
async function loadMessages() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        const container = document.getElementById('chatMessages');
        if (container) {
            container.innerHTML = '<div class="loading">Error: No hay sesión activa</div>';
        }
        return;
    }

    const container = document.getElementById('chatMessages');
    if (!container) return;

    try {
        const response = await fetch(`/api/p2p/trades/${tradeId}/messages`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/login';
                return;
            }
            throw new Error('Error al cargar mensajes');
        }

        const data = await response.json();
        displayMessages(data.messages || []);

        // Marcar mensajes como leídos
        markMessagesAsRead();
    } catch (error) {
        console.error('Error loading messages:', error);
        // Asegurarse de que el contenedor muestre algo, incluso si hay error
        if (container && container.innerHTML.includes('Cargando mensajes')) {
            container.innerHTML = '<div class="loading">Error al cargar mensajes. Por favor, recarga la página.</div>';
        }
    }
}

// Mostrar mensajes
function displayMessages(messages) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    // Si no hay currentUserId aún, esperar un momento y reintentar
    if (!currentUserId) {
        setTimeout(() => {
            if (currentUserId) {
                displayMessages(messages);
            }
        }, 500);
        return;
    }

    if (messages.length === 0) {
        container.innerHTML = '<div class="loading" style="text-align: center; padding: 20px; color: #999;">No hay mensajes aún. ¡Sé el primero en escribir!</div>';
        // Scroll al final después de renderizar
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
        }, 100);
        return;
    }

    container.innerHTML = messages.map(msg => {
        const isOwn = msg.sender?.id === currentUserId;
        const senderName = msg.sender?.profile?.firstName
            ? `${msg.sender.profile.firstName} ${msg.sender.profile.lastName || ''}`.trim()
            : msg.sender?.email || 'Usuario';
        const createdAt = new Date(msg.createdAt);
        const timeStr = createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="message ${isOwn ? 'own' : 'other'}">
                ${!isOwn ? `<div class="message-sender">${senderName}</div>` : ''}
                <div class="message-bubble">${escapeHtml(msg.content)}</div>
                <div class="message-info">${timeStr}</div>
            </div>
        `;
    }).join('');

    // Scroll al final después de renderizar
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 100);
}

// Configurar estado del chat según el estado del trade
function setupChatState() {
    if (!currentTrade) return;

    const chatInputContainer = document.getElementById('chatInputContainer');
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendButton');
    const chatForm = document.getElementById('chatForm');
    const chatClosedMessage = document.getElementById('chatClosedMessage');
    const chatClosedText = document.getElementById('chatClosedText');

    if (currentTrade.status === 'SETTLED' || currentTrade.status === 'CANCELLED') {
        // Deshabilitar chat
        if (chatInputContainer) {
            chatInputContainer.classList.add('disabled');
        }
        if (chatInput) {
            chatInput.disabled = true;
            chatInput.placeholder = 'El chat está cerrado';
        }
        if (sendButton) {
            sendButton.disabled = true;
        }
        if (chatClosedMessage) {
            chatClosedMessage.style.display = 'block';
        }
        // Set appropriate message based on status
        if (chatClosedText) {
            if (currentTrade.status === 'SETTLED') {
                chatClosedText.textContent = 'Este trade ha sido liquidado. El chat está cerrado.';
            } else if (currentTrade.status === 'CANCELLED') {
                chatClosedText.textContent = 'Este trade fue cancelado por expiración. El chat está cerrado.';
            }
        }
    } else {
        // Habilitar chat
        if (chatInputContainer) {
            chatInputContainer.classList.remove('disabled');
        }
        if (chatInput) {
            chatInput.disabled = false;
            chatInput.placeholder = 'Escribe un mensaje...';
        }
        if (sendButton) {
            sendButton.disabled = false;
        }
        if (chatClosedMessage) {
            chatClosedMessage.style.display = 'none';
        }
    }
}

// Enviar mensaje
async function sendMessage(event) {
    event.preventDefault();

    // Verificar que el trade no esté liquidado o cancelado
    if (currentTrade && (currentTrade.status === 'SETTLED' || currentTrade.status === 'CANCELLED')) {
        showAlert('No puedes enviar mensajes en un trade liquidado o cancelado', 'error');
        return;
    }

    const input = document.getElementById('chatInput');
    const content = input.value.trim();

    if (!content) return;

    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        window.location.href = '/login';
        return;
    }

    const sendButton = document.getElementById('sendButton');
    sendButton.disabled = true;

    try {
        const response = await fetch(`/api/p2p/trades/${tradeId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al enviar mensaje');
        }

        input.value = '';
        // El mensaje se agregará automáticamente vía WebSocket
        // No necesitamos recargar todos los mensajes
        // Feedback logic moved to global scope
    } catch (error) {
        console.error('Error sending message:', error);
        showAlert('Error al enviar mensaje: ' + error.message, 'error');
    } finally {
        sendButton.disabled = false;
    }
}

// Marcar mensajes como leídos
async function markMessagesAsRead() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    try {
        await fetch(`/api/p2p/trades/${tradeId}/messages/read`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Error marking messages as read:', error);
    }
}

// Inicializar WebSocket para chat en tiempo real
function initializeWebSocket() {
    // Verificar que Socket.IO esté disponible
    if (typeof io === 'undefined') {
        console.warn('Socket.IO no está disponible, usando polling para mensajes');
        startMessagePolling();
        return;
    }

    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        console.warn('No hay token de acceso, usando polling para mensajes');
        startMessagePolling();
        return;
    }

    try {
        // Conectar a Socket.IO
        socket = io({
            auth: {
                token: accessToken
            },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5
        });

        socket.on('connect', () => {
            console.log('WebSocket conectado');
            // Unirse a la sala del trade
            if (tradeId) {
                socket.emit('join-trade', tradeId);
            }
        });

        socket.on('joined-trade', (data) => {
            console.log('Unido al trade:', data.tradeId);
        });

        socket.on('new-message', (message) => {
            // Agregar nuevo mensaje al chat sin recargar todo
            addMessageToChat(message);
            markMessagesAsRead();
        });

        socket.on('trade-update', (trade) => {
            // Actualizar información del trade
            currentTrade = trade;
            displayTradeInfo();
            setupTradeActions();
            setupChatState();
        });

        socket.on('error', (error) => {
            console.error('Error en WebSocket:', error);
            // No mostrar alerta, solo usar polling como fallback
            if (!messagePollingInterval) {
                startMessagePolling();
            }
        });

        socket.on('connect_error', (error) => {
            console.error('Error de conexión WebSocket:', error);
            // Usar polling como fallback
            if (!messagePollingInterval) {
                startMessagePolling();
            }
        });

        socket.on('disconnect', () => {
            console.log('WebSocket desconectado');
            // Usar polling como fallback
            if (!messagePollingInterval) {
                startMessagePolling();
            }
        });
    } catch (error) {
        console.error('Error al inicializar WebSocket:', error);
        // Usar polling como fallback
        if (!messagePollingInterval) {
            startMessagePolling();
        }
    }
}

// Agregar mensaje al chat sin recargar todo
function addMessageToChat(message) {
    const container = document.getElementById('chatMessages');
    if (!container || !currentUserId) return;

    const isOwn = message.sender?.id === currentUserId;
    const senderName = message.sender?.profile?.firstName
        ? `${message.sender.profile.firstName} ${message.sender.profile.lastName || ''}`.trim()
        : message.sender?.email || 'Usuario';
    const createdAt = new Date(message.createdAt);
    const timeStr = createdAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    const messageHtml = `
        <div class="message ${isOwn ? 'own' : 'other'}">
            ${!isOwn ? `<div class="message-sender">${senderName}</div>` : ''}
            <div class="message-bubble">${escapeHtml(message.content)}</div>
            <div class="message-info">${timeStr}</div>
        </div>
    `;

    // Si el contenedor está vacío o muestra "No hay mensajes", reemplazar
    if (container.innerHTML.includes('No hay mensajes')) {
        container.innerHTML = messageHtml;
    } else {
        container.innerHTML += messageHtml;
    }

    // Scroll al final
    container.scrollTop = container.scrollHeight;
}

// Detener WebSocket
function disconnectWebSocket() {
    if (socket) {
        socket.emit('leave-trade', tradeId);
        socket.disconnect();
        socket = null;
    }
}

// Iniciar polling de mensajes (fallback si WebSocket no está disponible)
function startMessagePolling() {
    // Polling cada 3 segundos
    if (messagePollingInterval) {
        clearInterval(messagePollingInterval);
    }
    messagePollingInterval = setInterval(() => {
        loadMessages();
    }, 3000);
}

// Detener polling de mensajes
function stopMessagePolling() {
    if (messagePollingInterval) {
        clearInterval(messagePollingInterval);
        messagePollingInterval = null;
    }
}

// Iniciar polling del trade (para actualizar estado)
function startTradePolling() {
    // Polling cada 5 segundos
    tradePollingInterval = setInterval(() => {
        loadTradeInfo().then(() => {
            setupChatState();
        });
    }, 5000);
}

// Detener polling del trade
function stopTradePolling() {
    if (tradePollingInterval) {
        clearInterval(tradePollingInterval);
        tradePollingInterval = null;
    }
}

// Limpiar al salir
window.addEventListener('beforeunload', () => {
    stopMessagePolling();
    stopTradePolling();
});

// Utilidades
function formatNumber(num) {
    if (num >= 1) {
        return parseFloat(num).toFixed(2);
    }
    return parseFloat(num).toFixed(8);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorText').textContent = message;
}

function showAlert(message, type = 'info') {
    // Crear alerta temporal
    const alert = document.createElement('div');
    alert.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 5px;
        color: #fff;
        font-weight: 600;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;

    if (type === 'success') {
        alert.style.background = '#28a745';
    } else if (type === 'error') {
        alert.style.background = '#dc3545';
    } else {
        alert.style.background = '#17a2b8';
    }

    alert.textContent = message;
    document.body.appendChild(alert);

    setTimeout(() => {
        alert.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => alert.remove(), 300);
    }, 3000);
}

// Exponer funciones globalmente
window.sendMessage = sendMessage;

// Timer Logic
let timerInterval;

function startTimer(expiresAtString) {
    if (timerInterval) clearInterval(timerInterval);
    const timerElement = document.getElementById('tradeTimer');
    const timeRemainingElement = document.getElementById('timeRemaining');

    if (!expiresAtString) {
        if (timerElement) timerElement.style.display = 'none';
        return;
    }

    if (timerElement) timerElement.style.display = 'inline-block';

    const expiresAt = new Date(expiresAtString).getTime();

    function update() {
        const now = new Date().getTime();
        const distance = expiresAt - now;

        if (distance < 0) {
            clearInterval(timerInterval);
            if (timeRemainingElement) timeRemainingElement.innerHTML = "Expirado";
            // Check status again if needed
            return;
        }

        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        const m = minutes < 10 ? "0" + minutes : minutes;
        const s = seconds < 10 ? "0" + seconds : seconds;

        if (timeRemainingElement) timeRemainingElement.innerHTML = m + ":" + s;
    }

    update();
    timerInterval = setInterval(update, 1000);
}

// ================================
// Dispute Modal Functions
// ================================

function openDisputeModal() {
    const modal = document.getElementById('disputeModal');
    if (!modal || !currentTrade) return;

    // Pre-fill readonly fields - Use names instead of emails for privacy
    document.getElementById('disputeTradeId').value = currentTrade.id;
    const makerName = [currentTrade.maker?.profile?.firstName, currentTrade.maker?.profile?.lastName].filter(Boolean).join(' ') || 'N/A';
    const takerName = [currentTrade.taker?.profile?.firstName, currentTrade.taker?.profile?.lastName].filter(Boolean).join(' ') || 'N/A';
    document.getElementById('disputeMakerEmail').value = makerName;
    document.getElementById('disputeTakerEmail').value = takerName;

    // Reset form
    document.getElementById('disputeReason').value = '';
    document.getElementById('disputeCharCount').textContent = '0';

    // Reset file inputs
    const filesContainer = document.getElementById('disputeFilesContainer');
    filesContainer.innerHTML = `
        <div class="dispute-file-row" style="margin-bottom: 8px;">
            <input type="file" name="attachments" accept="image/*,.pdf" 
                style="width: 100%; padding: 8px; border: 1px dashed #ddd; border-radius: 5px; background: #fafafa;"
                onchange="handleDisputeFileChange(this)">
        </div>
    `;

    modal.style.display = 'block';
}

function closeDisputeModal() {
    const modal = document.getElementById('disputeModal');
    if (modal) modal.style.display = 'none';
}

function updateCharCount() {
    const textarea = document.getElementById('disputeReason');
    const counter = document.getElementById('disputeCharCount');
    if (textarea && counter) {
        counter.textContent = textarea.value.length;
    }
}

function handleDisputeFileChange(input) {
    const container = document.getElementById('disputeFilesContainer');
    const fileRows = container.querySelectorAll('.dispute-file-row');
    const currentCount = fileRows.length;

    // If file was selected and we have less than 3 inputs, add another
    if (input.files.length > 0 && currentCount < 3) {
        const newRow = document.createElement('div');
        newRow.className = 'dispute-file-row';
        newRow.style.marginBottom = '8px';
        newRow.innerHTML = `
            <input type="file" name="attachments" accept="image/*,.pdf" 
                style="width: 100%; padding: 8px; border: 1px dashed #ddd; border-radius: 5px; background: #fafafa;"
                onchange="handleDisputeFileChange(this)">
        `;
        container.appendChild(newRow);
    }
}

async function submitDispute(event) {
    event.preventDefault();

    const tradeId = document.getElementById('disputeTradeId').value;
    const reason = document.getElementById('disputeReason').value.trim();

    if (!reason) {
        showAlert('Por favor describe el problema', 'error');
        return;
    }

    if (reason.length > 500) {
        showAlert('La descripción no puede exceder 500 caracteres', 'error');
        return;
    }

    const submitBtn = document.getElementById('submitDisputeBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="ri-loader-4-line"></i> Enviando...';

    try {
        const formData = new FormData();
        formData.append('tradeId', tradeId);
        formData.append('reason', reason);

        // Add files
        const fileInputs = document.querySelectorAll('#disputeFilesContainer input[type="file"]');
        fileInputs.forEach(input => {
            if (input.files.length > 0) {
                formData.append('attachments', input.files[0]);
            }
        });

        const accessToken = localStorage.getItem('accessToken');
        const response = await fetch('/api/p2p/disputes', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al crear disputa');
        }

        showAlert('Disputa creada exitosamente. Un administrador revisará tu caso.', 'success');
        closeDisputeModal();

        // Reload trade to show updated status
        setTimeout(() => {
            window.location.reload();
        }, 2000);

    } catch (error) {
        console.error('Error submitting dispute:', error);
        showAlert(error.message || 'Error al crear disputa', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="ri-error-warning-line"></i> Enviar Disputa';
    }
}

// Feedback UI Logic
let selectedRating = 0;

function openFeedbackModal() {
    selectedRating = 0;
    document.getElementById('feedbackRating').value = 0;
    document.getElementById('feedbackComment').value = '';
    updateStars(0);
    document.getElementById('feedbackModal').style.display = 'block';
}

function closeFeedbackModal() {
    document.getElementById('feedbackModal').style.display = 'none';
}

function updateStars(rating) {
    const stars = document.querySelectorAll('.star-rating');
    stars.forEach(star => {
        const val = parseInt(star.getAttribute('data-value'));
        if (val <= rating) {
            star.classList.remove('ri-star-line');
            star.classList.add('ri-star-fill');
            star.style.color = '#ffc107';
        } else {
            star.classList.remove('ri-star-fill');
            star.classList.add('ri-star-line');
            star.style.color = '#ddd';
        }
    });
}

// Star click handlers
document.addEventListener('DOMContentLoaded', () => {
    const stars = document.querySelectorAll('.star-rating');
    stars.forEach(star => {
        star.addEventListener('click', () => {
            const val = parseInt(star.getAttribute('data-value'));
            selectedRating = val;
            document.getElementById('feedbackRating').value = val;
            updateStars(val);
        });
    });
});

async function submitFeedback() {
    const rating = document.getElementById('feedbackRating').value;
    const comment = document.getElementById('feedbackComment').value;

    if (!rating || rating == 0) {
        showAlert('Por favor selecciona una calificación (estrellas)', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/p2p/trades/${tradeId}/feedback`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ rating: parseInt(rating), comment })
        });

        if (response.ok) {
            closeFeedbackModal();
            showAlert('¡Gracias por tu calificación!', 'success');
            setTimeout(() => location.reload(), 1500);
        } else {
            const data = await response.json();
            showAlert(data.message || 'Error al enviar calificación', 'error');
        }
    } catch (error) {
        console.error('Error submitting feedback:', error);
        showAlert('Error de conexión', 'error');
    }
}

// Expose dispute functions globally
window.openDisputeModal = openDisputeModal;
window.closeDisputeModal = closeDisputeModal;
window.updateCharCount = updateCharCount;
window.handleDisputeFileChange = handleDisputeFileChange;
window.submitDispute = submitDispute;

// Expose feedback functions globally
window.openFeedbackModal = openFeedbackModal;
window.closeFeedbackModal = closeFeedbackModal;
window.submitFeedback = submitFeedback;
