/**
 * Oculta enlaces de visitas/deliveries según flags del condominio (SuperAdmin).
 */
(function () {
    if (typeof window === 'undefined') return;

    const VISIT_PATHS = ['/owner/visitors', '/owner/visitors/new', '/owner/visitors/history'];
    const DELIVERY_PATHS = ['/owner/delivery/new'];

    function hideByHref(paths) {
        paths.forEach(function (path) {
            document.querySelectorAll('a[href="' + path + '"]').forEach(function (el) {
                const block = el.closest('.sidebar-item') || el.closest('.card') || el.closest('a') || el;
                if (block) block.style.display = 'none';
            });
        });
    }

    function hidePortalCards() {
        document.querySelectorAll('.owner-portal-visits').forEach(function (el) {
            el.style.display = 'none';
        });
        document.querySelectorAll('.owner-portal-deliveries').forEach(function (el) {
            el.style.display = 'none';
        });
    }

    function getToken() {
        return sessionStorage.getItem('token') || localStorage.getItem('token');
    }

    async function apply() {
        const token = getToken();
        if (!token) return;
        try {
            const res = await fetch('/api/owner/portal-features', {
                headers: { Authorization: 'Bearer ' + token }
            });
            const json = await res.json();
            if (!res.ok || !json.data) return;
            const flags = json.data;
            if (!flags.visits_announcements_enabled) {
                hideByHref(VISIT_PATHS);
            }
            if (!flags.deliveries_announcements_enabled) {
                hideByHref(DELIVERY_PATHS);
            }
            if (!flags.visits_announcements_enabled) {
                document.querySelectorAll('.owner-portal-visits').forEach(function (el) {
                    el.style.display = 'none';
                });
            }
            if (!flags.deliveries_announcements_enabled) {
                document.querySelectorAll('.owner-portal-deliveries').forEach(function (el) {
                    el.style.display = 'none';
                });
            }
        } catch (e) {
            console.warn('owner-portal-features', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
})();
