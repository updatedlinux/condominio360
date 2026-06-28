const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ZipArchive } = require('archiver');
const EarthquakeCensusModel = require('../models/EarthquakeCensusModel');

const ZIP_DIR = path.join(process.cwd(), 'uploads', 'earthquake-census-zips');
const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

function getBaseUrl() {
    return (process.env.APP_URL || 'https://condominio-360.com').trim().replace(/\/$/, '');
}

function safeZipPart(name) {
    return String(name || 'unidad').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40);
}

class EarthquakeCensusPhotoZipService {
    static getPublicUrl(token) {
        if (!token) return null;
        return `${getBaseUrl()}/terremotove/fotos/${token}`;
    }

    static ensureZipDir() {
        if (!fs.existsSync(ZIP_DIR)) {
            fs.mkdirSync(ZIP_DIR, { recursive: true });
        }
    }

    /**
     * Comprime todas las fotos de un inmueble y persiste token/enlace permanente.
     * @returns {Promise<{ token: string, url: string, photoCount: number }|null>}
     */
    static async rebuildForSubmission(submissionId) {
        const full = await EarthquakeCensusModel.getSubmissionFull(submissionId);
        if (!full) return null;

        const photos = full.photos || [];
        const validPhotos = photos.filter((photo) => fs.existsSync(path.join(UPLOADS_ROOT, photo.file_path)));
        if (!validPhotos.length) {
            return full.photos_zip_token
                ? { token: full.photos_zip_token, url: this.getPublicUrl(full.photos_zip_token), photoCount: 0 }
                : null;
        }

        this.ensureZipDir();

        let token = full.photos_zip_token;
        if (!token) {
            token = crypto.randomBytes(24).toString('hex');
        }

        const zipFileName = `${token}.zip`;
        const zipRelativePath = `earthquake-census-zips/${zipFileName}`;
        const zipAbsolutePath = path.join(ZIP_DIR, zipFileName);
        const folderName = `${safeZipPart(full.building_label)}_${safeZipPart(full.apartment_label)}`;

        await new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipAbsolutePath);
            const archive = new ZipArchive({ zlib: { level: 6 } });
            let filesAdded = 0;

            output.on('close', () => {
                if (filesAdded === 0) {
                    fs.unlink(zipAbsolutePath, () => reject(new Error('No hay archivos de foto válidos')));
                } else {
                    resolve();
                }
            });
            archive.on('error', reject);
            archive.pipe(output);

            validPhotos.forEach((photo, idx) => {
                const diskPath = path.join(UPLOADS_ROOT, photo.file_path);
                const ext = path.extname(photo.original_name || photo.file_path) || '.jpg';
                const entryName = `${folderName}/foto_${String(idx + 1).padStart(2, '0')}${ext}`;
                archive.file(diskPath, { name: entryName });
                filesAdded += 1;
            });

            archive.finalize();
        });

        await EarthquakeCensusModel.updatePhotoZipMeta(submissionId, token, zipRelativePath);

        return {
            token,
            url: this.getPublicUrl(token),
            photoCount: validPhotos.length
        };
    }

    /**
     * Genera ZIPs faltantes antes de exportar PDF (tenant completo).
     */
    static async ensureZipsForTenant(tenantId) {
        const submissions = await EarthquakeCensusModel.listSubmissionsWithPhotos(tenantId);
        const results = [];
        for (const s of submissions) {
            const built = await this.rebuildForSubmission(s.id);
            if (built) results.push(built);
        }
        return results;
    }

    static async streamZipByToken(token, res) {
        const submission = await EarthquakeCensusModel.findSubmissionByPhotoToken(token);
        if (!submission || !submission.photos_zip_path) {
            return { found: false };
        }

        const absPath = path.join(UPLOADS_ROOT, submission.photos_zip_path);
        if (!fs.existsSync(absPath)) {
            await this.rebuildForSubmission(submission.id);
            if (!fs.existsSync(absPath)) {
                return { found: false };
            }
        }

        const downloadName = `fotos-danos_${safeZipPart(submission.building_label)}_${safeZipPart(submission.apartment_label)}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
        fs.createReadStream(absPath).pipe(res);
        return { found: true };
    }
}

module.exports = EarthquakeCensusPhotoZipService;
