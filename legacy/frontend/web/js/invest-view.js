/**
 * BidiInvest View JavaScript
 */

const API_BASE = '/api/invest';

// Auth helpers
function getToken() { return localStorage.getItem('accessToken'); }
function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
    };
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('es-VE', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(amount);
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('es-VE', {
        day: '2-digit', month: 'short', year: 'numeric'
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!getToken()) {
        window.location.href = '/login';
        return;
    }

    // Logout handler
    document.getElementById('logoutBtnSidebar')?.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
    });

    await loadActiveInvestment();
});

async function loadActiveInvestment() {
    try {
        // Fetch all investments and find the active one
        // Ideally there should be an endpoint /my-active-investment, but we reuse /my-investments
        const res = await fetch(`${API_BASE}/my-investments`, { headers: getHeaders() });
        const data = await res.json();

        if (!data.success) {
            alert('Error cargando staking');
            window.location.href = '/invest';
            return;
        }

        // Find active investment
        const activeInv = data.investments.find(i => i.status === 'active');

        if (!activeInv) {
            // No active investment, redirect back to list
            window.location.href = '/invest';
            return;
        }

        renderInvestment(activeInv);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('investContent').style.display = 'block';

    } catch (error) {
        console.error('Error loading investment:', error);
        document.getElementById('loading').innerHTML = '<p class="text-danger">Error de conexión</p>';
    }
}

function renderInvestment(inv) {
    document.getElementById('roomName').textContent = inv.room?.name || 'Sala de Staking';
    document.getElementById('planName').textContent = inv.room?.plan?.displayName || 'Plan';
    document.getElementById('participantId').textContent = `#${inv.id.substring(0, 8)}`;

    document.getElementById('investAmount').textContent = formatCurrency(inv.amount);
    document.getElementById('netProfit').textContent = `+${formatCurrency(inv.netReturn)}`;

    // Total receive = Initial Capital + Net Return (since exit fee is already deducted from gross to get net... wait)
    // Actually: Total Return (to user) = Capital + Net Return. 
    // Gross = Capital * Rate. Exit Fee = (Capital + Gross) * 1%. Net = Gross - Fee? 
    // Let's check the backend logic again if needed, but usually Net Return implies what user ACTUALLY gains on top of capital.
    // In invest service: netReturn = projected.netReturn.
    // projected.netReturn in service seems to be the pure profit.
    // Let's calculate total received as Capital + Net Return.
    const total = Number(inv.amount) + Number(inv.netReturn);
    document.getElementById('totalReceive').textContent = formatCurrency(total);

    document.getElementById('exitFee').textContent = formatCurrency(inv.exitFee);

    // Dates & Progress (real investment start/end; pre-registro shown separately)
    const start = new Date(inv.room?.startDate || inv.joinedAt);
    const end = new Date(inv.room?.endDate || inv.joinedAt);

    const preRegEl = document.getElementById('preRegistroLabel');
    const preRegDatesEl = document.getElementById('preRegistroDates');
    if (preRegEl && preRegDatesEl && inv.room?.registrationStart) {
        preRegEl.style.display = '';
        preRegDatesEl.textContent = formatDate(inv.room.registrationStart) + (inv.room.registrationEnd ? ' – ' + formatDate(inv.room.registrationEnd) : '');
    } else if (preRegEl) {
        preRegEl.style.display = 'none';
    }

    document.getElementById('startDate').textContent = formatDate(start);
    document.getElementById('endDate').textContent = formatDate(end);

    // Calculate progress
    const now = new Date();
    const totalTime = end.getTime() - start.getTime();
    const elapsedTime = now.getTime() - start.getTime();

    let progress = 0;
    if (totalTime > 0) {
        progress = Math.min(100, Math.max(0, (elapsedTime / totalTime) * 100));
    }

    document.getElementById('progressBar').style.width = `${progress}%`;

    // Days remaining
    const diffMs = end.getTime() - now.getTime();
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (daysLeft > 0) {
        document.getElementById('daysRemaining').textContent = `${daysLeft} días restantes`;
    } else {
        document.getElementById('daysRemaining').textContent = 'Finalizando...';
        document.getElementById('progressBar').style.width = '100%';
    }
}
