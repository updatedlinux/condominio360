# API Notify System - Documentación para Desarrolladores

## 📋 Introducción

API Notify System es una API REST que permite el envío de mensajes a través de **WhatsApp** y **Telegram**. Esta documentación está dirigida a desarrolladores que desean integrar el servicio de notificaciones en sus aplicaciones.

## 🌐 Endpoints Base

- **Producción**: `https://wsapiback.arsystech.net/api`
- **Desarrollo**: `http://localhost:3000/api`

## 🔐 Autenticación

La API soporta dos métodos de autenticación:

### 1. API Key (Header)
```bash
X-API-Key: tu_secret_key_aqui
```

### 2. API Key (Body)
Incluir `secretKey` en el cuerpo de la petición JSON.

**⚠️ IMPORTANTE**: El `secretKey` es obligatorio para el endpoint `/api/send-message`. Contacta al administrador del sistema para obtener tu clave de API.

## 📤 Endpoint Principal: Envío de Mensajes

### POST `/api/send-message`

Envía un mensaje a través de WhatsApp o Telegram.

#### Headers
```
Content-Type: application/json
X-API-Key: tu_secret_key_aqui (opcional si se envía en el body)
```

#### Body Parameters

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `countryCode` | string | Solo WhatsApp | Código de país con signo + (ej: "+58") |
| `phoneNumber` | string | ✅ Sí | Ver descripción por canal abajo |
| `channel` | string | No | Canal de envío: `WHATSAPP` (default) o `TELEGRAM` |
| `message` | string | ✅ Sí | Contenido del mensaje a enviar |
| `secretKey` | string | ✅ Sí | Clave de API para autenticación |

#### Parámetro `phoneNumber` según canal:

**Para WhatsApp:**
- Número telefónico sin código de país
- Ejemplo: `"4242967747"`

**Para Telegram:**
- `@username` del usuario (ej: `"@soyjonnymelendez"`)
- `chat_id` numérico (ej: `"797475826"`)
- Número telefónico (si el usuario compartió su contacto con el bot)
- Email o identificador personalizado (si fue asociado previamente)

---

## 📱 Ejemplos de Uso

### WhatsApp

#### Ejemplo 1: Envío básico con API Key en Header

```bash
curl -X 'POST' \
  'https://wsapiback.arsystech.net/api/send-message' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: tu_secret_key_aqui' \
  -d '{
  "countryCode": "+58",
  "phoneNumber": "4242967747",
  "channel": "WHATSAPP",
  "message": "Hola, este es un mensaje de prueba"
}'
```

#### Ejemplo 2: Envío con API Key en Body

```bash
curl -X 'POST' \
  'https://wsapiback.arsystech.net/api/send-message' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "countryCode": "+58",
  "phoneNumber": "4242967747",
  "channel": "WHATSAPP",
  "message": "Hola, este es un mensaje de prueba",
  "secretKey": "tu_secret_key_aqui"
}'
```

#### Respuesta Exitosa (WhatsApp)
```json
{
  "success": true,
  "messageId": "3EB0C767F26CXXXXX",
  "phoneNumber": "584242967747",
  "channel": "WHATSAPP",
  "error": null
}
```

---

### Telegram

#### ⚠️ IMPORTANTE: Requisito Previo para Telegram

**ANTES de poder enviar mensajes a un usuario vía Telegram, el usuario DEBE escribir al bot primero.**

El bot registrará automáticamente:
- `chat_id` del usuario
- `@username` (si tiene uno configurado)
- Número telefónico (si comparte su contacto)
- Otros datos disponibles

**Si intentas enviar un mensaje a un usuario que NO ha escrito al bot, recibirás el siguiente error:**

```json
{
  "success": false,
  "phoneNumber": "@soyjonnymelendez",
  "channel": "TELEGRAM",
  "error": "ETELEGRAM: 400 Bad Request: chat not found"
}
```

#### Ejemplo 1: Envío usando @username

```bash
curl -X 'POST' \
  'https://wsapiback.arsystech.net/api/send-message' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: tu_secret_key_aqui' \
  -d '{
  "phoneNumber": "@soyjonnymelendez",
  "channel": "TELEGRAM",
  "message": "Hola, este es un mensaje de prueba"
}'
```

**Nota**: `countryCode` es opcional para Telegram.

#### Ejemplo 2: Envío usando chat_id

```bash
curl -X 'POST' \
  'https://wsapiback.arsystech.net/api/send-message' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: tu_secret_key_aqui' \
  -d '{
  "phoneNumber": "797475826",
  "channel": "TELEGRAM",
  "message": "Hola, este es un mensaje de prueba"
}'
```

#### Ejemplo 3: Envío usando número telefónico (si el usuario compartió su contacto)

