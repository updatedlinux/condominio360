/**
 * Lógica para la página de Perfil y Seguridad
 * 
 * Carga datos desde GET /api/me/kyc-dashboard
 * Ver estado KYC, subir documentos y verificar teléfono
 */

document.addEventListener('DOMContentLoaded', function () {
    // Toggle sidebar
    const sidebarToggle = document.getElementById('sidebarToggle');
    const dashboardSidebar = document.getElementById('dashboardSidebar');
    const dashboardMain = document.getElementById('dashboardMain');

    sidebarToggle.addEventListener('click', function () {
        dashboardSidebar.classList.toggle('collapsed');
        dashboardMain.classList.toggle('sidebar-collapsed');
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', function (e) {
        e.preventDefault();
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
    });

    // Cargar datos del dashboard
    loadDashboardData();

    // Event listeners para modales
    setupModalListeners();
});

/**
 * Carga los datos del dashboard KYC
 */
async function loadDashboardData() {
    const accessToken = localStorage.getItem('accessToken');

    if (!accessToken) {
        window.location.href = '/login';
        return;
    }

    try {
        const response = await fetch('/api/me/kyc-dashboard', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();

            // Guardar datos globalmente para usar en modales
            window.dashboardData = data;

            // Actualizar estado del botón de cambio de contraseña
            updateChangePasswordButton(data.hasPendingPasswordChange);

            const loadingState = document.getElementById('loadingState');
            const profileContent = document.getElementById('profileContent');

            if (loadingState) loadingState.style.display = 'none';
            if (profileContent) profileContent.style.display = 'block';

            // Renderizar secciones
            try {
                if (data.profile) renderPersonalData(data.profile, data.kycStatus);
                if (data.kycStatus && data.levels) renderKycStatus(data.kycStatus, data.levels);
                if (data.documents) renderDocuments(data.documents);
                if (data.canUse2FA !== undefined) render2FASection(data);

                // Cargar límites de depósito desde el API
                loadDepositLimits();
            } catch (renderError) {
                showError('Error al renderizar los datos: ' + (renderError.message || 'Error desconocido'));
            }
        } else if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            window.location.href = '/login';
        } else {
            showError('Error al cargar datos del perfil');
        }
    } catch (error) {
        showError('Error de conexión. Por favor, intenta nuevamente.');
    }
}

/**
 * Renderiza los datos personales
 */
function renderPersonalData(profile, kycStatus) {
    const container = document.getElementById('personalDataContent');
    if (!container) return;

    if (!profile) {
        container.innerHTML = '<p class="text-muted">No hay datos de perfil disponibles.</p>';
        return;
    }

    const fields = [
        { label: 'Nombre', value: profile.firstName || 'No especificado' },
        { label: 'Apellido', value: profile.lastName || 'No especificado' },
        { label: 'Fecha de Nacimiento', value: profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString('es-VE') : 'No especificado' },
        { label: 'Email', value: profile.email || 'No especificado' },
        { label: 'País', value: profile.country || 'No especificado' },
        { label: 'Estado', value: profile.state || 'No especificado' },
        { label: 'Ciudad', value: profile.city || 'No especificado' },
        { label: 'Dirección Línea 1', value: profile.addressLine1 || 'No especificado' },
        { label: 'Dirección Línea 2', value: profile.addressLine2 || 'No especificado' },
        { label: 'Código Postal', value: profile.zipCode || 'No especificado' },
        { label: 'Cédula/ID', value: profile.nationalIdNumber || 'No especificado' },
        { label: 'Teléfono', value: profile.phoneCountryCode && profile.phoneNumber ? `${profile.phoneCountryCode} ${profile.phoneNumber}` : 'No especificado' },
    ];

    container.innerHTML = fields.map(field => `
        <div class="profile-field">
            <label>${field.label}</label>
            <div class="value">${field.value}</div>
        </div>
    `).join('');
}

/**
 * Renderiza el estado KYC y niveles disponibles
 */
function renderKycStatus(kycStatus, levels) {
    const container = document.getElementById('kycStatusContent');
    if (!container) return;

    if (!kycStatus || !levels) {
        container.innerHTML = '<p class="text-muted">No hay datos de estado KYC disponibles.</p>';
        return;
    }

    const levelBadgeClass = `kyc-level-badge ${kycStatus.currentLevel.toLowerCase()}`;

    let html = `
        <div style="margin-bottom: 25px;">
            <h4>Nivel Actual</h4>
            <span class="${levelBadgeClass}">${kycStatus.currentLevel}</span>
            <span class="status-badge ${kycStatus.status.toLowerCase()}">${getStatusText(kycStatus.status)}</span>
        </div>
        
        <div style="margin-bottom: 25px;">
            <h4>Verificaciones</h4>
            <div class="profile-field">
                <label>Email</label>
                <div class="value">
                    ${kycStatus.emailVerified ? '<i class="ri-checkbox-circle-fill" style="color: #28a745;"></i> Verificado' : '<i class="ri-close-circle-fill" style="color: #dc3545;"></i> No verificado'}
                </div>
            </div>
            <div class="profile-field">
                <label>Teléfono</label>
                <div class="value">
                    ${kycStatus.phoneVerified ? '<i class="ri-checkbox-circle-fill" style="color: #28a745;"></i> Verificado' : '<i class="ri-close-circle-fill" style="color: #dc3545;"></i> No verificado'}
                </div>
            </div>
        </div>
        
        <div>
            <h4>Niveles Disponibles</h4>
    `;

    if (!levels.availableLevels || !Array.isArray(levels.availableLevels)) {
        html += '<p class="text-muted">No hay información de niveles disponible.</p></div>';
        container.innerHTML = html;
        return;
    }

    levels.availableLevels.forEach(level => {
        const statusClass = level.completed ? 'completed' : '';
        const statusText = level.completed ? '<span class="status completed">Completado</span>' : '<span class="status pending">Pendiente</span>';

        // Traducir requisitos a lenguaje humano
        const humanRequirements = level.requirements.map(req => {
            const reqMap = {
                'EMAIL_VERIFICATION': 'Verificación de Correo',
                'PHONE_VERIFICATION': 'Verificación de Teléfono',
                'ID_FRONT': 'Doc de Identidad Frontal',
                'ID_BACK': 'Doc de Identidad Reverso',
                'SELFIE': 'Selfie',
                'PROOF_OF_ADDRESS': 'Prueba de Dirección',
                'PASSPORT': 'Pasaporte'
            };
            return reqMap[req] || req;
        });

        html += `
            <div class="level-item ${statusClass}">
                <h5>${level.name}</h5>
                ${statusText}
                <div style="margin-top: 10px; font-size: 0.9rem; color: #666;">
                    <strong>Requisitos:</strong> ${humanRequirements.join(', ')}
                </div>
            </div>
        `;
    });

    html += '</div>';

    // Agregar botones de acción según el nivel
    const levelNum = getLevelNumber(kycStatus.currentLevel);

    // Verificar si hay documentos faltantes para determinar si mostrar botón de subir
    const documents = window.dashboardData?.documents?.list || [];
    const uploadedTypes = new Set(documents.map(doc => doc.type));

    // Para L2: necesita ID_FRONT, SELFIE, PROOF_OF_ADDRESS
    // Para L3: necesita PASSPORT (si no lo tiene)
    const needsL3Docs = levelNum === 2 && (!uploadedTypes.has('ID_FRONT') || !uploadedTypes.has('SELFIE') || !uploadedTypes.has('PROOF_OF_ADDRESS'));
    const needsL4Docs = levelNum === 3 && !uploadedTypes.has('PASSPORT');
    const canUploadDocuments = needsL3Docs || needsL4Docs;

    if (levelNum === 1 && !kycStatus.phoneVerified) {
        html += `
            <div style="margin-top: 20px;">
                <button class="btn btn-upload-doc" onclick="showVerifyPhoneModal()">
                    <i class="ri-phone-line"></i> Verificar Teléfono
                </button>
            </div>
        `;
    } else if (levelNum === 2 || (levelNum === 3 && needsL4Docs)) {
        // Mostrar botón de subir documentos si:
        // - Está en L2 y le faltan documentos L3
        // - Está en L3 y le falta el pasaporte
        const buttons = [];

        if (canUploadDocuments) {
            buttons.push(`
                <button class="btn btn-upload-doc" onclick="showUploadDocModal()">
                    <i class="ri-upload-cloud-line"></i> Subir Documentos
                </button>
            `);
        }

        buttons.push(`
            <button class="btn btn-upload-doc" onclick="showKycRequestsModal()" style="background: linear-gradient(135deg, #6c757d 0%, #868e96 100%);">
                <i class="ri-file-list-line"></i> Ver Solicitudes KYC
            </button>
        `);

        html += `
            <div style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
                ${buttons.join('')}
            </div>
        `;
    } else if (levelNum >= 3) {
        html += `
            <div style="margin-top: 20px;">
                <button class="btn btn-upload-doc" onclick="showKycRequestsModal()" style="background: linear-gradient(135deg, #6c757d 0%, #868e96 100%);">
                    <i class="ri-file-list-line"></i> Ver Solicitudes KYC
                </button>
            </div>
        `;
    }

    container.innerHTML = html;
}

