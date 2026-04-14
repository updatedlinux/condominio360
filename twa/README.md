# Condominio360 — Android APK (Bubblewrap / TWA)

Esto genera una app Android tipo **Trusted Web Activity (TWA)** que abre Condominio360 usando el **Chrome del dispositivo** (ideal para PWA). Esto evita muchos problemas de WebView con JavaScript y reCAPTCHA.

## Requisitos

- Node.js 18+ (recomendado)
- Java JDK 17
- Android Studio (para instalar Android SDK) o Android SDK configurado

## 1) Asegura HTTPS y PWA mínima

En el backend ya está servido:

- `GET /manifest.webmanifest`
- `GET /sw.js`
- `GET /.well-known/assetlinks.json` (**debes actualizarlo** con package + fingerprint)

## 2) Instala Bubblewrap

```bash
npm i -g @bubblewrap/cli
```

## 3) Inicializa el proyecto TWA

Desde la raíz del repo:

```bash
mkdir -p android-twa
cd android-twa

# Reemplaza ORIGIN por tu dominio productivo (sin path)
# Ej: https://condominio-360.com
bubblewrap init --manifest ORIGIN/manifest.webmanifest
```

Sugerencias al responder el wizard:

- **Application ID (package)**: `com.condominio360.app` (o el que prefieras)
- **Start URL**: `ORIGIN/login`
- **Display mode**: `standalone`

## 4) Firma: genera keystore (si no tienes)

```bash
keytool -genkey -v -keystore condominio360-release.keystore -alias condominio360 \
  -keyalg RSA -keysize 2048 -validity 10000
```

Obtén el **SHA-256** del certificado (para `assetlinks.json`):

```bash
keytool -list -v -keystore condominio360-release.keystore -alias condominio360 | grep 'SHA256'
```

## 5) Publica `assetlinks.json` correcto

Edita:

- `src/public/.well-known/assetlinks.json`

y reemplaza:

- `package_name` por tu applicationId
- `sha256_cert_fingerprints` por el SHA-256 del certificado (sin espacios)

Luego despliega el backend para que quede accesible:

- `https://TU_DOMINIO/.well-known/assetlinks.json`

## 6) Build APK / AAB

En `android-twa/`:

```bash
# APK debug (rápido)
bubblewrap build

# Para Play Store normalmente necesitas AAB:
# bubblewrap build --release
```

## Troubleshooting (común)

- **No verifica el origen**: revisa que `assetlinks.json` esté en `/.well-known/assetlinks.json` y que el `SHA-256` corresponda al keystore usado para firmar.
- **reCAPTCHA sigue fallando**: en TWA suele mejorar; si falla, mira logs server-side (ahora incluyen `details`, `hostname`, etc.) para ver si es mismatch de dominios o bloqueo de scripts.

