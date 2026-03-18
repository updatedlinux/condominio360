# ✅ CAPÍTULO 3: MÓDULO DE SOLICITUDES CONFIGURABLE - COMPLETADO

## 📅 Fecha: Marzo 2026

---

## 🎯 Resumen Ejecutivo

Sistema de solicitudes completamente configurable implementado. Cada tenant puede definir sus propios tipos de solicitud con campos dinámicos, configurar reglas de mudanzas (días, horarios, antelación), y gestionar el flujo de aprobaciones.

---

## 📦 Entregables Completados

### 1. Migraciones de Base de Datos (3 migraciones)

| Migración | Descripción |
|-----------|-------------|
| `202503150001-UpdateRequestTypes.js` | Agregó campos: is_system, icon, color, requires_approval, auto_assign_to, form_schema (NVARCHAR(MAX)) |
| `202503150002-CreateMoveConfig.js` | Tabla TenantMoveConfig para configuración de mudanzas por tenant |
| `202503150003-CreateRequestAttachments.js` | Tabla RequestAttachments para archivos adjuntos |

**Total migraciones:** 10

---

### 2. RequestTypeModel Actualizado (`src/models/RequestTypeModel.js`)

**Nuevas funcionalidades:**

#### Campos Dinámicos (JSON Schema)
```javascript
// Ejemplo de schema para mudanza
{
  fields: [
    {
      name: 'move_date',
      label: 'Fecha de Mudanza',
      type: 'date',
      required: true,
      validation: { min_notice_days: 7 }
    },
    {
      name: 'elevator_needed',
      label: 'Requiere ascensor',
      type: 'checkbox',
      required: false
    }
  ]
}
```

**Métodos:**
- `getByTenant(tenantId)` - Listar tipos activos
- `findById(id, tenantId)` - Obtener detalle
- `create(data)` - Crear tipo personalizado
- `update(id, tenantId, data)` - Actualizar (solo no-system)
- `delete(id, tenantId)` - Soft delete (solo no-system)
- `createDefaults(tenantId, createdBy)` - Crear tipos predefinidos
- `validateFormData(formSchema, data)` - Validación dinámica

#### Tipos Predefinidos (createDefaults)
| Tipo | Icono | Color | Requiere Aprobación |
|------|-------|-------|---------------------|
| Mudanza - Entrada | fa-truck-moving | 🟠 Naranja | Sí |
| Mudanza - Salida | fa-truck-loading | 🔴 Rojo | Sí |
| Sugerencia | fa-lightbulb | 🟢 Verde | No |
| Reclamo | fa-exclamation-circle | 🔴 Rojo | No |
| PQR | fa-clipboard-list | ⚪ Gris | No |

---

### 3. TenantMoveConfigModel Nuevo (`src/models/TenantMoveConfigModel.js`)

**Configuración de Mudanzas:**

| Campo | Descripción | Default |
|-------|-------------|---------|
| allowed_days | Días permitidos (0=Dom, 6=Sáb) | [6] (Sábados) |
| start_time | Hora inicio | 08:00 |
| end_time | Hora fin | 17:00 |
| min_notice_days | Días de anticipación mínima | 7 |
| max_moves_per_day | Máximo mudanzas/día | 0 (ilimitado) |
| require_insurance | Requiere seguro | false |
| require_elevator_booking | Reserva de ascensor | false |
| notify_security | Notificar a vigilancia | true |
| notify_admin | Notificar a admin | true |

**Métodos:**
- `getByTenant(tenantId)` - Obtener configuración
- `create(configData)` - Crear configuración
- `update(tenantId, data)` - Actualizar
- `createOrUpdate(tenantId, data, userId)` - Upsert
- `validateMoveDate(tenantId, moveDate)` - Validar fecha
- `getAvailableDates(tenantId)` - Obtener fechas disponibles

---

### 4. TenantAdminRequestController Nuevo (`src/controllers/TenantAdminRequestController.js`)

**Endpoints para Administración de Junta:**

