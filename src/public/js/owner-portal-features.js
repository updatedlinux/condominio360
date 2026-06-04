/**
 * Oculta módulos del panel propietario según flags del condominio (SuperAdmin).
 * Compatible Chrome / Edge: caché local, CSS !important, re-aplicación en bfcache.
 */
(function () {
    if (typeof window === 'undefined') return;

    const VISIT_PATHS = ['/owner/visitors', '/owner/visitors/new', '/owner/visitors/history'];
    const DELIVERY_PATHS = ['/owner/delivery/new'];
    const VEHICLE_PATHS = ['/owner/vehicle-access'];
    const COMMON_AREAS_PATHS = ['/owner/common-areas'];
    const CACHE_PREFIX = 'ownerPortalFeatures_v1_';

    function currentPath() {
        return window.location.pathname.replace(/\/$/, '') || '/';
    }

    function getToken() {
        return localStorage.getItem('token') || sessionStorage.getItem('token');
    }

    function decodeJwtPayload(token) {
        try {
            const part = token.split('.')[1];
            if (!part) return null;
            const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64 + '==='.slice((base64.length + 3) % 4);
            return JSON.parse(atob(padded));
        } catch (_) {
            return null;
        }
    }

    function resolveTenantId(token) {
        if (!token) return null;
        const fromJwt = decodeJwtPayload(token);
        if (fromJwt && fromJwt.tenantId) return fromJwt.tenantId;
        try {
            const raw = localStorage.getItem('selectedProperty');
            if (raw) {
                const p = JSON.parse(raw);
                return p.tenantId || p.tenant_id || null;
            }
        } catch (_) { /* noop */ }
        return null;
    }

    function cacheKey(tenantId) {
        return CACHE_PREFIX + String(tenantId).toLowerCase();
    }

    function readCachedFlags(tenantId) {
        if (!tenantId) return null;
        try {
            const raw = sessionStorage.getItem(cacheKey(tenantId))
                || localStorage.getItem(cacheKey(tenantId));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    function writeCachedFlags(tenantId, flags) {
        if (!tenantId || !flags) return;
        const key = cacheKey(tenantId);
        const json = JSON.stringify(flags);
        try {
            sessionStorage.setItem(key, json);
            localStorage.setItem(key, json);
        } catch (_) { /* noop */ }
    }

    function normalizeFlags(flags) {
        return {
            visits_announcements_enabled: !!flags.visits_announcements_enabled,
            deliveries_announcements_enabled: !!flags.deliveries_announcements_enabled,
            vehicle_access_enabled: !!flags.vehicle_access_enabled,
            common_areas_enabled: !!flags.common_areas_enabled
        };
    }

    function injectFeatureStyles(flags) {
        let styleEl = document.getElementById('owner-portal-features-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'owner-portal-features-style';
            styleEl.setAttribute('data-owner-portal-features', '1');
            (document.head || document.documentElement).appendChild(styleEl);
        }

        const rules = [];
        if (!flags.visits_announcements_enabled) {
            rules.push(
                'a[href="/owner/visitors"], a[href="/owner/visitors/new"], a[href="/owner/visitors/history"], .owner-portal-visits { display: none !important; visibility: hidden !important; }'
            );
        }
        if (!flags.deliveries_announcements_enabled) {
            rules.push(
                'a[href="/owner/delivery/new"], .owner-portal-deliveries { display: none !important; visibility: hidden !important; }'
            );
        }
        if (!flags.vehicle_access_enabled) {
            rules.push(
                'a[href="/owner/vehicle-access"], .owner-portal-vehicle { display: none !important; visibility: hidden !important; }'
            );
        }
        if (!flags.common_areas_enabled) {
            rules.push(
                'a[href="/owner/common-areas"], .owner-portal-common-areas { display: none !important; visibility: hidden !important; }'
            );
        }
        styleEl.textContent = rules.join('\n');
    }

    function hideByHref(paths) {
        paths.forEach(function (path) {
            document.querySelectorAll('a[href="' + path + '"]').forEach(function (el) {
                const block = el.closest('.sidebar-item') || el.closest('.card') || el;
                if (block) {
                    block.style.setProperty('display', 'none', 'important');
                    block.setAttribute('aria-hidden', 'true');
                }
            });
        });
    }

    function guardDisabledRoutes(flags) {
        const path = currentPath();
        if (!flags.vehicle_access_enabled && VEHICLE_PATHS.indexOf(path) !== -1) {
            window.location.replace('/owner/dashboard');
            return true;
        }
        if (!flags.common_areas_enabled && COMMON_AREAS_PATHS.indexOf(path) !== -1) {
            window.location.replace('/owner/dashboard');
            return true;
        }
        return false;
    }

    function applyFlags(rawFlags) {
        const flags = normalizeFlags(rawFlags);
        injectFeatureStyles(flags);

        if (!flags.visits_announcements_enabled) {
            hideByHref(VISIT_PATHS);
            document.querySelectorAll('.owner-portal-visits').forEach(function (el) {
                el.style.setProperty('display', 'none', 'important');
            });
        }
        if (!flags.deliveries_announcements_enabled) {
            hideByHref(DELIVERY_PATHS);
            document.querySelectorAll('.owner-portal-deliveries').forEach(function (el) {
                el.style.setProperty('display', 'none', 'important');
            });
        }
        if (!flags.vehicle_access_enabled) {
            hideByHref(VEHICLE_PATHS);
            document.querySelectorAll('.owner-portal-vehicle').forEach(function (el) {
                el.style.setProperty('display', 'none', 'important');
            });
        }
        if (!flags.common_areas_enabled) {
            hideByHref(COMMON_AREAS_PATHS);
            document.querySelectorAll('.owner-portal-common-areas').forEach(function (el) {
                el.style.setProperty('display', 'none', 'important');
            });
        }

        guardDisabledRoutes(flags);
        return flags;
    }

    async function fetchFlags(token, tenantId) {
        let url = '/api/owner/portal-features';
        if (tenantId) {
            url += '?tenantId=' + encodeURIComponent(tenantId);
        }
        const res = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: {
                Authorization: 'Bearer ' + token,
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache'
            }
        });
        const json = await res.json().catch(function () {
            return {};
        });
        if (!res.ok || !json.data) {
            throw new Error(json.error || ('HTTP ' + res.status));
        }
        return normalizeFlags(json.data);
    }

    async function applyFromNetwork() {
        const token = getToken();
        if (!token) return null;

        const tenantId = resolveTenantId(token);
        const flags = await fetchFlags(token, tenantId);
        if (tenantId) {
            writeCachedFlags(tenantId, flags);
        }
        applyFlags(flags);
        return flags;
    }

    function applyFromCache() {
        const token = getToken();
        const tenantId = resolveTenantId(token);
        const cached = readCachedFlags(tenantId);
        if (cached) {
            applyFlags(cached);
            return cached;
        }
        return null;
    }

    function runApplyPass() {
        applyFromCache();
        return applyFromNetwork().catch(function (err) {
            console.warn('owner-portal-features:', err.message || err);
            return null;
        });
    }

    function schedulePasses() {
        var run = function () {
            runApplyPass();
            requestAnimationFrame(function () {
                applyFromCache();
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    }

    window.applyOwnerPortalFeatures = function () {
        return runApplyPass();
    };

    schedulePasses();

    window.addEventListener('pageshow', function (ev) {
        if (ev.persisted) {
            applyFromCache();
            runApplyPass();
        }
    });

    window.addEventListener('storage', function (ev) {
        if (ev.key === 'token' || ev.key === 'selectedProperty' || (ev.key && ev.key.indexOf(CACHE_PREFIX) === 0)) {
            runApplyPass();
        }
    });

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            applyFromCache();
        }
    });
})();
