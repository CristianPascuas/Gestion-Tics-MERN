const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { PDFDocument } = require('pdf-lib');
const { Aspirante } = require('../models/Aspirante');
const { Solicitud } = require('../models/Solicitud');
const { Ficha } = require('../models/Ficha');
const { SolicitudCoordinador } = require('../models/SolicitudCoordinador');
const { SolicitudFuncionario } = require('../models/SolicitudFuncionario');
const { Caracterizacion, TipoIdentificacion } = require('../models/SolicitudCatalogs');
const { mediaRoot } = require('../middleware/upload');

// Marcador persistido en solicitud cuando el enlace de inscripción queda cerrado.
const PREINSCRIPCION_CERRADA = 'cerrado';
// Título oficial del formato base de inscripción masiva.
const INSCRIPCION_FORMAT_TITLE = 'FORMATO PARA LA INSCRIPCIÓN DE ASPIRANTES EN SOFIA PLUS v1.0';
// Encabezados estándar requeridos por el formato de carga SOFiA Plus.
const INSCRIPCION_FORMAT_HEADERS = [
  'Resultado del Registro (Reservado para el sistema)',
  'Tipo de identificación',
  'Número de identificación',
  'Código de ficha',
  'Tipo población aspirantes',
  '',
  'Código empresa (solo si la ficha es cerrada)'
];

// Normaliza catálogos y comparaciones de texto para validaciones robustas.
const normalizeText = (value) => String(value || '').trim().toUpperCase();

const normalizeState = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

// Lee catálogos dinámicos desde Mongo (migrados desde SQL/Django).
const getAspiranteCatalogs = async () => {
  const [documentRows, caracterizacionRows] = await Promise.all([
    TipoIdentificacion.find().sort({ legacyId: 1, nombre: 1 }).lean(),
    Caracterizacion.find().sort({ legacyId: 1, nombre: 1 }).lean()
  ]);

  const documentTypes = (documentRows || [])
    .map((item) => normalizeText(item?.nombre))
    .filter(Boolean);

  const caracterizaciones = (caracterizacionRows || [])
    .map((item) => normalizeText(item?.nombre))
    .filter(Boolean);

  // Requisito funcional: siempre debe existir opción de "NINGUNO".
  if (!caracterizaciones.includes('NINGUNO')) {
    caracterizaciones.push('NINGUNO');
  }

  return {
    documentTypes: [...new Set(documentTypes)],
    caracterizaciones: [...new Set(caracterizaciones)]
  };
};

// Limpia texto simple de entrada conservando contenido literal del usuario.
const cleanText = (value) => String(value || '').trim();

// Elimina archivos de forma segura evitando excepciones por rutas inexistentes.
const safeUnlink = async (absolutePath) => {
  if (!absolutePath) {
    return;
  }

  if (fs.existsSync(absolutePath)) {
    await fs.promises.unlink(absolutePath);
  }
};

// Detecta error de índice único en MongoDB.
const isMongoDuplicateKeyError = (error) => {
  return Number(error?.code) === 11000;
};

// Traduce el campo duplicado de Mongo a etiqueta legible para respuesta API.
const getDuplicateFieldName = (error) => {
  const duplicateKey = Object.keys(error?.keyPattern || error?.keyValue || {})
    .find((key) => key !== 'solicitud');

  if (duplicateKey === 'documentNumber') {
    return 'documento';
  }

  if (duplicateKey === 'phone') {
    return 'teléfono';
  }

  if (duplicateKey === 'email') {
    return 'correo';
  }

  return 'dato';
};

// Detecta errores de validación emitidos por Mongoose.
const isMongooseValidationError = (error) => {
  return String(error?.name || '') === 'ValidationError';
};

// Obtiene solicitud con datos mínimos requeridos por la pantalla pública.
const getSolicitudById = async (solicitudId) => {
  return Solicitud.findById(solicitudId)
    .populate('programa', 'nombre')
    .populate('tipoSolicitud', 'nombre')
    .lean();
};

