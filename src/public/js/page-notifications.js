/**
 * Toasts y confirmación in-app (sin alert/confirm nativos).
 * Requiere el markup de views/partials/page-notifications.ejs y carga previa de este script.
 */
(function (global) {
    'use strict';

    var IDS = {
        toast: 'c360-toast',
        toastText: 'c360-toast-text',
        toastGlyph: 'c360-toast-glyph',
        confirm: 'c360-confirm',
        confirmText: 'c360-confirm-text',
        confirmOk: 'c360-confirm-ok',
        confirmCancel: 'c360-confirm-cancel',
        prompt: 'c360-prompt',
        promptLabel: 'c360-prompt-label',
        promptInput: 'c360-prompt-input',
        promptOk: 'c360-prompt-ok',
        promptCancel: 'c360-prompt-cancel'
    };

    var pageToastTimer = null;
    var confirmResolve = null;
    var promptResolve = null;
    var wired = false;

    var OK_DEFAULT_CLASS =
        'px-4 py-2.5 rounded-xl bg-orange-500 text-white font-semibold hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/25';
    var OK_DANGER_CLASS =
        'px-4 py-2.5 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/25';

    function portalToBody(id) {
        var el = document.getElementById(id);
        if (el && el.parentNode !== document.body) {
            document.body.appendChild(el);
        }
    }

    function wire() {
        if (wired) return;
        wired = true;
        portalToBody(IDS.toast);
        portalToBody(IDS.confirm);
        portalToBody(IDS.prompt);
        document.getElementById(IDS.confirmOk)?.addEventListener('click', function () {
            closeConfirm(true);
        });
        document.getElementById(IDS.confirmCancel)?.addEventListener('click', function () {
            closeConfirm(false);
        });
        document.getElementById(IDS.confirm)?.addEventListener('click', function (e) {
            if (e.target.id === IDS.confirm) closeConfirm(false);
        });

        document.getElementById(IDS.promptOk)?.addEventListener('click', function () {
            closePrompt(true);
        });
        document.getElementById(IDS.promptCancel)?.addEventListener('click', function () {
            closePrompt(false);
        });
        document.getElementById(IDS.prompt)?.addEventListener('click', function (e) {
            if (e.target.id === IDS.prompt) closePrompt(false);
        });
    }

    function showPageToast(message, variant) {
        wire();
        variant = variant || 'success';
        var el = document.getElementById(IDS.toast);
        var text = document.getElementById(IDS.toastText);
        var glyph = document.getElementById(IDS.toastGlyph);
        if (!el || !text || !glyph) return;
        clearTimeout(pageToastTimer);
        text.textContent = message || '';
        var variantClass =
            variant === 'error' ? 'c360-toast--error' : variant === 'info' ? 'c360-toast--info' : 'c360-toast--success';
        el.className = 'c360-toast ' + variantClass;
        if (variant === 'error') {
            glyph.textContent = '✕';
            glyph.className = 'text-lg shrink-0 mt-0.5 w-7 text-center font-bold text-red-600';
        } else if (variant === 'info') {
            glyph.textContent = 'ⓘ';
            glyph.className = 'text-lg shrink-0 mt-0.5 w-7 text-center font-semibold text-slate-600';
        } else {
            glyph.textContent = '✓';
            glyph.className = 'text-lg shrink-0 mt-0.5 w-7 text-center font-bold text-emerald-600';
        }
        el.classList.remove('hidden');
        pageToastTimer = setTimeout(function () {
            el.classList.add('hidden');
        }, 4800);
    }

    function resetConfirmOkButton() {
        var ok = document.getElementById(IDS.confirmOk);
        if (ok) {
            ok.className = OK_DEFAULT_CLASS;
            ok.textContent = 'Continuar';
        }
        var cancel = document.getElementById(IDS.confirmCancel);
        if (cancel) cancel.textContent = 'Cancelar';
    }

    function closeConfirm(result) {
        var overlay = document.getElementById(IDS.confirm);
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
            overlay.setAttribute('aria-hidden', 'true');
        }
        var r = confirmResolve;
        confirmResolve = null;
        resetConfirmOkButton();
        if (r) r(!!result);
    }

    /**
     * @param {string} message
     * @param {{ okLabel?: string, cancelLabel?: string, destructive?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    function openConfirmModal(message, opts) {
        wire();
        opts = opts || {};
        return new Promise(function (resolve) {
            confirmResolve = resolve;
            var overlay = document.getElementById(IDS.confirm);
            var txt = document.getElementById(IDS.confirmText);
            var ok = document.getElementById(IDS.confirmOk);
            var cancel = document.getElementById(IDS.confirmCancel);
            if (txt) txt.textContent = message || '';
            if (ok) {
                ok.textContent = opts.okLabel || 'Continuar';
                ok.className = opts.destructive ? OK_DANGER_CLASS : OK_DEFAULT_CLASS;
            }
            if (cancel) cancel.textContent = opts.cancelLabel || 'Cancelar';
            if (overlay) {
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
                overlay.setAttribute('aria-hidden', 'false');
            }
        });
    }

    function closePrompt(submit) {
        var overlay = document.getElementById(IDS.prompt);
        var input = document.getElementById(IDS.promptInput);
        var out = null;
        if (submit && input) out = String(input.value || '');
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
            overlay.setAttribute('aria-hidden', 'true');
        }
        var r = promptResolve;
        promptResolve = null;
        if (r) r(submit ? out : null);
    }

    /**
     * @param {string} message
     * @param {{ placeholder?: string, okLabel?: string }} [opts]
     * @returns {Promise<string|null>} texto o null si canceló
     */
    function openPromptModal(message, opts) {
        wire();
        opts = opts || {};
        return new Promise(function (resolve) {
            promptResolve = resolve;
            var overlay = document.getElementById(IDS.prompt);
            var label = document.getElementById(IDS.promptLabel);
            var input = document.getElementById(IDS.promptInput);
            var ok = document.getElementById(IDS.promptOk);
            if (label) label.textContent = message || '';
            if (input) {
                input.value = '';
                input.placeholder = opts.placeholder || '';
            }
            if (ok) ok.textContent = opts.okLabel || 'Aceptar';
            if (overlay) {
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
                overlay.setAttribute('aria-hidden', 'false');
                setTimeout(function () {
                    try {
                        input && input.focus();
                    } catch (e) {}
                }, 50);
            }
        });
    }

    function initPageNotifications() {
        wire();
    }

    global.showPageToast = showPageToast;
    global.showSnackbar = showPageToast;
    global.openConfirmModal = openConfirmModal;
    global.openPromptModal = openPromptModal;
    global.initPageNotifications = initPageNotifications;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPageNotifications);
    } else {
        initPageNotifications();
    }
})(typeof window !== 'undefined' ? window : this);
