
document.addEventListener('DOMContentLoaded', async function () {
    const token = localStorage.getItem('accessToken');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    // Determine which user to load: query param 'userId' or current user
    const urlParams = new URLSearchParams(window.location.search);
    const targetUserId = urlParams.get('userId'); // If null, backend 'me' endpoint or handle in JS

    // Setup Sidebar
    const sidebarToggle = document.getElementById('sidebarToggle');
    const dashboardSidebar = document.getElementById('dashboardSidebar');
    const dashboardMain = document.getElementById('dashboardMain');

    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            dashboardSidebar.classList.toggle('collapsed');
            dashboardMain.classList.toggle('sidebar-collapsed');
        });
    }

    // Load Profile
    await loadMerchantProfile(targetUserId);
});

async function loadMerchantProfile(userId) {
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');
    const profileContent = document.getElementById('profileContent');
    const errorText = document.getElementById('errorText');

    try {
        loadingState.style.display = 'block';
        errorState.style.display = 'none';
        profileContent.style.display = 'none';

        const token = localStorage.getItem('accessToken');
        let url = '/api/p2p/reputation/me';
        if (userId) {
            url = `/api/p2p/reputation/${userId}`;
        }

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Error al cargar perfil de comerciante');
        }

        const data = await response.json();
        renderMerchantProfile(data);

        loadingState.style.display = 'none';
        profileContent.style.display = 'block';

    } catch (error) {
        console.error(error);
        loadingState.style.display = 'none';
        errorText.textContent = error.message;
        errorState.style.display = 'block';
    }
}