// Cuenta inscritos de una solicitud para validaciones de cupo y cierre.
const countAspirantesBySolicitud = async (solicitudId) => {
  return Aspirante.countDocuments({ solicitud: solicitudId });
};

// Regla central para cierre: cupo alcanzado o enlace marcado como cerrado.
const isInscripcionClosed = ({ solicitud, totalAspirantes }) => {
  const reachedCapacity = Number(totalAspirantes) >= Number(solicitud?.cupo || 0);
  return reachedCapacity || String(solicitud?.linkPreinscripcion || '').toLowerCase() === PREINSCRIPCION_CERRADA;
};

// Sincroniza estado del enlace en Solicitud según el conteo real de inscritos.
const syncSolicitudPreinscripcionStatus = async (solicitud, totalAspirantes) => {
  if (!solicitud) {
    return;
  }

  const reachedCapacity = Number(totalAspirantes) >= Number(solicitud.cupo || 0);
  const expectedStatus = reachedCapacity ? PREINSCRIPCION_CERRADA : null;

  if ((solicitud.linkPreinscripcion || null) !== expectedStatus) {
    await Solicitud.updateOne(
      { _id: solicitud._id },
      { $set: { linkPreinscripcion: expectedStatus } }
    );
  }
};

// Permisos de gestión interna: instructor dueño de la solicitud o admin.
const ensureManagePermission = ({ user, solicitud }) => {
  const role = String(user?.roleKey || '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  if (role !== 'instructor') {
    return false;
  }

  return String(solicitud?.usuario || '') === String(user?._id || '');
};

// Permisos de lectura por rol: instructor dueño, coordinador asignado, funcionario con aprobación.
const ensureReadPermission = async ({ user, solicitud }) => {
  const role = String(user?.roleKey || '').toLowerCase();

  if (role === 'admin') {
    return true;
  }

  if (role === 'instructor') {
    return String(solicitud?.usuario || '') === String(user?._id || '');
  }

  if (role === 'coordinador') {
    const assigned = await SolicitudCoordinador.findOne({
      solicitud: solicitud?._id,
      usuarioRevisador: user?._id
    })
      .select('_id')
      .lean();

    return Boolean(assigned);
  }

  if (role === 'funcionario') {
    const lastRevision = await SolicitudCoordinador.findOne({ solicitud: solicitud?._id })
      .populate('estado', 'nombre')
      .sort({ fecha: -1, createdAt: -1 })
      .lean();

    const estadoActual = normalizeState(lastRevision?.estado?.nombre || '');
    return estadoActual.includes('aprob');
  }

  return false;
};

// Define si la gestión de aspirantes queda bloqueada según última revisión de coordinación.
const isSolicitudGestionBloqueada = async (solicitud) => {
  if (!solicitud) {
    return false;
  }

  const [lastRevision, lastRevisionFuncionario] = await Promise.all([
    SolicitudCoordinador.findOne({ solicitud: solicitud._id })
      .populate('estado', 'nombre')
      .sort({ fecha: -1, createdAt: -1 })
      .lean(),
    SolicitudFuncionario.findOne({ solicitud: solicitud._id })
      .sort({ fecha: -1, createdAt: -1 })
      .lean()
  ]);

  if (!lastRevision) {
    return false;
  }

  const estadoActual = normalizeState(lastRevision?.estado?.nombre || '');
  const estadoFuncionarioActual = normalizeState(lastRevisionFuncionario?.estado || '');

  if (estadoActual.includes('rechaz')) {
    return false;
  }

  if (estadoActual.includes('aprob')) {
    if (estadoFuncionarioActual === 'rechazado') {
      return false;
    }

    return true;
  }

  return true;
};

