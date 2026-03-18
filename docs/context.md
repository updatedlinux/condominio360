# Condominio360 - Contexto y Documentación del Proyecto

> **Fecha de actualización:** 16 de marzo de 2026  
> **Stack:** Node.js + Express + SQL Server 2022 + EJS + Tailwind CSS  
> **Timezone:** Venezuela (GMT-4 / America/Caracas)

---

## 📁 Estructura del Proyecto

```
condominio360/
├── src/
│   ├── config/           # Configuración de base de datos y variables
│   ├── controllers/      # Controladores de API (MVC)
│   ├── middleware/       # Autenticación y autorización
│   ├── models/          # Modelos de datos SQL Server
│   ├── routes/          # Definición de rutas API
│   ├── services/        # Servicios (BCV, Scheduler, Email, etc.)
│   ├── utils/           # Utilidades
│   └── views/           # Plantillas EJS
│       ├── admin/       # Panel Superadmin
│       ├── owner/       # Panel Propietario
│       ├── security/    # Panel Seguridad
│       └── tenant-admin/# Panel Admin de Junta
├── database/            # Scripts SQL de inicialización
├── scripts/             # Scripts de utilidad y migración
├── docs/                # Documentación
└── legacy/              # Código legacy (referencia)
```

---

## 🛠 Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| **Backend** | Node.js 18+, Express 4 |
| **Base de Datos** | SQL Server 2022 |
| **ORM** | mssql (node-mssql) |
| **Frontend** | EJS + Tailwind CSS + Material Design |
| **Autenticación** | JWT (jsonwebtoken) |
| **Tareas Programadas** | node-cron |
| **HTTP Client** | axios |
| **Icons** | Material Symbols Rounded |

---

## 🔐 Sistema de Autenticación

### Roles de Usuario
```javascript
// Roles definidos en el sistema
- SUPERADMIN   // Acceso a todos los tenants
- TENANT_ADMIN // Admin de junta de un condominio
- OWNER        // Propietario de inmueble
- SECURITY     // Personal de seguridad/portería
```

### Middlewares de Autorización

**`src/middleware/auth.js`**
```javascript
// authenticate - Verifica JWT y adjunta req.user
// requireSecurity - Permite SECURITY y TENANT_ADMIN (para supervisión)
// requireTenantAdmin - Solo TENANT_ADMIN
// requireSuperAdmin - Solo SUPERADMIN
// requirePropertyAccess - Verifica acceso a propiedad específica
```

### Estructura del Token JWT
```javascript
{
  userId: "uuid",
  email: "user@example.com",
  type: "OWNER" | "TENANT_ADMIN" | "SECURITY" | "SUPERADMIN",
  tenantId: "uuid",        // Para TENANT_ADMIN, SECURITY
  propertyId: "uuid"       // Para OWNER (opcional, seleccionable)
}
```

---

## 🌐 APIs Principales

### Autenticación
```
POST /api/auth/login              // Login general
POST /api/auth/select-property    // Propietario selecciona propiedad
POST /api/auth/logout
GET  /api/auth/me                 // Perfil del usuario
```

### Panel Propietario (`/api/owner`)
```
GET  /api/dashboard               // Stats del dashboard
GET  /api/activity                // Actividad reciente

// Visitas
GET  /api/owner/visitors          // Listar visitantes/pases
POST /api/owner/visitors          // Crear visita (única/frecuente)
GET  /api/owner/visits/history    // Historial completo con logs

// Deliveries
GET  /api/owner/deliveries
POST /api/owner/deliveries

// Solicitudes (PQRS)
GET  /api/owner/requests
POST /api/owner/requests

// Consultas (votaciones)
GET  /api/owner/consultations
POST /api/owner/consultations/:id/vote

// Facturación
GET  /api/owner/invoices          // Lista de facturas del propietario
GET  /api/owner/exchange-rates    // Tasas BCV
```

### Panel Seguridad (`/api/security`)
```
GET  /api/security/dashboard/status     // Stats en tiempo real
GET  /api/security/visits               // Visitas del día
GET  /api/security/visits/search?q=...&type=frequent|unique
POST /api/security/visits/:id/entry     // Registrar entrada
POST /api/security/visits/:id/exit      // Registrar salida
POST /api/security/visitors/:id/entry   // Entrada visita frecuente

// Deliveries
GET  /api/security/deliveries/pending
POST /api/security/deliveries/:id/arrive
POST /api/security/deliveries/:id/deliver

// Mudanzas
GET  /api/security/moves/pending
POST /api/security/moves/:id/approve
```

