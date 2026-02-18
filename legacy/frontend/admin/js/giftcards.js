let dataTableInstance = null;
let currentOrderId = null;
let currentOrderQuantity = 0;

// Format currency
const formatCurrency = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(amount);
};

// Fetch product fee info and update modal
async function fetchProductFeeInfo(productId, unitPriceUsd, quantity) {
    try {
        const response = await fetch(`${AdminConfig.API_URL}/giftcards/products/${productId}`, {
            headers: AdminConfig.getAuthHeaders()
        });

        if (response.ok) {
            const result = await response.json();
            const product = result.data;

            const senderFee = product.senderFee || 0;
            const senderFeePercentage = product.senderFeePercentage || 0;
            const cardValue = unitPriceUsd * quantity;

            // Calculate real cost (value + fixed fee per card + percentage fee)
            const fixedFeeTotal = senderFee * quantity;
            const percentageFeeTotal = cardValue * (senderFeePercentage / 100);
            const realCost = cardValue + fixedFeeTotal + percentageFeeTotal;

            $('#modalSenderFee').text(senderFee > 0 ? formatCurrency(senderFee) + ' x tarjeta' : 'N/A');
            $('#modalSenderFeePercentage').text(senderFeePercentage > 0 ? senderFeePercentage + '%' : 'N/A');
            $('#modalRealCost').text(formatCurrency(realCost));
        } else {
            $('#modalSenderFee').text('Error');
            $('#modalSenderFeePercentage').text('Error');
            $('#modalRealCost').text('Error');
        }
    } catch (error) {
        console.error('Error fetching product fee info:', error);
        $('#modalSenderFee').text('Error');
        $('#modalSenderFeePercentage').text('Error');
        $('#modalRealCost').text('Error');
    }
}

// Check auth
if (!AdminConfig.checkAuth()) {
    // Redirect handled by checkAuth
} else {
    // Initialize
    $(document).ready(() => {
        loadStats();
        loadOrders();
    });
}

function logout() {
    localStorage.removeItem('adminToken');
    window.location.href = 'login.html';
}

