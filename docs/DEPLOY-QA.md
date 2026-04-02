# Despliegue del ambiente de QA - Condominio360

Documento completo para el despliegue del ambiente de Quality Assurance, incluyendo flujo de Git, PM2 y script de limpieza de base de datos.

---

## 1. Requisitos previos

- **Node.js** v18+ (recomendado LTS)
- **npm** o **yarn**
- **Git**
- **PM2** (gestor de procesos)
- **SQL Server** (accesible desde el servidor QA)
- Variables de entorno configuradas (ver `.env.example`)

### Instalación de PM2

```bash
npm install -g pm2
```

---

## 2. Flujo de Git para QA

### 2.1 Crear la rama QA

```bash
# Asegurarse de estar en develop con lo último
git checkout develop
git pull origin develop

# Crear y cambiar a la rama qa
git checkout -b qa

# Subir la rama qa al remoto
git push -u origin qa
```

### 2.2 Trabajar en QA

```bash
# Cambiar a la rama qa
git checkout qa

# Traer cambios de develop (si aplica)
git merge develop

# Hacer commits locales y subir
git add .
git commit -m "fix: descripción del cambio"
git push origin qa
```

### 2.3 Pasar de QA a Main (release)

```bash
# 1. Asegurarse de que qa está al día y probada
git checkout qa
git pull origin qa

# 2. Ir a main y hacer merge
git checkout main
git pull origin main

# 3. Merge de qa a main
git merge qa -m "release: merge qa -> main para producción"

# 4. Subir main
git push origin main

# 5. Opcional: etiquetar la release
git tag -a v2.0.1 -m "Release QA validado"
git push origin v2.0.1

# 6. Volver a develop y sincronizar
git checkout develop
git merge main
git push origin develop
```

### 2.4 Resumen de checkouts habituales

| Acción                         | Comando                    |
|--------------------------------|----------------------------|
| Ir a rama `qa`                 | `git checkout qa`          |
| Ir a rama `develop`            | `git checkout develop`     |
| Ir a rama `main`               | `git checkout main`        |
| Ver rama actual                | `git branch` o `git status`|
| Listar ramas remotas           | `git branch -r`            |

---

## 3. Despliegue en el servidor QA

### 3.1 Clonar o actualizar el repositorio

```bash
# Primera vez (clonar)
git clone <url-del-repo> condominio360
cd condominio360

# Actualizar código existente
git fetch origin
git checkout qa
git pull origin qa
```

### 3.2 Configurar entorno

```bash
# Copiar y editar variables de entorno
cp .env.example .env
# Editar .env con valores de QA (DB, APP_URL, SMTP, etc.)
```

Variables clave para QA:

- `NODE_ENV=qa` o `development`
- `APP_URL=https://qa.condominio-360.com` (o la URL real de QA)
- `PORT=3000` (o el puerto configurado)
- Conexión a base de datos de QA
- JWT_SECRET, reCAPTCHA, SMTP según entorno

### 3.3 Instalar dependencias

```bash
npm install --omit=dev
# o, si usas devDependencies para build: npm install
```

### 3.4 Ejecutar migraciones (si aplica)

```bash
npm run migrate
```

### 3.5 Levantar el servicio con PM2

**Opción A — `ecosystem.config.cjs` (recomendado):** incluye `log_date_format` para que cada línea en `pm2 logs` / `*-error.log` lleve fecha y hora.

```bash
pm2 start ecosystem.config.cjs
```

**Opción B — línea de comandos** (sin timestamps en el archivo de log salvo que uses `--log-date-format`):

```bash
pm2 start src/app.js --name condominio360 --log-date-format "YYYY-MM-DD HH:mm:ss Z"
```

O especificando Node explícitamente:

```bash
pm2 start node --name condominio360 --log-date-format "YYYY-MM-DD HH:mm:ss Z" -- src/app.js
```

### 3.6 Comandos PM2 útiles

| Acción                  | Comando                                  |
|-------------------------|------------------------------------------|
| Ver estado              | `pm2 status`                             |
| Ver logs en vivo         | `pm2 logs condominio360`                 |
| Reiniciar               | `pm2 restart condominio360`              |
| Detener                 | `pm2 stop condominio360`                 |
| Eliminar del listado     | `pm2 delete condominio360`               |
| Monitoreo               | `pm2 monit`                              |

### 3.7 Inicio automático al reiniciar el servidor

```bash
pm2 startup
pm2 save
```

---

## 4. Script de limpieza de base de datos

El script elimina **todo** excepto el SuperAdmin (`Users.is_superadmin = 1`): propietarios, tenants, facturas, solicitudes, cartas/comunicados, visitantes, etc.

### 4.1 Ejecutar con Node

```bash
# Desde la raíz del proyecto
node scripts/cleanup-database.js
```

O usando el script de npm:

```bash
npm run cleanup-db
```

Asegúrate de tener configurado `.env` con la conexión a la base de datos (DB_HOST, DB_USER, DB_PASS, DB_NAME).

### 4.2 Ejecutar con SSMS (SQL Server Management Studio)

1. Conectar a la instancia de SQL Server.
2. Seleccionar la base de datos del proyecto.
3. Abrir el archivo `scripts/cleanup-database.sql`.
4. Ejecutar el script (F5 o botón Ejecutar).

Ruta del archivo: `scripts/cleanup-database.sql`

### 4.3 Precaución

- **Solo para QA** o entornos de pruebas.
- No ejecutar en producción sin respaldo y aprobación.
- Se preserva únicamente el usuario SuperAdmin.

---

## 5. Checklist de despliegue QA

- [ ] Código en rama `qa` actualizado
- [ ] `.env` configurado para QA
- [ ] `npm install` ejecutado
- [ ] Migraciones ejecutadas (`npm run migrate`)
- [ ] PM2 iniciado: `pm2 start ecosystem.config.cjs` (o `pm2 start src/app.js --name condominio360`)
- [ ] Verificar que la app responde: `curl http://localhost:3000` (o el puerto configurado)
- [ ] (Opcional) Ejecutar limpieza de BD si se parte de cero: `npm run cleanup-db`

---

## 6. Estructura de archivos relevantes

| Archivo / Carpeta           | Descripción                          |
|----------------------------|--------------------------------------|
| `src/app.js`               | Entry point de la aplicación         |
| `scripts/cleanup-database.js` | Script Node para limpiar la BD   |
| `scripts/cleanup-database.sql` | Script SQL para ejecutar en SSMS |
| `.env` / `.env.example`     | Variables de entorno                 |
| `package.json`             | `main`: `src/app.js`, scripts npm    |

---

## 7. Contacto y soporte

Para dudas sobre el despliegue o la configuración de QA, consultar al equipo de desarrollo.