### Panel Admin de Junta (`/api/tenant-admin`)
```
GET  /api/tenant-admin/stats
GET  /api/tenant-admin/requests         // Solicitudes PQRS
POST /api/tenant-admin/requests/:id/status

// Propietarios
GET  /api/tenant-admin/owners
POST /api/tenant-admin/owners
POST /api/tenant-admin/owners/:id/reset-password

// Inmuebles
GET  /api/tenant-admin/properties
POST /api/tenant-admin/properties
GET  /api/tenant-admin/buildings

// Consultas
GET  /api/tenant-admin/consultations
POST /api/tenant-admin/consultations
GET  /api/tenant-admin/consultations/:id/results

// Comunicados
GET  /api/tenant-admin/communiques
POST /api/tenant-admin/communiques

// Facturación
GET  /api/tenant-admin/billing/exchange-rate
POST /api/tenant-admin/billing/exchange-rate/update
POST /api/tenant-admin/billing/generate-invoices
GET  /api/tenant-admin/billing/invoices
```

### Superadmin (`/api/admin`)
```
GET  /api/admin/tenants
POST /api/admin/tenants
PUT  /api/admin/tenants/:id
GET  /api/admin/tenants/:id/stats
GET  /api/admin/tenants/:id/audit
```

---

## 🗄 Modelos de Base de Datos (Clave)

### Users
```sql
- id, email, password_hash, first_name, last_name, phone
- type: 'OWNER'|'TENANT_ADMIN'|'SECURITY'|'SUPERADMIN'
- tenant_id, is_active, created_at
```

### Properties (Inmuebles)
```sql
- id, tenant_id, name, building, floor, number
- type: 'APARTMENT'|'HOUSE'|'PARKING'|'STORAGE'
- alicuota (para facturación por alícuota)
- building_id (relación con Buildings)
```

### PropertyOwners (Relación N:M)
```sql
- property_id, user_id, is_primary, created_at
```

### VisitorPasses (Pases de visita)
```sql
- id, tenant_id, property_id, visitor_id, user_id
- type: 'ONE_TIME'|'FREQUENT'
- status: 'ACTIVE'|'USED'|'EXPIRED'|'CANCELLED'
- valid_from, valid_until (UTC 04:00 para Venezuela)
- created_at
```

### VisitorLogs (Bitácora de entradas/salidas)
```sql
- id, tenant_id, visitor_id, pass_id (nullable para frecuentes antiguos)
- property_id, user_id (quien registra)
- entry_time, exit_time (DATETIME2)
- access_method: 'PEDESTRIAN'|'VEHICLE'
- vehicle_plate
```

### Consultations (Votaciones)
```sql
- id, tenant_id, title, description, type: 'BINARY'|'MULTIPLE'
- status: 'DRAFT'|'OPEN'|'CLOSED'
- start_date, end_date (UTC)
- created_by, created_at
```

### ConsultationQuestions (Preguntas de consulta)
```sql
- id, consultation_id, question_text, question_type
- min_selection, max_selection
```

### ConsultationOptions (Opciones de respuesta)
```sql
- id, question_id, option_text
```

### ConsultationVotes (Votos)
```sql
- id, consultation_id, question_id, property_id, tenant_id
- selected_options (JSON array de option_ids)
- voted_at (renombrado de created_at)
```

### ExchangeRates (Tasas BCV)
```sql
- id, rate_date (DATE), usd_rate, eur_rate
- change_percentage_usd, change_percentage_eur
- created_at, updated_at
```

### Invoices (Facturas)
```sql
- id, tenant_id, property_id, owner_id
- amount, currency: 'USD'|'VES'
- exchange_rate (tasa aplicada)
- status: 'PENDING'|'PAID'|'OVERDUE'|'CANCELLED'
- due_date, paid_at
```

---

## ⏰ Manejo de Timezone (Venezuela GMT-4)

### Patrones Importantes

**1. Guardar fechas en UTC**
```javascript
// Para fechas de inicio/fin de consultas (medianoche Venezuela)
const venezuelaDate = new Date(2026, 2, 15); // 15 marzo 2026
const utcDate = new Date(Date.UTC(2026, 2, 15, 4, 0, 0)); // UTC 04:00
```

**2. Comparar en SQL Server**
```sql
-- Usar GETUTCDATE() para comparar con fechas almacenadas
WHERE end_date < GETUTCDATE()
```

**3. Mostrar en Venezuela**
```javascript
// En SQL: Agregar 4 horas
DATEADD(HOUR, 4, voted_at)

// En JavaScript frontend
new Date(dateStr).toLocaleString('es-VE', { timeZone: 'America/Caracas' })
```

**4. Formatear fechas (evitar problemas de día)**
```javascript
// Para fechas simples (sin hora)
const [year, month, day] = dateStr.split('T')[0].split('-');
return `${day} ${monthNames[parseInt(month) - 1]}. ${year}`;
```

---

## 🎨 Frontend - Estructura de Vistas

### Layouts por Rol

**Panel Propietario** (`/owner/*`)
- Sidebar naranja/marrón (`#8B5028`)
- Cards con sombra suave
- Grid 2x2 para contenido principal
- Acciones rápidas como lista vertical

**Panel Admin de Junta** (`/tenant-admin/*`)
- Sidebar azul Material Design (`#006494`)
- Navigation rail expandible/colapsable
- Tema blue/gray

