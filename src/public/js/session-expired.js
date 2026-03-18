/**
 * Interceptor global de sesión expirada
 * Detecta respuestas 401 en fetch y muestra modal para re-login
 */
(function() {
    'use strict';

    let sessionExpiredShown = false;
    // No mostrar modal en login (401 = credenciales incorrectas, no sesión expirada)
    const AUTH_URLS = ['/api/auth/login'];

    function isAuthUrl(url) {
        if (!url) return false;
        const u = typeof url === 'string' ? url : (url.url || '');
        return AUTH_URLS.some(prefix => u.includes(prefix));
    }

    function showSessionExpiredModal() {
        if (sessionExpiredShown) return;
        if (window.location.pathname === '/login') return;
        sessionExpiredShown = true;

        const existing = document.getElementById('session-expired-modal');
        if (existing) {
            existing.classList.remove('hidden');
            existing.classList.add('flex');
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'session-expired-modal';
        overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center animate-fade-in" style="animation: sessionExpiredFade 0.3s ease-out;">
                <div class="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
                    <svg class="w-10 h-10 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <h2 class="text-xl font-semibold text-[#3C4043] mb-2">Sesión expirada</h2>
                <p class="text-[#5F6368] mb-6">Tu sesión ha expirado por seguridad. Por favor, inicia sesión nuevamente para continuar.</p>
                <button id="session-expired-btn" class="w-full bg-gradient-to-r from-[#f97316] to-[#ea580c] text-white font-medium py-3 px-6 rounded-xl hover:shadow-lg transition-all">
                    Ir a inicio de sesión
                </button>
            </div>
        `;

        const style = document.createElement('style');
        style.textContent = '@keyframes sessionExpiredFade{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}';
        document.head.appendChild(style);

        overlay.querySelector('#session-expired-btn').onclick = function goToLogin() {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem('tenant');
            localStorage.removeItem('selectedProperty');
            localStorage.removeItem('availableProperties');
            sessionStorage.clear();
            window.location.href = '/login';
        };

        document.body.appendChild(overlay);
    }

    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
        return originalFetch.apply(this, arguments).then(function(response) {
            if (response.status === 401 && !isAuthUrl(url)) {
                showSessionExpiredModal();
            }
            return response;
        });
    };
})();
