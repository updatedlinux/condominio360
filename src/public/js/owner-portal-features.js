/**
 * Oculta enlaces y bloquea vistas según flags del condominio (SuperAdmin).
 */
(function () {
    if (typeof window === 'undefined') return;
    if (window.__ownerPortalFeaturesBootstrapped) return;
    window.__ownerPortalFeaturesBootstrapped = true;

    const VISIT_PATHS = ['/owner/visitors', '/owner/visitors/new', '/owner/visitors/history'];
    const DELIVERY_PATHS = ['/owner/delivery/new'];
    const VEHICLE_PATHS = ['/owner/vehicle-access'];
    const COMMON_AREAS_PATHS = ['/owner/common-areas'];

    function currentPath() {
        return window.location.pathname.replace(/\/$/, '') || '/';
    }

    function getToken() {
        return sessionStorage.getItem('token') || localStorage.getItem('token');
    }

    function tenantIdFromToken(token) {
        try {
            const part = token.split('.')[1];
            if (!part) return null;
            const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
            return json.tenantId || null;
        } catch (_) {
            return null;
        }
    }

    function tenantIdFromSelectedProperty() {
        try {
            const raw = localStorage.getItem('selectedProperty');
            if (!raw) return null;
            const p = JSON.parse(raw);
            return p.tenantId || p.tenant_id || null;
        } catch (_) {
            return null;
        }
    }

    function hideByHref(paths) {
        paths.forEach(function (path) {
            document.querySelectorAll('a[href="' + path + '"]').forEach(function (el) {
                const block = el.closest('.sidebar-item') || el.closest('.card') || el.closest('a') || el;
                if (block) block.style.display = 'none';
            });
        });
    }

    function applyFlags(flags) {
        if (!flags.visits_announcements_enabled) {
            hideByHref(VISIT_PATHS);
            document.querySelectorAll('.owner-portal-visits').forEach(function (el) {
                el.style.display = 'none';
            });
        }
        if (!flags.deliveries_announcements_enabled) {
            hideByHref(DELIVERY_PATHS);
            document.querySelectorAll('.owner-portal-deliveries').forEach(function (el) {
                el.style.display = 'none';
            });
        }
        if (!flags.vehicle_access_enabled) {
            hideByHref(VEHICLE_PATHS);
            document.querySelectorAll('.owner-portal-vehicle').forEach(function (el) {
                el.style.display = 'none';
            });
            if (VEHICLE_PATHS.indexOf(currentPath()) !== -1) {
                window.location.replace('/owner/dashboard');
            }
        }
        if (!flags.common_areas_enabled) {
            hideByHref(COMMON_AREAS_PATHS);
            document.querySelectorAll('.owner-portal-common-areas').forEach(function (el) {
                el.style.display = 'none';
            });
            if (COMMON_AREAS_PATHS.indexOf(currentPath()) !== -1) {
                window.location.replace('/owner/dashboard');
            }
        }
    }

    async function apply() {
        const token = getToken();
        if (!token) return;

        let url = '/api/owner/portal-features';
        const hintTenant =
            tenantIdFromToken(token) || tenantIdFromSelectedProperty();
        if (hintTenant) {
            url += '?tenantId=' + encodeURIComponent(hintTenant);
        }

        try {
            const res = await fetch(url, {
                headers: { Authorization: 'Bearer ' + token }
            });
            const json = await res.json().catch(function () {
                return {};
            });
            if (!res.ok || !json.data) {
                console.warn('owner-portal-features: no flags', json.error || res.status);
                return;
            }
            applyFlags(json.data);
        } catch (e) {
            console.warn('owner-portal-features', e);
        }
    }

    function scheduleApply() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', apply);
        } else {
            apply();
        }
    }

    scheduleApply();

    window.addEventListener('storage', function (ev) {
        if (ev.key === 'token' || ev.key === 'selectedProperty') {
            apply();
        }
    });
})();
