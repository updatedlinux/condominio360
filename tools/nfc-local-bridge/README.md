# Puente NFC local (Mac / Windows)

Chrome en escritorio **no** expone Web NFC. Este proceso usa **PC/SC** (el mismo estándar que muchos lectores USB, p. ej. ACR122U) y publica el último UID en `http://127.0.0.1:4789`.

## Requisitos

- Lector compatible con **PC/SC** en el sistema (drivers instalados).
- macOS: suele funcionar con los controladores del fabricante; a veces hace falta [CCID](https://ccid.apdu.fr/).
- Windows: drivers del lector + servicio de tarjeta inteligente.

## Uso

Desde la raíz del repo:

```bash
cd tools/nfc-local-bridge
npm install
npm start
```

Otro puerto:

```bash
NFC_BRIDGE_PORT=4790 npm start
```

En el panel **Seguridad → Acceso vehicular NFC**, active **“Usar lector USB vía puente local”** y, si cambió el puerto, ajústelo en el campo numérico.

## Endpoints

| Ruta      | Descripción                          |
|----------|--------------------------------------|
| `GET /health` | Servicio activo y número de lectores detectados |
| `GET /last`   | `{ "uid": "...", "ts": 1234567890 }` — última lectura |

Solo escucha en **127.0.0.1** (no expone a la red LAN).

## Seguridad

Ejecute el puente **solo en la PC de vigilancia** mientras use el panel. No comparta el puerto hacia internet.