/**
 * Renderiza los documentos KYC
 */
function renderDocuments(documents) {
    const container = document.getElementById('documentsContent');
    if (!container) return;

    if (!documents || !documents.list || documents.list.length === 0) {
        container.innerHTML = '<p class="text-muted">No hay documentos subidos aún.</p>';
        return;
    }

    let html = '<div class="row">';

    documents.list.forEach(doc => {
        const statusClass = doc.status.toLowerCase();
        const statusText = {
            'uploaded': 'Subido',
            'under_review': 'En Revisión',
            'approved': 'Aprobado',
            'rejected': 'Rechazado'
        }[statusClass] || doc.status;

        html += `
            <div class="col-md-6 mb-3">
                <div class="document-card ${statusClass}">
                    <h5>${getDocumentTypeName(doc.type)}</h5>
                    <p><strong>Estado:</strong> ${statusText}</p>
                    <p><strong>Nivel:</strong> ${doc.level}</p>
                    ${doc.rejectionReason ? `<p><strong>Motivo de rechazo:</strong> ${doc.rejectionReason}</p>` : ''}
                    <p><strong>Subido:</strong> ${new Date(doc.uploadedAt).toLocaleDateString('es-VE')}</p>
                    ${doc.storagePath ? `<button onclick="viewDocument('${doc.storagePath}', '${getDocumentTypeName(doc.type)}')" class="btn btn-sm btn-outline-primary"><i class="ri-eye-line"></i> Ver Documento</button>` : ''}
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

/**
 * Muestra la sección de perfil seleccionada (cards principales web)
 */
function showProfileSection(sectionId) {
    document.querySelectorAll('.profile-main-card').forEach(c => {
        c.classList.toggle('active', c.dataset.section === sectionId);
    });
    document.querySelectorAll('.profile-section-content').forEach(c => {
        c.classList.toggle('active', c.id === 'profileSection' + sectionId.charAt(0).toUpperCase() + sectionId.slice(1));
    });
}

/**
 * Renderiza la sección 2FA (solo visible si canUse2FA)
 */
function render2FASection(data) {
    const section = document.getElementById('twoFactorSection');
    const statusText = document.getElementById('twoFactorStatusText');
    const btnEnable = document.getElementById('btnEnable2FA');
    const btnDisable = document.getElementById('btnDisable2FA');
    const passkeyNote = document.getElementById('twoFAPasskeyNote');

    if (!section) return;

    if (!data.canUse2FA) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // Mostrar nota sobre PassKey si el usuario tiene PassKey registrado
    if (passkeyNote) {
        passkeyNote.style.display = data.hasPasskey ? 'block' : 'none';
    }

    if (data.twoFactorEnabled) {
        if (statusText) statusText.textContent = '2FA activado. Tu cuenta está protegida con autenticación de dos factores.';
        if (btnEnable) btnEnable.style.display = 'none';
        if (btnDisable) {
            btnDisable.style.display = 'block';
            btnDisable.onclick = show2FADisableModal;
        }
    } else {
        if (statusText) statusText.textContent = '2FA desactivado. Actívalo para mayor seguridad.';
        if (btnEnable) {
            btnEnable.style.display = 'block';
            btnEnable.onclick = start2FASetup;
        }
        if (btnDisable) btnDisable.style.display = 'none';
    }
}

let twoFactorSetupSecret = null;

async function start2FASetup() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;
    const modalNote = document.getElementById('twoFAModalPasskeyNote');
    if (modalNote) modalNote.style.display = (window.dashboardData?.hasPasskey) ? 'block' : 'none';
    try {
        const res = await fetch('/api/auth/2fa/setup', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        if (!res.ok) {
            const err = await res.json();
            alert(err.message || 'No se pudo iniciar el setup de 2FA');
            return;
        }
        const data = await res.json();
        twoFactorSetupSecret = data.secret;
        document.getElementById('twoFactorQRCode').src = data.qrCodeDataUrl;
        document.getElementById('twoFactorSecretDisplay').textContent = data.secret;
        document.getElementById('twoFactorCodeInput').value = '';
        document.getElementById('twoFactorError').style.display = 'none';
        show2FAModal();
    } catch (e) {
        alert('Error de conexión');
    }
}

function show2FAModal() {
    const modal = document.getElementById('twoFactorModal');
    if (modal) modal.classList.add('show');
}

function hide2FAModal() {
    const modal = document.getElementById('twoFactorModal');
    if (modal) modal.classList.remove('show');
    twoFactorSetupSecret = null;
}

function show2FADisableModal() {
    const modal = document.getElementById('twoFactorDisableModal');
    if (modal) modal.classList.add('show');
}

function hide2FADisableModal() {
    const modal = document.getElementById('twoFactorDisableModal');
    if (modal) modal.classList.remove('show');
}

async function verify2FAAndEnable() {
    const code = document.getElementById('twoFactorCodeInput').value.trim();
    if (!code || code.length !== 6 || !twoFactorSetupSecret) {
        document.getElementById('twoFactorError').textContent = 'Ingresa el código de 6 dígitos';
        document.getElementById('twoFactorError').style.display = 'block';
        return;
    }
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;
    const btn = document.getElementById('btnVerify2FA');
    btn.disabled = true;
    btn.textContent = 'Verificando...';
    document.getElementById('twoFactorError').style.display = 'none';
    try {
        const res = await fetch('/api/auth/2fa/verify', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: twoFactorSetupSecret, code })
        });
        const data = await res.json();
        if (!res.ok) {
            document.getElementById('twoFactorError').textContent = data.message || 'Código inválido';
            document.getElementById('twoFactorError').style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Verificar y activar';
            return;
        }
        hide2FAModal();
        if (window.dashboardData) window.dashboardData.twoFactorEnabled = true;
        render2FASection(window.dashboardData || { twoFactorEnabled: true, canUse2FA: true });
    } catch (e) {
        document.getElementById('twoFactorError').textContent = 'Error de conexión';
        document.getElementById('twoFactorError').style.display = 'block';
    }
    btn.disabled = false;
    btn.textContent = 'Verificar y activar';
}

async function confirmDisable2FA() {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;
    const btn = document.getElementById('btnConfirmDisable2FA');
    btn.disabled = true;
    try {
        const res = await fetch('/api/auth/2fa/disable', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
        if (!res.ok) {
            alert('No se pudo desactivar 2FA');
            return;
        }
        hide2FADisableModal();
        if (window.dashboardData) window.dashboardData.twoFactorEnabled = false;
        render2FASection(window.dashboardData || { twoFactorEnabled: false, canUse2FA: true });
    } catch (e) {
        alert('Error de conexión');
    }
    btn.disabled = false;
}

/**
 * Funciones auxiliares
 */
function getLevelNumber(level) {
    const levels = { 'NONE': 0, 'L1': 1, 'L2': 2, 'L3': 3, 'L4': 4 };
    return levels[level] || 0;
}

function getStatusText(status) {
    const statusMap = {
        'INCOMPLETE': 'Incompleto',
        'COMPLETE': 'Completado',
        'PENDING_REVIEW': 'En Revisión',
        'APPROVED': 'Aprobado',
        'REJECTED': 'Rechazado'
    };
    return statusMap[status] || status;
}

function getDocumentTypeName(type) {
    const typeMap = {
        'ID_FRONT': 'Cédula - Frente',
        'ID_BACK': 'Cédula - Reverso',
        'SELFIE': 'Selfie',
        'PROOF_OF_ADDRESS': 'Comprobante de Dirección',
        'PASSPORT': 'Pasaporte'
    };
    return typeMap[type] || type;
}

function showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorText').textContent = message;
    document.getElementById('errorState').style.display = 'block';
}

/**
 * Configurar listeners de modales
 */
function setupModalListeners() {
    try {
        // Modal de subida de documentos
        const uploadDocForm = document.getElementById('uploadDocForm');
        if (uploadDocForm) {
            uploadDocForm.addEventListener('submit', handleUploadDocument);
        }

        const cancelUploadBtn = document.getElementById('cancelUploadBtn');
        if (cancelUploadBtn) {
            cancelUploadBtn.addEventListener('click', () => {
                const modal = document.getElementById('uploadDocModal');
                if (modal) modal.classList.remove('show');
            });
        }

        // Modal de verificación de teléfono
        const verifyPhoneForm = document.getElementById('verifyPhoneForm');
        if (verifyPhoneForm) {
            verifyPhoneForm.addEventListener('submit', handleRequestPhoneCode);
        }

        // Validar código de país: solo + y dígitos, máx. 5 caracteres (ej: +1234)
        const phoneCountryCodeInput = document.getElementById('phoneCountryCode');
        if (phoneCountryCodeInput) {
            phoneCountryCodeInput.addEventListener('input', function () {
                let val = this.value;
                if (val.length === 0) return;
                const hasPlus = val.startsWith('+');
                val = val.replace(/[^\d]/g, ''); // Solo dígitos
                if (val.length > 4) val = val.slice(0, 4); // Máx 4 dígitos
                this.value = (hasPlus || val.length > 0 ? '+' : '') + val;
            });
        }

        // Código de verificación: solo dígitos, máx. 6 caracteres
        document.getElementById('verificationCode')?.addEventListener('input', function () {
            this.value = this.value.replace(/\D/g, '').slice(0, 6);
        });

        const verifyCodeForm = document.getElementById('verifyCodeForm');
        if (verifyCodeForm) {
            verifyCodeForm.addEventListener('submit', handleVerifyPhoneCode);
        }

        const cancelPhoneBtn = document.getElementById('cancelPhoneBtn');
        if (cancelPhoneBtn) {
            cancelPhoneBtn.addEventListener('click', () => {
                const modal = document.getElementById('verifyPhoneModal');
                if (modal) modal.classList.remove('show');
                resetPhoneModal();
            });
        }

        const resendCodeBtn = document.getElementById('resendCodeBtn');
        if (resendCodeBtn) {
            resendCodeBtn.addEventListener('click', () => {
                const form = document.getElementById('verifyPhoneForm');
                if (form) {
                    handleRequestPhoneCode({ preventDefault: () => { }, target: form });
                }
            });
        }

        // Modal 2FA
        const btnVerify2FA = document.getElementById('btnVerify2FA');
        if (btnVerify2FA) btnVerify2FA.addEventListener('click', verify2FAAndEnable);
        const btnConfirmDisable2FA = document.getElementById('btnConfirmDisable2FA');
        if (btnConfirmDisable2FA) btnConfirmDisable2FA.addEventListener('click', confirmDisable2FA);
        document.getElementById('twoFactorCodeInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') verify2FAAndEnable();
        });
        ['twoFactorModal', 'twoFactorDisableModal'].forEach(id => {
            const m = document.getElementById(id);
            if (m) m.addEventListener('click', (e) => {
                if (e.target === m) {
                    if (id === 'twoFactorModal') hide2FAModal();
                    else hide2FADisableModal();
                }
            });
        });

        // Mostrar/ocultar campo de código de país según el canal
        document.querySelectorAll('input[name="channel"]').forEach(radio => {
            radio.addEventListener('change', function () {
                const countryCodeGroup = document.getElementById('countryCodeGroup');
                const phoneCountryCodeInput = document.getElementById('phoneCountryCode');
                const phoneNumberHelp = document.getElementById('phoneNumberHelp');
                const phoneNumberLabel = document.getElementById('phoneNumberLabel');
                const phoneNumberInput = document.getElementById('phoneNumber');
                const telegramWarningTooltip = document.getElementById('telegramWarningTooltip');

                if (this.value === 'WHATSAPP') {
                    // Configuración para WhatsApp
                    if (countryCodeGroup) countryCodeGroup.style.display = 'block'; // Mostrar campo de código de país
                    if (phoneCountryCodeInput) {
                        phoneCountryCodeInput.required = true; // Hacer requerido
                    }
                    if (phoneNumberLabel) phoneNumberLabel.innerHTML = 'Número de Teléfono <span class="text-danger">*</span>';
                    if (phoneNumberInput) {
                        phoneNumberInput.placeholder = '4242967747';
                        phoneNumberInput.type = 'text';
                        phoneNumberInput.required = true;
                    }
                    if (phoneNumberHelp) phoneNumberHelp.textContent = 'Para WhatsApp: número sin código de país (ejemplo: 4242967747)';
                    if (telegramWarningTooltip) telegramWarningTooltip.style.display = 'none';
                } else {
                    // Configuración para Telegram
                    if (countryCodeGroup) countryCodeGroup.style.display = 'none'; // Ocultar campo de código de país
                    if (phoneCountryCodeInput) {
                        phoneCountryCodeInput.required = false; // No requerido para Telegram
                        phoneCountryCodeInput.value = ''; // Limpiar valor
                    }
                    if (phoneNumberLabel) phoneNumberLabel.innerHTML = 'Usuario de Telegram <span class="text-danger">*</span>';
                    if (phoneNumberInput) {
                        phoneNumberInput.placeholder = '@username o chat_id';
                        phoneNumberInput.type = 'text';
                        phoneNumberInput.required = true;
                    }
                    if (phoneNumberHelp) phoneNumberHelp.textContent = 'Ingresa tu nombre de usuario de Telegram (ejemplo: @usuario) o chat_id';
                    if (telegramWarningTooltip) telegramWarningTooltip.style.display = 'block';
                }
            });
        });
    } catch (error) {
        // Error silencioso al configurar listeners
    }
}

/**
 * Mostrar modal de subida de documentos
 * Solo muestra los tipos de documentos que aún no han sido subidos
 */
function showUploadDocModal() {
    const modal = document.getElementById('uploadDocModal');
    const docTypeSelect = document.getElementById('docType');
    const form = document.getElementById('uploadDocForm');

    // Obtener nivel KYC actual del usuario
    const currentLevel = window.dashboardData?.kycStatus?.currentLevel || 'NONE';
    const levelNum = getLevelNumber(currentLevel);

    // Obtener documentos ya subidos
    const uploadedDocs = window.dashboardData?.documents?.list || [];
    const uploadedTypes = new Set(uploadedDocs.map(doc => doc.type));

    // Tipos de documentos disponibles
    const allDocTypes = [
        { value: 'ID_FRONT', label: 'Cédula - Frente' },
        { value: 'ID_BACK', label: 'Cédula - Reverso' },
        { value: 'SELFIE', label: 'Selfie' },
        { value: 'PROOF_OF_ADDRESS', label: 'Comprobante de Dirección' },
        { value: 'PASSPORT', label: 'Pasaporte' }
    ];

    // Filtrar solo los tipos que faltan
    let missingTypes = allDocTypes.filter(type => !uploadedTypes.has(type.value));

    // ========== VALIDACIÓN PARA PASAPORTE ==========
    // El pasaporte solo puede subirse si el usuario tiene nivel mínimo L3 aprobado
    if (levelNum < 3) {
        // Remover PASSPORT de los tipos disponibles si no tiene L3
        missingTypes = missingTypes.filter(type => type.value !== 'PASSPORT');
    }

    // Limpiar selector
    docTypeSelect.innerHTML = '<option value="">Selecciona un tipo</option>';

    const submitBtn = document.getElementById('submitUploadBtn');
    const fileInput = document.getElementById('docFile');

    const errorDiv = document.getElementById('uploadDocError');
    const successDiv = document.getElementById('uploadDocSuccess');

    // Ocultar mensajes previos
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    // Mensaje informativo sobre pasaporte si no tiene L3
    let infoMessage = '';
    if (levelNum < 3 && uploadedTypes.has('PASSPORT') === false) {
        infoMessage = 'Nota: El pasaporte solo puede subirse después de obtener aprobación para el nivel L3.';
    }

    if (missingTypes.length === 0) {
        // Si no hay tipos faltantes, mostrar mensaje
        docTypeSelect.innerHTML = '<option value="">No hay documentos pendientes por subir</option>';
        docTypeSelect.disabled = true;
        fileInput.disabled = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Todos los documentos ya están subidos';

        // Mostrar mensaje informativo
        errorDiv.className = 'alert alert-info';
        let message = 'Ya has subido todos los documentos requeridos.';
        if (infoMessage) {
            message += ' ' + infoMessage;
        }
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    } else {
        // Agregar opciones de tipos faltantes
        missingTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.value;
            option.textContent = type.label;
            docTypeSelect.appendChild(option);
        });
        docTypeSelect.disabled = false;
        fileInput.disabled = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Subir Documento';

        // Restaurar clase original del errorDiv
        errorDiv.className = 'alert alert-danger';

        // Mostrar mensaje informativo sobre pasaporte si aplica
        if (infoMessage) {
            errorDiv.className = 'alert alert-info';
            errorDiv.textContent = infoMessage;
            errorDiv.style.display = 'block';
        }
    }

    // Resetear formulario (solo el file input, no el select que ya configuramos)
    fileInput.value = '';

    // Mostrar modal
    modal.classList.add('show');
}

/**
 * Manejar subida de documento
 */
async function handleUploadDocument(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData();
    const docTypeSelect = document.getElementById('docType');
    const docType = docTypeSelect.value;
    const fileInput = document.getElementById('docFile');
    const errorDiv = document.getElementById('uploadDocError');
    const submitBtn = document.getElementById('submitUploadBtn');
    const successDiv = document.getElementById('uploadDocSuccess');

    // Verificar que el selector no esté deshabilitado (no hay documentos pendientes)
    if (docTypeSelect.disabled) {
        errorDiv.className = 'alert alert-warning';
        errorDiv.textContent = 'No hay documentos pendientes por subir.';
        errorDiv.style.display = 'block';
        return;
    }

    if (!docType || !fileInput.files[0]) {
        errorDiv.className = 'alert alert-danger';
        errorDiv.textContent = 'Por favor, completa todos los campos.';
        errorDiv.style.display = 'block';
        return;
    }

    formData.append('type', docType);
    formData.append('file', fileInput.files[0]);

    submitBtn.disabled = true;
    submitBtn.textContent = 'Subiendo...';
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    try {
        const accessToken = localStorage.getItem('accessToken');
        const response = await fetch('/api/kyc/documents', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            body: formData
        });

        if (response.ok) {
            successDiv.textContent = 'Documento subido exitosamente. Si completaste los requisitos, se creará automáticamente una solicitud de upgrade de nivel KYC.';
            successDiv.style.display = 'block';

            // Recargar datos después de 1.5 segundos
            setTimeout(() => {
                document.getElementById('uploadDocModal').classList.remove('show');
                loadDashboardData();
            }, 1500);
        } else {
            const errorData = await response.json();
            const errorMessage = errorData.message || errorData.error || 'Error al subir el documento';

            // Si el error es sobre pasaporte sin L3, mostrar mensaje claro
            if (errorMessage.includes('pasaporte') || errorMessage.includes('L3')) {
                errorDiv.className = 'alert alert-warning';
                errorDiv.textContent = errorMessage + ' Primero debes completar y obtener aprobación para el nivel L3 (ID_FRONT, SELFIE, PROOF_OF_ADDRESS).';
            } else {
                errorDiv.className = 'alert alert-danger';
                errorDiv.textContent = errorMessage;
            }
            errorDiv.style.display = 'block';
            throw new Error(errorMessage);
        }
    } catch (error) {
        // Si el error no fue manejado arriba (ej: error de red), mostrar mensaje genérico
        if (!errorDiv.textContent) {
            errorDiv.className = 'alert alert-danger';
            errorDiv.textContent = error.message || 'Error al subir el documento. Por favor, intenta nuevamente.';
            errorDiv.style.display = 'block';
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Subir Documento';
    }
}

/**
 * Mostrar modal de verificación de teléfono
 */
function showVerifyPhoneModal() {
    const modal = document.getElementById('verifyPhoneModal');
    const form = document.getElementById('verifyPhoneForm');
    const codeForm = document.getElementById('verifyCodeForm');
    const countryCodeGroup = document.getElementById('countryCodeGroup');
    const phoneCountryCodeInput = document.getElementById('phoneCountryCode');
    const phoneNumberLabel = document.getElementById('phoneNumberLabel');
    const phoneNumberInput = document.getElementById('phoneNumber');
    const phoneNumberHelp = document.getElementById('phoneNumberHelp');
    const telegramWarningTooltip = document.getElementById('telegramWarningTooltip');
    const whatsappRadio = document.getElementById('channelWhatsApp');
    const telegramRadio = document.getElementById('channelTelegram');

    if (modal) modal.classList.add('show');
    if (form) form.reset();
    if (codeForm) codeForm.style.display = 'none';

    // Marcar WhatsApp como seleccionado por defecto
    if (whatsappRadio) whatsappRadio.checked = true;
    if (telegramRadio) telegramRadio.checked = false;

    // Configurar para WhatsApp (por defecto)
    if (countryCodeGroup) {
        countryCodeGroup.style.display = 'block'; // Mostrar campo de código de país para WhatsApp
    }
    if (phoneCountryCodeInput) {
        phoneCountryCodeInput.required = true; // Hacer requerido para WhatsApp
    }
    if (phoneNumberLabel) phoneNumberLabel.innerHTML = 'Número de Teléfono <span class="text-danger">*</span>';
    if (phoneNumberInput) {
        phoneNumberInput.placeholder = '4242967747';
        phoneNumberInput.type = 'text';
        phoneNumberInput.required = true;
    }
    if (phoneNumberHelp) phoneNumberHelp.textContent = 'Para WhatsApp: número sin código de país (ejemplo: 4242967747)';
    if (telegramWarningTooltip) telegramWarningTooltip.style.display = 'none';

    // Ocultar mensajes de error/éxito
    const errorDiv = document.getElementById('verifyPhoneError');
    const successDiv = document.getElementById('verifyPhoneSuccess');
    if (errorDiv) errorDiv.style.display = 'none';
    if (successDiv) successDiv.style.display = 'none';
}

/**
 * Resetear modal de teléfono
 */
function resetPhoneModal() {
    document.getElementById('verifyPhoneForm').reset();
    document.getElementById('verifyCodeForm').style.display = 'none';
    document.getElementById('verifyPhoneError').style.display = 'none';
    document.getElementById('verifyPhoneSuccess').style.display = 'none';
}

/**
 * Manejar solicitud de código de teléfono
 */
async function handleRequestPhoneCode(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);
    const channel = formData.get('channel');
    const countryCode = formData.get('countryCode');
    const phoneNumber = formData.get('phoneNumber');

    if (!channel || !phoneNumber) {
        document.getElementById('verifyPhoneError').textContent = 'Por favor, completa todos los campos.';
        document.getElementById('verifyPhoneError').style.display = 'block';
        return;
    }

    if (channel === 'WHATSAPP') {
        if (!countryCode || !/^\+[1-9]\d{0,3}$/.test(String(countryCode).trim())) {
            document.getElementById('verifyPhoneError').textContent = 'Ingresa un código de país válido (ej: +58). Solo + y hasta 4 dígitos.';
            document.getElementById('verifyPhoneError').style.display = 'block';
            return;
        }
    }

    const requestBtn = document.getElementById('requestCodeBtn');
    const errorDiv = document.getElementById('verifyPhoneError');
    const successDiv = document.getElementById('verifyPhoneSuccess');

    requestBtn.disabled = true;
    requestBtn.textContent = 'Enviando...';
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    try {
        const accessToken = localStorage.getItem('accessToken');
        const body = {
            channel,
            phoneNumber,
            ...(countryCode && { countryCode })
        };

        const response = await fetch('/api/kyc/phone/request-code', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (response.ok) {
            const data = await response.json();
            successDiv.textContent = `Código enviado a ${data.destination}. Revisa tu ${channel === 'WHATSAPP' ? 'WhatsApp' : 'Telegram'}.`;
            successDiv.style.display = 'block';

            // Mostrar formulario de verificación de código
            document.getElementById('verifyCodeForm').style.display = 'block';
        } else {
            const errorData = await response.json();
            let errorMessage = errorData.message || 'Error al enviar el código';

            // Interceptar mensaje de error de WhatsApp y cambiarlo
            if (channel === 'WHATSAPP' && (
                errorMessage.includes('WhatsApp no está conectado') ||
                errorMessage.includes('conexión está inactiva') ||
                errorMessage.includes('QR o espera a la reconexión')
            )) {
                errorMessage = 'Nuestro Servicio de Validación via WhatsApp no se encuentra disponible en este momento. Intenta de nuevo más tarde o utiliza la verificación por Telegram.';
            }

            throw new Error(errorMessage);
        }
    } catch (error) {
        let errorMessage = error.message || 'Error al solicitar el código. Por favor, intenta nuevamente.';

        // Interceptar mensaje de error de WhatsApp también en el catch
        if (errorMessage.includes('WhatsApp no está conectado') ||
            errorMessage.includes('conexión está inactiva') ||
            errorMessage.includes('QR o espera a la reconexión')) {
            errorMessage = 'Nuestro Servicio de Validación via WhatsApp no se encuentra disponible en este momento. Intenta de nuevo más tarde o utiliza la verificación por Telegram.';
        }

        errorDiv.textContent = errorMessage;
        errorDiv.style.display = 'block';
    } finally {
        requestBtn.disabled = false;
        requestBtn.textContent = 'Solicitar Código';
    }
}

/**
 * Manejar verificación de código de teléfono
 */
async function handleVerifyPhoneCode(e) {
    e.preventDefault();

    const code = document.getElementById('verificationCode').value.trim();

    if (!code || code.length !== 6) {
        document.getElementById('verifyCodeError').textContent = 'Por favor, ingresa un código de 6 dígitos.';
        document.getElementById('verifyCodeError').style.display = 'block';
        return;
    }

    const verifyBtn = document.getElementById('verifyCodeBtn');
    const errorDiv = document.getElementById('verifyCodeError');
    const successDiv = document.getElementById('verifyPhoneSuccess');

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verificando...';
    errorDiv.style.display = 'none';

    try {
        const accessToken = localStorage.getItem('accessToken');
        const response = await fetch('/api/kyc/phone/verify-code', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code })
        });

        if (response.ok) {
            successDiv.textContent = '¡Teléfono verificado exitosamente!';
            successDiv.style.display = 'block';

            // Cerrar modal y recargar datos
            setTimeout(() => {
                document.getElementById('verifyPhoneModal').classList.remove('show');
                resetPhoneModal();
                loadDashboardData();
            }, 1500);
        } else {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Código inválido');
        }
    } catch (error) {
        errorDiv.textContent = error.message || 'Error al verificar el código. Por favor, intenta nuevamente.';
        errorDiv.style.display = 'block';
    } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verificar';
    }
}

/**
 * Mostrar modal de solicitudes KYC
 */
async function showKycRequestsModal() {
    const modal = document.getElementById('kycRequestsModal');
    const content = document.getElementById('kycRequestsContent');

    // Mostrar modal
    modal.classList.add('show');

    // Mostrar loading
    content.innerHTML = '<div class="text-center" style="padding: 20px;"><p>Cargando solicitudes...</p></div>';

    try {
        const accessToken = localStorage.getItem('accessToken');
        const response = await fetch('/api/kyc/requests/me', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            const requests = data.requests || data || [];
            renderKycRequests(requests);
        } else if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            window.location.href = '/login';
        } else {
            content.innerHTML = '<div class="alert alert-danger">Error al cargar las solicitudes. Por favor, intenta nuevamente.</div>';
        }
    } catch (error) {
        content.innerHTML = '<div class="alert alert-danger">Error de conexión. Por favor, intenta nuevamente.</div>';
    }
}

/**
 * Renderiza las solicitudes KYC en el modal
 */
function renderKycRequests(requests) {
    const content = document.getElementById('kycRequestsContent');

    if (!requests || requests.length === 0) {
        content.innerHTML = `
            <div class="text-center" style="padding: 40px;">
                <i class="ri-file-list-line" style="font-size: 48px; color: #ccc; margin-bottom: 15px;"></i>
                <p class="text-muted">No tienes solicitudes de upgrade KYC aún.</p>
                <p class="text-muted" style="font-size: 0.9rem;">Las solicitudes se crean automáticamente cuando subes los documentos requeridos.</p>
            </div>
        `;
        return;
    }

    let html = '<div style="max-height: 500px; overflow-y: auto;">';

    requests.forEach((request, index) => {
        const statusClass = request.status === 'APPROVED' ? 'success' :
            request.status === 'REJECTED' ? 'danger' : 'warning';
        const statusText = request.status === 'APPROVED' ? 'Aprobada' :
            request.status === 'REJECTED' ? 'Rechazada' : 'En Revisión';
        const statusIcon = request.status === 'APPROVED' ? 'ri-checkbox-circle-line' :
            request.status === 'REJECTED' ? 'ri-close-circle-line' : 'ri-time-line';

        const createdAt = new Date(request.createdAt).toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const reviewedAt = request.reviewedAt ? new Date(request.reviewedAt).toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : null;

        html += `
            <div class="document-card" style="margin-bottom: 15px; ${index < requests.length - 1 ? 'border-bottom: 1px solid #e0e0e0; padding-bottom: 15px;' : ''}">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                    <div>
                        <h5 style="margin: 0; color: #333;">Solicitud de Upgrade a ${request.requestedLevel}</h5>
                        <small class="text-muted">Creada: ${createdAt}</small>
                    </div>
                    <span class="badge badge-${statusClass}" style="padding: 6px 12px; border-radius: 20px; font-size: 0.85rem;">
                        <i class="${statusIcon}"></i> ${statusText}
                    </span>
                </div>
                ${request.reviewedAt ? `
                    <div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 5px;">
                        <small class="text-muted"><strong>Revisada:</strong> ${reviewedAt}</small>
                        ${request.reviewedByAdmin ? `<br><small class="text-muted"><strong>Por:</strong> Admin</small>` : ''}
                    </div>
                ` : ''}
                ${request.rejectionReason ? `
                    <div style="margin-top: 10px; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                        <strong style="color: #856404;"><i class="ri-error-warning-line"></i> Razón del rechazo:</strong>
                        <p style="margin: 8px 0 0 0; color: #856404;">${request.rejectionReason}</p>
                        <p style="margin: 10px 0 0 0; font-size: 0.85rem; color: #856404;">
                            <i class="ri-information-line"></i> Puedes volver a subir los documentos y crear una nueva solicitud.
                        </p>
                    </div>
                ` : ''}
                ${request.status === 'PENDING' ? `
                    <div style="margin-top: 10px; padding: 10px; background: #e7f3ff; border-left: 4px solid #2196F3; border-radius: 4px;">
                        <small style="color: #1976D2;">
                            <i class="ri-information-line"></i> Tu solicitud está siendo revisada por nuestro equipo. Te notificaremos cuando haya una actualización.
                        </small>
                    </div>
                ` : ''}
            </div>
        `;
    });

    html += '</div>';

    // Agregar botón para recargar datos del dashboard si hay solicitudes rechazadas
    const hasRejectedRequests = requests.some(r => r.status === 'REJECTED');
    if (hasRejectedRequests) {
        html += `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
                <button 
                    class="btn btn-outline-primary" 
                    onclick="document.getElementById('kycRequestsModal').classList.remove('show'); loadDashboardData();"
                    style="width: 100%;"
                >
                    <i class="ri-refresh-line"></i> Actualizar Información
                </button>
            </div>
        `;
    }

    content.innerHTML = html;
}

/**
 * Carga los límites de depósito desde el API
 */
async function loadDepositLimits() {
    const accessToken = localStorage.getItem('accessToken');

    if (!accessToken) {
        return;
    }

    try {
        const response = await fetch('/api/me/deposit-limits', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const limitsData = await response.json();
            renderTransactionLimits(limitsData);
        } else {
            // Si falla, mostrar mensaje de error pero no bloquear la página
            const container = document.getElementById('transactionLimitsContent');
            if (container) {
                container.innerHTML = '<p class="text-muted">No se pudieron cargar los límites de depósito.</p>';
            }
        }
    } catch (error) {
        // Error silencioso, mostrar mensaje genérico
        const container = document.getElementById('transactionLimitsContent');
        if (container) {
            container.innerHTML = '<p class="text-muted">Error al cargar los límites de depósito.</p>';
        }
    }
}

/**
 * Renderiza los límites transaccionales usando datos reales del API
 */
function renderTransactionLimits(limitsData) {
    const container = document.getElementById('transactionLimitsContent');
    if (!container) return;

    if (!limitsData) {
        container.innerHTML = '<p class="text-muted">No hay datos de límites disponibles.</p>';
        return;
    }

    const currentLevel = limitsData.currentLevel || 'NONE';
    const monthlyLimitUsd = limitsData.monthlyLimitUsd;
    const usedUsd = limitsData.usedUsd || 0;
    const remainingUsd = limitsData.remainingUsd;

    // Si no hay límite (null), significa que es sin límite (típicamente L4)
    if (monthlyLimitUsd === null) {
        // Formatear fechas del rango del mes
        let monthRangeText = '';
        if (limitsData.monthRange) {
            const startDate = new Date(limitsData.monthRange.start);
            const endDate = new Date(limitsData.monthRange.end);
            monthRangeText = `(${startDate.toLocaleDateString('es-VE', { month: 'long', day: 'numeric' })} - ${endDate.toLocaleDateString('es-VE', { month: 'long', day: 'numeric', year: 'numeric' })})`;
        }

        container.innerHTML = `
            <div class="transaction-limit-item">
                <h5>Límite Mensual de Depósitos (USD)</h5>
                <div class="limit-info">
                    <span class="consumed">Consumido: $${usedUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span class="approved">Límite: Sin límite</span>
                </div>
                <div class="limit-progress-bar">
                    <div class="limit-progress-fill" style="width: 0%"></div>
                </div>
                <p style="margin-top: 10px; font-size: 0.85rem; color: #666;">
                    <strong>Nivel Actual:</strong> ${currentLevel} 
                    ${monthRangeText ? `<br><small class="text-muted">Período: ${monthRangeText}</small>` : ''}
                    <br><small class="text-muted">Tu nivel KYC actual no tiene límites mensuales de depósito.</small>
                    ${monthRangeText ? `<br><small class="text-muted" style="font-style: italic; margin-top: 8px; display: block;">* Los límites se expresan en moneda fiat (USD). El valor consumido se calcula mediante la conversión en tiempo real de los depósitos en criptomonedas a su equivalente en dólares estadounidenses.</small>` : ''}
                </p>
            </div>
        `;
        return;
    }

    // Calcular porcentaje de uso
    const percentage = monthlyLimitUsd > 0 ? (usedUsd / monthlyLimitUsd) * 100 : 0;
    let progressClass = '';
    if (percentage >= 90) {
        progressClass = 'danger';
    } else if (percentage >= 70) {
        progressClass = 'warning';
    }

    // Formatear fechas del rango del mes
    let monthRangeText = '';
    if (limitsData.monthRange) {
        const startDate = new Date(limitsData.monthRange.start);
        const endDate = new Date(limitsData.monthRange.end);
        monthRangeText = `(${startDate.toLocaleDateString('es-VE', { month: 'long', day: 'numeric' })} - ${endDate.toLocaleDateString('es-VE', { month: 'long', day: 'numeric', year: 'numeric' })})`;
    }

    let html = `
        <div class="transaction-limit-item">
            <h5>Límite Mensual de Depósitos (USD)</h5>
            <div class="limit-info">
                <span class="consumed">Consumido: $${usedUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span class="approved">Límite Aprobado: ${monthlyLimitUsd >= 1000000 ? 'Ilimitado' : `$${monthlyLimitUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
            </div>
            <div class="limit-progress-bar">
                <div class="limit-progress-fill ${progressClass}" style="width: ${Math.min(percentage, 100)}%">
                    ${percentage > 10 ? `${percentage.toFixed(1)}%` : ''}
                </div>
            </div>
            <p style="margin-top: 10px; font-size: 0.85rem; color: #666;">
                <strong>Nivel Actual:</strong> ${currentLevel}
                ${remainingUsd !== null ? `<br><strong>Disponible:</strong> $${remainingUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                ${monthRangeText ? `<br><small class="text-muted">Período: ${monthRangeText}</small>` : ''}
                ${monthlyLimitUsd === 0 ? '<br><small class="text-muted">Completa tu verificación KYC para obtener límites transaccionales.</small>' : ''}
                ${monthRangeText ? `<br><small class="text-muted" style="font-style: italic; margin-top: 8px; display: block;">* Los límites se expresan en moneda fiat (USD). El valor consumido se calcula mediante la conversión en tiempo real de los depósitos en criptomonedas a su equivalente en dólares estadounidenses.</small>` : ''}
            </p>
        </div>
    `;

    // ========== CARD DE BIDISAN - AHORRO COLABORATIVO ==========
    // Lógica: 
    // - Nivel < L3 (L0, L1, L2): No disponible (Bloqueado)
    // - Nivel >= L3 (L3, L4): Disponible (Habilitado)

    const levelNum = getLevelNumber(currentLevel);
    let bidisanHtml = '';

    if (levelNum < 3) {
        // NO DISPONIBLE - Estilo advertencia/bloqueo
        bidisanHtml = `
            <div class="transaction-limit-item" style="border-left-color: #dc3545; background: #fff5f5; margin-top: 20px;">
                <h5 style="color: #dc3545;"><i class="ri-forbid-2-line"></i> BidiSAN - Ahorro Colaborativo</h5>
                <div class="d-flex align-items-center mb-2">
                    <span class="badge bg-danger text-white" style="font-size: 0.9rem; padding: 6px 12px;">No Disponible</span>
                    <span class="ms-2 text-muted" style="font-size: 0.9rem; margin-left: 10px;">Requiere Nivel L3</span>
                </div>
                <p style="font-size: 0.9rem; color: #666; margin-bottom: 15px;">
                    Actualmente no puedes participar en grupos de ahorro colaborativo (BidiSAN).
                    Este producto es exclusivo para usuarios verificados con nivel <strong>L3</strong> o superior.
                </p>
                <button class="btn btn-sm btn-outline-danger" onclick="showUploadDocModal()">
                    <i class="ri-upload-cloud-line"></i> Subir Documentos para Upgrade
                </button>
            </div>
        `;
    } else {
        // DISPONIBLE - Estilo éxito
        bidisanHtml = `
            <div class="transaction-limit-item" style="border-left-color: #28a745; background: #f0fff4; margin-top: 20px;">
                <h5 style="color: #28a745;"><i class="ri-checkbox-circle-line"></i> BidiSAN - Ahorro Colaborativo</h5>
                <div class="d-flex align-items-center mb-2">
                    <span class="badge bg-success text-white" style="font-size: 0.9rem; padding: 6px 12px;">Habilitado</span>
                    <span class="ms-2 text-muted" style="font-size: 0.9rem; margin-left: 10px;">Acceso Completo</span>
                </div>
                <p style="font-size: 0.9rem; color: #666; margin-bottom: 15px;">
                    ¡Felicidades! Tu nivel KYC (${currentLevel}) te permite crear y unirte a grupos de ahorro colaborativo.
                    Comienza a ahorrar con tu comunidad hoy mismo.
                </p>
                <a href="/san" class="btn btn-sm btn-outline-success">
                    <i class="ri-group-line"></i> Ir a BidiSAN
                </a>
            </div>
        `;
    }

    // ========== CARD DE BIDIINVEST - INVERSIONES ==========
    // Lógica: 
    // - Nivel < L3 (L0, L1, L2): No disponible (Bloqueado)
    // - Nivel >= L3 (L3, L4): Disponible (Habilitado)

    let bidiinvestHtml = '';

    if (levelNum < 3) {
        // NO DISPONIBLE - Estilo advertencia/bloqueo
        bidiinvestHtml = `
            <div class="transaction-limit-item" style="border-left-color: #dc3545; background: #fff5f5; margin-top: 20px;">
                <h5 style="color: #dc3545;"><i class="ri-forbid-2-line"></i> BidiInvest - Recompensas de Staking</h5>
                <div class="d-flex align-items-center mb-2">
                    <span class="badge bg-danger text-white" style="font-size: 0.9rem; padding: 6px 12px;">No Disponible</span>
                    <span class="ms-2 text-muted" style="font-size: 0.9rem; margin-left: 10px;">Requiere Nivel L3</span>
                </div>
                <p style="font-size: 0.9rem; color: #666; margin-bottom: 15px;">
                    Actualmente no puedes participar en staking a plazo fijo (BidiInvest).
                    Este producto es exclusivo para usuarios verificados con nivel <strong>L3</strong> o superior.
                </p>
                <button class="btn btn-sm btn-outline-danger" onclick="showUploadDocModal()">
                    <i class="ri-upload-cloud-line"></i> Subir Documentos para Upgrade
                </button>
            </div>
        `;
    } else {
        // DISPONIBLE - Estilo éxito
        bidiinvestHtml = `
            <div class="transaction-limit-item" style="border-left-color: #10b981; background: #ecfdf5; margin-top: 20px;">
                <h5 style="color: #10b981;"><i class="ri-checkbox-circle-line"></i> BidiInvest - Recompensas de Staking</h5>
                <div class="d-flex align-items-center mb-2">
                    <span class="badge text-white" style="font-size: 0.9rem; padding: 6px 12px; background: #10b981;">Habilitado</span>
                    <span class="ms-2 text-muted" style="font-size: 0.9rem; margin-left: 10px;">Acceso Completo</span>
                </div>
                <p style="font-size: 0.9rem; color: #666; margin-bottom: 15px;">
                    ¡Felicidades! Tu nivel KYC (${currentLevel}) te permite participar en salas de staking a plazo fijo.
                    Obtén rendimientos garantizados sobre tu capital.
                </p>
                <a href="/invest" class="btn btn-sm" style="border: 1px solid #10b981; color: #10b981;">
                    <i class="ri-line-chart-line"></i> Ir a BidiInvest
                </a>
            </div>
        `;
    }

    // ========== CARD DE OTC EXPRESS - MERCADO OTC ==========
    // Lógica: Solo L4 puede participar como tomador/proveedor de liquidez
    // - Nivel < L4 (L0, L1, L2, L3): No disponible (Bloqueado)
    // - Nivel L4: Disponible (Habilitado)

    const otcPortalUrl = limitsData.otcPortalUrl || '';
    let otcExpressHtml = '';

    if (levelNum < 4) {
        // NO DISPONIBLE - Estilo advertencia/bloqueo
        otcExpressHtml = `
            <div class="transaction-limit-item" style="border-left-color: #dc3545; background: #fff5f5; margin-top: 20px;">
                <h5 style="color: #dc3545;"><i class="ri-forbid-2-line"></i> Mercado OTC Express - Genera Comisiones</h5>
                <div class="d-flex align-items-center mb-2">
                    <span class="badge bg-danger text-white" style="font-size: 0.9rem; padding: 6px 12px;">No Disponible</span>
                    <span class="ms-2 text-muted" style="font-size: 0.9rem; margin-left: 10px;">Requiere Nivel L4</span>
                </div>
                <p style="font-size: 0.9rem; color: #666; margin-bottom: 15px;">
                    Actualmente no puedes participar en el Mercado OTC Express como Proveedor de Liquidez.
                    Este servicio es exclusivo para usuarios verificados con nivel <strong>L4</strong>.
                </p>
                <button class="btn btn-sm btn-outline-danger" onclick="showUploadDocModal()">
                    <i class="ri-upload-cloud-line"></i> Subir Documentos para Upgrade
                </button>
            </div>
        `;
    } else {
        // DISPONIBLE - Estilo éxito (verde como BidiSAN y BidiInvest)
        const otcBtn = otcPortalUrl
            ? `<a href="${otcPortalUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-success"><i class="ri-external-link-line"></i> Ir a OTC Express</a>`
            : '<a href="/deposit" class="btn btn-sm btn-outline-success"><i class="ri-exchange-line"></i> Ver Depósito OTC</a>';
        otcExpressHtml = `
            <div class="transaction-limit-item" style="border-left-color: #28a745; background: #f0fff4; margin-top: 20px;">
                <h5 style="color: #28a745;"><i class="ri-checkbox-circle-line"></i> Mercado OTC Express - Genera Comisiones</h5>
                <div class="d-flex align-items-center mb-2">
                    <span class="badge bg-success text-white" style="font-size: 0.9rem; padding: 6px 12px;">Habilitado</span>
                    <span class="ms-2 text-muted" style="font-size: 0.9rem; margin-left: 10px;">Acceso Completo</span>
                </div>
                <p style="font-size: 0.9rem; color: #666; margin-bottom: 15px;">
                    ¡Felicidades! Tu nivel KYC (${currentLevel}) te permite participar en el mercado OTC Express.
                    Obtén comisiones a tasas preferenciales.
                </p>
                ${otcBtn}
            </div>
        `;
    }

    // Agregar al HTML final
    html += bidisanHtml;
    html += bidiinvestHtml;
    html += otcExpressHtml;

    container.innerHTML = html;
}

/**
 * Visualiza un documento en un modal (imagen o PDF)
 */
function viewDocument(storagePath, documentName) {
    const modal = document.getElementById('viewDocumentModal');
    const modalTitle = document.getElementById('viewDocumentTitle');
    const modalBody = document.getElementById('viewDocumentBody');

    modalTitle.textContent = documentName || 'Visualizar Documento';
    modalBody.innerHTML = '<div class="text-center"><i class="ri-loader-4-line" style="font-size: 2rem; animation: spin 1s linear infinite;"></i><p>Cargando documento...</p></div>';
    modal.classList.add('show');

    // Detectar si es PDF o imagen
    const isPDF = storagePath.toLowerCase().endsWith('.pdf') || storagePath.toLowerCase().includes('pdf');
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(storagePath);

    if (isPDF) {
        // Cargar PDF usando PDF.js
        loadPDF(storagePath, modalBody);
    } else if (isImage) {
        // Mostrar imagen directamente
        modalBody.innerHTML = `<img src="${storagePath}" alt="${documentName}" onerror="this.parentElement.innerHTML='<p class=\'text-danger\'>Error al cargar la imagen. Por favor, intenta nuevamente.</p>'">`;
    } else {
        // Intentar mostrar como imagen, si falla mostrar enlace
        modalBody.innerHTML = `
            <div class="text-center">
                <p>No se puede previsualizar este tipo de archivo.</p>
                <a href="${storagePath}" target="_blank" class="btn btn-primary">
                    <i class="ri-download-line"></i> Descargar Documento
                </a>
            </div>
        `;
    }
}

/**
 * Carga y muestra un PDF usando PDF.js
 */
function loadPDF(pdfPath, container) {
    // Configurar PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        pdfjsLib.getDocument(pdfPath).promise.then(function (pdf) {
            // Renderizar primera página
            pdf.getPage(1).then(function (page) {
                const scale = 1.5;
                const viewport = page.getViewport({ scale: scale });

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                container.innerHTML = '';
                container.appendChild(canvas);

                const renderContext = {
                    canvasContext: context,
                    viewport: viewport
                };

                page.render(renderContext).promise.then(function () {
                    // Si hay más páginas, agregar controles de navegación
                    if (pdf.numPages > 1) {
                        let currentPage = 1;
                        const controls = document.createElement('div');
                        controls.className = 'text-center mt-3';
                        controls.innerHTML = `
                            <button class="btn btn-sm btn-outline-secondary" onclick="changePDFPage(${currentPage - 1}, ${pdf.numPages}, '${pdfPath}', '${container.id}')" id="prevPageBtn" ${currentPage === 1 ? 'disabled' : ''}>
                                <i class="ri-arrow-left-line"></i> Anterior
                            </button>
                            <span class="mx-3">Página ${currentPage} de ${pdf.numPages}</span>
                            <button class="btn btn-sm btn-outline-secondary" onclick="changePDFPage(${currentPage + 1}, ${pdf.numPages}, '${pdfPath}', '${container.id}')" id="nextPageBtn" ${currentPage === pdf.numPages ? 'disabled' : ''}>
                                Siguiente <i class="ri-arrow-right-line"></i>
                            </button>
                        `;
                        container.appendChild(controls);
                    }
                });
            });
        }).catch(function (error) {
            container.innerHTML = `
                <div class="text-center">
                    <p class="text-danger">Error al cargar el PDF: ${error.message}</p>
                    <a href="${pdfPath}" target="_blank" class="btn btn-primary">
                        <i class="ri-download-line"></i> Descargar PDF
                    </a>
                </div>
            `;
        });
    } else {
        container.innerHTML = `
            <div class="text-center">
                <p class="text-danger">Error: PDF.js no está cargado correctamente.</p>
                <a href="${pdfPath}" target="_blank" class="btn btn-primary">
                    <i class="ri-download-line"></i> Descargar PDF
                </a>
            </div>
        `;
    }
}

/**
 * Cambia la página del PDF
 */
function changePDFPage(pageNum, totalPages, pdfPath, containerId) {
    if (pageNum < 1 || pageNum > totalPages) return;

    const container = document.getElementById(containerId);
    loadPDF(pdfPath, container);

    // Actualizar controles de navegación
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const pageInfo = container.querySelector('span');

    if (prevBtn) prevBtn.disabled = pageNum === 1;
    if (nextBtn) nextBtn.disabled = pageNum === totalPages;
    if (pageInfo) pageInfo.textContent = `Página ${pageNum} de ${totalPages}`;
}

// Cerrar modal al hacer clic en el botón de cerrar
document.addEventListener('DOMContentLoaded', function () {
    const closeBtn = document.getElementById('closeViewDocumentBtn');
    const modal = document.getElementById('viewDocumentModal');

    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            modal.classList.remove('show');
        });
    }

    // Cerrar modal al hacer clic fuera del contenido
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    }

    // Cerrar modal con ESC
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal && modal.classList.contains('show')) {
            modal.classList.remove('show');
        }
    });
});

/* ==========================================
   Lógica de Cambio de Contraseña
   ========================================== */

function showChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) modal.classList.add('show');
}

function hideChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
        modal.classList.remove('show');
        const form = document.getElementById('changePasswordForm');
        if (form) form.reset();

        const errorDiv = document.getElementById('changePasswordError');
        const successDiv = document.getElementById('changePasswordSuccess');
        const submitBtn = document.getElementById('submitChangePasswordBtn');

        if (errorDiv) errorDiv.style.display = 'none';
        if (successDiv) successDiv.style.display = 'none';
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Solicitar Cambio';
        }
    }
}

document.addEventListener('DOMContentLoaded', function () {
    // Cerrar modal al hacer clic fuera
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) hideChangePasswordModal();
        });
    }

    const form = document.getElementById('changePasswordForm');
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            const newPass = document.getElementById('newPassword').value;
            const confirmPass = document.getElementById('confirmPassword').value;
            const errorDiv = document.getElementById('changePasswordError');
            const successDiv = document.getElementById('changePasswordSuccess');
            const submitBtn = document.getElementById('submitChangePasswordBtn');

            errorDiv.style.display = 'none';
            successDiv.style.display = 'none';

            if (newPass.length < 8) {
                errorDiv.textContent = 'La contraseña debe tener al menos 8 caracteres.';
                errorDiv.style.display = 'block';
                return;
            }

            if (newPass !== confirmPass) {
                errorDiv.textContent = 'Las contraseñas no coinciden.';
                errorDiv.style.display = 'block';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Enviando...';

            try {
                const accessToken = localStorage.getItem('accessToken');
                if (!accessToken) {
                    window.location.href = '/login';
                    return;
                }

                const response = await fetch('/api/auth/change-password/request', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({ newPassword: newPass })
                });

                const data = await response.json();

                if (response.ok) {
                    successDiv.textContent = data.message;
                    successDiv.style.display = 'block';
                    form.reset();
                    submitBtn.textContent = 'Enviado';

                    // Opcional: Cerrar modal después de unos segundos
                    setTimeout(() => {
                        hideChangePasswordModal();
                        // Actualizar botón a estado pendiente
                        updateChangePasswordButton(true);
                    }, 3000);
                } else {
                    errorDiv.textContent = data.message || data.error || 'Error al solicitar cambio.';
                    errorDiv.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Solicitar Cambio';
                }
            } catch (error) {
                console.error(error);
                errorDiv.textContent = 'Error de conexión.';
                errorDiv.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Solicitar Cambio';
            }
        });
    }
});

/**
 * Actualiza el estado del botón de cambio de contraseña según si hay una solicitud pendiente
 */
function updateChangePasswordButton(hasPending) {
    const btn = document.getElementById('btnOpenChangePasswordModal');
    const btnText = document.getElementById('btnChangePasswordText');

    if (btn && btnText) {
        if (hasPending) {
            btn.disabled = true;
            btn.classList.add('disabled');
            btnText.textContent = 'Solicitud Pendiente';
            btn.title = 'Ya has solicitado un cambio. Revisa tu correo o espera 15 minutos.';
        } else {
            btn.disabled = false;
            btn.classList.remove('disabled');
            btnText.textContent = 'Cambiar Contraseña';
            btn.title = '';
        }
    }
}