// Payload unificado para formulario público de preinscripción.
const buildSolicitudInscripcionPayload = async (solicitud) => {
  const totalAspirantes = await countAspirantesBySolicitud(solicitud._id);
  const closed = isInscripcionClosed({ solicitud, totalAspirantes });
  const catalogs = await getAspiranteCatalogs();

  return {
    solicitud: {
      id: solicitud._id,
      codigoSolicitud: solicitud.codigoSolicitud,
      tipoSolicitud: solicitud.tipoSolicitud?.nombre || '',
      programa: solicitud.programa?.nombre || '',
      cupo: solicitud.cupo,
      totalAspirantes,
      cuposDisponibles: Math.max(0, Number(solicitud.cupo || 0) - Number(totalAspirantes)),
      inscripcionCerrada: closed
    },
    catalogs
  };
  // Genera filas normalizadas para vista/descarga del formato de inscripción masiva.
};

// Resuelve solicitud por ID y retorna 404 homogéneo cuando no existe.
const ensureSolicitudExists = async (req, res) => {
  const solicitud = await getSolicitudById(req.params.id);
  if (!solicitud) {
    res.status(404).json({ message: 'Solicitud no encontrada' });
    return null;
  }

  return solicitud;
};

// Endpoint público: consulta estado de cupo + catálogos para formulario.
const getInscripcionPublica = async (req, res, next) => {
  try {
    const solicitud = await ensureSolicitudExists(req, res);
    if (!solicitud) {
      return;
    }

    const payload = await buildSolicitudInscripcionPayload(solicitud);
    await syncSolicitudPreinscripcionStatus(solicitud, payload.solicitud.totalAspirantes);

    return res.status(200).json(payload);
  } catch (error) {
    return next(error);
  }
};

