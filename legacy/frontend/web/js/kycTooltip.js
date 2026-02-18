/**
 * Componente Tooltip/Banner KYC
 * Muestra una invitación discreta para que el usuario suba documentos y aumente su nivel KYC
 */

/**
 * Inicializa el tooltip KYC en el dashboard
 */
function initKycTooltip() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
        return;
    }
    
    // Cargar datos KYC
    loadKycData(accessToken);
}

/**
 * Carga los datos KYC del usuario
 */
async function loadKycData(accessToken) {
    try {
        const response = await fetch('/api/me/kyc-dashboard', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            return; // Error silencioso
        }
        
        const data = await response.json();
        const kycStatus = data.kycStatus;
        
        // Verificar si debe mostrarse el tooltip
        if (shouldShowKycTooltip(kycStatus)) {
            renderKycTooltip(kycStatus);
        }
        
    } catch (error) {
        console.error('Error al cargar datos KYC:', error);
    }
}

/**
 * Determina si debe mostrarse el tooltip KYC
 */
function shouldShowKycTooltip(kycStatus) {
    if (!kycStatus) {
        return false;
    }
    
    const currentLevel = kycStatus.currentLevel;
    const levelNum = getLevelNumber(currentLevel);
    
    // Mostrar solo si no está en L4 (nivel máximo)
    return levelNum < 4;
}

/**
 * Obtiene el número de nivel KYC
 */
function getLevelNumber(level) {
    const levels = { 'NONE': 0, 'L1': 1, 'L2': 2, 'L3': 3, 'L4': 4 };
    return levels[level] || 0;
}

/**
 * Renderiza el tooltip KYC
 */
function renderKycTooltip(kycStatus) {
    // Buscar contenedor en dashboard o profile
    let container = document.getElementById('dashboardMain');
    if (!container) {
        // Si no está en dashboard, buscar en profile
        container = document.querySelector('.dashboard-main') || document.querySelector('.profile-container');
    }
    
    if (!container) {
        return;
    }
    
    // Verificar si ya existe el tooltip
    if (document.getElementById('kycTooltip')) {
        return;
    }
    
    const currentLevel = kycStatus.currentLevel;
    const levelNum = getLevelNumber(currentLevel);
    const nextLevel = levelNum + 1;
    
    // Determinar mensaje según el nivel actual
    let message = '';
    let benefitMessage = '';
    
    if (levelNum === 0 || levelNum === 1) {
        message = 'Verifica tu teléfono para aumentar tus límites';
        benefitMessage = 'Aumenta tus límites de depósito y retiro';
    } else if (levelNum === 2) {
        message = 'Sube tus documentos para obtener nivel L3';
        benefitMessage = 'Límites de hasta $10,000 USD mensuales';
    } else if (levelNum === 3) {
        message = 'Sube tu pasaporte para obtener nivel L4';
        benefitMessage = 'Límites ilimitados';
    }
    
    // Crear tooltip
    const tooltip = document.createElement('div');
    tooltip.id = 'kycTooltip';
    tooltip.className = 'kyc-tooltip';
    tooltip.innerHTML = `
        <div class="kyc-tooltip-content">
            <div class="kyc-tooltip-icon">
                <i class="ri-shield-check-line"></i>
            </div>
            <div class="kyc-tooltip-text">
                <strong>${message}</strong>
                <small>${benefitMessage}</small>
            </div>
            <div class="kyc-tooltip-actions">
                <a href="/profile" class="kyc-tooltip-btn">
                    <i class="ri-arrow-right-line"></i> Verificar Ahora
                </a>
                <button class="kyc-tooltip-close" onclick="closeKycTooltip()">
                    <i class="ri-close-line"></i>
                </button>
            </div>
        </div>
    `;
    
    // Insertar al inicio del dashboard main
    dashboardMain.insertBefore(tooltip, dashboardMain.firstChild);
}

/**
 * Cierra el tooltip KYC
 */
function closeKycTooltip() {
    const tooltip = document.getElementById('kycTooltip');
    if (tooltip) {
        tooltip.style.opacity = '0';
        setTimeout(() => {
            tooltip.remove();
        }, 300);
    }
}

// Estilos CSS para el tooltip (se inyectan dinámicamente)
const kycTooltipStyles = `
    .kyc-tooltip {
        background: linear-gradient(135deg, #ee6a3e 0%, #ff8c5a 100%);
        color: #fff;
        padding: 15px 20px;
        border-radius: 10px;
        margin-bottom: 20px;
        box-shadow: 0 4px 15px rgba(238, 106, 62, 0.3);
        animation: slideDown 0.3s ease;
        position: relative;
        transition: opacity 0.3s ease;
    }
    
    @keyframes slideDown {
        from {
            opacity: 0;
            transform: translateY(-20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    .kyc-tooltip-content {
        display: flex;
        align-items: center;
        gap: 15px;
    }
    
    .kyc-tooltip-icon {
        font-size: 2rem;
        flex-shrink: 0;
    }
    
    .kyc-tooltip-text {
        flex: 1;
    }
    
    .kyc-tooltip-text strong {
        display: block;
        font-size: 1rem;
        margin-bottom: 5px;
    }
    
    .kyc-tooltip-text small {
        display: block;
        font-size: 0.85rem;
        opacity: 0.9;
    }
    
    .kyc-tooltip-actions {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    
    .kyc-tooltip-btn {
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
        padding: 8px 15px;
        border-radius: 5px;
        text-decoration: none;
        font-size: 0.9rem;
        font-weight: 600;
        transition: all 0.3s;
        display: flex;
        align-items: center;
        gap: 5px;
    }
    
    .kyc-tooltip-btn:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: translateY(-2px);
    }
    
    .kyc-tooltip-close {
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
        border: none;
        padding: 8px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 1.2rem;
        transition: all 0.3s;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
    }
    
    .kyc-tooltip-close:hover {
        background: rgba(255, 255, 255, 0.3);
    }
    
    @media (max-width: 768px) {
        .kyc-tooltip-content {
            flex-direction: column;
            align-items: flex-start;
        }
        
        .kyc-tooltip-actions {
            width: 100%;
            justify-content: space-between;
        }
        
        .kyc-tooltip-btn {
            flex: 1;
            justify-content: center;
        }
    }
`;

// Inyectar estilos
if (!document.getElementById('kycTooltipStyles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'kycTooltipStyles';
    styleSheet.textContent = kycTooltipStyles;
    document.head.appendChild(styleSheet);
}