#### Tipos de Solicitud
```
GET    /api/tenant-admin/request-types          # Listar
GET    /api/tenant-admin/request-types/:id      # Detalle
POST   /api/tenant-admin/request-types          # Crear
PUT    /api/tenant-admin/request-types/:id      # Actualizar
DELETE /api/tenant-admin/request-types/:id      # Eliminar
```

#### Configuración de Mudanzas
```
GET /api/tenant-admin/move-config               # Obtener config
PUT /api/tenant-admin/move-config               # Actualizar config
GET /api/tenant-admin/move-config/available-dates # Fechas disponibles
```

#### Gestión de Solicitudes
```
GET    /api/tenant-admin/requests               # Listar todas
GET    /api/tenant-admin/requests/:id           # Ver detalle
PUT    /api/tenant-admin/requests/:id/status    # Cambiar estado
```

---

### 5. OwnerController Actualizado (`src/controllers/OwnerController.js`)

**Nuevos Endpoints:**

```
GET /api/owner/requests/types          # Tipos disponibles
GET /api/owner/requests/move-config    # Config mudanzas
```

**Actualizaciones:**
- `createRequest()` ahora valida contra schema dinámico
- Validación especial para mudanzas (fechas permitidas)
- Notificación automática a junta al crear solicitud
- Estados: OPEN, IN_PROGRESS, RESOLVED, CLOSED

---

### 6. EmailService Actualizado (`src/services/EmailService.js`)

**Nuevos Métodos:**
- `notifyNewRequest(request, requestType)` - Notifica a admins
- `sendRequestStatusUpdate(request)` - Notifica al propietario

---

### 7. Rutas Actualizadas

**Owner Routes** (`src/routes/owner.js`)
```javascript
router.get('/requests/types', OwnerController.getRequestTypes);
router.get('/requests/move-config', OwnerController.getMoveConfig);
```

**Tenant Admin Routes** (`src/routes/tenantAdmin.js`)
```javascript
// Tipos de solicitud
router.get('/request-types', ...);
router.post('/request-types', ...);
router.put('/request-types/:id', ...);
router.delete('/request-types/:id', ...);

// Configuración mudanzas
router.get('/move-config', ...);
router.put('/move-config', ...);

// Gestión solicitudes
router.get('/requests', ...);
router.put('/requests/:id/status', ...);
```

---

## 🔐 Flujos Implementados

### 1. Configuración de Tipos de Solicitud (Admin Junta)

```
Admin accede a Panel → Configuración → Tipos de Solicitud
  ↓
Puede:
  • Ver tipos predefinidos (system=true, no editables)
  • Crear tipos personalizados
  • Definir campos dinámicos (JSON Schema)
  • Configurar si requiere aprobación
  • Asignar icono y color
```

### 2. Configuración de Mudanzas (Admin Junta)

```
Admin accede a Configuración → Mudanzas
  ↓
Configura:
  • Días permitidos (ej: solo sábados, o varios días)
  • Horario permitido
  • Días de anticipación mínima
  • Máximo de mudanzas por día
  • Requisitos adicionales
```

### 3. Creación de Solicitud Dinámica (Propietario)

```
Propietario → Nueva Solicitud
  ↓
Selecciona tipo (ej: Mudanza)
  ↓
Sistema carga formulario dinámico según schema
  ↓
Validaciones:
  • Campos requeridos
  • Tipos de datos
  • Fecha de mudanza válida (según config del tenant)
  • Antelación mínima
  • Día permitido
  ↓
Si todo OK:
  • Crea solicitud
  • Estado: PENDING (si requiere aprobación) o OPEN
  • Notifica a junta por email
```

### 4. Gestión de Solicitudes (Admin Junta)

```
Junta recibe notificación → Accede a Panel
  ↓
Ve lista de solicitudes
  ↓
Puede:
  • Ver detalle completo
  • Cambiar estado (OPEN → IN_PROGRESS → RESOLVED)
  • Agregar notas de resolución
  ↓
Al cambiar estado → Notifica al propietario
```

