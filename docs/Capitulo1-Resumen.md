# ✅ CAPÍTULO 1: AUTENTICACIÓN Y GESTIÓN DE USUARIOS - COMPLETADO

## 📅 Fecha: Marzo 2026

---

## 🎯 Resumen Ejecutivo

Sistema de autenticación dual implementado, soportando tres tipos de usuarios: Propietarios, Administradores de Junta y Superadmins del SaaS. Incluye flujo completo de invitaciones, recuperación de contraseña y selección de unidades.

---

## 📦 Entregables Completados

### 1. Servicios Creados

#### EmailService (`src/services/EmailService.js`)
- Configuración SMTP dinámica
- Envío de invitaciones a propietarios
- Envío de credenciales a admins de junta
- Recuperación de contraseña
- Modo desarrollo (muestra emails en consola)

**Plantillas incluidas:**
- `sendOwnerInvitation()` - Invitación a propietarios
- `sendAdminCredentials()` - Credenciales admin junta
- `sendPasswordReset()` - Recuperación de contraseña
- `sendPasswordChanged()` - Confirmación de cambio

#### AuthService (`src/services/AuthService.js`)
Lógica completa de autenticación:

**Métodos de Login:**
- `loginOwner(email, password)` - Propietarios
- `loginTenantAdmin(email, password)` - Admins de Junta
- `loginSuperAdmin(email, password)` - Superadmins

**Gestión de Invitaciones:**
- `inviteOwner(ownerData, tenantId, propertyId, invitedBy)`
  - Busca por DNI (reutiliza usuario si existe)
  - Genera token de invitación
  - Envía email
  - Asocia a unidad

- `completeRegistration(token, password, email)`
  - Valida token (expira en 7 días)
  - Establece contraseña
  - Cambia estado a ACTIVE

**Recuperación de Contraseña:**
- `requestPasswordReset(email, type)`
- `verifyResetToken(token)`
- `resetPassword(token, newPassword)`
- Tabla PasswordResets con expiración de 1 hora

**Utilidades:**
- `selectProperty(userId, propertyId)` - Cambiar unidad activa
- `changePassword(userId, type, current, new)` - Cambio de contraseña

---

### 2. Middleware de Autenticación (`src/middleware/auth.js`)

**Middlewares disponibles:**

| Middleware | Descripción |
|------------|-------------|
| `authenticate` | Verifica JWT token |
| `requireOwner` | Solo propietarios |
| `requireTenantAdmin` | Solo admins de junta |
| `requireSuperAdmin` | Solo superadmins |
| `requireTenantAccess` | Verifica acceso al tenant |
| `requireRole(...roles)` | Verifica rol específico |
| `requirePropertyAccess` | Verifica acceso a unidad |
| `optionalAuth` | Auth opcional |

**Características:**
- Soporte para tokens "scoped" a propiedad
- Verificación de tenant automática
- Manejo de errores con códigos específicos

---

### 3. Controlador de Autenticación (`src/controllers/AuthController.js`)

**Endpoints implementados:**

#### Login
- `POST /api/auth/login` - Login unificado (detecta tipo)
- `POST /api/auth/login/owner` - Login propietario
- `POST /api/auth/login/admin` - Login admin junta
- `POST /api/auth/login/superadmin` - Login superadmin

#### Registro/Invitaciones
- `POST /api/auth/complete-registration` - Completar registro
- `GET /api/auth/verify-invitation?token=` - Verificar token

#### Recuperación de Contraseña
- `POST /api/auth/forgot-password` - Solicitar reset
- `GET /api/auth/verify-reset-token?token=` - Verificar token
- `POST /api/auth/reset-password` - Establecer nueva

#### Rutas Protegidas (requieren autenticación)
- `GET /api/auth/me` - Obtener datos del usuario
- `POST /api/auth/select-property` - Seleccionar unidad
- `POST /api/auth/change-password` - Cambiar contraseña
- `POST /api/auth/logout` - Cerrar sesión

---

### 4. Rutas (`src/routes/auth.js`)

Configuración de rutas con middlewares aplicados:

```javascript
/api/auth
├── POST /login                    # Público
├── POST /login/owner              # Público
├── POST /login/admin              # Público
├── POST /login/superadmin         # Público
├── POST /complete-registration    # Público
├── GET  /verify-invitation        # Público
├── POST /forgot-password          # Público
├── GET  /verify-reset-token       # Público
├── POST /reset-password           # Público
├── GET  /me                       # Autenticado
├── POST /select-property          # Propietario
├── POST /change-password          # Autenticado
└── POST /logout                   # Autenticado
```

---

### 5. Modelos Actualizados

