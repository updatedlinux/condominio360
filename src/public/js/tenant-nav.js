// Tenant Admin Navigation - Injects consistent sidebar and header
(function() {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const tenant = JSON.parse(localStorage.getItem('tenant') || '{}');
    
    // Don't run on login pages
    if (window.location.pathname === '/login' || window.location.pathname === '/') return;
    
    // Check if already injected
    if (document.querySelector('.tenant-sidebar')) return;

    const currentPath = window.location.pathname;
    const tenantName = tenant.name || user.firstName || 'Condominio';
    const userEmail = user.email || 'Admin';

    // Navigation items
    const navItems = [
        { path: '/tenant-admin', icon: 'dashboard', label: 'Panel Principal', id: 'dashboard' },
        { path: '/tenant-admin/requests', icon: 'assignment', label: 'Solicitudes', id: 'requests', badge: 'nav-requests-badge' },
        { path: '/tenant-admin/request-types', icon: 'description', label: 'Tipos de Solicitud', id: 'request-types' },
        { path: '/tenant-admin/consultations', icon: 'how_to_vote', label: 'Consultas', id: 'consultations' },
        { path: '/tenant-admin/communiques', icon: 'mail', label: 'Comunicados', id: 'communiques' },
        { path: '/tenant-admin/common-areas', icon: 'sports_tennis', label: 'Áreas Comunes', id: 'common-areas' },
        { divider: true, label: 'Gestión de Unidades' },
        { path: '/tenant-admin/buildings', icon: 'apartment', label: 'Edificios/Calles', id: 'buildings' },
        { path: '/tenant-admin/properties', icon: 'home_work', label: 'Inmuebles', id: 'properties' },
        { path: '/tenant-admin/owners', icon: 'people', label: 'Propietarios', id: 'owners' },
    ];

    // Generate nav HTML
    let navHtml = '';
    navItems.forEach(item => {
        if (item.divider) {
            navHtml += `<div class="pt-4 mt-4 border-t border-[#E5E5E5]"><p class="px-3 text-xs font-medium text-[#9AA0A6] uppercase mb-2">${item.label}</p></div>`;
        } else {
            const isActive = currentPath === item.path || currentPath.startsWith(item.path + '/');
            const activeClass = isActive ? 'active' : '';
            const badgeHtml = item.badge ? `<span id="${item.badge}" class="ml-auto bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full hidden">0</span>` : '';
            navHtml += `
                <a href="${item.path}" class="nav-item ${activeClass} flex items-center px-3 py-3 text-sm font-medium rounded-lg" data-nav="${item.id}">
                    <span class="material-icons-round mr-3 ${isActive ? 'text-[#8B5028]' : 'text-[#5F6368]'}">${item.icon}</span>
                    <span class="${isActive ? 'text-[#3C4043]' : 'text-[#5F6368]'}">${item.label}</span>
                    ${badgeHtml}
                </a>
            `;
        }
    });

    // Sidebar HTML
    const sidebarHtml = `
        <aside class="tenant-sidebar fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#E5E5E5] flex flex-col transform -translate-x-full lg:translate-x-0 transition-transform duration-300">
            <div class="h-16 flex items-center justify-between px-4 border-b border-[#E5E5E5]">
                <span class="font-bold text-xl text-[#8B5028]">Condominio360</span>
                <button onclick="toggleMobileNav()" class="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F5F5F5]">
                    <span class="material-icons-round">close</span>
                </button>
            </div>
            <div class="flex-1 overflow-y-auto py-4">
                <nav class="space-y-1 px-3">
                    ${navHtml}
                </nav>
            </div>
            <div class="p-4 border-t border-[#E5E5E5]">
                <button onclick="logout()" class="flex items-center w-full px-3 py-2 text-sm font-medium text-[#5F6368] hover:text-red-600 rounded-lg hover:bg-red-50">
                    <span class="material-icons-round mr-3">logout</span>
                    Cerrar Sesión
                </button>
            </div>
        </aside>
        <div id="mobileOverlay" class="fixed inset-0 bg-black/50 z-40 hidden lg:hidden" onclick="toggleMobileNav()"></div>
    `;

    // Header HTML
    const headerHtml = `
        <header class="tenant-header h-16 bg-white border-b border-[#E5E5E5] flex items-center justify-between px-4 sticky top-0 z-30">
            <div class="flex items-center gap-4">
                <button onclick="toggleMobileNav()" class="lg:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#F5F5F5]">
                    <span class="material-icons-round text-[#5F6368]">menu</span>
                </button>
                <h1 class="text-lg font-medium text-[#3C4043]">${document.title || 'Panel de Administración'}</h1>
            </div>
            <div class="flex items-center gap-3">
                <div class="text-right hidden sm:block">
                    <span class="text-sm font-medium text-[#3C4043] block">${tenantName}</span>
                    <span class="text-xs text-[#5F6368]">${userEmail}</span>
                </div>
                <div class="w-10 h-10 bg-gradient-to-br from-[#8B5028] to-[#6B3F1F] rounded-full flex items-center justify-center">
                    <span class="material-icons-round text-white">apartment</span>
                </div>
            </div>
        </header>
    `;

    // Insert into page
    const body = document.body;
    const existingContent = body.innerHTML;
    
    body.innerHTML = `
        <div class="flex h-screen overflow-hidden">
            ${sidebarHtml}
            <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
                ${headerHtml}
                <main class="flex-1 overflow-y-auto bg-[#FAFAFA] p-4 lg:p-6">
                    ${existingContent}
                </main>
            </div>
        </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
        .nav-item { transition: all 0.2s; }
        .nav-item:hover, .nav-item.active { 
            background: linear-gradient(90deg, rgba(139,80,40,0.1) 0%, transparent 100%);
            border-right: 3px solid #8B5028;
        }
        .nav-item.active { background: linear-gradient(90deg, rgba(139,80,40,0.15) 0%, transparent 100%); }
        .card { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: all 0.2s; }
        .card-hover:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.12); transform: translateY(-2px); }
    `;
    document.head.appendChild(style);

    // Global functions
    window.toggleMobileNav = function() {
        const sidebar = document.querySelector('.tenant-sidebar');
        const overlay = document.getElementById('mobileOverlay');
        sidebar.classList.toggle('-translate-x-full');
        overlay.classList.toggle('hidden');
    };

    window.logout = function() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('tenant');
        window.location.href = '/login';
    };
})();
