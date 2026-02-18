/**
 * Admin - Recargas Telefónicas (Reloadly Airtime)
 * Lista recargas y detalle con usuario y payload webhook.
 */

if (!AdminConfig.checkAuth()) {
    // redirect handled by checkAuth
} else {
    $(document).ready(() => {
        loadOrders();
    });
}

function logout() {
    localStorage.removeItem('adminToken');
    window.location.href = 'login.html';
}

let currentPage = 1;
const pageSize = 20;

function getStatusBadge(status) {
    const map = {
        SUCCESS: '<span class="badge badge-success">Completado</span>',
        PENDING: '<span class="badge badge-warning">Pendiente</span>',
        FAILED: '<span class="badge badge-danger">Fallido</span>',
        REFUNDED: '<span class="badge badge-info">Reembolsado</span>'
    };
    return map[status] || '<span class="badge badge-secondary">' + (status || '-') + '</span>';
}

async function loadOrders() {
    const tbody = document.getElementById('ordersTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Cargando...</td></tr>';
    const userEmail = (document.getElementById('filterUserEmail') && document.getElementById('filterUserEmail').value) || '';
    const params = new URLSearchParams({ page: currentPage, limit: pageSize });
    if (userEmail.trim()) params.set('userEmail', userEmail.trim());

    try {
        const res = await fetch(
            `${AdminConfig.API_URL}/recargas/admin/orders?${params.toString()}`,
            { headers: AdminConfig.getAuthHeaders() }
        );
        if (res.status === 401) {
            AdminConfig.handleApiError(401);
            return;
        }
        if (!res.ok) throw new Error('Error al cargar recargas');
        const data = await res.json();
        const orders = data.orders || [];
        const total = data.total || 0;

        tbody.innerHTML = '';
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No hay recargas</td></tr>';
        } else {
            orders.forEach(o => {
                const userEmail = (o.user && o.user.email) ? o.user.email : (o.userId || 'N/A');
                const webhookBadge = o.webhookReceivedAt
                    ? '<span class="badge badge-info" title="' + new Date(o.webhookReceivedAt).toLocaleString() + '">Sí</span>'
                    : '<span class="badge badge-light text-muted">No</span>';
                const row = `
                    <tr>
                        <td>${new Date(o.createdAt).toLocaleString('es')}</td>
                        <td>${String(userEmail).replace(/</g, '&lt;')}</td>
                        <td>${String(o.operatorName || '-').replace(/</g, '&lt;')}</td>
                        <td>${String(o.recipientPhone || '-').replace(/</g, '&lt;')}</td>
                        <td>$${Number(o.amountUsd).toFixed(2)}</td>
                        <td>${getStatusBadge(o.status)}</td>
                        <td>${webhookBadge}</td>
                        <td><button class="btn btn-info btn-sm" onclick="viewOrder('${o.id}')" title="Ver detalle"><i class="fas fa-eye"></i></button></td>
                    </tr>
                `;
                tbody.innerHTML += row;
            });
        }

        const totalPages = Math.ceil(total / pageSize) || 1;
        const paginationEl = document.getElementById('ordersPagination');
        const start = (currentPage - 1) * pageSize + 1;
        const end = Math.min(currentPage * pageSize, total);
        paginationEl.innerHTML = '';
        if (total > 0) {
            paginationEl.innerHTML = `
                <nav><ul class="pagination pagination-sm mb-0 flex-wrap">
                    <li class="page-item ${currentPage <= 1 ? 'disabled' : ''}"><a class="page-link" href="#" onclick="changePage(${currentPage - 1}); return false;">Anterior</a></li>
                    <li class="page-item disabled"><span class="page-link">${start}-${end} de ${total} (20 por página)</span></li>
                    <li class="page-item ${currentPage >= totalPages ? 'disabled' : ''}"><a class="page-link" href="#" onclick="changePage(${currentPage + 1}); return false;">Siguiente</a></li>
                </ul></nav>
            `;
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Error al cargar</td></tr>';
        console.error(e);
    }
}

function doSearch() {
    currentPage = 1;
    loadOrders();
}

function changePage(page) {
    if (page < 1) return;
    currentPage = page;
    loadOrders();
}

async function viewOrder(id) {
    try {
        const res = await fetch(`${AdminConfig.API_URL}/recargas/admin/orders/${id}`, {
            headers: AdminConfig.getAuthHeaders()
        });
        if (res.status === 401) { AdminConfig.handleApiError(401); return; }
        if (!res.ok) throw new Error('Error al cargar detalle');
        const data = await res.json();
        const o = data.order;
        if (!o) return;

        document.getElementById('detailId').textContent = o.id;
        document.getElementById('detailUser').textContent = (o.user && o.user.email) ? o.user.email : (o.userId || 'N/A');
        document.getElementById('detailOperator').textContent = o.operatorName || '-';
        document.getElementById('detailPhone').textContent = o.recipientPhone || '-';
        document.getElementById('detailAmount').textContent = '$' + Number(o.amountUsd).toFixed(2);
        document.getElementById('detailCurrency').textContent = o.walletCurrency || '-';
        document.getElementById('detailStatus').innerHTML = getStatusBadge(o.status);
        document.getElementById('detailDate').textContent = o.createdAt ? new Date(o.createdAt).toLocaleString('es') : '-';
        document.getElementById('detailWebhookAt').textContent = o.webhookReceivedAt ? new Date(o.webhookReceivedAt).toLocaleString('es') : 'No';
        document.getElementById('detailProviderStatus').textContent = o.providerStatus || '-';

        let payloadText = '-';
        if (o.reloadlyRawResponse) {
            try {
                const parsed = JSON.parse(o.reloadlyRawResponse);
                payloadText = JSON.stringify(parsed, null, 2);
            } catch (_) {
                payloadText = o.reloadlyRawResponse;
            }
        }
        document.getElementById('detailWebhookPayload').textContent = payloadText;

        $('#orderDetailModal').modal('show');
    } catch (e) {
        console.error(e);
        alert('Error al cargar el detalle');
    }
}