// Endpoint público: registra aspirante con validación de catálogos y PDF.
const registerAspirantePublic = async (req, res, next) => {
  let movedDocumentAbsolutePath = null;
  try {
    const solicitud = await ensureSolicitudExists(req, res);
    if (!solicitud) {
      return;
    }

    const gestionBloqueada = await isSolicitudGestionBloqueada(solicitud);
    if (gestionBloqueada) {
      return res.status(409).json({ message: 'La solicitud ya fue enviada al coordinador y no permite más cambios en aspirantes' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Debe adjuntar el documento de identidad en PDF' });
    }

    const {
      firstName,
      lastName,
      documentType,
      documentNumber,
      phone,
      email,
      caracterizacion
    } = req.body;

    const normalizedData = {
      firstName: cleanText(firstName),
      lastName: cleanText(lastName),
      documentType: normalizeText(documentType),
      documentNumber: cleanText(documentNumber),
      phone: cleanText(phone),
      email: cleanText(email).toLowerCase(),
      caracterizacion: normalizeText(caracterizacion)
    };

    if (
      !normalizedData.firstName ||
      !normalizedData.lastName ||
      !normalizedData.documentType ||
      !normalizedData.documentNumber ||
      !normalizedData.phone ||
      !normalizedData.email ||
      !normalizedData.caracterizacion
    ) {
      return res.status(400).json({ message: 'Faltan campos obligatorios del aspirante' });
    }

    // Valida que los valores enviados existan en catálogos activos de BD.
    const catalogs = await getAspiranteCatalogs();
    if (!catalogs.documentTypes.includes(normalizedData.documentType)) {
      return res.status(400).json({ message: 'Tipo de documento inválido' });
    }

    if (!catalogs.caracterizaciones.includes(normalizedData.caracterizacion)) {
      return res.status(400).json({ message: 'Tipo de caracterización inválido' });
    }

    const totalAspirantes = await countAspirantesBySolicitud(solicitud._id);
    if (isInscripcionClosed({ solicitud, totalAspirantes })) {
      await syncSolicitudPreinscripcionStatus(solicitud, totalAspirantes);
      return res.status(409).json({ message: 'Las inscripciones están cerradas para esta solicitud' });
    }

    // Duplicados válidos solo dentro de la misma solicitud.
    const duplicated = await Aspirante.findOne({
      solicitud: solicitud._id,
      $or: [
        { documentNumber: normalizedData.documentNumber },
        { phone: normalizedData.phone },
        { email: normalizedData.email }
      ]
    })
      .select('_id')
      .lean();

    if (duplicated) {
      return res.status(409).json({ message: 'Documento, teléfono o correo ya registrado en esta solicitud' });
    }

    // Guarda PDF con nombre por documento dentro de carpeta por solicitud.
    const solicitudFolder = `solicitud_${solicitud._id}`;
    const aspiranteFolder = path.join(mediaRoot, 'pdf', solicitudFolder);
    await fs.promises.mkdir(aspiranteFolder, { recursive: true });

    const targetFileName = `${normalizedData.documentNumber}.pdf`;
    const targetAbsolutePath = path.join(aspiranteFolder, targetFileName);

    if (fs.existsSync(targetAbsolutePath)) {
      return res.status(409).json({ message: 'Ya existe un documento PDF para este número de identificación' });
    }

    await fs.promises.rename(req.file.path, targetAbsolutePath);
    movedDocumentAbsolutePath = targetAbsolutePath;

    const aspirante = await Aspirante.create({
      solicitud: solicitud._id,
      firstName: normalizedData.firstName,
      lastName: normalizedData.lastName,
      documentType: normalizedData.documentType,
      documentNumber: normalizedData.documentNumber,
      phone: normalizedData.phone,
      email: normalizedData.email,
      caracterizacion: normalizedData.caracterizacion,
      documentPdfPath: `pdf/${solicitudFolder}/${targetFileName}`
    });

    const updatedCount = await countAspirantesBySolicitud(solicitud._id);
    await syncSolicitudPreinscripcionStatus(solicitud, updatedCount);

    return res.status(201).json({
      message: 'Aspirante registrado correctamente',
      aspirante: aspirante.toSafeObject(),
      cupo: {
        total: solicitud.cupo,
        inscritos: updatedCount,
        cuposDisponibles: Math.max(0, Number(solicitud.cupo || 0) - Number(updatedCount)),
        inscripcionCerrada: updatedCount >= Number(solicitud.cupo || 0)
      }
    });
  } catch (error) {
    // Si algo falla tras mover el archivo, limpia el PDF para evitar huérfanos en disco.
    try {
      if (movedDocumentAbsolutePath) {
        await safeUnlink(movedDocumentAbsolutePath);
      } else if (req.file?.path) {
        await safeUnlink(req.file.path);
      }
    } catch (_cleanupError) {
    }

    if (isMongoDuplicateKeyError(error)) {
      return res.status(409).json({
        message: `${getDuplicateFieldName(error)} ya registrado en esta solicitud`
      });
    }

    if (isMongooseValidationError(error)) {
      return res.status(400).json({ message: 'Datos de aspirante inválidos' });
    }

    return next(error);
  }
};

// Endpoint interno: lista inscritos para modal de gestión en consultas.
const listAspirantesBySolicitud = async (req, res, next) => {
  try {
    const solicitud = await ensureSolicitudExists(req, res);
    if (!solicitud) {
      return;
    }

    if (!ensureManagePermission({ user: req.user, solicitud })) {
      return res.status(403).json({ message: 'Sin permisos para gestionar aspirantes de esta solicitud' });
    }

    const aspirantes = await Aspirante.find({ solicitud: solicitud._id }).sort({ createdAt: -1 });
    const totalAspirantes = aspirantes.length;
    const gestionBloqueada = await isSolicitudGestionBloqueada(solicitud);
    const catalogs = await getAspiranteCatalogs();
    await syncSolicitudPreinscripcionStatus(solicitud, totalAspirantes);

    return res.status(200).json({
      solicitud: {
        id: solicitud._id,
        cupo: solicitud.cupo,
        totalAspirantes,
        cuposDisponibles: Math.max(0, Number(solicitud.cupo || 0) - Number(totalAspirantes)),
        inscripcionCerrada: totalAspirantes >= Number(solicitud.cupo || 0),
        gestionBloqueada
      },
      catalogs,
      aspirantes: aspirantes.map((item) => item.toSafeObject())
    });
  } catch (error) {
    return next(error);
  }
};

// Endpoint interno: edición de datos y posible reemplazo/renombre de PDF.
const updateAspirante = async (req, res, next) => {
  let movedDocumentAbsolutePath = null;
  let previousDocumentAbsolutePath = null;
  try {
    const solicitud = await ensureSolicitudExists(req, res);
    if (!solicitud) {
      return;
    }

    if (!ensureManagePermission({ user: req.user, solicitud })) {
      return res.status(403).json({ message: 'Sin permisos para editar aspirantes de esta solicitud' });
    }

    const gestionBloqueada = await isSolicitudGestionBloqueada(solicitud);
    if (gestionBloqueada) {
      return res.status(409).json({ message: 'La solicitud ya fue enviada al coordinador y no permite editar aspirantes' });
    }

    const aspirante = await Aspirante.findOne({ _id: req.params.aspiranteId, solicitud: solicitud._id });
    if (!aspirante) {
      return res.status(404).json({ message: 'Aspirante no encontrado' });
    }

    const previousDocumentNumber = aspirante.documentNumber;

    const patchData = {
      firstName: cleanText(req.body.firstName || aspirante.firstName),
      lastName: cleanText(req.body.lastName || aspirante.lastName),
      documentType: normalizeText(req.body.documentType || aspirante.documentType),
      documentNumber: cleanText(req.body.documentNumber || aspirante.documentNumber),
      phone: cleanText(req.body.phone || aspirante.phone),
      email: cleanText(req.body.email || aspirante.email).toLowerCase(),
      caracterizacion: normalizeText(req.body.caracterizacion || aspirante.caracterizacion)
    };

    // Reusa validación de catálogos para mantener consistencia de datos.
    const catalogs = await getAspiranteCatalogs();
    if (!catalogs.documentTypes.includes(patchData.documentType)) {
      return res.status(400).json({ message: 'Tipo de documento inválido' });
    }

    if (!catalogs.caracterizaciones.includes(patchData.caracterizacion)) {
      return res.status(400).json({ message: 'Tipo de caracterización inválido' });
    }

    const duplicated = await Aspirante.findOne({
      _id: { $ne: aspirante._id },
      solicitud: solicitud._id,
      $or: [
        { documentNumber: patchData.documentNumber },
        { phone: patchData.phone },
        { email: patchData.email }
      ]
    })
      .select('_id')
      .lean();

    if (duplicated) {
      return res.status(409).json({ message: 'Documento, teléfono o correo ya registrado en esta solicitud' });
    }

    // Si cambia documento, se renombra archivo cuando no llega nuevo PDF.
    const solicitudFolder = `solicitud_${solicitud._id}`;
    const aspiranteFolder = path.join(mediaRoot, 'pdf', solicitudFolder);
    await fs.promises.mkdir(aspiranteFolder, { recursive: true });

    const newFileName = `${patchData.documentNumber}.pdf`;
    const newFileAbsolutePath = path.join(aspiranteFolder, newFileName);

    if (req.file) {
      if (fs.existsSync(newFileAbsolutePath) && patchData.documentNumber !== previousDocumentNumber) {
        return res.status(409).json({ message: 'Ya existe un documento PDF para ese número de identificación' });
      }

      await fs.promises.rename(req.file.path, newFileAbsolutePath);
      movedDocumentAbsolutePath = newFileAbsolutePath;

      if (patchData.documentNumber !== previousDocumentNumber) {
        const oldFileAbsolutePath = path.join(aspiranteFolder, `${previousDocumentNumber}.pdf`);
        previousDocumentAbsolutePath = oldFileAbsolutePath;
        if (fs.existsSync(oldFileAbsolutePath)) {
          await fs.promises.unlink(oldFileAbsolutePath);
        }
      }

      aspirante.documentPdfPath = `pdf/${solicitudFolder}/${newFileName}`;
    } else if (patchData.documentNumber !== previousDocumentNumber) {
      const oldFileAbsolutePath = path.join(aspiranteFolder, `${previousDocumentNumber}.pdf`);
      if (fs.existsSync(oldFileAbsolutePath)) {
        await fs.promises.rename(oldFileAbsolutePath, newFileAbsolutePath);
      }
      aspirante.documentPdfPath = `pdf/${solicitudFolder}/${newFileName}`;
    }

    aspirante.firstName = patchData.firstName;
    aspirante.lastName = patchData.lastName;
    aspirante.documentType = patchData.documentType;
    aspirante.documentNumber = patchData.documentNumber;
    aspirante.phone = patchData.phone;
    aspirante.email = patchData.email;
    aspirante.caracterizacion = patchData.caracterizacion;

    await aspirante.save();

    return res.status(200).json({
      message: 'Aspirante actualizado correctamente',
      aspirante: aspirante.toSafeObject()
    });
  } catch (error) {
    // Intenta restaurar estado de archivos cuando la actualización falla en cualquier punto.
    const canRestorePrevious = Boolean(
      req.file
      && previousDocumentAbsolutePath
      && movedDocumentAbsolutePath
      && previousDocumentAbsolutePath !== movedDocumentAbsolutePath
    );

    if (canRestorePrevious) {
      try {
        if (fs.existsSync(movedDocumentAbsolutePath) && !fs.existsSync(previousDocumentAbsolutePath)) {
          await fs.promises.rename(movedDocumentAbsolutePath, previousDocumentAbsolutePath);
        }
      } catch (_restoreError) {
      }
    }

    try {
      if (req.file?.path) {
        await safeUnlink(req.file.path);
      }

      if (!canRestorePrevious && movedDocumentAbsolutePath) {
        await safeUnlink(movedDocumentAbsolutePath);
      }
    } catch (_cleanupError) {
    }

    if (isMongoDuplicateKeyError(error)) {
      return res.status(409).json({
        message: `${getDuplicateFieldName(error)} ya registrado en esta solicitud`
      });
    }

    if (isMongooseValidationError(error)) {
      return res.status(400).json({ message: 'Datos de aspirante inválidos' });
    }

    return next(error);
  }
};

// Endpoint interno: elimina aspirante y libera cupo en la solicitud.
const deleteAspirante = async (req, res, next) => {
  try {
    const solicitud = await ensureSolicitudExists(req, res);
    if (!solicitud) {
      return;
    }

    if (!ensureManagePermission({ user: req.user, solicitud })) {
      return res.status(403).json({ message: 'Sin permisos para eliminar aspirantes de esta solicitud' });
    }

    const gestionBloqueada = await isSolicitudGestionBloqueada(solicitud);
    if (gestionBloqueada) {
      return res.status(409).json({ message: 'La solicitud ya fue enviada al coordinador y no permite eliminar aspirantes' });
    }

    const aspirante = await Aspirante.findOne({ _id: req.params.aspiranteId, solicitud: solicitud._id });
    if (!aspirante) {
      return res.status(404).json({ message: 'Aspirante no encontrado' });
    }

    const absoluteDocumentPath = path.join(mediaRoot, aspirante.documentPdfPath || '');
    if (aspirante.documentPdfPath && fs.existsSync(absoluteDocumentPath)) {
      await fs.promises.unlink(absoluteDocumentPath);
    }

    await aspirante.deleteOne();

    const updatedCount = await countAspirantesBySolicitud(solicitud._id);
    await syncSolicitudPreinscripcionStatus(solicitud, updatedCount);

    return res.status(200).json({
      message: 'Aspirante eliminado correctamente',
      cupo: {
        total: solicitud.cupo,
        inscritos: updatedCount,
        cuposDisponibles: Math.max(0, Number(solicitud.cupo || 0) - Number(updatedCount)),
        inscripcionCerrada: updatedCount >= Number(solicitud.cupo || 0)
      }
    });
  } catch (error) {
    return next(error);
  }
};

// Endpoint interno: genera un PDF consolidado con documentos de identidad en orden de inscripción.
const viewAspirantesIdentityDocuments = async (req, res, next) => {
  try {
    const solicitud = await ensureSolicitudExists(req, res);
    if (!solicitud) {
      return;
    }

    if (!await ensureReadPermission({ user: req.user, solicitud })) {
      return res.status(403).json({ message: 'Sin permisos para consultar documentos de aspirantes de esta solicitud' });
    }

    const aspirantes = await Aspirante.find({ solicitud: solicitud._id })
      .select('documentPdfPath createdAt _id')
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    const mergedPdf = await PDFDocument.create();
    let totalPages = 0;

    for (const aspirante of aspirantes) {
      if (!aspirante?.documentPdfPath) {
        continue;
      }

      const absolutePath = path.join(mediaRoot, aspirante.documentPdfPath);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }

      try {
        const sourceBytes = await fs.promises.readFile(absolutePath);
        const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
        const sourcePages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());

        sourcePages.forEach((page) => {
          mergedPdf.addPage(page);
          totalPages += 1;
        });
      } catch (_) {
      }
    }

    if (!totalPages) {
      return res.status(404).json({ message: 'No hay documentos PDF de identidad disponibles para esta solicitud' });
    }

    const safeCode = String(solicitud.codigoSolicitud || solicitud._id || 'solicitud')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `documentos_identidad_${safeCode}.pdf`;

    const mergedBytes = await mergedPdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);

    return res.status(200).send(Buffer.from(mergedBytes));
  } catch (error) {
    return next(error);
  }
};

