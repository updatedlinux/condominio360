const mammoth = require('mammoth');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Servicio para procesar archivos Word (DOCX) y convertirlos a HTML
 */
class WordProcessingService {
    constructor() {
        this.uploadDir = process.env.UPLOAD_DIR || './uploads/communiques';
        this.ensureUploadDir();
    }

    /**
     * Asegurar que el directorio de uploads exista
     */
    async ensureUploadDir() {
        try {
            await fs.mkdir(this.uploadDir, { recursive: true });
        } catch (error) {
            console.error('Error creating upload directory:', error);
        }
    }

    /**
     * Procesar archivo DOCX y convertir a HTML
     * @param {string} filePath - Ruta del archivo DOCX
     * @returns {Promise<Object>} { html, images, text }
     */
    async processDocx(filePath) {
        try {
            console.log('📝 Procesando archivo DOCX:', filePath);

            // Leer el archivo
            const fileBuffer = await fs.readFile(filePath);

            // Convertir DOCX a HTML usando mammoth
            const result = await mammoth.convertToHtml({ buffer: fileBuffer }, {
                styleMap: [
                    "p[style-name='Heading 1'] => h1",
                    "p[style-name='Heading 2'] => h2",
                    "p[style-name='Heading 3'] => h3",
                    "p[style-name='Heading 4'] => h4",
                    "b => strong",
                    "i => em",
                    "u => u",
                ],
                convertImage: mammoth.images.imgElement(this.convertImage.bind(this))
            });

            // Extraer texto plano también
            const textResult = await mammoth.extractRawText({ buffer: fileBuffer });

            console.log('✅ DOCX procesado exitosamente');
            console.log('   - Mensajes:', result.messages);
            console.log('   - Longitud HTML:', result.value.length);

            return {
                html: result.value,
                text: textResult.value,
                messages: result.messages,
                images: this.extractedImages || []
            };

        } catch (error) {
            console.error('❌ Error procesando DOCX:', error);
            throw new Error(`Error al procesar archivo Word: ${error.message}`);
        }
    }

    /**
     * Convertir imagen embebida en DOCX a base64
     */
    async convertImage(image) {
        try {
            const imageBuffer = await image.read();
            const contentType = image.contentType;
            const extension = this.getExtensionFromContentType(contentType);
            const filename = `${uuidv4()}.${extension}`;
            
            // Guardar imagen en disco
            const imagePath = path.join(this.uploadDir, 'images', filename);
            await fs.mkdir(path.dirname(imagePath), { recursive: true });
            await fs.writeFile(imagePath, imageBuffer);

            // Crear URL relativa para la imagen
            const imageUrl = `/uploads/communiques/images/${filename}`;

            // Guardar referencia
            if (!this.extractedImages) {
                this.extractedImages = [];
            }
            this.extractedImages.push({
                filename,
                path: imagePath,
                url: imageUrl,
                contentType,
                size: imageBuffer.length
            });

            // Retornar elemento img con data URL para el HTML inicial
            const base64 = imageBuffer.toString('base64');
            return {
                src: `data:${contentType};base64,${base64}`,
                'data-filename': filename,
                'data-image-url': imageUrl
            };

        } catch (error) {
            console.error('Error converting image:', error);
            return { src: '' };
        }
    }

    /**
     * Generar HTML completo para el comunicado
     */
    generateFullHtml(title, description, contentHtml, authorName = null, createdAt = null) {
        const dateStr = createdAt ? new Date(createdAt).toLocaleDateString('es-VE', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'America/Caracas'
        }) : '';

