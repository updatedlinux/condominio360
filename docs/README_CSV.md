# Guía de Carga Masiva CSV - Condominio360

## 📁 Archivos de Ejemplo

### Inmuebles

| Archivo | Descripción |
|---------|-------------|
| `ejemplo_inmuebles_facturacion_fija_edificio_unico.csv` | Facturación FIJA + Edificio único |
| `ejemplo_inmuebles_alicuota_edificio_unico.csv` | Facturación ALICUOTA + Edificio único |
| `ejemplo_inmuebles_facturacion_fija_multi_edificio.csv` | Facturación FIJA + Múltiples edificios |
| `ejemplo_inmuebles_alicuota_multi_edificio.csv` | Facturación ALICUOTA + Múltiples edificios |

### Propietarios

| Archivo | Descripción |
|---------|-------------|
| `ejemplo_propietarios_carga_masiva.csv` | Carga de propietarios - Edificio único |
| `ejemplo_propietarios_multi_edificio.csv` | Carga de propietarios - Multi-edificio |

---

## 📋 Estructura CSV - Inmuebles

### Campos Base (siempre requeridos)
- `nombre` - Nombre del inmueble (ej: "Apartamento 1A")
- `tipo` - Tipo: APARTAMENTO, LOCAL, ESTACIONAMIENTO, BODEGA, OFICINA, OTRO
- `piso` - Número de piso (ej: 1, 2, PB, SS, PH)
- `numero` - Número de unidad (ej: 101, A1, LC01)

### Campos Condicionales

#### Si el condominio usa ALICUOTA:
- `alicuota` - Porcentaje (ej: 8.50). La suma de TODAS las alícuotas debe ser exactamente 100.00

#### Si el condominio es MULTI-EDIFICIO:
- `edificio` - Nombre exacto del edificio (debe existir previamente)

### Campos Opcionales
- `observaciones` - Notas adicionales

---

## 📋 Estructura CSV - Propietarios

### ⚠️ Identificador Único: `numero_documento`

**El número de documento (DNI/CE/Pasaporte) es el identificador único del propietario.**

- Si el documento **ya existe**: Se actualizan los datos (nombre, email, teléfono) y se asigna la nueva propiedad
- Si el documento **no existe**: Se crea un nuevo propietario

Esto permite que un propietario tenga:
- Múltiples propiedades en el mismo condominio
- Propiedades en diferentes condominios (mismo DNI, diferentes emails si es necesario)

### Campos Requeridos
- `numero_documento` - **Identificador único** (DNI, CE, Pasaporte, etc.)
- `nombre` - Nombre completo del propietario
- `email` - Correo electrónico (se actualiza si cambia)

### Campos Opcionales
- `telefono` - Teléfono de contacto
- `inmueble_slug` - Slug del inmueble a asignar (ver nota abajo)
- `tipo_documento` - Tipo: DNI, CE, PASAPORTE, RUC, OTRO
- `direccion` - Dirección postal
- `observaciones` - Notas adicionales

### Orden Recomendado de Columnas
```
numero_documento,nombre,email,telefono,inmueble_slug,tipo_documento,direccion
12345678,Juan Pérez,juan@email.com,555-0000,apartamento-101,DNI,Av. Principal 123
```

### Nota sobre `inmueble_slug`

El slug se genera automáticamente a partir del nombre del inmueble:
- "Apartamento 1A" → `apartamento-1a`
- "Local Comercial PB" → `local-comercial-pb`
- "Estacionamiento A1" → `estacionamiento-a1`

Para **multi-edificio**, el slug incluye el edificio:
- "Torre A - Apartamento 101" → `torre-a-apartamento-101`

---

## ⚠️ Validaciones Importantes

### Para Inmuebles con Alicuota:
1. La suma de todas las alícuotas debe ser exactamente 100.00
2. Cada alícuota debe ser un número positivo
3. El sistema rechazará la carga si no se cumple

### Para Multi-Edificio:
1. Los edificios deben existir previamente en el sistema
2. El nombre en el CSV debe coincidir exactamente (case-sensitive)
3. Se recomienda descargar la lista de edificios antes de preparar el CSV

### Para Propietarios:
1. **El `numero_documento` es el identificador único** - Si ya existe, se actualizan los demás datos
2. El email se actualiza si el propietario ya existe (permite cambiar email manteniendo el DNI)
3. El inmueble_slug debe existir (si se proporciona)
4. Un inmueble solo puede tener un propietario principal
5. Un propietario puede tener múltiples inmuebles (en el mismo u otros condominios)

---

## 🔄 Flujo de Trabajo Recomendado

### Paso 1: Configurar el Condominio
1. Definir tipo de facturación (Fija o Alicuota)
2. Crear los edificios (si es multi-edificio)

### Paso 2: Preparar CSV de Inmuebles
1. Descargar el ejemplo apropiado según la configuración
2. Completar los datos
3. Validar que suma de alícuotas = 100 (si aplica)

### Paso 3: Cargar Inmuebles
1. Usar la opción "Carga Masiva" en el panel
2. Subir el CSV
3. Revisar el resumen antes de confirmar

### Paso 4: Preparar CSV de Propietarios
1. **Usar el número de documento (DNI) como identificador único**
2. Obtener la lista de slugs de inmuebles cargados
3. Asignar cada propietario a su inmueble correspondiente
4. Completar datos de contacto (nombre, email, teléfono)
5. Verificar que no haya duplicados de DNI en el CSV

### Paso 5: Cargar Propietarios
1. Usar la opción "Carga Masiva" en la sección de propietarios
2. Subir el CSV
3. Verificar asignaciones correctas

---

## 💡 Consejos

- Usa un editor de hojas de cálculo (Excel, Google Sheets) y exporta a CSV
- Guarda una copia de respaldo antes de cargar
- Comienza con pocos registros para probar el formato
- Revisa los mensajes de error del sistema si hay problemas
- Los campos con comas deben ir entre comillas (ej: "Local Comercial, PB")