const buildAspirantesInscripcionFormatoData = ({ solicitud, ficha, aspirantes }) => {
  const codigoFicha = ficha?.codigoFicha ? String(ficha.codigoFicha) : '';
  const nitEmpresa = solicitud?.empresa?.nit ? String(solicitud.empresa.nit) : '';

  const filas = (aspirantes || []).map((item) => ([
    '',
    String(item?.documentType || ''),
    String(item?.documentNumber || ''),
    codigoFicha,
    String(item?.caracterizacion || ''),
    '',
    nitEmpresa
  ]));

  return {
    titulo: INSCRIPCION_FORMAT_TITLE,
    encabezados: INSCRIPCION_FORMAT_HEADERS,
    filas
  };
};

// Endpoint interno: construye formato de inscripción masiva en estructura tipo Excel (tabla HTML).
const getAspirantesInscripcionFormato = async (req, res, next) => {
  try {
    const solicitud = await Solicitud.findById(req.params.id)
      .populate('empresa', 'nit')
      .populate('programa', 'nombre')
      .lean();

    if (!solicitud) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    if (!await ensureReadPermission({ user: req.user, solicitud })) {
      return res.status(403).json({ message: 'Sin permisos para consultar formato de inscripción de esta solicitud' });
    }

    const [ficha, aspirantes] = await Promise.all([
      Ficha.findOne({ solicitud: solicitud._id })
        .select('codigoFicha')
        .sort({ createdAt: -1 })
        .lean(),
      Aspirante.find({ solicitud: solicitud._id })
        .select('documentType documentNumber caracterizacion createdAt _id')
        .sort({ documentNumber: 1, createdAt: 1, _id: 1 })
        .lean()
    ]);

    const formato = buildAspirantesInscripcionFormatoData({ solicitud, ficha, aspirantes });

    return res.status(200).json({
      formato,
      solicitud: {
        id: solicitud._id,
        codigoSolicitud: solicitud.codigoSolicitud,
        nombrePrograma: solicitud.programa?.nombre || ''
      }
    });
  } catch (error) {
    return next(error);
  }
};

