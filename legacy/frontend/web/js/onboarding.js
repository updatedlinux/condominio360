/**
 * Modal de Onboarding Obligatorio
 * 
 * Este modal se muestra cuando el usuario necesita completar su perfil o verificar su email.
 * La lógica decide qué paso mostrar según el estado KYC y los datos del perfil.
 */

// Lista completa de países
const COUNTRIES = [
  'Afganistán', 'Albania', 'Alemania', 'Andorra', 'Angola', 'Antigua y Barbuda', 'Arabia Saudí',
  'Argelia', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaiyán', 'Bahamas', 'Bangladés',
  'Barbados', 'Baréin', 'Bélgica', 'Belice', 'Benín', 'Bielorrusia', 'Birmania', 'Bolivia',
  'Bosnia y Herzegovina', 'Botsuana', 'Brasil', 'Brunéi', 'Bulgaria', 'Burkina Faso', 'Burundi',
  'Bután', 'Cabo Verde', 'Camboya', 'Camerún', 'Canadá', 'Catar', 'Chad', 'Chile', 'China',
  'Chipre', 'Ciudad del Vaticano', 'Colombia', 'Comoras', 'Corea del Norte', 'Corea del Sur',
  'Costa de Marfil', 'Costa Rica', 'Croacia', 'Cuba', 'Dinamarca', 'Dominica', 'Ecuador',
  'Egipto', 'El Salvador', 'Emiratos Árabes Unidos', 'Eritrea', 'Eslovaquia', 'Eslovenia',
  'España', 'Estados Unidos', 'Estonia', 'Esuatini', 'Etiopía', 'Filipinas', 'Finlandia',
  'Fiyi', 'Francia', 'Gabón', 'Gambia', 'Georgia', 'Ghana', 'Granada', 'Grecia', 'Guatemala',
  'Guinea', 'Guinea-Bisáu', 'Guinea Ecuatorial', 'Guyana', 'Haití', 'Honduras', 'Hungría',
  'India', 'Indonesia', 'Irak', 'Irán', 'Irlanda', 'Islandia', 'Islas Marshall', 'Islas Salomón',
  'Israel', 'Italia', 'Jamaica', 'Japón', 'Jordania', 'Kazajistán', 'Kenia', 'Kirguistán',
  'Kiribati', 'Kuwait', 'Laos', 'Lesoto', 'Letonia', 'Líbano', 'Liberia', 'Libia', 'Liechtenstein',
  'Lituania', 'Luxemburgo', 'Macedonia del Norte', 'Madagascar', 'Malasia', 'Malaui', 'Maldivas',
  'Malí', 'Malta', 'Marruecos', 'Mauricio', 'Mauritania', 'México', 'Micronesia', 'Moldavia',
  'Mónaco', 'Mongolia', 'Montenegro', 'Mozambique', 'Namibia', 'Nauru', 'Nepal', 'Nicaragua',
  'Níger', 'Nigeria', 'Noruega', 'Nueva Zelanda', 'Omán', 'Países Bajos', 'Pakistán', 'Palaos',
  'Palestina', 'Panamá', 'Papúa Nueva Guinea', 'Paraguay', 'Perú', 'Polonia', 'Portugal',
  'Reino Unido', 'República Centroafricana', 'República Checa', 'República del Congo',
  'República Democrática del Congo', 'República Dominicana', 'Ruanda', 'Rumania', 'Rusia',
  'Samoa', 'San Cristóbal y Nieves', 'San Marino', 'San Vicente y las Granadinas', 'Santa Lucía',
  'Santo Tomé y Príncipe', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leona', 'Singapur',
  'Siria', 'Somalia', 'Sri Lanka', 'Sudáfrica', 'Sudán', 'Sudán del Sur', 'Suecia', 'Suiza',
  'Surinam', 'Tailandia', 'Tanzania', 'Tayikistán', 'Timor Oriental', 'Togo', 'Tonga',
  'Trinidad y Tobago', 'Túnez', 'Turkmenistán', 'Turquía', 'Tuvalu', 'Ucrania', 'Uganda',
  'Uruguay', 'Uzbekistán', 'Vanuatu', 'Venezuela', 'Vietnam', 'Yemen', 'Yibuti', 'Zambia', 'Zimbabue'
];

