/**
 * OTC Audit - Admin list of OTC orders (deposits and withdrawals)
 * Retiros OTC: comprobante, tasa, comisiones 2% (1% plataforma, 1% taker)
 */
let currentPage = 1;
const pageSize = 20;

document.addEventListener('DOMContentLoaded', () => {
    if (!AdminConfig.checkAuth()) return;
    document.getElementById('adminEmail').textContent = AdminConfig.getUser().email || 'Admin';
    loadOrders();
});

function logout() {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    window.location.href = 'login.html';
}

async function loadOrders() {
    const tbody = document.getElementById('ordersTableBody');
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">Cargando...</td></tr>';

    const orderType = document.getElementById('orderTypeFilter')?.value || '';
    const status = document.getElementById('statusFilter')?.value || '';
    const userEmail = (document.getElementById('emailFilter')?.value || '').trim();

    const params = new URLSearchParams({ page: currentPage, limit: pageSize });
    if (orderType) params.set('orderType', orderType);
    if (status) params.set('status', status);
    if (userEmail) params.set('userEmail', userEmail);

    try {
        const res = await fetch(
            `${AdminConfig.API_URL}/otc/admin/orders?${params.toString()}`,
            { headers: AdminConfig.getAuthHeaders() }
        );
        if (res.status === 401) {
            AdminConfig.handleApiError(401);
            return;
        }
        if (!res.ok) throw new Error('Error al cargar órdenes');
        const data = await res.json();
        const orders = data.orders || [];
        const total = data.total || 0;

        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No hay órdenes OTC</td></tr>';
        } else {
            tbody.innerHTML = orders.map(o => {
                const isWithdrawal = (o.orderType || '').toUpperCase() === 'WITHDRAWAL';
                const date = o.completedAt || o.takenAt || o.createdAt;
                const reqEmail = (o.requester?.email || 'N/A').replace(/</g, '&lt;');
                const takerEmail = (o.taker?.email || '—').replace(/</g, '&lt;');
                const netCrypto = isWithdrawal ? parseFloat(o.cryptoAmount) * 0.98 : parseFloat(o.cryptoAmount);
                const feePlatform = isWithdrawal ? (parseFloat(o.cryptoAmount) * 0.01).toFixed(4) : '—';
                const feeTaker = isWithdrawal ? (parseFloat(o.cryptoAmount) * 0.01).toFixed(4) : '—';
                const proofUrl = (o.paymentProof || '').trim();
                const proofLink = proofUrl
                    ? getProofLink(proofUrl)
                    : '<span class="text-muted">—</span>';

                return `
                    <tr>
                        <td>${new Date(date).toLocaleString('es')}</td>
                        <td><span class="badge ${isWithdrawal ? 'badge-success' : 'badge-primary'}">${isWithdrawal ? 'Retiro' : 'Depósito'}</span></td>
                        <td>${reqEmail}</td>
                        <td>${takerEmail}</td>
                        <td>${parseFloat(o.cryptoAmount).toFixed(4)} ${o.cryptoAsset}</td>
                        <td>${parseFloat(o.fiatAmount).toFixed(2)} ${o.fiatCurrency}</td>
                        <td>${parseFloat(o.rate || 0).toFixed(4)}</td>
                        <td>${getStatusBadge(o.status)}</td>
                        <td>${proofLink}</td>
                    </tr>
                    ${isWithdrawal && o.status === 'COMPLETED' ? `
                    <tr class="bg-light">
                        <td colspan="2"></td>
                        <td colspan="7" class="small">
                            <strong>Comisiones retiro:</strong> Plataforma 1% = ${feePlatform} ${o.cryptoAsset} | Taker 1% = ${feeTaker} ${o.cryptoAsset} | Neto tomador = ${netCrypto.toFixed(4)} ${o.cryptoAsset}
                            ${o.paymentReference ? ` | Ref: ${String(o.paymentReference).replace(/</g, '&lt;')}` : ''}
                        </td>
                    </tr>
                    ` : ''}
                `;
            }).join('');
        }

        const totalPages = Math.ceil(total / pageSize) || 1;
        const pagEl = document.getElementById('ordersPagination');
        pagEl.innerHTML = total > 0 ? `
            <div class="d-flex justify-content-between align-items-center">
                <span class="text-muted">Total: ${total} órdenes</span>
                <div>
                    <button class="btn btn-sm btn-outline-secondary mr-1" onclick="goPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>Anterior</button>
                    <span class="mx-2">Pág. ${currentPage} de ${totalPages}</span>
                    <button class="btn btn-sm btn-outline-secondary ml-1" onclick="goPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>Siguiente</button>
                </div>
            </div>
        ` : '';
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger">${err.message || 'Error'}</td></tr>`;
    }
}

function goPage(p) {
    if (p < 1) return;
    currentPage = p;
    loadOrders();
}

function getStatusBadge(status) {
    const map = { PENDING: 'warning', WAITING_PAYMENT: 'info', COMPLETED: 'success', CANCELLED: 'secondary' };
    const c = map[status] || 'secondary';
    return `<span class="badge badge-${c}">${status || '—'}</span>`;
}

function getProofLink(url) {
    if (!url || !url.trim()) return '<span class="text-muted">—</span>';
    const u = String(url).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const isPdf = /\.pdf(\?|$)/i.test(url);
    if (isPdf) {
        return `<a href="${u}" target="_blank" rel="noopener" class="btn btn-sm btn-info" title="Abrir PDF"><i class="fas fa-file-pdf"></i></a>`;
    }
    return `<a href="#" class="btn btn-sm btn-info proof-view-btn" data-url="${u}" title="Ver imagen"><i class="fas fa-image"></i></a>`;
}

function showProofLightbox(url) {
    const img = document.getElementById('proofLightboxImg');
    const modal = $('#proofLightboxModal');
    if (img && modal) {
        img.src = url;
        img.onerror = function () { img.src = ''; img.alt = 'No se pudo cargar'; };
        modal.modal('show');
    }
}

document.addEventListener('click', function (e) {
    if (e.target.closest('.proof-view-btn')) {
        e.preventDefault();
        const btn = e.target.closest('.proof-view-btn');
        const url = btn && btn.getAttribute('data-url');
        if (url) showProofLightbox(url);
    }
});