        return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.8;
            color: #333;
            max-width: 900px;
            margin: 0 auto;
            padding: 40px 20px;
            background: #f5f5f5;
        }
        .communique-container {
            background: white;
            padding: 50px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .communique-header {
            border-bottom: 3px solid #8B5028;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .communique-title {
            font-size: 28px;
            font-weight: 600;
            color: #1a1a1a;
            margin: 0 0 15px 0;
            line-height: 1.3;
        }
        .communique-meta {
            color: #666;
            font-size: 14px;
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }
        .communique-meta span {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .communique-description {
            background: #f8f9fa;
            border-left: 4px solid #8B5028;
            padding: 20px;
            margin-bottom: 30px;
            font-style: italic;
            color: #555;
        }
        .communique-content {
            font-size: 16px;
            line-height: 1.8;
        }
        .communique-content h1 { font-size: 24px; color: #1a1a1a; margin: 30px 0 15px; }
        .communique-content h2 { font-size: 22px; color: #333; margin: 25px 0 12px; }
        .communique-content h3 { font-size: 20px; color: #444; margin: 20px 0 10px; }
        .communique-content h4 { font-size: 18px; color: #555; margin: 15px 0 8px; }
        .communique-content p { margin: 15px 0; text-align: justify; }
        .communique-content strong { font-weight: 600; color: #1a1a1a; }
        .communique-content em { font-style: italic; }
        .communique-content u { text-decoration: underline; }
        .communique-content ul, .communique-content ol { margin: 15px 0; padding-left: 30px; }
        .communique-content li { margin: 8px 0; }
        .communique-content table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        .communique-content th, .communique-content td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }
        .communique-content th {
            background: #f8f9fa;
            font-weight: 600;
        }
        .communique-content img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 20px auto;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .communique-content blockquote {
            border-left: 4px solid #8B5028;
            margin: 20px 0;
            padding: 15px 20px;
            background: #f8f9fa;
            font-style: italic;
        }
        .communique-footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            text-align: center;
            color: #999;
            font-size: 12px;
        }
        @media print {
            body { background: white; padding: 0; }
            .communique-container { box-shadow: none; padding: 20px; }
        }
        @media (max-width: 768px) {
            .communique-container { padding: 25px; }
            .communique-title { font-size: 22px; }
            .communique-content { font-size: 15px; }
        }
    </style>
</head>
<body>
    <div class="communique-container">
        <header class="communique-header">
            <h1 class="communique-title">${title}</h1>
            <div class="communique-meta">
                ${dateStr ? `<span>📅 ${dateStr}</span>` : ''}
                ${authorName ? `<span>✍️ ${authorName}</span>` : ''}
            </div>
        </header>
        
        ${description ? `
        <div class="communique-description">
            ${description}
        </div>
        ` : ''}
        
        <div class="communique-content">
            ${contentHtml}
        </div>
        
        <footer class="communique-footer">
            <p>Este comunicado fue emitido por la Junta de Condominio</p>
            <p>Sistema Condominio360</p>
        </footer>
    </div>
</body>
</html>`;
    }

    /**
     * Guardar archivo subido
     */
    async saveFile(buffer, originalFilename) {
        try {
            const ext = path.extname(originalFilename);
            const filename = `${uuidv4()}${ext}`;
            const filePath = path.join(this.uploadDir, filename);
            
            await fs.writeFile(filePath, buffer);
            
            return {
                filename,
                originalFilename,
                path: filePath,
                size: buffer.length
            };
        } catch (error) {
            console.error('Error saving file:', error);
            throw error;
        }
    }

    /**
     * Limpiar archivo temporal
     */
    async cleanupFile(filePath) {
        try {
            await fs.unlink(filePath);
            console.log('🗑️ Archivo temporal eliminado:', filePath);
        } catch (error) {
            console.warn('⚠️ No se pudo eliminar archivo temporal:', error.message);
        }
    }

    /**
     * Obtener extensión desde content type
     */
    getExtensionFromContentType(contentType) {
        const map = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/bmp': 'bmp'
        };
        return map[contentType] || 'png';
    }

    /**
     * Procesar PDF (placeholder - solo guarda el archivo)
     */
    async processPdf(filePath) {
        return {
            html: null,
            text: null,
            type: 'pdf',
            path: filePath
        };
    }
}

module.exports = new WordProcessingService();