function renderMerchantProfile(data) {
    if (!data) return;

    // --- Header Info ---
    // Initials
    // If it's "me", I might have user info in localStorage, but "data" coming from getPublicProfile 
    // might NOT have the user object populated inside 'stats' unless I populated it.
    // The entity has @OneToOne user. Let's see if it was loaded.
    // In P2PReputationService, 'getReputation' does findOne({ where: { userId } }). It does NOT relation load 'user'.
    // So I might not have the name.
    // However, I can fallback to "Usuario P2P" or use what's available.
    // If viewing "me", I use localStorage.
    // If viewing others, I really need the name.
    // Update: I should check if I need to update Service to include User relation. 
    // For now, let's assume partial data or "Usuario".

    // Update local storage check for "me"
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    let displayName = 'Usuario BidiPago';
    let initials = 'BP';
    let joinedDate = '--';

    // If data.user is returned (need to ensure service returns it)
    // Actually, P2PReputation entity has 'user' relation.
    // But 'getPublicProfile' spreads 'stats' (reputation entity).
    // If I didn't load relations, 'user' is undefined.
    // I will need to update service to load 'user' relation if I want names for OTHER users.
    // For now, let's use what we have.

    // Use data.user from backend (now loaded via relation)
    if (data.user) {
        // Check profile relation
        const userProfile = data.user.profile;
        if (userProfile && userProfile.firstName) {
            displayName = `${userProfile.firstName} ${userProfile.lastName || ''}`;
            initials = userProfile.firstName.charAt(0).toUpperCase();
        } else {
            // Fallback if user data exists but no name set
            displayName = data.user.email || 'Usuario BidiPago';
            initials = displayName.charAt(0).toUpperCase();
        }

        if (data.user.createdAt) {
            joinedDate = new Date(data.user.createdAt).toLocaleDateString();
        }
    } else if (data.userId === currentUser.id && currentUser.firstName) {
        // Fallback to local storage if "me" and backend user relation failed somehow
        displayName = `${currentUser.firstName} ${currentUser.lastName || ''}`;
        initials = currentUser.firstName.charAt(0).toUpperCase();
    }

    document.getElementById('profileName').textContent = displayName;
    document.getElementById('profileInitials').textContent = initials;
    document.getElementById('profileJoined').textContent = joinedDate;

    // --- Rating ---
    const rating = parseFloat(data.averageRating || 0);
    document.getElementById('profileRatingValue').textContent = rating.toFixed(2);
    document.getElementById('profileTotalVotes').textContent = data.totalFeedbacks || 0;

    // Render Stars
    const starsContainer = document.getElementById('profileStars');
    starsContainer.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const star = document.createElement('i');
        if (i <= Math.round(rating)) {
            star.className = 'ri-star-fill';
        } else {
            star.className = 'ri-star-line';
        }
        starsContainer.appendChild(star);
    }

    // --- Key Stats ---
    document.getElementById('statTotalTrades').textContent = data.totalTrades || 0;

    // Completion Rate / Color
    const compRate = parseFloat(data.completionRate || 0);
    const compEl = document.getElementById('statCompletionRate');
    compEl.textContent = compRate.toFixed(1) + '%';
    if (compRate >= 90) compEl.className = 'stat-value text-success';
    else if (compRate >= 80) compEl.className = 'stat-value text-warning';
    else compEl.className = 'stat-value text-danger';

    // Avg Time
    // Calculate global average from maker/taker
    let avgMinutes = 0;
    if (data.totalTrades > 0) {
        // Weighted average manually?
        // (MakerAvg * MakerCount + TakerAvg * TakerCount) / Total
        const makerTime = data.makerAvgMinutes * data.makerCompletedTrades || 0;
        const takerTime = data.takerAvgMinutes * data.takerCompletedTrades || 0;
        const totalCompleted = data.makerCompletedTrades + data.takerCompletedTrades;
        if (totalCompleted > 0) {
            avgMinutes = (makerTime + takerTime) / totalCompleted;
        }
    }
    document.getElementById('statAvgTime').textContent = Math.round(avgMinutes) + ' min';

    // Detailed Stats
    document.getElementById('statCancelled').textContent = data.cancelledTrades || 0;
    document.getElementById('statDisputes').textContent = data.totalDisputes || 0;

    // Maker vs Taker (labeled as Buy vs Sell loosely or generic)
    // HTML says "Compras (Taker/Maker)" and "Ventas".
    // I decided to map:
    // "Compras" -> Taker Trades (usually buying from ads?)
    // "Ventas" -> Maker Trades (usually selling via ads?)
    // This is INACCURATE. Maker can BUY or SELL.
    // I'll change the text in HTML dynamically or just show "Maker / Taker".
    // Let's reuse the element IDs but change logic:
    // Box 1: "Ads Creados (Maker)"
    // Box 2: "Ofertas Tomadas (Taker)"

    const boxBuy = document.getElementById('statBuyTrades');
    const boxSell = document.getElementById('statSellTrades');

    // Update labels via JS or rely on HTML update
    boxBuy.parentElement.querySelector('.stat-label').textContent = 'Anuncios (Maker)';
    boxBuy.textContent = data.makerTotalTrades || 0;

    boxSell.parentElement.querySelector('.stat-label').textContent = 'Ofertas (Taker)';
    boxSell.textContent = data.takerTotalTrades || 0;

    // --- Feedback List with Pagination ---
    const feedbackList = document.getElementById('feedbackList');
    const allFeedback = data.recentFeedback || [];
    const ITEMS_PER_PAGE = 5;
    let currentPage = 0;

    function renderFeedbackPage() {
        feedbackList.innerHTML = '';

        if (allFeedback.length === 0) {
            feedbackList.innerHTML = '<div class="text-center text-muted py-3">No hay comentarios aún.</div>';
            return;
        }

        const startIndex = currentPage * ITEMS_PER_PAGE;
        const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, allFeedback.length);
        const pageItems = allFeedback.slice(startIndex, endIndex);

        pageItems.forEach(fb => {
            const item = document.createElement('div');
            item.className = 'feedback-item';

            // Name masking or full name
            let fromName = 'Usuario';
            if (fb.fromUser && fb.fromUser.profile && fb.fromUser.profile.firstName) {
                fromName = `${fb.fromUser.profile.firstName} ${fb.fromUser.profile.lastName || ''}`;
            } else if (fb.fromUser && fb.fromUser.firstName) {
                // Fallback if fromUser is flattened
                fromName = fb.fromUser.firstName;
            }
            const date = new Date(fb.createdAt).toLocaleDateString();
            const stars = '★'.repeat(fb.rating) + '☆'.repeat(5 - fb.rating);

            item.innerHTML = `
                <div class="feedback-header">
                    <div>
                        <span class="feedback-user">${fromName}</span>
                         <span class="feedback-role">${fb.role === 'BUYER' ? 'Comprador' : 'Vendedor'}</span>
                    </div>
                    <span class="feedback-date">${date}</span>
                </div>
                <div class="feedback-rating mb-1">${stars}</div>
                <div class="feedback-comment text-muted small">${fb.comment || 'Sin comentario'}</div>
            `;
            feedbackList.appendChild(item);
        });

        // Render pagination controls if needed
        if (allFeedback.length > ITEMS_PER_PAGE) {
            const totalPages = Math.ceil(allFeedback.length / ITEMS_PER_PAGE);
            const paginationDiv = document.createElement('div');
            paginationDiv.className = 'feedback-pagination';
            paginationDiv.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 15px; margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;';

            paginationDiv.innerHTML = `
                <button id="prevFeedbackBtn" style="padding: 8px 16px; border: 1px solid #ddd; border-radius: 6px; background: ${currentPage === 0 ? '#f5f5f5' : '#fff'}; cursor: ${currentPage === 0 ? 'not-allowed' : 'pointer'}; color: ${currentPage === 0 ? '#999' : '#333'};" ${currentPage === 0 ? 'disabled' : ''}>
                    ← Anterior
                </button>
                <span style="font-size: 14px; color: #666;">
                    Página ${currentPage + 1} de ${totalPages}
                </span>
                <button id="nextFeedbackBtn" style="padding: 8px 16px; border: 1px solid #ddd; border-radius: 6px; background: ${currentPage >= totalPages - 1 ? '#f5f5f5' : '#fff'}; cursor: ${currentPage >= totalPages - 1 ? 'not-allowed' : 'pointer'}; color: ${currentPage >= totalPages - 1 ? '#999' : '#333'};" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>
                    Siguiente →
                </button>
            `;
            feedbackList.appendChild(paginationDiv);

            // Attach event listeners
            document.getElementById('prevFeedbackBtn')?.addEventListener('click', () => {
                if (currentPage > 0) {
                    currentPage--;
                    renderFeedbackPage();
                }
            });

            document.getElementById('nextFeedbackBtn')?.addEventListener('click', () => {
                if (currentPage < totalPages - 1) {
                    currentPage++;
                    renderFeedbackPage();
                }
            });
        }
    }

    // Initial render
    renderFeedbackPage();
}
