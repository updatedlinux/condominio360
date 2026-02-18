const AdminConfig = {
    // API URL - Uses env-config.js (inyectado por servidor) o fallback desde mismo origen
    API_URL: (window.AdminConfigEnv && window.AdminConfigEnv.API_URL) || (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin + '/api' : ''),

    // Auth helper
    getAuthHeaders: () => {
        const token = localStorage.getItem('adminToken');
        console.log('[AdminConfig] Token:', token ? token.substring(0, 20) + '...' : 'NULL');
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    },

    // Check if logged in
    checkAuth: () => {
        const token = localStorage.getItem('adminToken');
        console.log('[AdminConfig] checkAuth - token exists:', !!token);
        if (!token) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    },

    // Get User Info
    getUser: () => {
        try {
            const userStr = localStorage.getItem('adminUser');
            return userStr ? JSON.parse(userStr) : {};
        } catch (e) {
            console.error('[AdminConfig] Error parsing user:', e);
            return {};
        }
    },

    // Handle API errors (e.g. 401 Unauthorized) - shows modal and redirects to login
    handleApiError: (status, endpoint = 'unknown') => {
        console.error(`[AdminConfig] API Error ${status} on endpoint: ${endpoint}`);
        if (status === 401) {
            AdminConfig.showSessionExpiredModal();
        }
    },

    // Modal when session has expired (no alert; user must click to go to login)
    showSessionExpiredModal: () => {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        let el = document.getElementById('adminSessionExpiredModal');
        if (!el) {
            el = document.createElement('div');
            el.id = 'adminSessionExpiredModal';
            el.className = 'modal fade';
            el.setAttribute('tabindex', '-1');
            el.setAttribute('aria-hidden', 'true');
            el.innerHTML = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header bg-warning">
                            <h5 class="modal-title text-dark"><i class="fas fa-exclamation-triangle mr-2"></i>Sesión expirada</h5>
                        </div>
                        <div class="modal-body">
                            <p class="mb-0">Su sesión ha expirado. Debe iniciar sesión nuevamente para continuar.</p>
                        </div>
                        <div class="modal-footer">
                            <a href="login.html" class="btn btn-primary">Ir al inicio de sesión</a>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(el);
        }
        const $modal = window.jQuery ? window.jQuery(el) : null;
        if ($modal && $modal.modal) {
            $modal.modal({ backdrop: 'static', keyboard: false }).modal('show');
        } else {
            el.classList.add('show');
            el.style.display = 'block';
            el.style.background = 'rgba(0,0,0,0.5)';
            const dialog = el.querySelector('.modal-dialog');
            if (dialog) dialog.style.margin = '10% auto';
        }
    }
};