```bash
curl -X 'POST' \
  'https://wsapiback.arsystech.net/api/send-message' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: tu_secret_key_aqui' \
  -d '{
  "phoneNumber": "584242967747",
  "channel": "TELEGRAM",
  "message": "Hola, este es un mensaje de prueba"
}'
```

#### Respuesta Exitosa (Telegram)
```json
{
  "success": true,
  "messageId": "12345",
  "phoneNumber": "@soyjonnymelendez",
  "channel": "TELEGRAM",
  "error": null
}
```

---

## 🔄 Respuestas de Error

### Error: Usuario no encontrado (Telegram)

```json
{
  "success": false,
  "phoneNumber": "@usuario_no_registrado",
  "channel": "TELEGRAM",
  "error": "Usuario \"@usuario_no_registrado\" no encontrado. El usuario debe escribir al bot primero para ser registrado. Una vez que el usuario escriba al bot, podrás enviarle mensajes usando su @username, número telefónico, o cualquier identificador que hayas asociado."
}
```

**Solución**: El usuario debe escribir al bot primero. Una vez que lo haga, el sistema lo registrará automáticamente.

### Error: WhatsApp no conectado

```json
{
  "success": false,
  "error": "WhatsApp no está conectado o la conexión está inactiva. Escanea el QR o espera a la reconexión automática.",
  "reconnecting": false
}
```

**Solución**: Verifica que WhatsApp esté conectado a través del dashboard.

### Error: Clave de API inválida

```json
{
  "success": false,
  "error": "Clave de API inválida"
}
```

**Solución**: Verifica que estés usando la clave de API correcta.

### Error: Datos inválidos

```json
{
  "success": false,
  "error": "countryCode y phoneNumber son requeridos para WhatsApp"
}
```

**Solución**: Verifica que todos los campos requeridos estén presentes y con el formato correcto.

---

## 📊 Códigos de Estado HTTP

| Código | Descripción |
|--------|-------------|
| `200` | Petición exitosa |
| `400` | Datos inválidos o faltantes |
| `401` | Clave de API inválida |
| `500` | Error interno del servidor |
| `503` | Servicio no disponible (WhatsApp/Telegram no conectado) |

---

## 🔍 Endpoints Adicionales (Requieren Autenticación JWT)

Estos endpoints requieren autenticación mediante JWT. Para obtener un token, usa el endpoint de login.

### POST `/api/auth/login`

Obtiene un token JWT para acceder a endpoints protegidos.

```bash
curl -X 'POST' \
  'https://wsapiback.arsystech.net/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{
  "username": "admin",
  "password": "tu_password"
}'
```

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "username": "admin",
      "email": "admin@example.com",
      "fullName": "Administrador"
    }
  }
}
```

### GET `/api/messages`

Obtiene el historial de mensajes enviados.

**Headers:**
```
Authorization: Bearer tu_jwt_token_aqui
```

**Query Parameters:**
- `limit` (opcional): Número de mensajes a retornar (default: 50)
- `offset` (opcional): Offset para paginación (default: 0)
- `channel` (opcional): Filtrar por canal (`WHATSAPP` o `TELEGRAM`)

**Ejemplo:**
```bash
curl -X 'GET' \
  'https://wsapiback.arsystech.net/api/messages?limit=30&channel=TELEGRAM' \
  -H 'Authorization: Bearer tu_jwt_token_aqui'
```

### GET `/api/stats`

Obtiene estadísticas de mensajes enviados.

**Headers:**
```
Authorization: Bearer tu_jwt_token_aqui
```

**Query Parameters:**
- `channel` (opcional): Filtrar por canal (`WHATSAPP` o `TELEGRAM`)

**Ejemplo:**
```bash
curl -X 'GET' \
  'https://wsapiback.arsystech.net/api/stats?channel=WHATSAPP' \
  -H 'Authorization: Bearer tu_jwt_token_aqui'
```

**Respuesta:**
```json
{
  "success": true,
  "data": [
    {
      "channel": "WHATSAPP",
      "status": "sent",
      "count": "150"
    },
    {
      "channel": "WHATSAPP",
      "status": "failed",
      "count": "5"
    },
    {
      "channel": "TELEGRAM",
      "status": "sent",
      "count": "80"
    }
  ]
}
```

### GET `/api/status`

Obtiene el estado de conexión de WhatsApp.

**Headers:**
```
Authorization: Bearer tu_jwt_token_aqui
```

### GET `/api/qr`

Obtiene el código QR para conectar WhatsApp.

**Headers:**
```
Authorization: Bearer tu_jwt_token_aqui
```

---

## 📚 Documentación Interactiva (Swagger)

La documentación interactiva completa está disponible en:

- **Producción**: `https://wsapiback.arsystech.net/api/docs`
- **Desarrollo**: `http://localhost:3000/api/docs`

