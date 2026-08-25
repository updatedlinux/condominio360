(function () {
    var STORAGE_KEY = 'c360-service-closure-modal-seen';

    function isPanelPath() {
        return /^\/(owner|tenant-admin)(\/|$)/.test(window.location.pathname);
    }

    function placeBanner() {
        var banner = document.getElementById('service-closure-banner');
        var mainCol = document.querySelector('.flex-1.flex.flex-col.overflow-hidden');
        if (!banner || !mainCol || banner.parentElement === mainCol) return;
        mainCol.insertBefore(banner, mainCol.firstChild);
    }

    function openModal() {
        var modal = document.getElementById('service-closure-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        var modal = document.getElementById('service-closure-modal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        try {
            sessionStorage.setItem(STORAGE_KEY, '1');
        } catch (e) { /* ignore */ }
    }

    function init() {
        if (!isPanelPath()) {
            var banner = document.getElementById('service-closure-banner');
            var modal = document.getElementById('service-closure-modal');
            if (banner) banner.remove();
            if (modal) modal.remove();
            return;
        }

        placeBanner();

        var closeBtn = document.getElementById('service-closure-modal-close');
        var modal = document.getElementById('service-closure-modal');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeModal();
            });
        }

        var seen = false;
        try {
            seen = sessionStorage.getItem(STORAGE_KEY) === '1';
        } catch (e) { /* ignore */ }

        if (!seen) {
            openModal();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
