// Owner Panel - Mobile navigation toggle + flags del condominio (cargar pronto)
(function() {
    if (!window.__ownerPortalFeaturesBootstrapped) {
        var pf = document.createElement('script');
        pf.src = '/js/owner-portal-features.js';
        pf.defer = true;
        document.head.appendChild(pf);
    }
    window.toggleOwnerMobileNav = function() {
        const sidebar = document.getElementById('owner-sidebar');
        const overlay = document.getElementById('owner-mobile-overlay');
        if (sidebar && overlay) {
            sidebar.classList.toggle('-translate-x-full');
            overlay.classList.toggle('hidden');
        }
    };

    // Close sidebar when clicking a nav link (mobile)
    document.addEventListener('DOMContentLoaded', function() {
        const sidebar = document.getElementById('owner-sidebar');
        const overlay = document.getElementById('owner-mobile-overlay');
        if (sidebar && overlay) {
            sidebar.querySelectorAll('a[href]').forEach(function(link) {
                link.addEventListener('click', function() {
                    if (window.innerWidth < 768) {
                        sidebar.classList.add('-translate-x-full');
                        overlay.classList.add('hidden');
                    }
                });
            });
        }
    });
})();