En Swagger puedes:
1. Ver todos los endpoints disponibles
2. Probar los endpoints directamente desde el navegador
3. Obtener tokens JWT usando el endpoint de login
4. Ver ejemplos de requests y responses

---

## 🔑 Obtener tu Clave de API

Para obtener tu `secretKey` (clave de API), contacta al administrador del sistema. Esta clave es necesaria para autenticarte en el endpoint `/api/send-message`.

---

## ⚠️ Consideraciones Importantes

### WhatsApp
- Requiere que WhatsApp esté conectado (escaneo de QR)
- El `countryCode` es obligatorio
- El formato del número debe ser: código de país + número (sin espacios ni caracteres especiales)

### Telegram
- **CRÍTICO**: El usuario DEBE escribir al bot primero antes de poder recibir mensajes
- El `countryCode` es opcional
- Puedes usar `@username`, `chat_id`, número telefónico, email o identificador personalizado
- Si el usuario no está registrado, recibirás error `chat not found`

### Rate Limiting
- La API tiene límites de rate limiting configurados
- Si excedes el límite, recibirás un error 429
- Espera unos momentos antes de reintentar

### Formato de Mensajes
- Los mensajes pueden contener texto plano
- Telegram soporta formato HTML básico
- WhatsApp soporta texto plano y emojis

---

## 🛠️ Ejemplos de Integración

### JavaScript (Fetch API)

```javascript
async function enviarMensajeWhatsApp(mensaje, telefono, codigoPais) {
  const response = await fetch('https://wsapiback.arsystech.net/api/send-message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'tu_secret_key_aqui'
    },
    body: JSON.stringify({
      countryCode: codigoPais,
      phoneNumber: telefono,
      channel: 'WHATSAPP',
      message: mensaje
    })
  });
  
  const data = await response.json();
  return data;
}

async function enviarMensajeTelegram(mensaje, username) {
  const response = await fetch('https://wsapiback.arsystech.net/api/send-message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'tu_secret_key_aqui'
    },
    body: JSON.stringify({
      phoneNumber: username, // @username o chat_id
      channel: 'TELEGRAM',
      message: mensaje
    })
  });
  
  const data = await response.json();
  return data;
}
```

### Python (requests)

```python
import requests

def enviar_mensaje_whatsapp(mensaje, telefono, codigo_pais, api_key):
    url = 'https://wsapiback.arsystech.net/api/send-message'
    headers = {
        'Content-Type': 'application/json',
        'X-API-Key': api_key
    }
    data = {
        'countryCode': codigo_pais,
        'phoneNumber': telefono,
        'channel': 'WHATSAPP',
        'message': mensaje
    }
    response = requests.post(url, json=data, headers=headers)
    return response.json()

def enviar_mensaje_telegram(mensaje, username, api_key):
    url = 'https://wsapiback.arsystech.net/api/send-message'
    headers = {
        'Content-Type': 'application/json',
        'X-API-Key': api_key
    }
    data = {
        'phoneNumber': username,  # @username o chat_id
        'channel': 'TELEGRAM',
        'message': mensaje
    }
    response = requests.post(url, json=data, headers=headers)
    return response.json()
```

### PHP (cURL)

```php
function enviarMensajeWhatsApp($mensaje, $telefono, $codigoPais, $apiKey) {
    $url = 'https://wsapiback.arsystech.net/api/send-message';
    $data = [
        'countryCode' => $codigoPais,
        'phoneNumber' => $telefono,
        'channel' => 'WHATSAPP',
        'message' => $mensaje
    ];
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'X-API-Key: ' . $apiKey
    ]);
    
    $response = curl_exec($ch);
    curl_close($ch);
    
    return json_decode($response, true);
}

function enviarMensajeTelegram($mensaje, $username, $apiKey) {
    $url = 'https://wsapiback.arsystech.net/api/send-message';
    $data = [
        'phoneNumber' => $username, // @username o chat_id
        'channel' => 'TELEGRAM',
        'message' => $mensaje
    ];
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'X-API-Key: ' . $apiKey
    ]);
    
    $response = curl_exec($ch);
    curl_close($ch);
    
    return json_decode($response, true);
}
```

---

## 📞 Soporte

Para soporte técnico o consultas sobre la API, contacta al administrador del sistema.

---

## 📝 Changelog

### Versión 2.0.0
- ✅ Soporte para WhatsApp y Telegram
- ✅ Sistema de registro automático de usuarios de Telegram
- ✅ Búsqueda automática de chat_id por identificadores
- ✅ Endpoints de estadísticas y historial con filtros por canal
- ✅ Documentación Swagger interactiva

---

**Última actualización**: Enero 2026