// Endpoint interno: descarga el formato de inscripción masiva como archivo Excel real (.xlsx).
const downloadAspirantesInscripcionFormatoExcel = async (req, res, next) => {
  try {
    const solicitud = await Solicitud.findById(req.params.id)
      .populate('empresa', 'nit')
      .populate('programa', 'nombre')
      .lean();

    if (!solicitud) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    if (!await ensureReadPermission({ user: req.user, solicitud })) {
      return res.status(403).json({ message: 'Sin permisos para consultar formato de inscripción de esta solicitud' });
    }

    const [ficha, aspirantes] = await Promise.all([
      Ficha.findOne({ solicitud: solicitud._id })
        .select('codigoFicha')
        .sort({ createdAt: -1 })
        .lean(),
      Aspirante.find({ solicitud: solicitud._id })
        .select('documentType documentNumber caracterizacion createdAt _id')
        .sort({ documentNumber: 1, createdAt: 1, _id: 1 })
        .lean()
    ]);

    const formato = buildAspirantesInscripcionFormatoData({ solicitud, ficha, aspirantes });
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Aspirantes Inscritos');

    const programaCaption = `Programa: ${solicitud.programa?.nombre || 'Sin programa'}`;
    worksheet.columns = [
      { width: 36 },
      { width: 20 },
      { width: 24 },
      { width: 16 },
      { width: 28 },
      { width: 12 },
      { width: 28 }
    ];

    worksheet.mergeCells('A1:G1');
    worksheet.getCell('A1').value = programaCaption;

    worksheet.mergeCells('A2:G2');
    worksheet.getCell('A2').value = formato.titulo;
    worksheet.addRow(formato.encabezados);

    if (formato.filas.length) {
      formato.filas.forEach((fila) => worksheet.addRow(fila));
    } else {
      worksheet.mergeCells('A4:G4');
      worksheet.getCell('A4').value = 'No hay aspirantes registrados para generar el formato de inscripción masiva.';
    }

    const baseBorder = {
      top: { style: 'thin', color: { argb: 'FF444444' } },
      left: { style: 'thin', color: { argb: 'FF444444' } },
      bottom: { style: 'thin', color: { argb: 'FF444444' } },
      right: { style: 'thin', color: { argb: 'FF444444' } }
    };

    worksheet.getRow(1).height = 18;
    worksheet.getRow(1).font = { name: 'Arial', size: 12, color: { argb: 'FF000000' } };
    worksheet.getRow(1).alignment = { horizontal: 'left', vertical: 'middle' };

    worksheet.getRow(2).height = 24;
    worksheet.getCell('A2').font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getCell('A2').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4CAF50' }
    };
    worksheet.getCell('A2').border = baseBorder;

    const headerRow = worksheet.getRow(3);
    headerRow.height = 38;
    headerRow.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF000000' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    headerRow.eachCell((cell) => {
      cell.border = baseBorder;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' }
      };
    });

    const firstDataRowIndex = 4;
    const totalDataRows = Math.max(formato.filas.length, 1);
    for (let offset = 0; offset < totalDataRows; offset += 1) {
      const rowIndex = firstDataRowIndex + offset;
      const row = worksheet.getRow(rowIndex);
      row.height = 24;

      for (let columnIndex = 1; columnIndex <= INSCRIPCION_FORMAT_HEADERS.length; columnIndex += 1) {
        const cell = row.getCell(columnIndex);
        cell.font = { name: 'Arial', size: 12, color: { argb: 'FF000000' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = baseBorder;

        const isEvenVisualRow = (offset + 1) % 2 === 0;
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEvenVisualRow ? 'FFF9F9F9' : 'FFFFFFFF' }
        };
      }
    }

    const safeCode = String(solicitud.codigoSolicitud || solicitud._id || 'solicitud')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `formato_inscripcion_${safeCode}.xlsx`;

    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    return res.status(200).send(Buffer.from(xlsxBuffer));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  // Controladores exportados para rutas públicas e internas de aspirantes.
  getInscripcionPublica,
  registerAspirantePublic,
  listAspirantesBySolicitud,
  updateAspirante,
  deleteAspirante,
  viewAspirantesIdentityDocuments,
  getAspirantesInscripcionFormato,
  downloadAspirantesInscripcionFormatoExcel
};