class OnboardingModal {
  constructor() {
    this.currentStep = 1;
    this.totalSteps = 2;
    this.modal = null;
    this.dashboardData = null; // Almacenar datos del dashboard
    this.pendingProfile = null; // Perfil pendiente para pre-llenar
    this.init();
  }

  init() {
    // Crear estructura del modal
    this.createModal();
    // Agregar event listeners
    this.attachEventListeners();
  }

  createModal() {
    // Generar opciones de países
    const countryOptions = COUNTRIES.map(country => 
      `<option value="${country}">${country}</option>`
    ).join('');

    const modalHTML = `
      <div class="onboarding-modal-overlay" id="onboardingModal" style="display: none;">
        <div class="onboarding-modal-container">
          <div class="onboarding-modal-header">
            <h3>Completa tu Perfil</h3>
            <div class="onboarding-progress">
              <span id="onboardingStepIndicator">Paso ${this.currentStep} de ${this.totalSteps}</span>
            </div>
          </div>
          
          <div class="onboarding-modal-body">
            <!-- Paso 1: Datos de Perfil -->
            <div class="onboarding-step" id="step1" data-step="1">
              <h4>Datos Personales</h4>
              <p class="text-muted">Por favor, completa tu información personal para continuar.</p>
              
              <form id="profileForm">
                <div class="row">
                  <div class="col-md-6 mb-3">
                    <label for="firstName" class="form-label">Nombre <span class="text-danger">*</span></label>
                    <input type="text" class="form-control" id="firstName" name="firstName" required>
                    <div class="invalid-feedback"></div>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label for="lastName" class="form-label">Apellido <span class="text-danger">*</span></label>
                    <input type="text" class="form-control" id="lastName" name="lastName" required>
                    <div class="invalid-feedback"></div>
                  </div>
                </div>
                
                <div class="mb-3">
                  <label for="dateOfBirth" class="form-label">Fecha de Nacimiento <span class="text-danger">*</span></label>
                  <input type="date" class="form-control" id="dateOfBirth" name="dateOfBirth" required>
                  <div class="invalid-feedback"></div>
                </div>
                
                <div class="row">
                  <div class="col-md-4 mb-3">
                    <label for="country" class="form-label">País <span class="text-danger">*</span></label>
                    <select class="form-control" id="country" name="country" required>
                      <option value="">Selecciona un país</option>
                      ${countryOptions}
                    </select>
                    <div class="invalid-feedback"></div>
                  </div>
                  
                  <div class="col-md-4 mb-3">
                    <label for="state" class="form-label">Estado <span class="text-danger">*</span></label>
                    <input type="text" class="form-control" id="state" name="state" required>
                    <div class="invalid-feedback"></div>
                  </div>
                  
                  <div class="col-md-4 mb-3">
                    <label for="city" class="form-label">Ciudad <span class="text-danger">*</span></label>
                    <input type="text" class="form-control" id="city" name="city" required>
                    <div class="invalid-feedback"></div>
                  </div>
                </div>
                
                <div class="mb-3">
                  <label for="addressLine1" class="form-label">Dirección Línea 1 <span class="text-danger">*</span></label>
                  <input type="text" class="form-control" id="addressLine1" name="addressLine1" required>
                  <div class="invalid-feedback"></div>
                </div>
                
                <div class="mb-3">
                  <label for="addressLine2" class="form-label">Dirección Línea 2</label>
                  <input type="text" class="form-control" id="addressLine2" name="addressLine2">
                </div>
                
                <div class="row">
                  <div class="col-md-6 mb-3">
                    <label for="zipCode" class="form-label">Código Postal</label>
                    <input type="text" class="form-control" id="zipCode" name="zipCode">
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label for="nationalIdNumber" class="form-label">Documento ID Nacional <span class="text-danger">*</span></label>
                    <input type="text" class="form-control" id="nationalIdNumber" name="nationalIdNumber" required>
                    <div class="invalid-feedback"></div>
                  </div>
                </div>
                
                <div class="alert alert-danger" id="profileFormError" style="display: none;"></div>
                
                <div class="onboarding-modal-footer">
                  <button type="submit" class="btn btn-primary" id="saveProfileBtn">
                    Guardar y Continuar
                  </button>
                </div>
              </form>
            </div>
            
            <!-- Paso 2: Verificación de Email -->
            <div class="onboarding-step" id="step2" data-step="2" style="display: none;">
              <h4>Verificación de Email</h4>
              <p class="text-muted" id="emailVerificationMessage">
                Hemos enviado un correo de verificación. Por favor, revisa tu bandeja de entrada (incluyendo Spam) y haz clic en el enlace de verificación.
              </p>
              
              <div class="alert alert-info">
                <i class="ri-mail-line"></i> 
                <span id="userEmailDisplay"></span>
              </div>
              
              <div id="emailVerificationContent">
                <div class="alert alert-danger" id="emailVerificationError" style="display: none;"></div>
                <div class="alert alert-success" id="emailVerificationSuccess" style="display: none;"></div>
                
                <div class="onboarding-modal-footer">
                  <button type="button" class="btn btn-outline-secondary" id="resendEmailBtn">
                    <i class="ri-mail-send-line"></i> Reenviar Correo
                  </button>
                  <button type="button" class="btn btn-primary" id="checkVerificationBtn">
                    <i class="ri-checkbox-circle-line"></i> Ya validé mi correo
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Insertar modal en el body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('onboardingModal');
    
    // Asegurarse de que el modal esté oculto al crearse
    if (this.modal) {
      this.modal.style.display = 'none';
    }
    
    // Prevenir cierre del modal
    this.preventModalClose();
  }

  preventModalClose() {
    // Prevenir cierre con ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal && this.modal.style.display !== 'none') {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    
    // Prevenir cierre haciendo clic fuera
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  attachEventListeners() {
    // Formulario de perfil
    document.getElementById('profileForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveProfile();
    });
    
    // Botón reenviar correo
    document.getElementById('resendEmailBtn').addEventListener('click', () => {
      this.resendVerificationEmail();
    });
    
    // Botón "Ya validé mi correo"
    document.getElementById('checkVerificationBtn').addEventListener('click', () => {
      this.checkEmailVerification();
    });
  }

  /**
   * Decide qué paso mostrar según el estado KYC y los datos del perfil
   * @param {Object} dashboardData - Datos del GET /api/me/kyc-dashboard
   */
  determineInitialStep(dashboardData) {
    this.dashboardData = dashboardData;
    const { kycStatus, profile } = dashboardData;
    const currentLevel = kycStatus.currentLevel;
    const emailVerified = kycStatus.emailVerified;
    
    // Verificar si el perfil está completo
    const profileComplete = !!(profile && 
      profile.firstName && 
      profile.lastName && 
      profile.dateOfBirth && 
      profile.country && 
      profile.state && 
      profile.city && 
      profile.addressLine1 && 
      profile.nationalIdNumber);

    // Si el perfil está completo Y el email está verificado, NO mostrar modal
    if (profileComplete && emailVerified && (currentLevel === 'L1' || this.getLevelNumber(currentLevel) > 1)) {
      return null; // No mostrar modal
    }

    // Caso a) Email YA verificado (L1+) y perfil incompleto
    if ((currentLevel === 'L1' || this.getLevelNumber(currentLevel) > 1) && !profileComplete) {
      // Solo mostrar Paso 1 (datos personales)
      this.currentStep = 1;
      this.totalSteps = 1; // Solo un paso necesario
      // Guardar profile para pre-llenar después
      this.pendingProfile = profile;
      return 1;
    }

    // Caso b) Email NO verificado (NONE) pero perfil completo
    if (currentLevel === 'NONE' && profileComplete && !emailVerified) {
      // Saltar directamente al Paso 2 (verificación de email)
      this.currentStep = 2;
      this.totalSteps = 1; // Solo un paso necesario
      return 2;
    }

    // Caso c) Usuario completamente nuevo (NONE y perfil vacío)
    if (currentLevel === 'NONE' && !profileComplete) {
      // Empezar en Paso 1
      this.currentStep = 1;
      this.totalSteps = 2;
      // Guardar profile para pre-llenar después
      this.pendingProfile = profile;
      return 1;
    }

    // Por defecto, no mostrar modal
    return null;
  }

  getLevelNumber(level) {
    const levels = { 'NONE': 0, 'L1': 1, 'L2': 2, 'L3': 3, 'L4': 4 };
    return levels[level] || 0;
  }

  show(initialStep = null) {
    if (this.modal) {
      this.modal.style.display = 'flex';
      this.modal.classList.add('show');
      
      // Actualizar indicador de pasos
      document.getElementById('onboardingStepIndicator').textContent = 
        `Paso ${this.currentStep} de ${this.totalSteps}`;
      
      // Si se especifica un paso inicial, ir a ese paso
      if (initialStep) {
        this.goToStep(initialStep);
      }
      
      // Usar setTimeout para asegurar que el DOM esté listo
      setTimeout(() => {
        // Si estamos en el paso 1, pre-llenar con datos del dashboard o desde la API
        if (this.currentStep === 1) {
          // Primero intentar con datos del dashboard si están disponibles
          if (this.pendingProfile) {
            this.prefillProfile(this.pendingProfile);
            this.pendingProfile = null;
          } else if (this.dashboardData && this.dashboardData.profile) {
            this.prefillProfile(this.dashboardData.profile);
          } else {
            // Si no hay datos del dashboard, cargar desde la API
            this.prefillProfileFromAPI();
          }
        }
        
        // Si estamos en el paso 2, cargar email y enviar verificación
        if (this.currentStep === 2) {
          this.loadUserEmail().then(() => {
            this.resendVerificationEmail();
          });
        }
      }, 100);
    }
  }

  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
      this.modal.classList.remove('show');
    }
  }

  goToStep(step) {
    // Ocultar todos los pasos
    document.querySelectorAll('.onboarding-step').forEach(stepEl => {
      stepEl.style.display = 'none';
    });
    
    // Mostrar paso actual
    const stepElement = document.getElementById(`step${step}`);
    if (stepElement) {
      stepElement.style.display = 'block';
      this.currentStep = step;
      document.getElementById('onboardingStepIndicator').textContent = `Paso ${step} de ${this.totalSteps}`;
    }
  }

  async saveProfile() {
    const form = document.getElementById('profileForm');
    const errorDiv = document.getElementById('profileFormError');
    const saveBtn = document.getElementById('saveProfileBtn');
    
    // Validar formulario
    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      return;
    }
    
    // Obtener datos del formulario
    const formData = {
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      dateOfBirth: document.getElementById('dateOfBirth').value,
      country: document.getElementById('country').value,
      state: document.getElementById('state').value.trim(),
      city: document.getElementById('city').value.trim(),
      addressLine1: document.getElementById('addressLine1').value.trim(),
      addressLine2: document.getElementById('addressLine2').value.trim(),
      zipCode: document.getElementById('zipCode').value.trim(),
      nationalIdNumber: document.getElementById('nationalIdNumber').value.trim(),
    };
    
    // Deshabilitar botón
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    errorDiv.style.display = 'none';
    
    try {
      const accessToken = localStorage.getItem('accessToken');
      if (!accessToken) {
        throw new Error('No hay sesión activa');
      }
      
      const response = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      
      if (response.ok) {
        // Verificar si el email ya está verificado
        // Si es así, cerrar el modal directamente
        // Si no, pasar al paso 2
        const dashboardResponse = await fetch('/api/me/kyc-dashboard', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (dashboardResponse.ok) {
          const dashboardData = await dashboardResponse.json();
          const emailVerified = dashboardData.kycStatus.emailVerified;
          const currentLevel = dashboardData.kycStatus.currentLevel;
          
          // Verificar también si el perfil está completo
          const profile = dashboardData.profile || {};
          const profileComplete = profile.firstName && 
            profile.lastName && 
            profile.dateOfBirth && 
            profile.country && 
            profile.state && 
            profile.city && 
            profile.addressLine1 && 
            profile.nationalIdNumber;
          
          // Si el email ya está verificado (L1+) Y el perfil está completo, cerrar modal
          if (emailVerified && profileComplete && (currentLevel === 'L1' || this.getLevelNumber(currentLevel) > 1)) {
            // Cerrar modal inmediatamente
            this.hide();
            const dashboardMain = document.getElementById('dashboardMain');
            if (dashboardMain) {
              dashboardMain.style.filter = 'none';
            }
            // Recargar dashboard sin mostrar modal
            window.location.reload();
            return;
          }
          
          // Si el email NO está verificado, pasar al paso 2
          if (!emailVerified) {
            this.totalSteps = 2;
            this.goToStep(2);
            await this.loadUserEmail();
            await this.resendVerificationEmail();
          } else {
            // Email verificado pero perfil incompleto (no debería pasar, pero por si acaso)
            this.hide();
            const dashboardMain = document.getElementById('dashboardMain');
            if (dashboardMain) {
              dashboardMain.style.filter = 'none';
            }
            window.location.reload();
          }
        }
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al guardar el perfil');
      }
    } catch (error) {
      errorDiv.textContent = error.message || 'Error al guardar el perfil. Por favor, intenta nuevamente.';
      errorDiv.style.display = 'block';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar y Continuar';
    }
  }

  async loadUserEmail() {
    try {
      const accessToken = localStorage.getItem('accessToken');
      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const email = data.user?.email || '';
        document.getElementById('userEmailDisplay').textContent = email;
        document.getElementById('emailVerificationMessage').innerHTML = 
          `Hemos enviado un correo de verificación a <strong>${email}</strong>. Por favor, revisa tu bandeja de entrada (incluyendo Spam) y haz clic en el enlace de verificación.`;
      }
      } catch (error) {
        // Error silencioso al cargar email
      }
  }

  async resendVerificationEmail() {
    const resendBtn = document.getElementById('resendEmailBtn');
    const successDiv = document.getElementById('emailVerificationSuccess');
    const errorDiv = document.getElementById('emailVerificationError');
    
    if (resendBtn.dataset.verified === 'true') return;
    
    resendBtn.disabled = true;
    resendBtn.innerHTML = '<i class="ri-loader-4-line"></i> Enviando...';
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    try {
      const accessToken = localStorage.getItem('accessToken');
      if (!accessToken) {
        throw new Error('No hay sesión activa');
      }
      
      const response = await fetch('/api/auth/send-email-verification', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        successDiv.textContent = 'Correo de verificación enviado. Revisa tu bandeja de entrada (incluyendo Spam).';
        successDiv.style.display = 'block';
        this.startResendCooldown(60);
      } else {
        const errorData = await response.json();
        if (errorData.emailAlreadyVerified) {
          successDiv.textContent = 'Tu correo ya está verificado.';
          successDiv.style.display = 'block';
          resendBtn.disabled = true;
          resendBtn.dataset.verified = 'true';
          resendBtn.innerHTML = '<i class="ri-checkbox-circle-line"></i> Correo verificado';
          return;
        } else {
          throw new Error(errorData.message || 'Error al enviar el correo de verificación');
        }
      }
    } catch (error) {
      errorDiv.textContent = error.message || 'Error al reenviar el correo. Por favor, intenta nuevamente.';
      errorDiv.style.display = 'block';
      resendBtn.disabled = false;
      resendBtn.innerHTML = '<i class="ri-mail-send-line"></i> Reenviar Correo';
    }
  }

  startResendCooldown(seconds) {
    const resendBtn = document.getElementById('resendEmailBtn');
    if (!resendBtn || resendBtn.dataset.verified === 'true') return;
    let remaining = seconds;
    const updateBtn = () => {
      if (remaining <= 0) {
        resendBtn.disabled = false;
        resendBtn.innerHTML = '<i class="ri-mail-send-line"></i> Reenviar Correo';
        return;
      }
      resendBtn.disabled = true;
      resendBtn.innerHTML = '<i class="ri-time-line"></i> Reenviar en ' + remaining + ' s';
      remaining--;
      setTimeout(updateBtn, 1000);
    };
    updateBtn();
  }

  /**
   * Verifica si el email ya fue verificado consultando el servidor
   */
  async checkEmailVerification() {
    const checkBtn = document.getElementById('checkVerificationBtn');
    const errorDiv = document.getElementById('emailVerificationError');
    const successDiv = document.getElementById('emailVerificationSuccess');
    
    checkBtn.disabled = true;
    checkBtn.innerHTML = '<i class="ri-loader-4-line"></i> Verificando...';
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    try {
      const accessToken = localStorage.getItem('accessToken');
      if (!accessToken) {
        throw new Error('No hay sesión activa');
      }
      
      const response = await fetch('/api/me/kyc-dashboard', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const dashboardData = await response.json();
        const emailVerified = dashboardData.kycStatus.emailVerified;
        const currentLevel = dashboardData.kycStatus.currentLevel;
        
        if (emailVerified && (currentLevel === 'L1' || this.getLevelNumber(currentLevel) > 1)) {
          // Email verificado exitosamente
          successDiv.innerHTML = '<i class="ri-checkbox-circle-fill" style="color: #28a745; font-size: 1.5rem;"></i> ¡Email verificado exitosamente!';
          successDiv.style.display = 'block';
          
          // Inhabilitar reenvío permanentemente (ya verificado)
          const resendBtn = document.getElementById('resendEmailBtn');
          if (resendBtn) {
            resendBtn.disabled = true;
            resendBtn.dataset.verified = 'true';
            resendBtn.innerHTML = '<i class="ri-checkbox-circle-line"></i> Correo verificado';
          }
          
          // Habilitar botón de cerrar (que ahora es el mismo botón)
          checkBtn.innerHTML = '<i class="ri-checkbox-circle-line"></i> Cerrar';
          checkBtn.onclick = () => {
            this.hide();
            const dashboardMain = document.getElementById('dashboardMain');
            if (dashboardMain) {
              dashboardMain.style.filter = 'none';
            }
            window.location.reload();
          };
        } else {
          // Aún no está verificado
          errorDiv.textContent = 'Aún no detectamos la verificación. Por favor, revisa tu correo o espera unos segundos.';
          errorDiv.style.display = 'block';
        }
      } else {
        throw new Error('Error al verificar el estado');
      }
    } catch (error) {
      errorDiv.textContent = error.message || 'Error al verificar. Por favor, intenta nuevamente.';
      errorDiv.style.display = 'block';
    } finally {
      if (!successDiv.style.display || successDiv.style.display === 'none') {
        checkBtn.disabled = false;
        checkBtn.innerHTML = '<i class="ri-checkbox-circle-line"></i> Ya validé mi correo';
      }
    }
  }

  /**
   * Pre-llenar datos del perfil desde la API
   */
  async prefillProfileFromAPI() {
    try {
      const accessToken = localStorage.getItem('accessToken');
      if (!accessToken) {
        return;
      }
      
      const response = await fetch('/api/me/profile', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.profile) {
          this.prefillProfile(data.profile);
        }
      }
      } catch (error) {
        // Error silencioso al cargar perfil
      }
  }

  /**
   * Pre-cargar datos del perfil si ya existen
   */
  prefillProfile(profileData) {
    if (!profileData) {
      return;
    }
    
    try {
      const firstNameEl = document.getElementById('firstName');
      const lastNameEl = document.getElementById('lastName');
      const dateOfBirthEl = document.getElementById('dateOfBirth');
      const countryEl = document.getElementById('country');
      const stateEl = document.getElementById('state');
      const cityEl = document.getElementById('city');
      const addressLine1El = document.getElementById('addressLine1');
      const addressLine2El = document.getElementById('addressLine2');
      const zipCodeEl = document.getElementById('zipCode');
      const nationalIdNumberEl = document.getElementById('nationalIdNumber');
      
      if (firstNameEl && profileData.firstName) {
        firstNameEl.value = profileData.firstName;
      }
      if (lastNameEl && profileData.lastName) {
        lastNameEl.value = profileData.lastName;
      }
      
      if (dateOfBirthEl && profileData.dateOfBirth) {
        // Asegurar formato YYYY-MM-DD
        const date = new Date(profileData.dateOfBirth);
        if (!isNaN(date.getTime())) {
          dateOfBirthEl.value = date.toISOString().split('T')[0];
        }
      }
      
      if (countryEl && profileData.country) {
        countryEl.value = profileData.country;
      }
      
      if (stateEl && profileData.state) {
        stateEl.value = profileData.state;
      }
      if (cityEl && profileData.city) {
        cityEl.value = profileData.city;
      }
      if (addressLine1El && profileData.addressLine1) {
        addressLine1El.value = profileData.addressLine1;
      }
      if (addressLine2El) {
        addressLine2El.value = profileData.addressLine2 || '';
      }
      if (zipCodeEl) {
        zipCodeEl.value = profileData.zipCode || '';
      }
      if (nationalIdNumberEl && profileData.nationalIdNumber) {
        nationalIdNumberEl.value = profileData.nationalIdNumber;
      }
    } catch (error) {
      // Error silencioso al pre-llenar perfil
    }
  }
}

// Exportar para uso global
window.OnboardingModal = OnboardingModal;
