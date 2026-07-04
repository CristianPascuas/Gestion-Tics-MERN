const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Carpeta temporal para archivos cargados antes de procesamiento definitivo.
const tmpDir = path.resolve(__dirname, '../../media/tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// Configuración de almacenamiento en disco para multer.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir),
  filename: (_req, file, cb) => {
    const safeOriginal = String(file.originalname || 'carta.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeOriginal}`);
  }
});

// Middleware para carta de solicitud (solo PDF, máximo 5MB).
const uploadCartaSolicitud = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Se acepta únicamente PDF por MIME o extensión.
    const isPdfMime = file.mimetype === 'application/pdf';
    const isPdfName = String(file.originalname || '').toLowerCase().endsWith('.pdf');

    if (!isPdfMime && !isPdfName) {
      cb(new Error('Solo se permiten archivos PDF para la carta de solicitud'));
      return;
    }

    cb(null, true);
  }
});

// Middleware para documento de identidad de aspirante (solo PDF, máximo 5MB).
const uploadDocumentoAspirante = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdfMime = file.mimetype === 'application/pdf';
    const isPdfName = String(file.originalname || '').toLowerCase().endsWith('.pdf');

    if (!isPdfMime && !isPdfName) {
      cb(new Error('Solo se permiten archivos PDF para documento de identidad'));
      return;
    }

    cb(null, true);
  }
});

// Middleware para archivo SOFiA Plus (Excel .xls/.xlsx, máximo 10MB).
const uploadSofiaPlusExcel = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const originalName = String(file.originalname || '').toLowerCase();
    const allowedMimeTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    const isExcelMime = allowedMimeTypes.includes(String(file.mimetype || '').toLowerCase());
    const isExcelName = originalName.endsWith('.xls') || originalName.endsWith('.xlsx');

    if (!isExcelMime && !isExcelName) {
      cb(new Error('Solo se permiten archivos Excel (.xls, .xlsx) para SOFiA Plus'));
      return;
    }

    cb(null, true);
  }
});

module.exports = {
  uploadCartaSolicitud,
  uploadDocumentoAspirante,
  uploadSofiaPlusExcel,
  // Ruta base de medios para reutilizar en utilidades/controladores.
  mediaRoot: path.resolve(__dirname, '../../media')
};