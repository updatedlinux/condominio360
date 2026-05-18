/**
 * Dimensiones estándar del logo de conjunto (vista previa admin y PDF de recibos).
 * PDF usa puntos (pt); pantalla usa px (~1.33 pt/px en 96dpi para referencia).
 */
const TENANT_LOGO = {
    /** Archivo almacenado (px) */
    storageMaxWidth: 400,
    storageMaxHeight: 160,
    /** Vista previa Super Admin (px) */
    previewWidth: 160,
    previewHeight: 112,
    /** Encabezado PDF de recibo (pt) */
    pdfWidth: 168,
    pdfHeight: 64
};

module.exports = TENANT_LOGO;
