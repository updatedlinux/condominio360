/**
 * Oculta navegación y bloquea vistas según flags del condominio (SuperAdmin).
 */
(function () {
    if (typeof window === 'undefined') return;

    const PATH_GUARDS = {
        '/tenant-admin/nfc-cards': {
            flag: 'vehicle_access_enabled',
            redirect: '/tenant-admin'
        },
        '/tenant-admin/common-areas': {
            flag: 'common_areas_enabled',
            redirect: '/tenant-admin'
        },
        '/tenant-admin/visits-deliveries-report': {
            test: function (flags) {
                return flags.visits_announcements_enabled || flags.deliveries_announcements_enabled;
            },
            redirect: '/tenant-admin'
        }
    };

    function currentPath() {
        return window.location.pathname.replace(/\/$/, '') || '/';
    }

    function getToken() {
        return sessionStorage.getItem('token') || localStorage.getItem('token');
    }

    function hideDisabledUi(flags) {
        if (!flags.vehicle_access_enabled) {
            ['tab-nfc', 'content-nfc'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        }
        if (!flags.common_areas_enabled) {
            ['nav-common-areas', 'tenant-dash-common-areas-stat', 'tenant-dash-common-areas-action'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        }
    }

    async function apply() {
        const token = getToken();
        if (!token) return;

        const path = currentPath();
        const guard = PATH_GUARDS[path];

        try {
            const res = await fetch('/api/tenant-admin/portal-features', {
                headers: { Authorization: 'Bearer ' + token }
            });
            const json = await res.json();
            if (!res.ok || !json.data) return;

            const flags = json.data;
            hideDisabledUi(flags);

            if (!guard) return;

            let allowed = true;
            if (guard.test) {
                allowed = guard.test(flags);
            } else if (guard.flag) {
                allowed = !!flags[guard.flag];
            }

            if (!allowed) {
                window.location.replace(guard.redirect || '/tenant-admin');
            }
        } catch (e) {
            console.warn('tenant-admin-portal-features', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
})();