---

## 📋 Estructura de Datos

### RequestTypes (actualizado)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| is_system | BIT | true = predefinido, no editable |
| icon | NVARCHAR(50) | Icono FontAwesome |
| color | NVARCHAR(20) | Color en hex |
| requires_approval | BIT | ¿Requiere aprobación de junta? |
| auto_assign_to | NVARCHAR(100) | Asignación automática |
| form_schema | NVARCHAR(MAX) | JSON Schema de campos |

### TenantMoveConfig (nuevo)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| tenant_id | UNIQUEIDENTIFIER | FK a Tenants |
| allowed_days | NVARCHAR(50) | "0,1,6" = Dom, Lun, Sáb |
| start_time | TIME | Hora inicio |
| end_time | TIME | Hora fin |
| min_notice_days | INT | Antelación mínima |
| max_moves_per_day | INT | 0 = ilimitado |
| require_insurance | BIT | Seguro obligatorio |
| require_elevator_booking | BIT | Reservar ascensor |

### RequestAttachments (nuevo)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| request_id | UNIQUEIDENTIFIER | FK a Requests |
| file_name | NVARCHAR(255) | Nombre único |
| file_path | NVARCHAR(500) | Ruta en disco |
| file_size | INT | Bytes |
| mime_type | NVARCHAR(100) | Tipo de archivo |

---

## 🧪 Testing Manual

### Crear Tipo de Solicitud Personalizado
```bash
curl -X POST http://localhost:3000/api/tenant-admin/request-types \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Reserva de Área Común",
    "description": "Solicitar uso de áreas comunes",
    "icon": "fa-swimming-pool",
    "color": "#3B82F6",
    "requires_approval": true,
    "form_schema": {
      "fields": [
        {"name": "area", "label": "Área", "type": "select", "options": ["Piscina", "Salón", "Gimnasio"], "required": true},
        {"name": "date", "label": "Fecha", "type": "date", "required": true},
        {"name": "guests", "label": "Número de invitados", "type": "number", "required": true}
      ]
    }
  }'
```

### Configurar Mudanzas
```bash
curl -X PUT http://localhost:3000/api/tenant-admin/move-config \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "allowed_days": [0, 6],
    "start_time": "09:00",
    "end_time": "16:00",
    "min_notice_days": 14,
    "max_moves_per_day": 3
  }'
```

### Crear Solicitud con Validación
```bash
curl -X POST http://localhost:3000/api/owner/requests \
  -H "Authorization: Bearer <owner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "request_type_id": "<mudanza_id>",
    "title": "Mudanza Entrada",
    "description": "Mudanza departamento 101",
    "data": {
      "move_date": "2026-03-22",
      "elevator_needed": true,
      "transporter_name": "Transportes Rápidos",
      "transporter_phone": "04141234567",
      "vehicle_plate": "ABC123"
    }
  }'
```

---

## ✅ Checklist Capítulo 3

- [x] 3 migraciones ejecutadas
- [x] RequestTypeModel con campos dinámicos
- [x] TenantMoveConfigModel para reglas de mudanzas
- [x] TenantAdminRequestController con 11 endpoints
- [x] OwnerController actualizado con validaciones
- [x] Validación dinámica de formularios
- [x] Validación de fechas de mudanza
- [x] Tipos predefinidos (5 tipos)
- [x] Notificaciones por email
- [x] Estados de solicitud configurables
- [x] Tabla para archivos adjuntos
- [x] Rutas API actualizadas

---

## 🎯 Próximos Pasos (Capítulo 4)

**Capítulo 4: Módulo de Visitas y Control de Acceso**
- Registro de entradas/salidas por seguridad
- Validación de pases de visitantes
- Vista para vigilancia (tablet-friendly)
- Módulo de delivery
- Integración con lectores NFC (preparación)

---

**Estado: COMPLETADO ✅**
**Listo para iniciar Capítulo 4**
