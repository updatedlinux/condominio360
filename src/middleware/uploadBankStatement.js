const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = './uploads/bank-statements';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, uniqueSuffix + (ext || '.bin'));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedMimes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv',
        'text/plain'
    ];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.pdf', '.xlsx', '.xls', '.csv', '.txt'];
    if (allowedMimes.includes(file.mimetype) && allowedExts.some(e => ext === e)) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten PDF, XLSX, XLS o CSV de estado de cuenta'), false);
    }
};

const uploadBankStatement = multer({
    storage,
    fileFilter,
    limits: { fileSize: 20 * 1024 * 1024 }
});

module.exports = uploadBankStatement;