**Panel Superadmin** (`/admin/*`)
- Mismo tema azul que tenant-admin
- Consistencia en todas las vistas de admin

**Panel Seguridad** (`/security`)
- Interfaz optimizada para móviles/tablets
- Cámara para escanear QR
- Búsqueda rápida de visitantes

### Componentes Reutilizables

```javascript
// Formato de tiempo relativo
function timeAgoVenezuela(dateStr) {
    // Calcula "Hace X minutos/horas/días"
    // Maneja UTC del servidor vs hora local
}

// Formato de moneda
function formatCurrency(amount, currency) {
    return currency === 'USD' 
        ? `$${amount.toFixed(2)}`
        : `Bs.S ${amount.toFixed(2)}`;
}
```

---

## 🔄 Servicios Automatizados (Cron Jobs)

### SchedulerService (`src/services/SchedulerService.js`)

| Tarea | Frecuencia | Descripción |
|-------|------------|-------------|
| Actualización BCV | 6:00 PM Venezuela | Obtiene tasas del día siguiente del BCV |
| Verificación BCV | Cada hora (6 AM - 8 PM) | Verifica si falta tasa y actualiza |
| Cierre Consultas | Cada 5 minutos | Cierra consultas vencidas |

### BCVService
```javascript
// IMPORTANTE: Usar SIEMPRE la fecha efectiva que viene en la API (fecha a la que corresponde la tasa).
// El BCV publica tasas ~5:30-6 PM (Venezuela); la tasa se "crea" un día pero contablemente corresponde
// al día que la API registra. Ej: API devuelve fecha 17/03 → guardar 17/03, NO la fecha de extracción.
// Nunca usar new Date() como fallback; si la API no devuelve fecha, no guardar.
```

---

## 📝 Decisiones de Diseño Recientes

### 1. Visitas Frecuentes
- Las visitas frecuentes ahora guardan `pass_id` en `VisitorLogs`
- Esto permite vincular entradas/salidas con el historial del propietario
- Script de migración: `scripts/migrate_frequent_visit_logs.js`

### 2. Actividad Reciente
- Fecha contextual según estado:
  - Completada → `exit_time`
  - En curso → `entry_time`
  - Programada → `created_at`

### 3. Tasas BCV
- El BCV publica tasas del día siguiente a las ~5:30 PM
- Worker actualizado a 6:00 PM para asegurar disponibilidad
- Se almacena con fecha de la API (ej: 17/03) no del servidor (16/03)

### 4. Autenticación Seguridad
- `requireSecurity` ahora acepta `TENANT_ADMIN` también
- Permite a admins supervisar el panel de seguridad

---

## 🖼 Assets estáticos (logos, imágenes)

Los archivos se sirven desde `src/public/`. Todo lo que esté en esa carpeta se expone en la raíz del sitio.

| Ruta física | URL en la web |
|-------------|---------------|
| `src/public/assets/images/logo.svg` | `/assets/images/logo.svg` |
| `src/public/assets/images/` | `/assets/images/` |

**Para agregar tu logo:** Coloca el archivo en `src/public/assets/images/logo.svg` (o `logo.png`). La landing y demás vistas lo usarán desde `/assets/images/logo.svg`. Ver `src/public/assets/README.md` para más detalles.

---

## 🚀 Comandos Útiles

```bash
# Instalar dependencias
npm install

# Iniciar servidor (desarrollo)
npm run dev

# Ejecutar script de migración
node scripts/migrate_frequent_visit_logs.js

# Forzar actualización BCV manual
node -e "require('dotenv').config(); require('./src/services/BCVService').fetchAndSave().then(console.log)"
```

---

## ⚠️ Notas Importantes

1. **Timezone crítico:** Siempre usar `America/Caracas` para display y UTC para almacenamiento

2. **ConsultationVotes:** El campo es `voted_at` (no `created_at`)

3. **VisitorLogs pass_id:** Puede ser NULL para registros antiguos de visitas frecuentes

4. **BillingMode:** `FULL` (facturación completa) vs `SUPPORT` (modo apoyo)

5. **ExchangeRate:** La fecha es la clave primaria lógica (una tasa por día)

---

## 📚 Archivos Clave para Referencia

| Archivo | Propósito |
|---------|-----------|
| `docs/EVALUACION.md` | **Evaluación del proyecto** - Estado, correcciones y roadmap de continuación |
| `src/middleware/auth.js` | Autenticación y autorización |
| `src/services/BCVService.js` | Integración con API BCV |
| `src/services/SchedulerService.js` | Tareas programadas |
| `src/models/ConsultationModel.js` | Lógica de votaciones |
| `src/controllers/OwnerController.js` | API del panel propietario |
| `src/controllers/SecurityController.js` | API del panel seguridad |
| `database/01_init.sql` | Estructura de BD |

---

*Documento generado para continuar desarrollo en Cursor IDE*
