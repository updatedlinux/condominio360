/**
 * BidiPago Admin - Sidebar colapsable unificado
 * Uso: definir window.ADMIN_ACTIVE_PAGE antes de cargar este script, ej: 'users', 'kyc', 'commissions-audit'
 * O llamar renderAdminSidebar('users') después de cargar.
 */
(function () {
    'use strict';

    var SECTIONS = {
        users: 'collapseUsers',
        products: 'collapseProducts',
        wallets: 'collapseWallets',
        audit: 'collapseAudit',
        comms: 'collapseComms'
    };

    function isActive(id) {
        var active = window.ADMIN_ACTIVE_PAGE || '';
        return id === active;
    }

    function sectionExpanded(sectionId) {
        var active = window.ADMIN_ACTIVE_PAGE || '';
        var inSection = {
            collapseUsers: ['create-admin', 'kyc', 'users'],
            collapseProducts: ['p2p', 'giftcards', 'recargas', 'san', 'invest'],
            collapseWallets: ['payment-methods', 'fiat-payment-methods', 'withdrawals'],
            collapseAudit: ['commissions-audit', 'fiat-deposits-audit', 'otc-audit'],
            collapseComms: ['push-notifications', 'email-masivos', 'mensajeria-masiva']
        };
        return (inSection[sectionId] || []).indexOf(active) >= 0;
    }

    function itemClass(id) {
        return isActive(id) ? 'collapse-item active' : 'collapse-item';
    }

    function navItemClass(id) {
        return isActive(id) ? 'nav-item active' : 'nav-item';
    }

    function getSidebarHTML() {
        var showUsers = sectionExpanded('collapseUsers');
        var showProducts = sectionExpanded('collapseProducts');
        var showWallets = sectionExpanded('collapseWallets');
        var showAudit = sectionExpanded('collapseAudit');
        var showComms = sectionExpanded('collapseComms');

        return `
            <a class="sidebar-brand d-flex align-items-center justify-content-center" href="index.html">
                <img class="sidebar-logo-expanded" src="img/biglogo.svg" alt="BidiPago" style="max-width: 140px; height: auto; padding: 10px;">
                <img class="sidebar-logo-collapsed" src="assets/coins/biusd.svg" alt="BiUSD" style="max-width: 36px; height: 36px;">
            </a>
            <hr class="sidebar-divider my-0">
            <li class="${navItemClass('index')}">
                <a class="nav-link" href="index.html">
                    <i class="fas fa-fw fa-tachometer-alt"></i>
                    <span>Dashboard</span>
                </a>
            </li>
            <hr class="sidebar-divider">

            <!-- Gestión de Usuarios -->
            <li class="nav-item">
                <a class="nav-link ${showUsers ? '' : 'collapsed'}" href="#" data-toggle="collapse" data-target="#collapseUsers" aria-expanded="${showUsers}">
                    <i class="fas fa-fw fa-users-cog"></i>
                    <span>Gestión de Usuarios</span>
                </a>
                <div id="collapseUsers" class="collapse ${showUsers ? 'show' : ''}" data-parent="#accordionSidebar">
                    <div class="bg-dark py-2 collapse-inner rounded">
                        <a class="${itemClass('create-admin')}" href="create-admin.html"><i class="fas fa-fw fa-user-plus mr-2"></i>Crear Admin</a>
                        <a class="${itemClass('kyc')}" href="kyc.html"><i class="fas fa-fw fa-id-card mr-2"></i>KYC</a>
                        <a class="${itemClass('users')}" href="users.html"><i class="fas fa-fw fa-users mr-2"></i>Usuarios</a>
                    </div>
                </div>
            </li>

            <!-- Productos BidiPago -->
            <li class="nav-item">
                <a class="nav-link ${showProducts ? '' : 'collapsed'}" href="#" data-toggle="collapse" data-target="#collapseProducts" aria-expanded="${showProducts}">
                    <i class="fas fa-fw fa-box-open"></i>
                    <span>Productos BidiPago</span>
                </a>
                <div id="collapseProducts" class="collapse ${showProducts ? 'show' : ''}" data-parent="#accordionSidebar">
                    <div class="bg-dark py-2 collapse-inner rounded">
                        <a class="${itemClass('p2p')}" href="p2p.html"><i class="fas fa-fw fa-exchange-alt mr-2"></i>P2P</a>
                        <a class="${itemClass('giftcards')}" href="giftcards.html"><i class="fas fa-fw fa-gift mr-2"></i>Gift Cards</a>
                        <a class="${itemClass('recargas')}" href="recargas.html"><i class="fas fa-fw fa-phone-alt mr-2"></i>Recargas Telefónicas</a>
                        <a class="${itemClass('san')}" href="san.html"><i class="fas fa-fw fa-piggy-bank mr-2"></i>BidiSAN</a>
                        <a class="${itemClass('invest')}" href="invest.html"><i class="fas fa-fw fa-chart-line mr-2"></i>BidiInvest</a>
                    </div>
                </div>
            </li>

            <!-- Gestión de Billeteras -->
            <li class="nav-item">
                <a class="nav-link ${showWallets ? '' : 'collapsed'}" href="#" data-toggle="collapse" data-target="#collapseWallets" aria-expanded="${showWallets}">
                    <i class="fas fa-fw fa-wallet"></i>
                    <span>Gestión de Billeteras</span>
                </a>
                <div id="collapseWallets" class="collapse ${showWallets ? 'show' : ''}" data-parent="#accordionSidebar">
                    <div class="bg-dark py-2 collapse-inner rounded">
                        <a class="${itemClass('payment-methods')}" href="payment-methods.html"><i class="fas fa-fw fa-credit-card mr-2"></i>Métodos de Pago</a>
                        <a class="${itemClass('fiat-payment-methods')}" href="fiat-payment-methods.html"><i class="fas fa-fw fa-university mr-2"></i>Métodos de Depósito Fiat</a>
                        <a class="${itemClass('withdrawals')}" href="withdrawals.html"><i class="fas fa-fw fa-money-bill-wave mr-2"></i>Retiros Cripto</a>
                    </div>
                </div>
            </li>

            <!-- Auditoría Interna -->
            <li class="nav-item">
                <a class="nav-link ${showAudit ? '' : 'collapsed'}" href="#" data-toggle="collapse" data-target="#collapseAudit" aria-expanded="${showAudit}">
                    <i class="fas fa-fw fa-clipboard-list"></i>
                    <span>Auditoría Interna</span>
                </a>
                <div id="collapseAudit" class="collapse ${showAudit ? 'show' : ''}" data-parent="#accordionSidebar">
                    <div class="bg-dark py-2 collapse-inner rounded">
                        <a class="${itemClass('commissions-audit')}" href="commissions-audit.html"><i class="fas fa-fw fa-coins mr-2"></i>Auditoría Comisiones</a>
                        <a class="${itemClass('fiat-deposits-audit')}" href="fiat-deposits-audit.html"><i class="fas fa-fw fa-file-invoice-dollar mr-2"></i>Auditoría Depósitos Fiat</a>
                        <a class="${itemClass('otc-audit')}" href="otc-audit.html"><i class="fas fa-fw fa-exchange-alt mr-2"></i>Auditoría OTC</a>
                    </div>
                </div>
            </li>

            <!-- Gestión de Comunicaciones (Placeholder) -->
            <li class="nav-item">
                <a class="nav-link ${showComms ? '' : 'collapsed'}" href="#" data-toggle="collapse" data-target="#collapseComms" aria-expanded="${showComms}">
                    <i class="fas fa-fw fa-bullhorn"></i>
                    <span>Gestión de Comunicaciones</span>
                </a>
                <div id="collapseComms" class="collapse ${showComms ? 'show' : ''}" data-parent="#accordionSidebar">
                    <div class="bg-dark py-2 collapse-inner rounded">
                        <a class="${itemClass('push-notifications')}" href="push-notifications.html"><i class="fas fa-fw fa-bell mr-2"></i>Notificaciones Push</a>
                        <a class="${itemClass('email-masivos')}" href="email-masivos.html"><i class="fas fa-fw fa-envelope mr-2"></i>Email Masivos</a>
                        <a class="${itemClass('mensajeria-masiva')}" href="mensajeria-masiva.html"><i class="fas fa-fw fa-comments mr-2"></i>WhatsApp / Telegram</a>
                    </div>
                </div>
            </li>

            <hr class="sidebar-divider d-none d-md-block">
            <div class="text-center d-none d-md-inline">
                <button type="button" class="rounded-circle border-0" id="sidebarToggle" aria-label="Contraer o expandir menú"></button>
            </div>
            <hr class="sidebar-divider">
            <li class="nav-item">
                <a class="nav-link sidebar-logout-btn" href="#" data-target="#logoutModal">
                    <i class="fas fa-fw fa-sign-out-alt"></i>
                    <span>Cerrar Sesión</span>
                </a>
            </li>
        `;
    }

    function renderAdminSidebar(activePage) {
        window.ADMIN_ACTIVE_PAGE = activePage || window.ADMIN_ACTIVE_PAGE;
        var sidebar = document.getElementById('accordionSidebar');
        if (sidebar) {
            sidebar.innerHTML = getSidebarHTML();
        }
    }

    function toggleSidebar() {
        document.body.classList.toggle('sidebar-toggled');
        var sidebar = document.getElementById('accordionSidebar');
        if (sidebar) {
            sidebar.classList.toggle('toggled');
            if (sidebar.classList.contains('toggled')) {
                var collapses = sidebar.querySelectorAll('.collapse.show');
                collapses.forEach(function (el) {
                    el.classList.remove('show');
                });
            }
        }
    }

    function doLogout() {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        window.location.href = 'login.html';
    }

    document.addEventListener('click', function (e) {
        var target = e.target;
        if (!target) return;
        var btn = target.id === 'sidebarToggle' || target.id === 'sidebarToggleTop' ? target : (target.closest && target.closest('#sidebarToggle, #sidebarToggleTop'));
        if (btn) {
            e.preventDefault();
            e.stopPropagation();
            toggleSidebar();
            return;
        }
        var logoutBtn = target.closest && target.closest('.sidebar-logout-btn');
        if (logoutBtn) {
            e.preventDefault();
            var modal = document.getElementById('logoutModal');
            if (modal) {
                if (window.jQuery && modal) {
                    window.jQuery(modal).modal('show');
                } else if (window.bootstrap && window.bootstrap.Modal) {
                    new window.bootstrap.Modal(modal).show();
                } else {
                    doLogout();
                }
            } else {
                doLogout();
            }
        }
    }, true);

    window.renderAdminSidebar = renderAdminSidebar;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            if (window.ADMIN_ACTIVE_PAGE) {
                renderAdminSidebar(window.ADMIN_ACTIVE_PAGE);
            }
        });
    } else if (window.ADMIN_ACTIVE_PAGE) {
        renderAdminSidebar(window.ADMIN_ACTIVE_PAGE);
    }
})();