async function loadStats() {
    try {
        const balanceResp = await fetch(`${AdminConfig.API_URL}/giftcards/admin/balance`, {
            headers: AdminConfig.getAuthHeaders()
        });

        if (balanceResp.ok) {
            const balanceData = await balanceResp.json();
            if (balanceData.success) {
                $('#reloadlyBalance').text(formatCurrency(balanceData.data.balance, balanceData.data.currencyCode));
            }
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

async function loadOrders() {
    try {
        const response = await fetch(`${AdminConfig.API_URL}/giftcards/admin/orders?limit=100`, {
            headers: AdminConfig.getAuthHeaders()
        });

        if (response.status === 401) {
            AdminConfig.handleApiError(401);
            return;
        }

        if (!response.ok) throw new Error('Error cargando órdenes');

        const data = await response.json();
        const orders = data.data.orders || [];

        if (dataTableInstance) {
            dataTableInstance.destroy();
        }

        const tbody = document.getElementById('ordersTableBody');
        tbody.innerHTML = '';

        let pendingCount = 0;

        orders.forEach(order => {
            const hasCodes = order.giftcardCodesJson && order.giftcardCodesJson !== 'null';
            const needsFulfillment = order.status === 'SUCCESS' && !hasCodes;

            if (needsFulfillment) pendingCount++;

            const statusBadge = getStatusBadge(order.status);
            const codesBadge = hasCodes
                ? '<span class="badge badge-success">Entregado</span>'
                : (order.status === 'SUCCESS' ? '<span class="badge badge-warning">Pendiente Manual</span>' : '<span class="badge badge-secondary">-</span>');

            const webhookBadge = order.webhookReceivedAt
                ? `<span class="badge badge-info" title="${new Date(order.webhookReceivedAt).toLocaleString()}"><i class="fas fa-check"></i> Correo de Reloadly Recibido</span>`
                : '<span class="badge badge-light text-muted">-</span>';

            const row = `
                <tr>
                    <td>${order.id.substring(0, 8)}...</td>
                    <td>${order.user?.email || 'N/A'}</td>
                    <td>${order.productName}</td>
                    <td>${formatCurrency(order.totalUsd)}</td>
                    <td>${new Date(order.createdAt).toLocaleDateString()} ${new Date(order.createdAt).toLocaleTimeString()}</td>
                    <td>${statusBadge}</td>
                    <td>${webhookBadge}</td>
                    <td>${codesBadge}</td>
                    <td>
                        <button class="btn btn-info btn-sm" onclick="viewOrder('${order.id}')" title="Ver Detalles">
                            <i class="fas fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        });

        $('#pendingFulfillCount').text(pendingCount);

        dataTableInstance = $('#dataTable').DataTable({
            language: { emptyTable: "No hay órdenes registradas" },
            order: [[4, "desc"]] // Sort by date desc
        });

        // Add Filter Event Listener
        $('#deliveryStatusFilter').off('change').on('change', function () {
            dataTableInstance.column(7).search(this.value).draw();
        });

    } catch (error) {
        console.error('Error:', error);
        Swal.fire('Error', 'No se pudieron cargar las órdenes', 'error');
    }
}

function getStatusBadge(status) {
    switch (status) {
        case 'SUCCESS': return '<span class="badge badge-success">Exitoso</span>';
        case 'PENDING': return '<span class="badge badge-warning">Pendiente</span>';
        case 'FAILED': return '<span class="badge badge-danger">Fallido</span>';
        case 'REFUNDED': return '<span class="badge badge-secondary">Reembolsado</span>';
        default: return `<span class="badge badge-light">${status}</span>`;
    }
}

async function viewOrder(orderId) {
    try {
        const response = await fetch(`${AdminConfig.API_URL}/giftcards/admin/orders/${orderId}`, {
            headers: AdminConfig.getAuthHeaders()
        });

        if (!response.ok) throw new Error('Error al obtener detalles');

        const result = await response.json();
        const order = result.data;

        currentOrderId = order.id;
        currentOrderQuantity = order.quantity;

        // Populate Modal
        $('#modalOrderId').text(order.id);
        $('#modalUserEmail').text(order.user?.email || 'N/A');
        $('#modalDate').text(new Date(order.createdAt).toLocaleString());
        $('#modalProduct').text(order.productName);
        $('#modalAmount').text(formatCurrency(order.totalUsd));
        $('#modalStatus').html(getStatusBadge(order.status));
        $('#modalQuantity').text(order.quantity);

        // Reset fee info while loading
        $('#modalSenderFee').text('Cargando...');
        $('#modalSenderFeePercentage').text('Cargando...');
        $('#modalUnitPrice').text(formatCurrency(order.unitPriceUsd));
        $('#modalRealCost').text('Cargando...');

        // Fetch product details to get fee info
        fetchProductFeeInfo(order.productId, order.unitPriceUsd, order.quantity);

        const hasCodes = order.giftcardCodesJson && order.giftcardCodesJson !== 'null';
        const codes = hasCodes ? JSON.parse(order.giftcardCodesJson) : [];

        if (order.status === 'SUCCESS' && !hasCodes) {
            // Show fulfillment section
            $('#fulfillmentSection').show();
            $('#existingCodesSection').hide();
            $('#btnFulfill').show();
            renderFulfillmentInputs(order.quantity);
        } else if (hasCodes) {
            // Show existing codes
            $('#fulfillmentSection').hide();
            $('#existingCodesSection').show();
            $('#btnFulfill').hide();
            renderExistingCodes(codes);
        } else {
            // Other status
            $('#fulfillmentSection').hide();
            $('#existingCodesSection').hide();
            $('#btnFulfill').hide();
        }

        $('#orderModal').modal('show');

    } catch (error) {
        console.error('Error viewing order:', error);
        Swal.fire('Error', 'No se pudieron cargar los detalles de la orden', 'error');
    }
}

function renderFulfillmentInputs(quantity) {
    const container = document.getElementById('codesContainer');
    container.innerHTML = '<p class="small text-muted mb-2">Cantidad de tarjetas: <span class="font-weight-bold">' + quantity + '</span></p>';

    for (let i = 0; i < quantity; i++) {
        const html = `
            <div class="code-input-group" id="codeGroup_${i}">
                <h6 class="font-weight-bold text-primary mb-2">Tarjeta #${i + 1}</h6>
                <div class="form-row">
                    <div class="col-md-7 mb-2">
                        <label>Número de Tarjeta/Código *</label>
                        <input type="text" class="form-control card-number" placeholder="Ingrese el código" required>
                    </div>
                    <div class="col-md-5 mb-2">
                        <label>PIN (Opcional)</label>
                        <input type="text" class="form-control card-pin" placeholder="PIN si aplica">
                    </div>
                </div>
            </div>
        `;
        container.innerHTML += html;
    }
}

function renderExistingCodes(codes) {
    const list = document.getElementById('existingCodesList');
    list.innerHTML = '';

    if (!codes || codes.length === 0) {
        list.innerHTML = '<p>No hay códigos disponibles.</p>';
        return;
    }

    codes.forEach((code, index) => {
        list.innerHTML += `
            <div class="mb-2 border-bottom pb-2">
                <strong>Tarjeta #${index + 1}:</strong> 
                <span class="text-monospace bg-white px-2 py-1 border rounded ml-2">${code.cardNumber}</span>
                ${code.pinCode ? `<span class="ml-3 text-muted">PIN: ${code.pinCode}</span>` : ''}
            </div>
        `;
    });
}

function submitFulfillment() {
    const codes = [];
    let valid = true;

    // Collect inputs
    for (let i = 0; i < currentOrderQuantity; i++) {
        const group = $(`#codeGroup_${i}`);
        const cardNumber = group.find('.card-number').val().trim();
        const pinCode = group.find('.card-pin').val().trim();

        if (!cardNumber) {
            group.find('.card-number').addClass('is-invalid');
            valid = false;
        } else {
            group.find('.card-number').removeClass('is-invalid');
            codes.push({
                cardNumber,
                pinCode: pinCode || undefined
            });
        }
    }

    if (!valid) {
        Swal.fire('Error', 'Por favor complete todos los campos de número de tarjeta', 'warning');
        return;
    }

    Swal.fire({
        title: '¿Confirmar Envío?',
        text: "Se guardarán los códigos y estarán visibles para el usuario inmediatamente.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Sí, Guardar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const response = await fetch(`${AdminConfig.API_URL}/giftcards/admin/orders/${currentOrderId}/fulfill`, {
                    method: 'PATCH',
                    headers: AdminConfig.getAuthHeaders(),
                    body: JSON.stringify({ codes })
                });

                const data = await response.json();

                if (data.success) {
                    $('#orderModal').modal('hide');
                    Swal.fire('¡Éxito!', 'Códigos actualizados correctamente.', 'success');
                    loadOrders(); // Refresh table
                } else {
                    throw new Error(data.error || 'Error al guardar');
                }
            } catch (error) {
                console.error('Error fulfillment:', error);
                Swal.fire('Error', error.message, 'error');
            }
        }
    });
}

async function syncProducts() {
    const { value: countryCode } = await Swal.fire({
        title: 'Sincronizar Productos',
        input: 'text',
        inputLabel: 'Código de país (ISO)',
        inputValue: 'US',
        showCancelButton: true,
        inputValidator: (value) => {
            if (!value) {
                return 'Debes escribir un código de país'
            }
        }
    });

    if (countryCode) {
        try {
            Swal.fire({
                title: 'Sincronizando...',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            const response = await fetch(`${AdminConfig.API_URL}/giftcards/admin/sync-products`, {
                method: 'POST',
                headers: AdminConfig.getAuthHeaders(),
                body: JSON.stringify({ countryCode })
            });

            const data = await response.json();

            if (data.success) {
                Swal.fire('Sincronziación Completada', `Productos de ${countryCode} actualizados.`, 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            Swal.fire('Error', error.message, 'error');
        }
    }
}

// ==========================================
// Email Inbox Logic
// ==========================================

let currentEmailPage = 1;
const EMAIL_PAGE_SIZE = 15;

function openEmailInbox() {
    $('#emailInboxModal').modal('show');
    showEmailList();
    loadEmails(1);
}

function showEmailList() {
    $('#emailDetailView').hide();
    $('#emailListView').show();
}

async function loadEmails(page = 1) {
    currentEmailPage = page;

    // UI Loading state
    $('#emailListLoading').show();
    $('#emailList').hide();
    $('#emailListError').hide();
    $('#emailPagination').hide();
    $('#emailInboxStatus').text('Cargando...');

    try {
        const response = await fetch(`${AdminConfig.API_URL}/admin/email/messages?page=${page}&limit=${EMAIL_PAGE_SIZE}`, {
            headers: AdminConfig.getAuthHeaders()
        });

        if (!response.ok) throw new Error('Error al cargar correos');

        const result = await response.json();
        const { messages, pagination } = result.data;

        renderEmailList(messages);
        updateEmailPagination(pagination);

        // Update status text
        $('#emailInboxStatus').text(`${pagination.total} mensajes totales`);

    } catch (error) {
        console.error('Error loading emails:', error);
        $('#emailListError').text('Error al cargar la bandeja de entrada. Verifique la conexión IMAP.').show();
    } finally {
        $('#emailListLoading').hide();
        $('#emailList').show();
    }
}

function renderEmailList(messages) {
    const container = $('#emailList');
    container.empty();

    if (messages.length === 0) {
        container.html('<div class="list-group-item text-center text-muted">No hay correos para mostrar</div>');
        return;
    }

    messages.forEach(msg => {
        const date = new Date(msg.date).toLocaleString();
        const seenClass = msg.seen ? 'text-muted' : 'font-weight-bold';
        const bgClass = msg.seen ? '' : 'bg-light';
        const iconClass = msg.seen ? 'fa-envelope-open-text' : 'fa-envelope text-primary';

        const item = `
            <a href="#" class="list-group-item list-group-item-action ${bgClass} flex-column align-items-start" onclick="viewEmail(${msg.uid}); return false;">
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1 ${seenClass}">${escapeHtml(msg.subject)}</h6>
                    <small>${date}</small>
                </div>
                <div class="d-flex w-100 justify-content-between align-items-center mt-1">
                    <small class="mb-1 text-truncate" style="max-width: 80%;">${escapeHtml(msg.from)}</small>
                    <i class="fas ${iconClass}"></i>
                </div>
            </a>
        `;
        container.append(item);
    });
}

function updateEmailPagination(pagination) {
    const { page, totalPages } = pagination;

    $('#emailPageInfo').text(`Página ${page} de ${totalPages || 1}`);

    $('#emailPrevBtn').prop('disabled', page <= 1);
    $('#emailNextBtn').prop('disabled', page >= totalPages);

    $('#emailPagination').show();
}

async function viewEmail(uid) {
    // Switch view immediately
    $('#emailListView').hide();
    $('#emailDetailView').show();
    $('#emailDetailLoading').show();
    $('#emailDetailContent').hide();
    $('#emailDetailAttachments').hide();

    // Reset fields
    $('#emailDetailSubject').text('Cargando...');
    $('#emailDetailFrom').text('');
    $('#emailDetailDate').text('');

    try {
        const response = await fetch(`${AdminConfig.API_URL}/admin/email/messages/${uid}`, {
            headers: AdminConfig.getAuthHeaders()
        });

        if (!response.ok) throw new Error('Error al obtener el correo');

        const result = await response.json();
        const email = result.data;

        // Render detail
        $('#emailDetailSubject').text(email.subject);
        $('#emailDetailFrom').text(email.from);
        $('#emailDetailDate').text(new Date(email.date).toLocaleString());

        // Content: Prefer HTML, fallback to Text
        const content = email.html || (email.text ? `<pre style="white-space: pre-wrap;">${escapeHtml(email.text)}</pre>` : '<em>Sin contenido</em>');

        // Sanitize simplisticly/wrap in sandbox iframe if needed, 
        // but for trusted admin tool, inserting HTML directly is acceptable-ish if careful.
        // For better security, we'll put it in a secured div or simple render.
        // Given this is admin, we render directly but user should be careful.
        $('#emailDetailContent').html(content).show();

        // Attachments
        if (email.attachments && email.attachments.length > 0) {
            const attList = email.attachments.map(att =>
                `<span class="badge badge-info mr-2"><i class="fas fa-file"></i> ${escapeHtml(att.filename)} (${formatBytes(att.size)})</span>`
            ).join('');
            $('#emailAttachmentList').html(attList);
            $('#emailDetailAttachments').show();
        }

        // Mark as read in background
        markEmailAsRead(uid);

    } catch (error) {
        console.error('Error viewing email:', error);
        $('#emailDetailContent').html('<div class="alert alert-danger">Error al cargar el contenido del correo.</div>').show();
    } finally {
        $('#emailDetailLoading').hide();
    }
}

async function markEmailAsRead(uid) {
    try {
        await fetch(`${AdminConfig.API_URL}/admin/email/messages/${uid}/mark-read`, {
            method: 'POST',
            headers: AdminConfig.getAuthHeaders()
        });
        // We don't need to update UI here as we are inside the view
    } catch (error) {
        console.warn('Failed to mark email as read:', error);
    }
}

// Utils
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