#### UserModel
Nuevos métodos:
- `findById(id)` - Buscar por UUID
- `findByDni(dni)` - Buscar por cédula
- `findByInvitationToken(token)`
- `createInvitation(userData)`
- `completeRegistration(token, password, email)`
- `dniExists(dni, excludeUserId)`

#### TenantAdminModel (existente, funcional)

#### PropertyModel (actualizado)
Métodos para gestión de propietarios:
- `getByOwner(userId)`
- `addOwner()`, `removeOwner()`, `updateOwner()`
- `getWithOwners(id, tenantId)`

---

### 6. Migraciones de BD

**Nueva migración:**
- `202503140001-CreatePasswordResets.js`
  - Tabla para tokens de recuperación
  - Expiración de 1 hora
  - Índices en token, user_id, expires_at

**Total migraciones:** 7

---

## 🗄️ Estructura de Datos

### Flujo de Estados de Usuario

```
[PENDING] → [INVITED] → [ACTIVE]
                ↓           ↓
           (invitado)   (logueado)
```

### Tabla PasswordResets
| Campo | Descripción |
|-------|-------------|
| user_id | Usuario a recuperar |
| user_type | OWNER / TENANT_ADMIN / SUPERADMIN |
| token | Token único de reset |
| expires_at | Expiración (1 hora) |
| used_at | Cuándo se usó |

---

## 🔐 Flujos de Autenticación

### 1. Invitación de Propietario (por Junta)

```
Junta registra propietario
    ↓
POST /api/tenant-admin/owners/invite (a crear)
    ↓
AuthService.inviteOwner()
    ↓
Buscar por DNI
    ├── Existe → Reutilizar usuario
    └── No existe → Crear INVITED + token
    ↓
Asociar a unidad (PropertyOwners)
    ↓
Enviar email con link de invitación
    ↓
Propietario recibe email
    ↓
GET /auth/complete-registration?token=xxx
    ↓
POST /api/auth/complete-registration
    ↓
Estado: ACTIVE → Puede loguear
```

### 2. Login Propietario

```
POST /api/auth/login
    ↓
Verificar credenciales
    ↓
Obtener unidades del propietario
    ↓
Respuesta: token + lista de unidades
    ↓
Frontend muestra selector de unidad (si tiene >1)
    ↓
POST /api/auth/select-property
    ↓
Nuevo token "scoped" a esa unidad
```

### 3. Login Admin de Junta

```
POST /api/auth/login/admin
    ↓
Verificar credenciales
    ↓
Tenant viene en el token
    ↓
Acceso completo al Panel de Junta
```

### 4. Recuperación de Contraseña

```
POST /api/auth/forgot-password
    ↓
Generar token (1 hora)
    ↓
Enviar email con link
    ↓
Usuario click en link
    ↓
GET /auth/reset-password?token=xxx
    ↓
POST /api/auth/reset-password
    ↓
Contraseña actualizada
```

---

## 📝 Variables de Entorno Requeridas

```env
# JWT
JWT_SECRET=your-super-secret-key
JWT_EXPIRES_IN=24h

# App
APP_URL=http://localhost:3000

# SMTP (opcional en desarrollo)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@condominio360.com
SMTP_SECURE=false
SMTP_TLS_REJECT_UNAUTHORIZED=true
```

---

## 🧪 Testing Manual

### Login como Propietario
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "propietario@email.com",
    "password": "password123"
  }'
```

### Verificar Invitación
```bash
curl http://localhost:3000/api/auth/verify-invitation?token=xxx
```

### Completar Registro
```bash
curl -X POST http://localhost:3000/api/auth/complete-registration \
  -H "Content-Type: application/json" \
  -d '{
    "token": "invitation-token",
    "password": "newpassword123",
    "email": "nuevo@email.com"
  }'
```

### Obtener Datos del Usuario (requiere auth)
```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer jwt-token-here"
```

---

## ✅ Checklist Capítulo 1

- [x] Servicio de Email con plantillas
- [x] Servicio de Autenticación completo
- [x] Middleware de autenticación (3 tipos de usuarios)
- [x] Controlador de Auth con todos los endpoints
- [x] Rutas configuradas con middlewares
- [x] Modelos actualizados (findById, etc.)
- [x] Tabla PasswordResets creada
- [x] Flujo de invitaciones implementado
- [x] Recuperación de contraseña implementada
- [x] Selección de unidades implementada
- [x] Documentación de uso

---

## 🎯 Próximos Pasos (Capítulo 2)

**Capítulo 2: Panel del Propietario**
- Vista de dashboard del propietario
- Lista de unidades
- Módulo de solicitudes (crear, ver historial)
- Módulo de consultas (votar)
- Módulo de visitas (anunciar)
- Módulo de facturación (visualización)

---

**Estado: COMPLETADO ✅**
**Listo para iniciar Capítulo 2**
