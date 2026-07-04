const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { Solicitud } = require('../models/Solicitud');
const { Aspirante } = require('../models/Aspirante');
const { Ficha } = require('../models/Ficha');
const { SolicitudCoordinador } = require('../models/SolicitudCoordinador');
const { SolicitudFuncionario } = require('../models/SolicitudFuncionario');
const { User } = require('../models/User');
const {
  Area,
  Empresa,
  Horario,
  Modalidad,
  Municipio,
  ProgramaEspecial,
  ProgramaFormacion,
  TipoEmpresa,
  TipoSolicitud,
  EstadoFicha,
  EstadoCoordinador
} = require('../models/SolicitudCatalogs');
const { mediaRoot } = require('../middleware/upload');
const { sendSolicitudDecisionEmail, sendFuncionarioSolicitudStatusEmail } = require('../utils/mailer');

// Catálogo de cargos válidos en solicitudes Campesena.
const CAMPESENA_CARGOS = {
  instructor_tecnico: { label: 'Instructor Técnico', requiereHorario: true },
  instructor_empresarial: { label: 'Instructor Empresarial', requiereHorario: true },
  instructor_full_popular: { label: 'Instructor Full Popular', requiereHorario: true }
};

const CAMPESENA_ROLE_MAP = {
  instructor_tecnico: 'tecnico',
  instructor_empresarial: 'empresarial',
  instructor_full_popular: 'fullPopular'
};

// Marcador de enlace de preinscripción cuando la solicitud ya no admite registros.
const PREINSCRIPCION_CERRADA = 'cerrado';

// Normaliza texto para comparaciones tolerantes (acentos/case).
const normalizeTipoSolicitudKey = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

const isRegularTipo = (value) => {
  // Detecta variantes históricas de tipo regular/normal.
  const normalized = normalizeTipoSolicitudKey(value);
  return normalized.includes('normal') || normalized.includes('regular');
};

const isCampesenaTipo = (value) => {
  // Detecta tipo Campesena tolerando tildes/case.
  const normalized = normalizeTipoSolicitudKey(value);
  return normalized.includes('campesena');
};

// Conversión numérica segura.
const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Convierte fecha opcional a Date o null cuando es inválida.
const parseOptionalDate = (value) => {
  if (!value || !String(value).trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Convierte un campo numérico opcional en { provided, value, error }.
const parseNullableNumberField = (value) => {
  if (value === undefined) {
    return { provided: false, value: null, error: false };
  }

  if (value === null) {
    return { provided: true, value: null, error: false };
  }

  const normalized = String(value).trim();
  if (!normalized.length) {
    return { provided: true, value: null, error: false };
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return { provided: true, value: null, error: true };
  }

  return { provided: true, value: parsed, error: false };
};

const buildPersonName = (person) => {
  // Construye nombre completo legible desde documento de usuario.
  return [person?.firstName, person?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
};

const sanitizeFileName = (value) => {
  // Sanitiza nombre de archivo para escritura segura en disco.
  return String(value || 'archivo')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');
};

// Parsea arreglos recibidos como array, JSON string o CSV.
const parseJsonArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim().length) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
};

// Obtiene clave año-mes (YYYY-MM) para agrupar calendario.
const getMonthKey = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

// Calcula los meses involucrados entre dos fechas (inclusive).
const monthKeysFromDateRange = (startValue, endValue) => {
  const startDate = new Date(`${startValue}T00:00:00`);
  const endDate = new Date(`${endValue}T00:00:00`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return [];
  }

  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  const keys = [];

  while (cursor <= endCursor) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return keys;
};

// Construye payload de meses (mes1..mes5) a partir del calendario seleccionado.
const buildHorarioMonthsPayload = (calendarDates) => {
  const monthMap = new Map();

  for (const rawDate of calendarDates) {
    const date = new Date(`${rawDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const list = monthMap.get(monthKey) || [];
    list.push(rawDate);
    monthMap.set(monthKey, list);
  }

  const sortedMonthKeys = [...monthMap.keys()].sort();
  const monthValues = sortedMonthKeys.map((monthKey) => {
    const dates = (monthMap.get(monthKey) || []).sort();
    return JSON.stringify(dates);
  });

  return {
    mes1: monthValues[0] || null,
    mes2: monthValues[1] || null,
    mes3: monthValues[2] || null,
    mes4: monthValues[3] || null,
    mes5: monthValues[4] || null
  };
};

// Normaliza asignaciones Campesena enviadas desde frontend.
const normalizeCampesenaAssignments = (value) => {
  const parsed = parseJsonArray(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => ({
      cargo: String(item?.cargo || '').trim(),
      instructorId: String(item?.instructorId || '').trim(),
      diasSemana: parseJsonArray(item?.diasSemana).map((day) => String(day).trim()).filter(Boolean)
    }))
    .filter((item) => item.cargo);
};

// Convierte días de semana desde múltiples formatos de entrada.
const parseDiasSemana = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  const raw = String(value).trim();
  if (!raw.length) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch (_error) {
    // Continúa con separación por comas.
  }

  return raw.split(',').map((item) => item.trim()).filter(Boolean);
};

// Convierte fechas mensuales desde múltiples formatos de entrada.
const parseMesFechas = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  const raw = String(value).trim();
  if (!raw.length) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch (_error) {
    // Continúa con separación por comas.
  }

  return raw.split(',').map((item) => item.trim()).filter(Boolean);
};

const buildInstructorSafeData = (userDoc) => {
  // Proyección segura/minimal del instructor para respuestas públicas.
  if (!userDoc) {
    return {
      id: null,
      nombre: '',
      documento: '',
      correo: ''
    };
  }

  return {
    id: userDoc._id || null,
    nombre: [userDoc.firstName, userDoc.lastName].filter(Boolean).join(' ').trim(),
    documento: userDoc.documentNumber || '',
    correo: userDoc.email || ''
  };
};

const escapeHtml = (value) => {
  // Escapa caracteres especiales para interpolación segura en HTML.
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatDateEsCo = (value) => {
  // Formato de fecha local para documentos y vistas descargables.
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('es-CO');
};

const joinDateDays = (dates) => {
  // Resume fechas a solo día de mes para plantilla de caracterización.
  if (!Array.isArray(dates) || !dates.length) {
    return '';
  }

  return dates
    .map((value) => {
      const raw = String(value || '').trim();
      if (!raw) {
        return null;
      }

      const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        return String(Number(isoMatch[3]));
      }

      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return null;
      }

      return String(parsed.getDate());
    })
    .filter(Boolean)
    .join(', ');
};

const splitExecutionDatesIntoMonths = (dates, maxMonths = 5) => {
  // Agrupa calendario en bloques mensuales para salida mes1..mes5.
  if (!Array.isArray(dates) || !dates.length) {
    return Array.from({ length: maxMonths }, () => '');
  }

  const monthBuckets = [];
  const monthIndexByKey = new Map();

  dates.forEach((value) => {
    const raw = String(value || '').trim();
    if (!raw) {
      return;
    }

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const monthKey = `${isoMatch[1]}-${isoMatch[2]}`;
      const day = String(Number(isoMatch[3]));

      if (!monthIndexByKey.has(monthKey)) {
        monthIndexByKey.set(monthKey, monthBuckets.length);
        monthBuckets.push([]);
      }

      monthBuckets[monthIndexByKey.get(monthKey)].push(day);
      return;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return;
    }

    const monthKey = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
    const day = String(parsed.getDate());

    if (!monthIndexByKey.has(monthKey)) {
      monthIndexByKey.set(monthKey, monthBuckets.length);
      monthBuckets.push([]);
    }

    monthBuckets[monthIndexByKey.get(monthKey)].push(day);
  });

  const monthlyValues = monthBuckets.slice(0, maxMonths).map((days) => days.join(', '));
  while (monthlyValues.length < maxMonths) {
    monthlyValues.push('');
  }

  return monthlyValues;
};

// Catálogo visual de días usado en la exportación Word.
const DAY_OPTIONS_DOC = [
  { code: '1', label: 'LUN' },
  { code: '2', label: 'MAR' },
  { code: '3', label: 'MIE' },
  { code: '4', label: 'JUE' },
  { code: '5', label: 'VIE' },
  { code: '6', label: 'SAB' },
  { code: '0', label: 'DOM' }
];

// Conversión de nombre de día a código corto en documento Word.
const DAY_NAME_TO_CODE_DOC = {
  lun: '1',
  lunes: '1',
  mar: '2',
  martes: '2',
  mie: '3',
  miercoles: '3',
  miércoles: '3',
  jue: '4',
  jueves: '4',
  vie: '5',
  viernes: '5',
  sab: '6',
  sabado: '6',
  sábado: '6',
  dom: '0',
  domingo: '0'
};

// Lista de programas especiales marcada en la ficha de caracterización.
const PROGRAMAS_ESPECIALES_DOC = [
  { id: 1, label: 'SENA EMPRENDE RURAL' },
  { id: 2, label: 'SENA EMPRENDE RURAL- POST CONFLICTO (ETCR)' },
  { id: 3, label: 'AULAS ABIERTAS' },
  { id: 4, label: 'PROGRAMA DE EMPRENDIMIENTO' },
  { id: 5, label: 'CATEDRA VIRTUAL DE PRODUCTIVIDAD' },
  { id: 6, label: 'PROGRAMA DE BILINGÜISMO' },
  { id: 7, label: 'JÓVENES RURALES SIN ALIANZAS' },
  { id: 8, label: 'CAPACIDAD DE GESTIÓN DE EXPORTACIONES' },
  { id: 9, label: 'LEOS – LABORATORIOS EXPERIMENTALES' },
  { id: 10, label: 'AULA MÓVIL' },
  { id: 11, label: 'AMBIENTES VIRTUALES DE APRENDIZAJE' },
  { id: 12, label: 'CATEDRA VIRTUAL DE PENSAMIENTO EMPRESARIAL' },
  { id: 13, label: 'PROGRAMA JÓVENES EN ACCIÓN' },
  { id: 14, label: 'ALIANZAS ESTRATÉGICAS' },
  { id: 15, label: 'ALTA GERENCIA' }
];

const normalizeDayCodesDoc = (dayCodes) => {
  // Normaliza días recibidos desde BD (nombre/código) a códigos 0..6.
  if (!Array.isArray(dayCodes)) {
    return [];
  }

  return dayCodes
    .map((value) => {
      const raw = String(value || '').trim();
      if (!raw) {
        return null;
      }

      if (/^[0-6]$/.test(raw)) {
        return raw;
      }

      const normalized = normalizeTipoSolicitudKey(raw);
      return DAY_NAME_TO_CODE_DOC[normalized] || null;
    })
    .filter(Boolean);
};

const getCampesenaRoleExecutionMonthsDoc = (horario) => {
  // Resuelve meses por subrol Campesena usando meses explícitos o fechas agregadas.
  if (!horario) {
    return Array.from({ length: 5 }, () => '');
  }

  const explicitMonths = [horario.mes1, horario.mes2, horario.mes3, horario.mes4, horario.mes5];
  const hasExplicitMonths = explicitMonths.some((monthDates) => Array.isArray(monthDates) && monthDates.length);

  if (hasExplicitMonths) {
    return explicitMonths.map((monthDates) => joinDateDays(monthDates));
  }

  return splitExecutionDatesIntoMonths(horario.fechas, 5);
};

const readSenaLogoDataUri = () => {
  // Lee logo institucional y lo serializa como data URI para incrustarlo en Word HTML.
  try {
    const logoPath = path.resolve(__dirname, '../../../frontend/public/SenaVerde.png');
    if (!fs.existsSync(logoPath)) {
      return '';
    }

    const logoBase64 = fs.readFileSync(logoPath).toString('base64');
    return `data:image/png;base64,${logoBase64}`;
  } catch (_error) {
    return '';
  }
};

const buildCampesenaRolePayload = ({ cargoKey, roleSchedule, cargoAssignment }) => {
  // Estandariza el payload de cada subrol Campesena para consumo del frontend.
  return {
    cargo: cargoKey,
    etiqueta: CAMPESENA_CARGOS[cargoKey]?.label || cargoKey,
    horario: {
      horaInicio: roleSchedule?.horaInicio || '',
      horaFin: roleSchedule?.horaFin || '',
      diasSemanaCodigos: parseDiasSemana(roleSchedule?.diasSemana),
      fechas: parseMesFechas(roleSchedule?.fechasCalendario)
    },
    instructor: buildInstructorSafeData(cargoAssignment?.instructor)
  };
};

// Define alcance de consulta según rol autenticado.
const buildConsultaScope = async (user) => {
  const role = String(user?.roleKey || '').toLowerCase();
  const baseQuery = {};

  if (role === 'instructor') {
    baseQuery.usuario = user._id;
  }

  if (role === 'coordinador') {
    const coordinatorSolicitudIds = await SolicitudCoordinador.find({ usuarioRevisador: user._id })
      .distinct('solicitud');
    baseQuery._id = { $in: coordinatorSolicitudIds };
  }

  if (role === 'funcionario') {
    const approvedEstado = await EstadoCoordinador.findOne({ nombre: /aprobado/i });
    if (approvedEstado) {
      const lastApprovedBySolicitud = await SolicitudCoordinador.aggregate([
        { $sort: { solicitud: 1, fecha: -1, createdAt: -1 } },
        { $group: { _id: '$solicitud', estado: { $first: '$estado' } } },
        { $match: { estado: approvedEstado._id } }
      ]);

      const approvedSolicitudIds = lastApprovedBySolicitud.map((item) => item._id);
      baseQuery._id = { $in: approvedSolicitudIds };
    } else {
      baseQuery._id = { $in: [] };
    }
  }

  return baseQuery;
};

// Genera carta PDF interna para solicitudes de oferta abierta.
const generateInternalCartaPdf = async ({ destinationPath, solicitud, user, coordinator }) => {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(destinationPath);

    doc.pipe(stream);

    doc.fontSize(16).text('AUTORIZACIÓN PARA LA CREACIÓN DEL PROGRAMA DE FORMACIÓN', {
      align: 'center'
    });
    doc.moveDown(1);
    doc.fontSize(13).text(`${solicitud.programaNombre || 'Programa de formación'}`, { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(12).text(`COORDINADOR: ${coordinator?.name || 'Coordinación Académica'}`);
    doc.text(`CORREO ELECTRÓNICO: ${coordinator?.email || 'coordinacion@sena.local'}`);
    doc.moveDown(1);
    doc.text(`SOLICITANTE: ${user.name}`);
    doc.moveDown(1);

    doc.text(
      `Yo, en calidad de Coordinación, autorizo al solicitante ${user.name} a crear e implementar el programa de formación ${solicitud.programaNombre || ''}, bajo lineamientos internos del SENA.`,
      { align: 'justify' }
    );
    doc.moveDown(1);
    doc.text(
      'Esta autorización tiene carácter oficial para efectos del proceso de solicitud y queda asociada al registro de la solicitud en el sistema.',
      { align: 'justify' }
    );
    doc.moveDown(2);

    doc.text(`Lugar y fecha: ${new Date().toLocaleDateString('es-CO')}`);
    doc.moveDown(3);
    doc.text('________________________________________');
    doc.text('Firma Coordinación');

    doc.end();

    stream.on('finish', resolve);
    stream.on('error', reject);
  });
};

const createSolicitud = async (req, res, next) => {
  try {
    // Flujo principal de creación: validaciones, horario, empresa, solicitud y carta.
    const {
      tipoSolicitud,
      tipoOferta,
      programaId,
      subsectorEconomico,
      cupoAprendices,
      municipioFormacion,
      direccionFormacion,
      programaEspecial,
      nombreAmbiente,
      fechaInicio,
      fechaFinalizacion,
      horarioInicio,
      horarioFin,
      diasSemana,
      fechasCalendario,
      campesenaAsignaciones,
      campesenaHorarios,
      empresaSolicitante,
      tipoEmpresa,
      nombreResponsable,
      nitEmpresa,
      convenioEmpresa,
      fechaCreacionEmpresa,
      direccionEmpresa,
      nombreContactoEmpresa,
      correoContactoEmpresa,
      numeroEmpleadosEmpresa
    } = req.body;

    const cupo = parseNumber(cupoAprendices);
    const normalizedTipoSolicitud = String(tipoSolicitud || '').trim().toLowerCase();
    const normalizedDiasSemana = parseJsonArray(diasSemana);
    const normalizedFechasCalendario = parseJsonArray(fechasCalendario);
    const normalizedCampesenaAsignaciones = normalizeCampesenaAssignments(campesenaAsignaciones);
    const normalizedCampesenaHorarios = parseCampesenaHorarios(campesenaHorarios);
    const maxMonthsByTipo = normalizedTipoSolicitud === 'campesena' ? 5 : 2;

    // Validación mínima de campos requeridos transversales.
    if (!normalizedTipoSolicitud || !programaId || !municipioFormacion || !programaEspecial || !direccionFormacion) {
      return res.status(400).json({ message: 'Faltan campos requeridos de la solicitud' });
    }

    let horarioForSolicitud = {
      fechaInicio: fechaInicio || null,
      fechaFinalizacion: fechaFinalizacion || null,
      horarioInicio: horarioInicio || null,
      horarioFin: horarioFin || null,
      diasSemana: normalizedDiasSemana,
      fechasCalendario: normalizedFechasCalendario
    };

    let horarioCampesenaHorariosToSave = null;
    let horarioCampesenaCargosToSave = [];

    if (normalizedTipoSolicitud !== 'campesena') {
      // Reglas de horario para solicitud regular.
      if (!fechaInicio || !fechaFinalizacion || !horarioInicio || !horarioFin) {
        return res.status(400).json({ message: 'La programación de horario es obligatoria' });
      }

      const monthKeysFromCalendar = [...new Set(
        normalizedFechasCalendario
          .map((item) => getMonthKey(`${item}T00:00:00`))
          .filter(Boolean)
      )].sort();

      const involvedMonths = monthKeysFromCalendar.length
        ? monthKeysFromCalendar
        : monthKeysFromDateRange(fechaInicio, fechaFinalizacion);

      if (!involvedMonths.length) {
        return res.status(400).json({ message: 'Rango de fechas inválido para el horario' });
      }

      if (involvedMonths.length > maxMonthsByTipo) {
        return res.status(400).json({
          message: 'Para ficha regular el horario no puede abarcar más de 2 meses'
        });
      }
    }

    if (!cupo || cupo < 1) {
      return res.status(400).json({ message: 'El cupo debe ser mayor a cero' });
    }

    let campesenaCargosToSave = [];
    if (normalizedTipoSolicitud === 'campesena') {
      // Reglas específicas Campesena: cargos, instructores y no solapes.
      if (!normalizedCampesenaAsignaciones.length) {
        return res.status(400).json({
          message: 'Debe asignar al menos un cargo de instructor para la solicitud Campesena'
        });
      }

      const usedCargos = new Set();
      for (const asignacion of normalizedCampesenaAsignaciones) {
        if (!CAMPESENA_CARGOS[asignacion.cargo]) {
          return res.status(400).json({ message: `Cargo Campesena inválido: ${asignacion.cargo}` });
        }

        if (usedCargos.has(asignacion.cargo)) {
          return res.status(400).json({ message: 'No puede repetir el mismo cargo Campesena' });
        }
        usedCargos.add(asignacion.cargo);

        if (!asignacion.instructorId) {
          return res.status(400).json({
            message: `Debe seleccionar instructor para ${CAMPESENA_CARGOS[asignacion.cargo].label}`
          });
        }
      }

      if (String(req.user.roleKey || '').toLowerCase() === 'instructor') {
        const creatorId = String(req.user._id);
        const creatorHasCargo = normalizedCampesenaAsignaciones.some(
          (item) => String(item.instructorId) === creatorId
        );

        if (!creatorHasCargo) {
          return res.status(400).json({
            message: 'Debe asignarse al menos un cargo al instructor que crea la solicitud'
          });
        }
      }

      const instructorIds = [...new Set(normalizedCampesenaAsignaciones.map((item) => item.instructorId))];
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const validInstructors = await User.find({
        _id: { $in: instructorIds },
        roleKey: 'instructor',
        instructorType: 'campesena',
        active: true,
        $or: [
          { contractType: 1 },
          { contractEndAt: { $gte: startOfToday } },
          { contractEndAt: null }
        ]
      })
        .select('_id')
        .lean();

      const validIds = new Set(validInstructors.map((item) => String(item._id)));
      const invalidInstructor = instructorIds.find((item) => !validIds.has(String(item)));
      if (invalidInstructor) {
        return res.status(400).json({ message: 'Uno o más instructores Campesena seleccionados no son válidos' });
      }

      if (!normalizedCampesenaHorarios || !normalizedCampesenaHorarios.fechaInicioCompartida) {
        return res.status(400).json({ message: 'La fecha de inicio compartida de Campesena es obligatoria' });
      }

      const normalizedRoleSchedules = {
        // Se normaliza horario por cada rol Campesena para validación homogénea.
        instructor_tecnico: normalizeRoleSchedule(normalizedCampesenaHorarios.tecnico),
        instructor_empresarial: normalizeRoleSchedule(normalizedCampesenaHorarios.empresarial),
        instructor_full_popular: normalizeRoleSchedule(normalizedCampesenaHorarios.fullPopular)
      };

      for (const asignacion of normalizedCampesenaAsignaciones) {
        const schedule = normalizedRoleSchedules[asignacion.cargo];
        const roleLabel = CAMPESENA_CARGOS[asignacion.cargo].label;

        const timeRange = toTimeRange(schedule.horaInicio, schedule.horaFin);
        if (!timeRange) {
          return res.status(400).json({ message: `Horario inválido para ${roleLabel}` });
        }

        if (!schedule.diasSemana.length) {
          return res.status(400).json({ message: `Debe seleccionar días de semana para ${roleLabel}` });
        }

        if (!schedule.fechasCalendario.length) {
          return res.status(400).json({ message: `Debe seleccionar fechas de calendario para ${roleLabel}` });
        }

        const invalidDays = asignacion.diasSemana.filter((day) => !schedule.diasSemana.includes(day));
        if (invalidDays.length) {
          return res.status(400).json({
            message: `Los días del cargo ${roleLabel} deben coincidir con su propio horario`
          });
        }

        const monthKeys = [...new Set(
          schedule.fechasCalendario
            .map((item) => getMonthKey(`${item}T00:00:00`))
            .filter(Boolean)
        )].sort();

        const maxMonthsForRole = asignacion.cargo === 'instructor_full_popular' ? 2 : 5;
        if (!monthKeys.length || monthKeys.length > maxMonthsForRole) {
          return res.status(400).json({
            message:
              asignacion.cargo === 'instructor_full_popular'
                ? 'Instructor Full Popular solo puede abarcar máximo 2 meses'
                : `${roleLabel} no puede abarcar más de 5 meses`
          });
        }
      }

      const activeCargos = normalizedCampesenaAsignaciones.map((item) => item.cargo);
      for (let index = 0; index < activeCargos.length; index += 1) {
        for (let nested = index + 1; nested < activeCargos.length; nested += 1) {
          const cargoA = activeCargos[index];
          const cargoB = activeCargos[nested];
          const scheduleA = normalizedRoleSchedules[cargoA];
          const scheduleB = normalizedRoleSchedules[cargoB];
          const rangeA = toTimeRange(scheduleA.horaInicio, scheduleA.horaFin);
          const rangeB = toTimeRange(scheduleB.horaInicio, scheduleB.horaFin);

          if (!rangesOverlap(rangeA, rangeB)) {
            continue;
          }

          const overlapDates = scheduleA.fechasCalendario.filter((date) => scheduleB.fechasCalendario.includes(date));
          if (overlapDates.length) {
            return res.status(400).json({
              message: `No se permite solape de calendario y horas entre ${CAMPESENA_CARGOS[cargoA].label} y ${CAMPESENA_CARGOS[cargoB].label}`
            });
          }
        }
      }

      const instructorByCargo = new Map(
        normalizedCampesenaAsignaciones.map((item) => [item.cargo, String(item.instructorId)])
      );

      const existingCampesenaSolicitudes = await Solicitud.find({
        // Previene conflictos de horario/calendario con otras solicitudes activas de los mismos instructores.
        _id: { $ne: req.body?.solicitudId || null },
        'campesenaCargos.instructor': { $in: instructorIds }
      })
        .select('campesenaCargos horario')
        .populate('horario', 'campesenaHorarios')
        .lean();

      for (const existing of existingCampesenaSolicitudes) {
        const existingInstructorByCargo = new Map(
          (existing.campesenaCargos || []).map((item) => [item.cargo, String(item.instructor)])
        );

        const existingSchedules = {
          instructor_tecnico: normalizeRoleSchedule(existing.horario?.campesenaHorarios?.tecnico),
          instructor_empresarial: normalizeRoleSchedule(existing.horario?.campesenaHorarios?.empresarial),
          instructor_full_popular: normalizeRoleSchedule(existing.horario?.campesenaHorarios?.fullPopular)
        };

        for (const cargo of activeCargos) {
          const newInstructorId = instructorByCargo.get(cargo);
          if (!newInstructorId) {
            continue;
          }

          const newSchedule = normalizedRoleSchedules[cargo];
          const newRange = toTimeRange(newSchedule.horaInicio, newSchedule.horaFin);

          for (const existingCargo of Object.keys(existingSchedules)) {
            const existingInstructorId = existingInstructorByCargo.get(existingCargo);
            if (!existingInstructorId || existingInstructorId !== newInstructorId) {
              continue;
            }

            const existingSchedule = existingSchedules[existingCargo];
            const existingRange = toTimeRange(existingSchedule.horaInicio, existingSchedule.horaFin);
            if (!rangesOverlap(newRange, existingRange)) {
              continue;
            }

            const overlapDates = newSchedule.fechasCalendario.filter(
              (date) => existingSchedule.fechasCalendario.includes(date)
            );

            if (overlapDates.length) {
              return res.status(400).json({
                message: 'Existe solape de calendario y horario con otra solicitud Campesena para uno de los instructores seleccionados'
              });
            }
          }
        }
      }

      campesenaCargosToSave = normalizedCampesenaAsignaciones.map((item) => ({
        cargo: item.cargo,
        instructor: item.instructorId
      }));

      horarioCampesenaCargosToSave = normalizedCampesenaAsignaciones.map((item) => ({
        cargo: item.cargo,
        instructor: item.instructorId,
        diasSemana: item.diasSemana
      }));

      horarioCampesenaHorariosToSave = {
        fechaInicioCompartida: new Date(`${normalizedCampesenaHorarios.fechaInicioCompartida}T00:00:00`),
        tecnico: normalizedRoleSchedules.instructor_tecnico,
        empresarial: normalizedRoleSchedules.instructor_empresarial,
        fullPopular: normalizedRoleSchedules.instructor_full_popular
      };

      const roleCalendarDates = [
        ...horarioCampesenaHorariosToSave.tecnico.fechasCalendario,
        ...horarioCampesenaHorariosToSave.empresarial.fechasCalendario,
        ...horarioCampesenaHorariosToSave.fullPopular.fechasCalendario
      ].filter(Boolean);

      const uniqueRoleDates = [...new Set(roleCalendarDates)].sort();
      const lastRoleDate = uniqueRoleDates.at(-1) || normalizedCampesenaHorarios.fechaInicioCompartida;

      const firstActiveRole = activeCargos[0];
      const firstActiveSchedule = normalizedRoleSchedules[firstActiveRole] || {};

      horarioForSolicitud = {
        fechaInicio: normalizedCampesenaHorarios.fechaInicioCompartida,
        fechaFinalizacion: lastRoleDate,
        horarioInicio: firstActiveSchedule.horaInicio,
        horarioFin: firstActiveSchedule.horaFin,
        diasSemana: [...new Set([
          ...horarioCampesenaHorariosToSave.tecnico.diasSemana,
          ...horarioCampesenaHorariosToSave.empresarial.diasSemana,
          ...horarioCampesenaHorariosToSave.fullPopular.diasSemana
        ])],
        fechasCalendario: uniqueRoleDates
      };
    }

    if (tipoOferta === 'no' && cupo < 25) {
      return res.status(400).json({ message: 'Para oferta abierta el cupo mínimo es 25' });
    }

    // Resolución de referencias de catálogos relacionadas a la solicitud.
    const tipoSolicitudDoc = await TipoSolicitud.findOne({ nombre: normalizedTipoSolicitud });
    if (!tipoSolicitudDoc) {
      return res.status(400).json({ message: 'Tipo de solicitud inválido' });
    }

    const programa = await ProgramaFormacion.findById(programaId).populate('modalidad', '_id');
    if (!programa) {
      return res.status(400).json({ message: 'Programa de formación inválido' });
    }

    const modalidad = await Modalidad.findById(programa.modalidad?._id || programa.modalidad);
    if (!modalidad) {
      return res.status(400).json({ message: 'Modalidad no encontrada para el programa' });
    }

    const municipio = await Municipio.findById(municipioFormacion);
    if (!municipio) {
      return res.status(400).json({ message: 'Municipio de formación inválido' });
    }

    const especial = await ProgramaEspecial.findById(programaEspecial);
    if (!especial) {
      return res.status(400).json({ message: 'Programa especial inválido' });
    }

    const horarioMonthsPayload = buildHorarioMonthsPayload(horarioForSolicitud.fechasCalendario || []);

    // Persistencia del horario consolidado.
    const horario = await Horario.create({
      fechaInicio: new Date(`${horarioForSolicitud.fechaInicio}T00:00:00`),
      fechaFin: new Date(`${horarioForSolicitud.fechaFinalizacion}T00:00:00`),
      ...horarioMonthsPayload,
      horas:
        horarioForSolicitud.horarioInicio && horarioForSolicitud.horarioFin
          ? `${horarioForSolicitud.horarioInicio} - ${horarioForSolicitud.horarioFin}`
          : null,
      diasSemana: horarioForSolicitud.diasSemana.length ? horarioForSolicitud.diasSemana.join(',') : null,
      campesenaHorarios: horarioCampesenaHorariosToSave,
      campesenaCargos: horarioCampesenaCargosToSave
    });

    let empresaId = null;
    if (tipoOferta === 'si') {
      // Oferta cerrada: valida datos y crea/actualiza empresa por NIT/correo.
      if (
        !empresaSolicitante ||
        !tipoEmpresa ||
        !nombreResponsable ||
        !nitEmpresa ||
        !fechaCreacionEmpresa ||
        !direccionEmpresa ||
        !nombreContactoEmpresa ||
        !correoContactoEmpresa ||
        !numeroEmpleadosEmpresa
      ) {
        return res.status(400).json({ message: 'Faltan datos de empresa para oferta cerrada' });
      }

      const tipoEmpresaDoc = await TipoEmpresa.findById(tipoEmpresa);
      if (!tipoEmpresaDoc) {
        return res.status(400).json({ message: 'Tipo de empresa inválido' });
      }

      let empresa = await Empresa.findOne({ nit: String(nitEmpresa).trim() });
      if (!empresa) {
        empresa = await Empresa.findOne({ correo: String(correoContactoEmpresa).toLowerCase().trim() });
      }

      if (!empresa) {
        empresa = await Empresa.create({
          nombre: String(empresaSolicitante).trim(),
          representante: String(nombreResponsable).trim(),
          correo: String(correoContactoEmpresa).toLowerCase().trim(),
          nit: String(nitEmpresa).trim(),
          convenio: String(convenioEmpresa || '').trim() || null,
          fechaCreacionEmpresa: parseOptionalDate(fechaCreacionEmpresa),
          direccionEmpresa: String(direccionEmpresa || '').trim() || null,
          nombreContactoEmpresa: String(nombreContactoEmpresa || '').trim() || null,
          correoContactoEmpresa: String(correoContactoEmpresa || '').toLowerCase().trim() || null,
          numeroEmpleadosEmpresa: parseNumber(numeroEmpleadosEmpresa),
          tipoEmpresa: tipoEmpresaDoc._id
        });
      } else {
        empresa.nombre = String(empresaSolicitante).trim();
        empresa.representante = String(nombreResponsable).trim();
        empresa.correo = String(correoContactoEmpresa).toLowerCase().trim();
        empresa.convenio = String(convenioEmpresa || '').trim() || null;
        empresa.fechaCreacionEmpresa = parseOptionalDate(fechaCreacionEmpresa);
        empresa.direccionEmpresa = String(direccionEmpresa || '').trim() || null;
        empresa.nombreContactoEmpresa = String(nombreContactoEmpresa || '').trim() || null;
        empresa.correoContactoEmpresa = String(correoContactoEmpresa || '').toLowerCase().trim() || null;
        empresa.numeroEmpleadosEmpresa = parseNumber(numeroEmpleadosEmpresa);
        empresa.tipoEmpresa = tipoEmpresaDoc._id;
        await empresa.save();
      }

      empresaId = empresa._id;
    }

    // Creación de la solicitud principal.
    const solicitud = await Solicitud.create({
      tipoSolicitud: tipoSolicitudDoc._id,
      programa: programa._id,
      horario: horario._id,
      cupo,
      modalidad: modalidad._id,
      municipio: municipio._id,
      direccion: String(direccionFormacion || '').trim(),
      usuario: req.user._id,
      empresa: empresaId,
      subsectorEconomico: String(subsectorEconomico || '').trim() || null,
      programaEspecial: especial._id,
      ambiente: String(nombreAmbiente || '').trim() || null,
      cartaRuta: null,
      cartaTipo: null,
      fechaSolicitud: new Date(),
      revisado: false,
      linkPreinscripcion: null,
      campesenaCargos: campesenaCargosToSave
    });

    // Carpeta dedicada para la carta PDF asociada a la solicitud.
    const folderName = `carta_${solicitud._id}`;
    const folderPath = path.join(mediaRoot, 'Cartas_de_solicitud', folderName);
    await fs.promises.mkdir(folderPath, { recursive: true });

    if (tipoOferta === 'si') {
      // Guarda carta subida por empresa.
      if (!req.file) {
        return res.status(400).json({ message: 'Debe adjuntar la carta PDF de la empresa' });
      }

      const finalName = `carta_${solicitud._id}.pdf`;
      const finalPath = path.join(folderPath, finalName);
      await fs.promises.rename(req.file.path, finalPath);

      solicitud.cartaRuta = `Cartas_de_solicitud/${folderName}/${finalName}`;
      solicitud.cartaTipo = 'subida_empresa';
      await solicitud.save();
    } else {
      // Genera carta interna automática para oferta abierta.
      let coordinatorData = null;
      if (req.user?.coordinatorId) {
        const coordinatorUser = await User.findById(req.user.coordinatorId).select('firstName lastName email');
        if (coordinatorUser) {
          coordinatorData = {
            name: `${coordinatorUser.firstName || ''} ${coordinatorUser.lastName || ''}`.trim(),
            email: coordinatorUser.email || null
          };
        }
      }

      const generatedName = `${folderName}.pdf`;
      const generatedPath = path.join(folderPath, generatedName);
      await generateInternalCartaPdf({
        destinationPath: generatedPath,
        solicitud: {
          programaNombre: programa.nombre
        },
        user: {
          name: req.user.name || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim()
        },
        coordinator: coordinatorData
      });

      solicitud.cartaRuta = `Cartas_de_solicitud/${folderName}/${generatedName}`;
      solicitud.cartaTipo = 'generada_interna';
      await solicitud.save();
    }

    return res.status(201).json({
      message: 'Solicitud creada correctamente',
      solicitud: {
        id: solicitud._id,
        codigoSolicitud: solicitud.codigoSolicitud,
        tipoSolicitud: normalizedTipoSolicitud,
        cupo: solicitud.cupo,
        fechaSolicitud: solicitud.fechaSolicitud,
        cartaTipo: solicitud.cartaTipo,
        cartaUrl: solicitud.cartaRuta ? `/media/${solicitud.cartaRuta}` : null
      }
    });
  } catch (error) {
    return next(error);
  }
};

const listSolicitudesConsulta = async (req, res, next) => {
  try {
    // Lista de consulta según alcance del rol y estado derivado (ficha/coordinación).
    const currentRole = String(req.user?.roleKey || '').toLowerCase();
    const baseQuery = await buildConsultaScope(req.user);
    const estadosFichaCatalogo = await EstadoFicha.find({})
      .sort({ nombre: 1 })
      .select('_id nombre')
      .lean();

    const solicitudes = await Solicitud.find(baseQuery)
      .populate({
        path: 'programa',
        select: 'nombre area',
        populate: { path: 'area', select: 'nombre' }
      })
      .populate('tipoSolicitud', 'nombre')
      .sort({ fechaSolicitud: -1 });

    const solicitudIds = solicitudes.map((item) => item._id);

    const aspirantesBySolicitudAgg = await Aspirante.aggregate([
      { $match: { solicitud: { $in: solicitudIds } } },
      { $group: { _id: '$solicitud', total: { $sum: 1 } } }
    ]);
    const aspirantesCountBySolicitud = new Map(
      aspirantesBySolicitudAgg.map((item) => [String(item._id), Number(item.total || 0)])
    );

    const fichas = await Ficha.find({ solicitud: { $in: solicitudIds } })
      .populate('estado', 'nombre')
      .sort({ createdAt: -1 });

    const revisiones = await SolicitudCoordinador.find({ solicitud: { $in: solicitudIds } })
      .populate('estado', 'nombre')
      .populate('usuarioRevisador', 'firstName lastName')
      .sort({ fecha: -1, createdAt: -1 });

    const revisionesFuncionario = await SolicitudFuncionario.find({ solicitud: { $in: solicitudIds } })
      .populate('usuarioRevisador', 'firstName lastName')
      .sort({ fecha: -1, createdAt: -1 });

    const fichaBySolicitud = new Map();
    for (const ficha of fichas) {
      const key = String(ficha.solicitud);
      if (!fichaBySolicitud.has(key)) {
        fichaBySolicitud.set(key, ficha);
      }
    }

    const revisionBySolicitud = new Map();
    const approvedRevisionBySolicitud = new Map();
    for (const revision of revisiones) {
      const key = String(revision.solicitud);
      if (!revisionBySolicitud.has(key)) {
        revisionBySolicitud.set(key, revision);
      }

      const estadoRevision = normalizeTipoSolicitudKey(revision?.estado?.nombre || '');
      const isApproved = estadoRevision.includes('aprob');
      if (isApproved && !approvedRevisionBySolicitud.has(key)) {
        approvedRevisionBySolicitud.set(key, revision);
      }
    }

    const revisionFuncionarioBySolicitud = new Map();
    for (const revision of revisionesFuncionario) {
      const key = String(revision.solicitud);
      if (!revisionFuncionarioBySolicitud.has(key)) {
        revisionFuncionarioBySolicitud.set(key, revision);
      }
    }

    const result = solicitudes.map((solicitud) => {
      const key = String(solicitud._id);
      const ficha = fichaBySolicitud.get(key);
      const revision = revisionBySolicitud.get(key);
      const approvedRevision = approvedRevisionBySolicitud.get(key);
      const revisionFuncionario = revisionFuncionarioBySolicitud.get(key);

      const estadoFicha = ficha?.estado?.nombre || null;
      const estadoFichaId = ficha?.estado?._id ? String(ficha.estado._id) : null;
      const estadoCoordinador = revision?.estado?.nombre || null;
      const estadoCoordinadorNormalizado = normalizeTipoSolicitudKey(estadoCoordinador || '');
      const coordinacionAprobada = estadoCoordinadorNormalizado.includes('aprob');
      const coordinacionRechazada = estadoCoordinadorNormalizado.includes('rechaz');
      const coordinacionPendiente = Boolean(revision) && !coordinacionAprobada && !coordinacionRechazada;
      const estadoFuncionario = String(revisionFuncionario?.estado || '').toLowerCase();
      const funcionarioRechazo = estadoFuncionario === 'rechazado';
      const funcionarioAprobo = estadoFuncionario === 'aprobado';
      const funcionarioReenvio = estadoFuncionario === 'reenviado';
      const estado = estadoFicha || estadoCoordinador || 'Lista de espera';
      const tipoSolicitudNombre = solicitud.tipoSolicitud?.nombre || null;
      const fichaCaracterizacionUrl = isRegularTipo(tipoSolicitudNombre) || isCampesenaTipo(tipoSolicitudNombre)
        ? `/solicitudes/consultar/${solicitud._id}/ficha`
        : null;
      const cantidadAspirantes = aspirantesCountBySolicitud.get(key) || 0;
      const cupo = Number(solicitud?.cupo || 0);
      const inscripcionCerrada =
        cantidadAspirantes >= cupo
        || String(solicitud?.linkPreinscripcion || '').toLowerCase() === PREINSCRIPCION_CERRADA;
      const enviadoCoordinador = coordinacionPendiente || coordinacionAprobada;
      const puedeEnviarCoordinador =
        cantidadAspirantes >= cupo
        && (!revision || coordinacionRechazada)
        && !funcionarioRechazo;
      const enviadoFuncionario = coordinacionAprobada;
      const puedeEnviarFuncionario =
        ['coordinador', 'admin'].includes(currentRole)
        && coordinacionPendiente;
      const coordinadorAprobador = buildPersonName(approvedRevision?.usuarioRevisador);
      const observacionFuncionarioActual = String(revisionFuncionario?.observacion || '').trim();
      const estadoFichaNormalizado = getEstadoNombreNormalizado(estadoFicha || '');
      const bloqueadaPorMatriculada = estadoFichaNormalizado.includes('matriculad');
      const puedeReenviarDirectoFuncionario =
        currentRole === 'instructor'
        && funcionarioRechazo
        && coordinacionAprobada;
      const enviadoDirectoFuncionario = funcionarioReenvio || funcionarioAprobo;
      const gestionAspirantesBloqueada =
        coordinacionPendiente
        || (coordinacionAprobada && !funcionarioRechazo);
      const decisionCoordinadorActual = coordinacionAprobada
        ? 'aprobado'
        : coordinacionRechazada
          ? 'rechazado'
          : coordinacionPendiente
            ? 'pendiente'
            : null;

      return {
        id: solicitud._id,
        codigoSolicitud: solicitud.codigoSolicitud,
        codigoFicha: ficha?.codigoFicha || null,
        estadoFichaId,
        estadoFicha,
        nombrePrograma: solicitud.programa?.nombre || 'Sin programa',
        areaPrograma: solicitud.programa?.area?.nombre || 'Sin área',
        tipoSolicitud: tipoSolicitudNombre || 'Sin tipo',
        fechaSolicitud: solicitud.fechaSolicitud,
        estado,
        observacionFuncionario: observacionFuncionarioActual || ficha?.observacion || 'Sin observación',
        observacionCoordinador: revision?.observacion || '',
        coordinadorAprobador: coordinadorAprobador || 'Sin coordinador aprobador',
        cupo,
        inscripcionCerrada,
        linkInscripcionPublica: `/inscripcion/${solicitud._id}`,
        cartaUrl: solicitud.cartaRuta ? `/media/${solicitud.cartaRuta}` : null,
        fichaCaracterizacionUrl,
        excelSofiaUrl: ['instructor', 'funcionario'].includes(currentRole) && ficha?.excelSofiaPlusPath
          ? `/solicitudes/${solicitud._id}/sofia-plus`
          : null,
        tieneExcelSofiaPlus: Boolean(ficha?.excelSofiaPlusPath),
        cantidadAspirantes,
        enviadoCoordinador,
        puedeEnviarCoordinador,
        gestionAspirantesBloqueada,
        enviadoFuncionario,
        puedeEnviarFuncionario,
        decisionCoordinadorActual,
        observacionFuncionarioActual,
        estadoFuncionarioActual: estadoFuncionario || null,
        retornadaPorFuncionario: funcionarioRechazo,
        puedeReenviarDirectoFuncionario,
        enviadoDirectoFuncionario,
        bloqueadaPorMatriculada
      };
    });

    return res.status(200).json({
      solicitudes: result,
      catalogs: {
        estadosFicha: estadosFichaCatalogo.map((item) => ({ id: String(item._id), nombre: item.nombre }))
      }
    });
  } catch (error) {
    return next(error);
  }
};

const getSolicitudesReportes = async (req, res, next) => {
  try {
    // Reporte consolidado con filtros, series agregadas y paginación para dashboard.
    const currentRole = String(req.user?.roleKey || '').toLowerCase();
    const {
      areaId,
      programaId,
      tipoSolicitud,
      estadoFichaId,
      estadoCoordinadorId,
      fechaDesde,
      fechaHasta,
      coordinatorId,
      instructorId,
      funcionarioId,
      page,
      limit
    } = req.query;

    const parsedPage = Math.max(Number(page) || 1, 1);
    const parsedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);

    const [areas, programas, estadosFicha, estadosCoordinador, coordinadores, instructores, funcionarios] = await Promise.all([
      Area.find({}).sort({ nombre: 1 }).select('_id nombre').lean(),
      ProgramaFormacion.find({})
        .populate('area', 'nombre')
        .sort({ nombre: 1 })
        .select('_id nombre area')
        .lean(),
      EstadoFicha.find({}).sort({ nombre: 1 }).select('_id nombre').lean(),
      EstadoCoordinador.find({}).sort({ nombre: 1 }).select('_id nombre').lean(),
      User.find({ roleKey: 'coordinador', active: true })
        .sort({ firstName: 1, lastName: 1 })
        .select('_id firstName lastName')
        .lean(),
      User.find({ roleKey: 'instructor', active: true })
        .sort({ firstName: 1, lastName: 1 })
        .select('_id firstName lastName coordinatorId')
        .lean(),
      User.find({ roleKey: 'funcionario', active: true })
        .sort({ firstName: 1, lastName: 1 })
        .select('_id firstName lastName')
        .lean()
    ]);

    // Construye query base según permisos y filtros relacionales por rol.
    const baseQuery = {};
    if (currentRole === 'coordinador') {
      const instructorIds = await User.find({
        roleKey: 'instructor',
        coordinatorId: req.user._id,
        active: true
      }).distinct('_id');
      baseQuery.usuario = { $in: instructorIds };

      if (coordinatorId && String(coordinatorId) !== String(req.user._id)) {
        baseQuery.usuario = { $in: [] };
      }
    }

    if (currentRole === 'coordinador' && instructorId) {
      const ownInstructor = await User.exists({
        _id: instructorId,
        roleKey: 'instructor',
        coordinatorId: req.user._id,
        active: true
      });

      if (!ownInstructor) {
        baseQuery.usuario = { $in: [] };
      } else {
        baseQuery.usuario = instructorId;
      }
    } else if (instructorId) {
      baseQuery.usuario = instructorId;
    }

    if (programaId) {
      baseQuery.programa = programaId;
    } else if (areaId) {
      const programasAreaIds = await ProgramaFormacion.find({ area: areaId }).distinct('_id');
      baseQuery.programa = { $in: programasAreaIds };
    }

    if (tipoSolicitud) {
      const normalizedTipo = normalizeTipoSolicitudKey(tipoSolicitud);
      let tipoDoc = null;

      if (normalizedTipo.includes('campesena')) {
        tipoDoc = await TipoSolicitud.findOne({ nombre: /campesena/i }).select('_id').lean();
      }

      if (normalizedTipo.includes('regular') || normalizedTipo.includes('normal')) {
        tipoDoc = await TipoSolicitud.findOne({ nombre: /normal|regular/i }).select('_id').lean();
      }

      if (tipoDoc?._id) {
        baseQuery.tipoSolicitud = tipoDoc._id;
      }
    }

    const rangoFechas = {};
    const fromDate = parseOptionalDate(fechaDesde);
    const toDate = parseOptionalDate(fechaHasta);
    if (fromDate) {
      fromDate.setHours(0, 0, 0, 0);
      rangoFechas.$gte = fromDate;
    }
    if (toDate) {
      toDate.setHours(23, 59, 59, 999);
      rangoFechas.$lte = toDate;
    }
    if (Object.keys(rangoFechas).length) {
      baseQuery.fechaSolicitud = rangoFechas;
    }

    const solicitudes = await Solicitud.find(baseQuery)
      .populate({
        path: 'programa',
        select: 'nombre area',
        populate: { path: 'area', select: 'nombre' }
      })
      .populate('tipoSolicitud', 'nombre')
      .populate({
        path: 'usuario',
        select: 'firstName lastName coordinatorId',
        populate: { path: 'coordinatorId', select: 'firstName lastName' }
      })
      .sort({ fechaSolicitud: -1 });

    const solicitudIds = solicitudes.map((item) => item._id);

    const fichas = await Ficha.find({ solicitud: { $in: solicitudIds } })
      .populate('estado', 'nombre')
      .sort({ createdAt: -1 });

    const revisiones = await SolicitudCoordinador.find({ solicitud: { $in: solicitudIds } })
      .populate('estado', 'nombre')
      .sort({ fecha: -1, createdAt: -1 });

    const revisionesFuncionario = await SolicitudFuncionario.find({ solicitud: { $in: solicitudIds } })
      .populate('usuarioRevisador', 'firstName lastName')
      .sort({ fecha: -1, createdAt: -1 });

    const fichaBySolicitud = new Map();
    for (const ficha of fichas) {
      const key = String(ficha.solicitud);
      if (!fichaBySolicitud.has(key)) {
        fichaBySolicitud.set(key, ficha);
      }
    }

    const revisionBySolicitud = new Map();
    for (const revision of revisiones) {
      const key = String(revision.solicitud);
      if (!revisionBySolicitud.has(key)) {
        revisionBySolicitud.set(key, revision);
      }
    }

    const revisionFuncionarioBySolicitud = new Map();
    for (const revisionFuncionario of revisionesFuncionario) {
      const key = String(revisionFuncionario.solicitud);
      if (!revisionFuncionarioBySolicitud.has(key)) {
        revisionFuncionarioBySolicitud.set(key, revisionFuncionario);
      }
    }

    // Proyecta cada solicitud en una fila plana para tabla y gráficos.
    const rows = solicitudes.map((solicitud) => {
      const key = String(solicitud._id);
      const ficha = fichaBySolicitud.get(key);
      const revision = revisionBySolicitud.get(key);
      const revisionFuncionario = revisionFuncionarioBySolicitud.get(key);
      const estadoFichaNombre = ficha?.estado?.nombre || null;
      const estadoCoordinadorNombre = revision?.estado?.nombre || null;
      const estadoGeneral = estadoFichaNombre || estadoCoordinadorNombre || 'Lista de espera';
      const tipoSolicitudNombre = solicitud.tipoSolicitud?.nombre || '';
      const tipoSolicitudClave = isCampesenaTipo(tipoSolicitudNombre) ? 'campesena' : 'regular';
      const coordinadorNombre = [
        solicitud.usuario?.coordinatorId?.firstName,
        solicitud.usuario?.coordinatorId?.lastName
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
      const funcionarioNombre = [
        revisionFuncionario?.usuarioRevisador?.firstName,
        revisionFuncionario?.usuarioRevisador?.lastName
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      return {
        id: String(solicitud._id),
        codigoSolicitud: solicitud.codigoSolicitud || null,
        fechaSolicitud: solicitud.fechaSolicitud,
        programaId: solicitud.programa?._id ? String(solicitud.programa._id) : null,
        nombrePrograma: solicitud.programa?.nombre || 'Sin programa',
        areaId: solicitud.programa?.area?._id ? String(solicitud.programa.area._id) : null,
        areaPrograma: solicitud.programa?.area?.nombre || 'Sin área',
        tipoSolicitud: tipoSolicitudClave,
        tipoSolicitudLabel: tipoSolicitudClave === 'campesena' ? 'Campesena' : 'Regular',
        estadoFichaId: ficha?.estado?._id ? String(ficha.estado._id) : null,
        estadoFicha: estadoFichaNombre || 'Sin estado de ficha',
        estadoCoordinadorId: revision?.estado?._id ? String(revision.estado._id) : null,
        estadoCoordinador: estadoCoordinadorNombre || 'Sin estado de coordinación',
        estadoGeneral,
        instructorId: solicitud.usuario?._id ? String(solicitud.usuario._id) : null,
        instructor: [solicitud.usuario?.firstName, solicitud.usuario?.lastName].filter(Boolean).join(' ').trim(),
        coordinadorId: solicitud.usuario?.coordinatorId?._id ? String(solicitud.usuario.coordinatorId._id) : null,
        coordinador: coordinadorNombre || 'Sin coordinador',
        funcionarioId: revisionFuncionario?.usuarioRevisador?._id
          ? String(revisionFuncionario.usuarioRevisador._id)
          : null,
        funcionario: funcionarioNombre || 'Sin funcionario'
      };
    });

    // Filtro final in-memory para estados especiales (sin estado/sin funcionario).
    const filteredRows = rows.filter((item) => {
      if (coordinatorId && String(item.coordinadorId || '') !== String(coordinatorId)) {
        return false;
      }

      if (instructorId && String(item.instructorId || '') !== String(instructorId)) {
        return false;
      }

      if (funcionarioId) {
        if (funcionarioId === 'sin_funcionario') {
          if (item.funcionarioId) {
            return false;
          }
        } else if (String(item.funcionarioId || '') !== String(funcionarioId)) {
          return false;
        }
      }

      if (estadoFichaId) {
        if (estadoFichaId === 'sin_estado') {
          if (item.estadoFichaId) {
            return false;
          }
        } else if (String(item.estadoFichaId || '') !== String(estadoFichaId)) {
          return false;
        }
      }

      if (estadoCoordinadorId) {
        if (estadoCoordinadorId === 'sin_estado') {
          if (item.estadoCoordinadorId) {
            return false;
          }
        } else if (String(item.estadoCoordinadorId || '') !== String(estadoCoordinadorId)) {
          return false;
        }
      }

      return true;
    });

    // Agrega series de frecuencia para visualizaciones del reporte.
    const buildSeries = (collection, keyGetter, labelGetter) => {
      const map = new Map();
      for (const item of collection) {
        const keyValue = keyGetter(item);
        const keyLabel = labelGetter(item);
        const prev = map.get(keyValue) || { key: keyValue, label: keyLabel, total: 0 };
        prev.total += 1;
        map.set(keyValue, prev);
      }

      return [...map.values()].sort((a, b) => b.total - a.total);
    };

    const porEstadoFicha = buildSeries(
      filteredRows,
      (item) => item.estadoFichaId || 'sin_estado',
      (item) => item.estadoFicha || 'Sin estado de ficha'
    );

    const porEstadoCoordinador = buildSeries(
      filteredRows,
      (item) => item.estadoCoordinadorId || 'sin_estado',
      (item) => item.estadoCoordinador || 'Sin estado de coordinación'
    );

    const porTipoSolicitud = buildSeries(
      filteredRows,
      (item) => item.tipoSolicitud,
      (item) => item.tipoSolicitudLabel
    );

    const porArea = buildSeries(
      filteredRows,
      (item) => item.areaId || 'sin_area',
      (item) => item.areaPrograma || 'Sin área'
    );

    const porPrograma = buildSeries(
      filteredRows,
      (item) => item.programaId || 'sin_programa',
      (item) => item.nombrePrograma || 'Sin programa'
    );

    const porMes = buildSeries(
      filteredRows,
      (item) => {
        const date = new Date(item.fechaSolicitud);
        if (Number.isNaN(date.getTime())) {
          return 'sin_mes';
        }

        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      },
      (item) => {
        const date = new Date(item.fechaSolicitud);
        if (Number.isNaN(date.getTime())) {
          return 'Sin mes';
        }

        return date.toLocaleDateString('es-CO', { year: 'numeric', month: 'long' });
      }
    ).sort((a, b) => String(a.key).localeCompare(String(b.key)));

    const totalItems = filteredRows.length;
    const startIndex = (parsedPage - 1) * parsedLimit;
    const endIndex = startIndex + parsedLimit;
    const paginatedItems = filteredRows.slice(startIndex, endIndex);

    return res.status(200).json({
      filtrosAplicados: {
        areaId: areaId || '',
        programaId: programaId || '',
        tipoSolicitud: tipoSolicitud || '',
        estadoFichaId: estadoFichaId || '',
        estadoCoordinadorId: estadoCoordinadorId || '',
        fechaDesde: fechaDesde || '',
        fechaHasta: fechaHasta || '',
        coordinatorId: coordinatorId || '',
        instructorId: instructorId || '',
        funcionarioId: funcionarioId || ''
      },
      catalogos: {
        areas: areas.map((item) => ({ id: String(item._id), nombre: item.nombre })),
        programas: programas.map((item) => ({
          id: String(item._id),
          nombre: item.nombre,
          areaId: item.area?._id ? String(item.area._id) : null,
          areaNombre: item.area?.nombre || 'Sin área'
        })),
        estadosFicha: [
          { id: 'sin_estado', nombre: 'Sin estado de ficha' },
          ...estadosFicha.map((item) => ({ id: String(item._id), nombre: item.nombre }))
        ],
        estadosCoordinador: [
          { id: 'sin_estado', nombre: 'Sin estado de coordinación' },
          ...estadosCoordinador.map((item) => ({ id: String(item._id), nombre: item.nombre }))
        ],
        coordinadores: coordinadores.map((item) => ({
          id: String(item._id),
          nombre: [item.firstName, item.lastName].filter(Boolean).join(' ').trim()
        })).filter((item) => {
          if (currentRole !== 'coordinador') {
            return true;
          }

          return item.id === String(req.user._id || '');
        }),
        instructores: instructores
          .filter((item) => {
            if (currentRole !== 'coordinador') {
              return true;
            }

            return String(item.coordinatorId || '') === String(req.user._id || '');
          })
          .map((item) => ({
            id: String(item._id),
            nombre: [item.firstName, item.lastName].filter(Boolean).join(' ').trim(),
            coordinatorId: item.coordinatorId ? String(item.coordinatorId) : null
          })),
        funcionarios: [
          { id: 'sin_funcionario', nombre: 'Sin funcionario' },
          ...funcionarios.map((item) => ({
            id: String(item._id),
            nombre: [item.firstName, item.lastName].filter(Boolean).join(' ').trim()
          }))
        ],
        tiposSolicitud: [
          { id: 'regular', nombre: 'Regular' },
          { id: 'campesena', nombre: 'Campesena' }
        ]
      },
      resumen: {
        totalSolicitudes: totalItems,
        totalRegular: filteredRows.filter((item) => item.tipoSolicitud === 'regular').length,
        totalCampesena: filteredRows.filter((item) => item.tipoSolicitud === 'campesena').length
      },
      graficas: {
        porEstadoFicha,
        porEstadoCoordinador,
        porTipoSolicitud,
        porArea,
        porPrograma,
        porMes
      },
      tabla: {
        page: parsedPage,
        limit: parsedLimit,
        totalItems,
        totalPages: Math.max(Math.ceil(totalItems / parsedLimit), 1),
        items: paginatedItems
      }
    });
  } catch (error) {
    return next(error);
  }
};

const sendSolicitudToCoordinator = async (req, res, next) => {
  try {
    // Envía solicitud del instructor a coordinación cuando el cupo está completo.
    const role = String(req.user?.roleKey || '').toLowerCase();

    const solicitud = await Solicitud.findById(req.params.id)
      .populate('usuario', 'coordinatorId firstName lastName')
      .lean();

    if (!solicitud) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    if (role === 'instructor' && String(solicitud.usuario?._id || '') !== String(req.user?._id || '')) {
      return res.status(403).json({ message: 'Sin permisos para enviar esta solicitud al coordinador' });
    }

    if (!['instructor', 'admin'].includes(role)) {
      return res.status(403).json({ message: 'Sin permisos para enviar solicitudes al coordinador' });
    }

    const totalAspirantes = await Aspirante.countDocuments({ solicitud: solicitud._id });
    const cupo = Number(solicitud.cupo || 0);
    if (totalAspirantes < cupo) {
      return res.status(409).json({
        message: `Debe completar todos los cupos antes de enviar al coordinador (${totalAspirantes}/${cupo})`
      });
    }

    const lastRevision = await SolicitudCoordinador.findOne({ solicitud: solicitud._id })
      .populate('estado', 'nombre')
      .sort({ fecha: -1, createdAt: -1 })
      .lean();

    const estadoActual = normalizeTipoSolicitudKey(lastRevision?.estado?.nombre || '');
    const alreadySent = Boolean(lastRevision) && !estadoActual.includes('rechaz');

    if (alreadySent) {
      return res.status(409).json({ message: 'La solicitud ya fue enviada al coordinador' });
    }

    const solicitudOwner = role === 'instructor'
      ? req.user
      : await User.findById(solicitud.usuario?._id).select('coordinatorId').lean();

    const coordinatorId = solicitudOwner?.coordinatorId;
    if (!coordinatorId) {
      return res.status(400).json({ message: 'El instructor no tiene coordinador asignado' });
    }

    const coordinator = await User.findById(coordinatorId)
      .select('firstName lastName roleKey active')
      .lean();

    if (!coordinator || String(coordinator.roleKey || '').toLowerCase() !== 'coordinador' || !coordinator.active) {
      return res.status(400).json({ message: 'El coordinador asignado no es válido o está inactivo' });
    }

    let pendingEstado = await EstadoCoordinador.findOne({ nombre: /pendiente|espera|revision|cread/i })
      .sort({ legacyId: 1, nombre: 1 })
      .lean();

    if (!pendingEstado) {
      pendingEstado = await EstadoCoordinador.findOneAndUpdate(
        { nombre: 'Pendiente' },
        { $setOnInsert: { nombre: 'Pendiente' } },
        { upsert: true, new: true }
      ).lean();
    }

    if (!pendingEstado) {
      return res.status(500).json({ message: 'No se pudo resolver el estado inicial de coordinación' });
    }

    await SolicitudCoordinador.create({
      usuarioRevisador: coordinator._id,
      usuarioSolicitud: solicitud.usuario?._id,
      solicitud: solicitud._id,
      estado: pendingEstado._id,
      observacion: 'Solicitud enviada a coordinación académica',
      fecha: new Date()
    });

    await Solicitud.updateOne(
      { _id: solicitud._id },
      {
        $set: {
          revisado: true,
          linkPreinscripcion: PREINSCRIPCION_CERRADA
        }
      }
    );

    return res.status(200).json({
      message: 'Solicitud enviada al coordinador correctamente',
      envio: {
        solicitudId: solicitud._id,
        coordinadorId: coordinator._id,
        coordinadorNombre: [coordinator.firstName, coordinator.lastName].filter(Boolean).join(' ').trim()
      }
    });
  } catch (error) {
    return next(error);
  }
};

const sendSolicitudDirectToFuncionario = async (req, res, next) => {
  try {
    // Reenvío excepcional instructor→funcionario tras rechazo previo de funcionario.
    const role = String(req.user?.roleKey || '').toLowerCase();
    if (role !== 'instructor') {
      return res.status(403).json({ message: 'Sin permisos para enviar solicitudes a funcionario' });
    }

    const solicitud = await Solicitud.findById(req.params.id)
      .populate('usuario', 'firstName lastName email')
      .lean();

    if (!solicitud) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    if (String(solicitud.usuario?._id || '') !== String(req.user?._id || '')) {
      return res.status(403).json({ message: 'Sin permisos para reenviar esta solicitud al funcionario' });
    }

    const lastCoordinacion = await SolicitudCoordinador.findOne({ solicitud: solicitud._id })
      .populate('estado', 'nombre')
      .sort({ fecha: -1, createdAt: -1 })
      .lean();

    const estadoCoordinacionActual = normalizeTipoSolicitudKey(lastCoordinacion?.estado?.nombre || '');
    if (!estadoCoordinacionActual.includes('aprob')) {
      return res.status(409).json({ message: 'Solo se puede reenviar directo cuando coordinación ya aprobó la solicitud' });
    }

    const lastFuncionario = await SolicitudFuncionario.findOne({ solicitud: solicitud._id })
      .sort({ fecha: -1, createdAt: -1 })
      .lean();

    if (String(lastFuncionario?.estado || '').toLowerCase() !== 'rechazado') {
      return res.status(409).json({ message: 'La solicitud no se encuentra retornada por funcionario' });
    }

    await SolicitudFuncionario.create({
      usuarioRevisador: null,
      usuarioSolicitud: solicitud.usuario?._id,
      solicitud: solicitud._id,
      estado: 'reenviado',
      observacion: 'Solicitud reenviada directamente por instructor al funcionario',
      fecha: new Date()
    });

    return res.status(200).json({
      message: 'Solicitud reenviada directamente al funcionario',
      envio: {
        solicitudId: solicitud._id
      }
    });
  } catch (error) {
    return next(error);
  }
};

const sendSolicitudToFuncionario = async (req, res, next) => {
  try {
    // Registra decisión de coordinación y notifica al instructor por correo.
    const role = String(req.user?.roleKey || '').toLowerCase();
    if (!['coordinador', 'admin'].includes(role)) {
      return res.status(403).json({ message: 'Sin permisos para enviar solicitudes a funcionario' });
    }

    const observacion = String(req.body?.observacion || '').trim();
    const decisionRaw = normalizeTipoSolicitudKey(req.body?.decision || '');
    const decision = decisionRaw.includes('rechaz')
      ? 'rechazado'
      : decisionRaw.includes('aprob')
        ? 'aprobado'
        : '';

    if (!observacion) {
      return res.status(400).json({ message: 'La observación es obligatoria para enviar la decisión de coordinación' });
    }

    if (!decision) {
      return res.status(400).json({ message: 'Debe seleccionar una decisión válida: aprobado o rechazado' });
    }

    const solicitud = await Solicitud.findById(req.params.id)
      .populate('programa', 'nombre')
      .lean();
    if (!solicitud) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    const revisionQuery = { solicitud: solicitud._id };
    if (role === 'coordinador') {
      revisionQuery.usuarioRevisador = req.user._id;
    }

    const lastRevision = await SolicitudCoordinador.findOne(revisionQuery)
      .populate('estado', 'nombre')
      .sort({ fecha: -1, createdAt: -1 })
      .lean();

    if (!lastRevision) {
      return res.status(409).json({ message: 'La solicitud aún no ha sido enviada a coordinación para su revisión' });
    }

    const estadoActual = normalizeTipoSolicitudKey(lastRevision.estado?.nombre || '');
    if (estadoActual.includes('aprob')) {
      return res.status(409).json({ message: 'La solicitud ya fue aprobada por coordinación' });
    }

    if (estadoActual.includes('rechaz')) {
      return res.status(409).json({ message: 'La solicitud ya fue rechazada y debe reenviarse a coordinación desde instructor/admin' });
    }

    let targetEstado = null;
    if (decision === 'aprobado') {
      targetEstado = await EstadoCoordinador.findOne({ nombre: /aprobado/i }).lean();
      if (!targetEstado) {
        return res.status(500).json({ message: 'No existe estado aprobado de coordinación configurado' });
      }
    } else {
      targetEstado = await EstadoCoordinador.findOne({ nombre: /rechazado/i }).lean();
      if (!targetEstado) {
        targetEstado = await EstadoCoordinador.findOneAndUpdate(
          { nombre: 'Rechazado' },
          { $setOnInsert: { nombre: 'Rechazado' } },
          { upsert: true, new: true }
        ).lean();
      }

      if (!targetEstado) {
        return res.status(500).json({ message: 'No existe estado rechazado de coordinación configurado' });
      }
    }

    await SolicitudCoordinador.create({
      usuarioRevisador: role === 'coordinador' ? req.user._id : (lastRevision.usuarioRevisador || req.user._id),
      usuarioSolicitud: lastRevision.usuarioSolicitud,
      solicitud: lastRevision.solicitud,
      estado: targetEstado._id,
      observacion,
      fecha: new Date()
    });

    const totalAspirantes = await Aspirante.countDocuments({ solicitud: solicitud._id });
    const cupo = Number(solicitud.cupo || 0);
    const reachedCapacity = totalAspirantes >= cupo;

    await Solicitud.updateOne(
      { _id: solicitud._id },
      {
        $set: {
          revisado: decision === 'aprobado',
          linkPreinscripcion: decision === 'rechazado' && !reachedCapacity
            ? null
            : PREINSCRIPCION_CERRADA
        }
      }
    );

    const instructor = await User.findById(solicitud.usuario)
      .select('firstName lastName email')
      .lean();

    if (instructor?.email) {
      try {
        const coordinadorNombre = [req.user?.firstName, req.user?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();

        await sendSolicitudDecisionEmail({
          to: instructor.email,
          firstName: instructor.firstName,
          decision,
          observacion,
          codigoSolicitud: solicitud.codigoSolicitud,
          nombrePrograma: solicitud.programa?.nombre,
          coordinadorNombre
        });
      } catch (mailError) {
        console.error('No se pudo enviar correo de decisión al instructor:', mailError?.message || mailError);
      }
    }

    return res.status(200).json({
      message: decision === 'aprobado'
        ? 'Solicitud aprobada y enviada al funcionario correctamente'
        : 'Solicitud rechazada y devuelta al instructor para ajustes',
      decision
    });
  } catch (error) {
    return next(error);
  }
};

const updateSolicitudByFuncionario = async (req, res, next) => {
  const temporalPath = req.file?.path ? String(req.file.path) : '';

  try {
    // Gestiona actualización funcional de ficha (estado, códigos, observación y Excel).
    const role = String(req.user?.roleKey || '').toLowerCase();
    if (role !== 'funcionario') {
      return res.status(403).json({ message: 'Sin permisos para gestionar la solicitud' });
    }

    const baseQuery = await buildConsultaScope(req.user);
    const solicitud = await Solicitud.findOne({
      ...baseQuery,
      _id: req.params.id
    })
      .populate('programa', 'nombre')
      .populate('usuario', 'firstName lastName email')
      .select('_id codigoSolicitud cupo usuario programa')
      .lean();

    if (!solicitud) {
      return res.status(404).json({ message: 'Solicitud no encontrada o no disponible para gestión' });
    }

    let ficha = await Ficha.findOne({ solicitud: solicitud._id })
      .populate('estado', 'nombre')
      .sort({ createdAt: -1 });

    if (!ficha) {
      const estadoInicial = await resolveInitialEstadoFicha();
      if (!estadoInicial?._id) {
        return res.status(500).json({ message: 'No se pudo resolver el estado inicial de la ficha' });
      }

      ficha = await Ficha.create({
        solicitud: solicitud._id,
        estado: estadoInicial._id,
        usuario: solicitud.usuario?._id || req.user?._id,
        observacion: ''
      });

      ficha = await Ficha.findById(ficha._id)
        .populate('estado', 'nombre');
    }

    if (isEstadoFichaMatriculada(ficha?.estado)) {
      return res.status(409).json({ message: 'La ficha ya se encuentra matriculada y no permite más cambios' });
    }

    const body = req.body || {};
    const hasEstadoField = Object.prototype.hasOwnProperty.call(body, 'estadoFichaId');
    const hasCodigoSolicitudField = Object.prototype.hasOwnProperty.call(body, 'codigoSolicitud');
    const hasCodigoFichaField = Object.prototype.hasOwnProperty.call(body, 'codigoFicha');
    const hasObservacionField = Object.prototype.hasOwnProperty.call(body, 'observacionFuncionario');
    const hasExcelField = Boolean(req.file);

    if (!hasEstadoField && !hasCodigoSolicitudField && !hasCodigoFichaField && !hasObservacionField && !hasExcelField) {
      return res.status(400).json({ message: 'Debe enviar al menos un campo para actualizar' });
    }

    const solicitudUpdate = {};
    const fichaUpdate = {};

    const codigoSolicitudParsed = parseNullableNumberField(body.codigoSolicitud);
    if (codigoSolicitudParsed.error) {
      return res.status(400).json({ message: 'El código de solicitud debe ser numérico' });
    }
    if (codigoSolicitudParsed.provided) {
      solicitudUpdate.codigoSolicitud = codigoSolicitudParsed.value;
    }

    const codigoFichaParsed = parseNullableNumberField(body.codigoFicha);
    if (codigoFichaParsed.error) {
      return res.status(400).json({ message: 'El código de ficha debe ser numérico' });
    }
    if (codigoFichaParsed.provided) {
      fichaUpdate.codigoFicha = codigoFichaParsed.value;
    }

    let targetEstado = ficha?.estado || null;
    if (hasEstadoField) {
      const estadoFichaId = String(body.estadoFichaId || '').trim();
      if (estadoFichaId.length) {
        const estadoFicha = await EstadoFicha.findById(estadoFichaId)
          .select('_id nombre')
          .lean();

        if (!estadoFicha) {
          return res.status(400).json({ message: 'El estado de ficha seleccionado no es válido' });
        }

        targetEstado = estadoFicha;
        fichaUpdate.estado = estadoFicha._id;
      }
    }

    const observacionFuncionario = String(body?.observacionFuncionario || '').trim();
    if (hasObservacionField) {
      fichaUpdate.observacion = observacionFuncionario;
    }

    const targetEsCreada = isEstadoFichaCreada(targetEstado);
    const targetEsMatriculada = isEstadoFichaMatriculada(targetEstado);
    const targetEsRechazada = isEstadoFichaRechazada(targetEstado);

    const nextCodigoSolicitud = Object.prototype.hasOwnProperty.call(solicitudUpdate, 'codigoSolicitud')
      ? solicitudUpdate.codigoSolicitud
      : solicitud.codigoSolicitud;
    const nextCodigoFicha = Object.prototype.hasOwnProperty.call(fichaUpdate, 'codigoFicha')
      ? fichaUpdate.codigoFicha
      : ficha.codigoFicha;

    let nextExcelPath = ficha.excelSofiaPlusPath || null;
    if (req.file) {
      const folderRelative = path.join('sofia_plus', `solicitud_${String(solicitud._id)}`);
      const folderAbsolute = path.join(mediaRoot, folderRelative);
      await fs.promises.mkdir(folderAbsolute, { recursive: true });

      const originalFileName = sanitizeFileName(req.file.originalname || 'sofia_plus.xlsx');
      const generatedName = `${Date.now()}-${originalFileName}`;
      const destinationAbsolutePath = path.join(folderAbsolute, generatedName);
      await fs.promises.rename(req.file.path, destinationAbsolutePath);

      const previousPath = ficha.excelSofiaPlusPath ? path.join(mediaRoot, ficha.excelSofiaPlusPath) : null;
      if (previousPath && fs.existsSync(previousPath) && previousPath !== destinationAbsolutePath) {
        await fs.promises.unlink(previousPath).catch(() => null);
      }

      nextExcelPath = path.join(folderRelative, generatedName).replace(/\\/g, '/');
      fichaUpdate.excelSofiaPlusPath = nextExcelPath;
    }

    if ((targetEsCreada || targetEsMatriculada) && (!nextCodigoSolicitud || !nextCodigoFicha || !nextExcelPath)) {
      return res.status(400).json({
        message: 'Para estados Creada o Matriculada debe completar código de solicitud, código de ficha y archivo SOFiA Plus'
      });
    }

    if (targetEsRechazada && !observacionFuncionario) {
      return res.status(400).json({
        message: 'Debe registrar observación cuando la ficha se marca en estado rechazado'
      });
    }

    try {
      if (Object.keys(solicitudUpdate).length) {
        await Solicitud.updateOne({ _id: solicitud._id }, { $set: solicitudUpdate });
      }

      if (Object.keys(fichaUpdate).length) {
        await Ficha.updateOne({ _id: ficha._id }, { $set: fichaUpdate });
      }
    } catch (updateError) {
      if (Number(updateError?.code) === 11000) {
        return res.status(409).json({ message: 'El código de solicitud o de ficha ya existe. Use un valor diferente.' });
      }

      throw updateError;
    }

    const decisionFuncionario = targetEsRechazada ? 'rechazado' : 'aprobado';
    await SolicitudFuncionario.create({
      usuarioRevisador: req.user._id,
      usuarioSolicitud: solicitud.usuario?._id,
      solicitud: solicitud._id,
      estado: decisionFuncionario,
      observacion: observacionFuncionario || null,
      fecha: new Date()
    });

    const totalAspirantes = await Aspirante.countDocuments({ solicitud: solicitud._id });
    const cupo = Number(solicitud.cupo || 0);
    const reachedCapacity = totalAspirantes >= cupo;

    await Solicitud.updateOne(
      { _id: solicitud._id },
      {
        $set: {
          revisado: !targetEsRechazada,
          linkPreinscripcion: targetEsRechazada && !reachedCapacity
            ? null
            : PREINSCRIPCION_CERRADA
        }
      }
    );

    const instructor = solicitud.usuario;
    if (instructor?.email) {
      try {
        const funcionarioNombre = [req.user?.firstName, req.user?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();

        await sendFuncionarioSolicitudStatusEmail({
          to: instructor.email,
          firstName: instructor.firstName,
          estadoFicha: targetEstado?.nombre,
          observacion: observacionFuncionario,
          codigoSolicitud: nextCodigoSolicitud,
          nombrePrograma: solicitud.programa?.nombre,
          funcionarioNombre
        });
      } catch (mailError) {
        console.error('No se pudo enviar correo de estado de funcionario al instructor:', mailError?.message || mailError);
      }
    }

    const [updatedSolicitud, updatedFicha] = await Promise.all([
      Solicitud.findById(solicitud._id).select('_id codigoSolicitud').lean(),
      Ficha.findById(ficha._id)
        .populate('estado', 'nombre')
        .select('_id codigoFicha estado observacion excelSofiaPlusPath')
        .lean()
    ]);

    return res.status(200).json({
      message: targetEsRechazada
        ? 'Solicitud rechazada y devuelta al instructor'
        : 'Solicitud enviada por funcionario correctamente',
      solicitud: {
        id: String(updatedSolicitud?._id || solicitud._id),
        codigoSolicitud: updatedSolicitud?.codigoSolicitud ?? null,
        codigoFicha: updatedFicha?.codigoFicha ?? null,
        estadoFichaId: updatedFicha?.estado?._id ? String(updatedFicha.estado._id) : null,
        estadoFicha: updatedFicha?.estado?.nombre || null,
        observacionFuncionario: updatedFicha?.observacion || '',
        tieneExcelSofiaPlus: Boolean(updatedFicha?.excelSofiaPlusPath),
        bloqueadaPorMatriculada: isEstadoFichaMatriculada(updatedFicha?.estado)
      }
    });
  } catch (error) {
    if (temporalPath && fs.existsSync(temporalPath)) {
      await fs.promises.unlink(temporalPath).catch(() => null);
    }

    return next(error);
  }
};

const uploadSolicitudSofiaPlus = async (req, res, next) => {
  const temporalPath = req.file?.path ? String(req.file.path) : '';

  try {
    // Carga directa de Excel SOFiA Plus por funcionario para una solicitud.
    const role = String(req.user?.roleKey || '').toLowerCase();
    if (role !== 'funcionario') {
      return res.status(403).json({ message: 'Sin permisos para cargar archivo SOFiA Plus' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Debe adjuntar un archivo Excel para SOFiA Plus' });
    }

    const baseQuery = await buildConsultaScope(req.user);
    const solicitud = await Solicitud.findOne({
      ...baseQuery,
      _id: req.params.id
    })
      .select('_id usuario')
      .lean();

    if (!solicitud) {
      return res.status(404).json({ message: 'Solicitud no encontrada o no disponible para gestión' });
    }

    let ficha = await Ficha.findOne({ solicitud: solicitud._id })
      .sort({ createdAt: -1 });

    if (!ficha) {
      const estadoInicial = await resolveInitialEstadoFicha();
      if (!estadoInicial?._id) {
        return res.status(500).json({ message: 'No se pudo resolver el estado inicial de la ficha' });
      }

      ficha = await Ficha.create({
        solicitud: solicitud._id,
        estado: estadoInicial._id,
        usuario: solicitud.usuario || req.user?._id,
        observacion: ''
      });
    }

    const folderRelative = path.join('sofia_plus', `solicitud_${String(solicitud._id)}`);
    const folderAbsolute = path.join(mediaRoot, folderRelative);
    await fs.promises.mkdir(folderAbsolute, { recursive: true });

    const originalFileName = sanitizeFileName(req.file.originalname || 'sofia_plus.xlsx');
    const generatedName = `${Date.now()}-${originalFileName}`;
    const destinationAbsolutePath = path.join(folderAbsolute, generatedName);
    await fs.promises.rename(req.file.path, destinationAbsolutePath);

    const previousPath = ficha.excelSofiaPlusPath ? path.join(mediaRoot, ficha.excelSofiaPlusPath) : null;
    if (previousPath && fs.existsSync(previousPath) && previousPath !== destinationAbsolutePath) {
      await fs.promises.unlink(previousPath).catch(() => null);
    }

    ficha.excelSofiaPlusPath = path.join(folderRelative, generatedName).replace(/\\/g, '/');
    await ficha.save();

    return res.status(200).json({
      message: 'Archivo SOFiA Plus cargado correctamente',
      archivo: {
        disponible: true,
        nombre: generatedName
      }
    });
  } catch (error) {
    if (temporalPath && fs.existsSync(temporalPath)) {
      await fs.promises.unlink(temporalPath).catch(() => null);
    }

    return next(error);
  }
};

const downloadSolicitudSofiaPlus = async (req, res, next) => {
  try {
    // Descarga archivo SOFiA Plus validando alcance de lectura por rol.
    const baseQuery = await buildConsultaScope(req.user);
    const solicitud = await Solicitud.findOne({
      ...baseQuery,
      _id: req.params.id
    })
      .select('_id codigoSolicitud')
      .lean();

    if (!solicitud) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    const ficha = await Ficha.findOne({ solicitud: solicitud._id })
      .sort({ createdAt: -1 })
      .select('excelSofiaPlusPath')
      .lean();

    if (!ficha?.excelSofiaPlusPath) {
      return res.status(404).json({ message: 'El formato SOFiA Plus no está disponible para esta solicitud' });
    }

    const absolutePath = path.resolve(mediaRoot, ficha.excelSofiaPlusPath);
    if (!absolutePath.startsWith(path.resolve(mediaRoot)) || !fs.existsSync(absolutePath)) {
      return res.status(404).json({ message: 'No se encontró el archivo SOFiA Plus en el servidor' });
    }

    const extension = path.extname(absolutePath) || '.xlsx';
    const safeCode = sanitizeFileName(solicitud.codigoSolicitud || solicitud._id || 'solicitud');
    const fileName = `sofia_plus_${safeCode}${extension}`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.status(200).sendFile(absolutePath);
  } catch (error) {
    return next(error);
  }
};

const getSolicitudCaracterizacion = async (req, res, next) => {
  try {
    // Devuelve payload de ficha de caracterización para solicitudes regulares.
    const baseQuery = await buildConsultaScope(req.user);

    const solicitud = await Solicitud.findOne({
      ...baseQuery,
      _id: req.params.id
    })
      .populate('tipoSolicitud', 'nombre')
      .populate('programa', 'legacyId nombre version horas')
      // Incluye también estructura Campesena para ficha por subroles.
      .populate('horario', 'fechaInicio fechaFin horas diasSemana mes1 mes2 campesenaHorarios')
      .populate('modalidad', 'nombre')
      .populate({
        path: 'municipio',
        select: 'nombre departamento',
        populate: {
          path: 'departamento',
          select: 'nombre'
        }
      })
      .populate('usuario', 'firstName lastName documentNumber email')
      .populate('empresa', 'nombre convenio')
      .populate('programaEspecial', 'legacyId nombre')
      .populate('campesenaCargos.instructor', 'firstName lastName documentNumber email')
      .lean();

    if (!solicitud) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    const tipoSolicitudNombre = solicitud.tipoSolicitud?.nombre || '';
    const isRegular = isRegularTipo(tipoSolicitudNombre);
    const isCampesena = isCampesenaTipo(tipoSolicitudNombre);

    if (!isRegular && !isCampesena) {
      return res.status(400).json({ message: 'La ficha de caracterización no está disponible para este tipo de solicitud' });
    }

    const [ficha, revision] = await Promise.all([
      Ficha.findOne({ solicitud: solicitud._id })
        .populate('estado', 'nombre')
        .sort({ createdAt: -1 })
        .lean(),
      SolicitudCoordinador.findOne({ solicitud: solicitud._id })
        .populate('estado', 'nombre')
        .sort({ fecha: -1, createdAt: -1 })
        .lean()
    ]);

    // Construye bloque específico de CampeSENA con subroles, horarios e instructores.
    let campesena = null;
    if (isCampesena) {
      const assignmentByCargo = new Map(
        (solicitud.campesenaCargos || []).map((item) => [String(item.cargo || ''), item])
      );

      campesena = {
        fechaInicioCompartida: solicitud.horario?.campesenaHorarios?.fechaInicioCompartida || null,
        roles: [
          buildCampesenaRolePayload({
            cargoKey: 'instructor_tecnico',
            roleSchedule: solicitud.horario?.campesenaHorarios?.tecnico,
            cargoAssignment: assignmentByCargo.get('instructor_tecnico')
          }),
          buildCampesenaRolePayload({
            cargoKey: 'instructor_empresarial',
            roleSchedule: solicitud.horario?.campesenaHorarios?.empresarial,
            cargoAssignment: assignmentByCargo.get('instructor_empresarial')
          }),
          buildCampesenaRolePayload({
            cargoKey: 'instructor_full_popular',
            roleSchedule: solicitud.horario?.campesenaHorarios?.fullPopular,
            cargoAssignment: assignmentByCargo.get('instructor_full_popular')
          })
        ]
      };
    }

    return res.status(200).json({
      fichaCaracterizacion: {
        solicitud: {
          id: solicitud._id,
          codigoSolicitud: solicitud.codigoSolicitud,
          fechaSolicitud: solicitud.fechaSolicitud,
          tipoSolicitud: tipoSolicitudNombre,
          cupo: solicitud.cupo,
          direccion: solicitud.direccion,
          subsectorEconomico: solicitud.subsectorEconomico,
          ambiente: solicitud.ambiente
        },
        programa: {
          codigo: solicitud.programa?.legacyId || null,
          nombre: solicitud.programa?.nombre || '',
          version: solicitud.programa?.version || '',
          horas: solicitud.programa?.horas || null
        },
        horario: {
          fechaInicio: solicitud.horario?.fechaInicio || null,
          fechaFin: solicitud.horario?.fechaFin || null,
          horas: solicitud.horario?.horas || null,
          diasSemanaCodigos: parseDiasSemana(solicitud.horario?.diasSemana),
          mes1: parseMesFechas(solicitud.horario?.mes1),
          mes2: parseMesFechas(solicitud.horario?.mes2)
        },
        // Para CampeSENA se entrega el detalle completo por subrol.
        campesena,
        modalidad: {
          nombre: solicitud.modalidad?.nombre || ''
        },
        ubicacion: {
          departamento: solicitud.municipio?.departamento?.nombre || '',
          municipio: solicitud.municipio?.nombre || ''
        },
        responsable: {
          nombre: [solicitud.usuario?.firstName, solicitud.usuario?.lastName].filter(Boolean).join(' ').trim(),
          documento: solicitud.usuario?.documentNumber || '',
          correo: solicitud.usuario?.email || ''
        },
        empresa: {
          nombre: solicitud.empresa?.nombre || '',
          convenio: solicitud.empresa?.convenio || ''
        },
        programaEspecial: {
          id: solicitud.programaEspecial?.legacyId || null,
          nombre: solicitud.programaEspecial?.nombre || ''
        },
        ficha: {
          codigoFicha: ficha?.codigoFicha || null,
          estado: ficha?.estado?.nombre || null,
          observacion: ficha?.observacion || null
        },
        coordinacion: {
          estado: revision?.estado?.nombre || null
        }
      }
    });
  } catch (error) {
    return next(error);
  }
};

const downloadSolicitudCaracterizacionWord = async (req, res, next) => {
  try {
    // Exporta ficha de caracterización en formato Word (HTML embebido).
    const baseQuery = await buildConsultaScope(req.user);

    const solicitud = await Solicitud.findOne({
      ...baseQuery,
      _id: req.params.id
    })
      .populate('tipoSolicitud', 'nombre')
      .populate('programa', 'legacyId nombre version horas')
      .populate('horario', 'fechaInicio fechaFin horas diasSemana mes1 mes2 campesenaHorarios')
      .populate('modalidad', 'nombre')
      .populate({
        path: 'municipio',
        select: 'nombre departamento',
        populate: {
          path: 'departamento',
          select: 'nombre'
        }
      })
      .populate('usuario', 'firstName lastName documentNumber email')
      .populate('empresa', 'nombre convenio')
      .populate('programaEspecial', 'legacyId nombre')
      .populate('campesenaCargos.instructor', 'firstName lastName documentNumber email')
      .lean();

    if (!solicitud) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    const [ficha] = await Promise.all([
      Ficha.findOne({ solicitud: solicitud._id })
        .populate('estado', 'nombre')
        .sort({ createdAt: -1 })
        .lean()
    ]);

    const tipoSolicitudNombre = solicitud.tipoSolicitud?.nombre || '';
    const isRegular = isRegularTipo(tipoSolicitudNombre);
    const isCampesena = isCampesenaTipo(tipoSolicitudNombre);

    if (!isRegular && !isCampesena) {
      return res.status(400).json({ message: 'La ficha de caracterización no está disponible para este tipo de solicitud' });
    }

    // Marca visual usada para checkboxes en formato tipo documento.
    const mark = (checked) => (checked ? 'X' : '');
    const selectedModalidad = normalizeTipoSolicitudKey(solicitud.modalidad?.nombre || '');
    const programaEspecialSeleccionadoId = Number(solicitud.programaEspecial?.legacyId || 0);
    const selectedProgramaEspecialByName = normalizeTipoSolicitudKey(solicitud.programaEspecial?.nombre || '');
    const selectedDays = new Set(normalizeDayCodesDoc(parseDiasSemana(solicitud.horario?.diasSemana)));
    const responsableNombre = [solicitud.usuario?.firstName, solicitud.usuario?.lastName].filter(Boolean).join(' ').trim();
    const logoDataUri = readSenaLogoDataUri();

    let campesenaRoles = [];
    if (isCampesena) {
      const parsedCampesenaHorarios = parseCampesenaHorarios(solicitud.horario?.campesenaHorarios) || solicitud.horario?.campesenaHorarios || {};
      const assignmentByCargo = new Map(
        (solicitud.campesenaCargos || []).map((item) => [String(item.cargo || ''), item])
      );

      campesenaRoles = Object.keys(CAMPESENA_CARGOS).map((cargoKey) => {
        const roleScheduleKey = CAMPESENA_ROLE_MAP[cargoKey];
        const roleSchedule = parsedCampesenaHorarios?.[roleScheduleKey] || {};
        const assignment = assignmentByCargo.get(cargoKey);
        const roleInstructor = assignment?.instructor;
        return {
          etiqueta: CAMPESENA_CARGOS[cargoKey]?.label || cargoKey,
          horario: {
            horaInicio: roleSchedule?.horaInicio || '',
            horaFin: roleSchedule?.horaFin || '',
            diasSemanaCodigos: normalizeDayCodesDoc(parseDiasSemana(roleSchedule?.diasSemana)),
            mes1: parseMesFechas(roleSchedule?.mes1),
            mes2: parseMesFechas(roleSchedule?.mes2),
            mes3: parseMesFechas(roleSchedule?.mes3),
            mes4: parseMesFechas(roleSchedule?.mes4),
            mes5: parseMesFechas(roleSchedule?.mes5),
            fechas: parseMesFechas(roleSchedule?.fechasCalendario)
          },
          instructor: {
            nombre: [roleInstructor?.firstName, roleInstructor?.lastName].filter(Boolean).join(' ').trim(),
            documento: roleInstructor?.documentNumber || '',
            correo: roleInstructor?.email || ''
          }
        };
      });
    }

    // Renderiza fila horizontal de opciones con casillas de marcado.
    const renderChoiceRow = (items, options = {}) => {
      const center = Boolean(options.center);

      return `
        <table class="choice-table" role="presentation">
          <tr>
            ${items.map((item, index) => `
              <td class="choice-cell ${center ? 'choice-cell-center' : ''} ${index === items.length - 1 ? 'choice-cell-last' : ''}">
                <span class="choice-check">${mark(item.checked)}</span>
                <span>${escapeHtml(item.label)}</span>
              </td>
            `).join('')}
          </tr>
        </table>
      `;
    };

    // Renderiza catálogo de días para horario regular/Campesena.
    const renderDayChoiceRow = (selectedSet) => {
      return renderChoiceRow(
        DAY_OPTIONS_DOC.map((day) => ({ label: day.label, checked: selectedSet.has(day.code) }))
      );
    };

    // Construye bloque tabular de programa especial con marca de selección.
    const programaEspecialHtml = `
      <table class="programa-table" role="presentation">
        <tbody>
          ${PROGRAMAS_ESPECIALES_DOC.map((item, index) => {
            const checked = programaEspecialSeleccionadoId === item.id
              || normalizeTipoSolicitudKey(item.label) === selectedProgramaEspecialByName;

            return `
              <tr class="${index === PROGRAMAS_ESPECIALES_DOC.length - 1 ? 'programa-row-last' : ''}">
                <td class="programa-mark">${mark(checked)}</td>
                <td class="programa-text">${escapeHtml(item.label)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    // Filas específicas para solicitudes regulares.
    const regularRowsHtml = `
      <tr>
        <td class="label-cell" colspan="2">Días semana de programación*</td>
        <td colspan="8" class="dias-cell">${renderDayChoiceRow(selectedDays)}</td>
      </tr>
      <tr>
        <td class="label-cell" colspan="2">Horario de ejecución de la formación*</td>
        <td colspan="8">${escapeHtml(solicitud.horario?.horas || '')}</td>
      </tr>
      <tr>
        <td class="label-cell" colspan="2">Fechas de ejecución de la formación mes 1</td>
        <td colspan="8">${escapeHtml(joinDateDays(parseMesFechas(solicitud.horario?.mes1)))}</td>
      </tr>
      <tr>
        <td class="label-cell" colspan="2">Fechas de ejecución de la formación mes 2</td>
        <td colspan="8">${escapeHtml(joinDateDays(parseMesFechas(solicitud.horario?.mes2)))}</td>
      </tr>
    `;

    // Filas específicas para solicitudes Campesena por subrol.
    const campesenaRowsHtml = campesenaRoles.map((role) => {
      const roleSelectedDays = new Set(role.horario?.diasSemanaCodigos || []);
      const executionMonths = getCampesenaRoleExecutionMonthsDoc(role.horario);

      const monthRows = executionMonths.map((fechasMes, monthIndex) => `
        <tr>
          <td class="label-cell" colspan="2">Fechas de ejecución mes ${monthIndex + 1}</td>
          <td colspan="8">${escapeHtml(fechasMes)}</td>
        </tr>
      `).join('');

      return `
        <tr>
          <td class="label-cell" colspan="2">Subrol instructor CampeSENA</td>
          <td colspan="8">${escapeHtml(role.etiqueta || '')}</td>
        </tr>
        <tr>
          <td class="label-cell" colspan="2">Horario</td>
          <td colspan="8">${escapeHtml(role.horario?.horaInicio && role.horario?.horaFin ? `${role.horario.horaInicio} - ${role.horario.horaFin}` : '')}</td>
        </tr>
        <tr>
          <td class="label-cell" colspan="2">Días de semana</td>
          <td colspan="8" class="dias-cell">${renderDayChoiceRow(roleSelectedDays)}</td>
        </tr>
        ${monthRows}
        <tr>
          <td class="label-cell" colspan="2">Instructor asignado</td>
          <td colspan="8">${escapeHtml(role.instructor?.nombre || '')}</td>
        </tr>
        <tr>
          <td class="label-cell" colspan="2">Documento instructor</td>
          <td colspan="8">${escapeHtml(role.instructor?.documento || '')}</td>
        </tr>
        <tr>
          <td class="label-cell" colspan="2">Correo instructor</td>
          <td colspan="8">${escapeHtml(role.instructor?.correo || '')}</td>
        </tr>
      `;
    }).join('');

    // Documento HTML que se entrega con extensión .doc para descarga en Word.
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Ficha de caracterización</title>
        <style>
          @page { size: A4 portrait; margin: 4mm; }
          html, body { margin: 0; padding: 0; }
          body { font-family: Arial, sans-serif; font-size: 10px; color: #000; }
          .sena-format-document { width: 100%; font-family: Arial, sans-serif; font-size: 10px; color: #000; }
          .sena-head-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .sena-head-table td { border: 1px solid #555; border-bottom: none; padding: 2px 4px; vertical-align: middle; }
          .sena-head-logo { width: 72px; text-align: center; }
          .sena-head-title { text-align: center; font-weight: 700; line-height: 1.2; }
          .sena-head-radicado { width: 190px; text-align: left; line-height: 1.2; vertical-align: top; }
          .sena-head-logo img { width: 46px; max-width: 46px; height: auto; display: inline-block; }
          .sena-main-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .sena-main-table td { border: 1px solid #555; padding: 1px 3px; vertical-align: middle; line-height: 1.15; font-size: 9px; }
          .label-cell { width: 220px; font-weight: 600; }
          .center-cell { text-align: center; min-width: 38px; }
          .formacion-cell, .modalidad-cell, .dias-cell, .programa-especial-cell { padding: 0 !important; }
          .choice-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .choice-cell { border-right: 1px solid #555; padding: 1px 2px; white-space: nowrap; font-size: 9px; }
          .choice-cell-center { text-align: center; }
          .choice-cell-last { border-right: none; }
          .choice-check { width: 9px; height: 9px; border: 1px solid #555; display: inline-block; text-align: center; line-height: 9px; font-size: 7px; font-weight: 700; margin-right: 4px; vertical-align: middle; }
          .programa-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .programa-table td { border-bottom: 1px solid #555; font-size: 9px; }
          .programa-table tr.programa-row-last td { border-bottom: none; }
          .programa-mark { width: 20px; text-align: center; border-right: 1px solid #555; font-weight: 700; }
          .programa-text { padding: 1px 3px; }
          .sena-sign-row { margin-top: 14px; width: 100%; }
          .sena-sign-final-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .sena-sign-final-table td { border: none; vertical-align: bottom; font-size: 9px; padding: 0; }
          .sign-line { text-align: center; border-top: 1px solid #555; padding-top: 2px; }
        </style>
      </head>
      <body>
        <div class="sena-format-document">
          <table class="sena-head-table" role="presentation">
            <tr>
              <td class="sena-head-logo">${logoDataUri ? `<img src="${logoDataUri}" alt="Logo SENA" />` : 'SENA'}</td>
              <td class="sena-head-title">
                <div>SERVICIO NACIONAL DE APRENDIZAJE</div>
                <div>SISTEMA INTEGRADO DE GESTIÓN</div>
              </td>
              <td class="sena-head-radicado">
                <div>La presente formación se programa en atención a la solicitud con Radicado</div>
                <div>No ${escapeHtml(solicitud.codigoSolicitud || '________')} &nbsp;&nbsp; Fecha de asignación Coordinación Académica ${escapeHtml(formatDateEsCo(solicitud.fechaSolicitud) || '___/___/____')}</div>
              </td>
            </tr>
          </table>

          <table class="sena-main-table">
            <tbody>
              <tr>
                <td class="label-cell" colspan="2"></td>
                <td colspan="8" class="formacion-cell">
                  ${renderChoiceRow([
                    { label: 'COMPLEMENTARIA', checked: true },
                    { label: 'TITULADA', checked: false }
                  ], { center: true })}
                </td>
              </tr>

              <tr><td class="label-cell" colspan="2">Código programa de formación*</td><td colspan="8">${escapeHtml(solicitud.programa?.legacyId || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Nombre del Programa*</td><td colspan="8">${escapeHtml(solicitud.programa?.nombre || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Versión del programa*</td><td colspan="8">${escapeHtml(solicitud.programa?.version || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Duración Máxima (Horas)*</td><td colspan="8">${escapeHtml(solicitud.programa?.horas || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Fecha de Inicio*</td><td colspan="8">${escapeHtml(formatDateEsCo(solicitud.horario?.fechaInicio))}</td></tr>
              <tr><td class="label-cell" colspan="2">Fecha prevista de terminación*</td><td colspan="8">${escapeHtml(formatDateEsCo(solicitud.horario?.fechaFin))}</td></tr>
              <tr><td class="label-cell" colspan="2">Cupo*</td><td colspan="8">${escapeHtml(solicitud.cupo || '')}</td></tr>

              <tr>
                <td class="label-cell" colspan="2">Modalidad del programa*</td>
                <td colspan="8" class="modalidad-cell">
                  ${renderChoiceRow([
                    { label: 'PRESENCIAL', checked: normalizeTipoSolicitudKey('PRESENCIAL') === selectedModalidad },
                    { label: 'DESESCOLARIZADA', checked: normalizeTipoSolicitudKey('DESESCOLARIZADA') === selectedModalidad },
                    { label: 'VIRTUAL', checked: normalizeTipoSolicitudKey('VIRTUAL') === selectedModalidad },
                    { label: 'COMBINADA', checked: normalizeTipoSolicitudKey('COMBINADA') === selectedModalidad }
                  ], { center: true })}
                </td>
              </tr>

              <tr><td class="label-cell" colspan="2">Departamento desarrollo de formación*</td><td colspan="8">${escapeHtml(solicitud.municipio?.departamento?.nombre || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Municipio desarrollo de formación*</td><td colspan="8">${escapeHtml(solicitud.municipio?.nombre || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Dirección donde se va a realizar la formación*</td><td colspan="8">${escapeHtml(solicitud.direccion || '')}</td></tr>

              <tr>
                <td class="label-cell" colspan="2">Nombre responsable*</td>
                <td colspan="5">${escapeHtml(responsableNombre)}</td>
                <td class="center-cell">CC #</td>
                <td colspan="2">${escapeHtml(solicitud.usuario?.documentNumber || '')}</td>
              </tr>
              <tr><td class="label-cell" colspan="2">Correo electrónico*</td><td colspan="8">${escapeHtml(solicitud.usuario?.email || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Empresa solicitante</td><td colspan="8">${escapeHtml(solicitud.empresa?.nombre || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Subsector económico*</td><td colspan="8">${escapeHtml(solicitud.subsectorEconomico || '')}</td></tr>

              <tr>
                <td class="label-cell" colspan="2">Programa Especial*</td>
                <td colspan="8" class="programa-especial-cell">${programaEspecialHtml}</td>
              </tr>

              <tr><td class="label-cell" colspan="2">Convenio</td><td colspan="8">${escapeHtml(solicitud.empresa?.convenio || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Nombre y área en metros del ambiente</td><td colspan="8">${escapeHtml(solicitud.ambiente || '')}</td></tr>

              ${isCampesena ? campesenaRowsHtml : regularRowsHtml}

              <tr><td class="label-cell" colspan="2">Código de solicitud</td><td colspan="8">${escapeHtml(solicitud.codigoSolicitud || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Código de ficha</td><td colspan="8">${escapeHtml(ficha?.codigoFicha || '')}</td></tr>
              <tr><td class="label-cell" colspan="2">Fecha de inscripción</td><td colspan="8">${escapeHtml(formatDateEsCo(solicitud.fechaSolicitud))}</td></tr>
            </tbody>
          </table>

          <div class="sena-sign-row">
            <table class="sena-sign-final-table">
              <tr>
                <td style="width: 42%;">Nombre del instructor: ${escapeHtml(responsableNombre)}</td>
                <td style="width: 29%; padding-left: 8px;"><div class="sign-line">Firma Instructor</div></td>
                <td style="width: 29%; padding-left: 8px;"><div class="sign-line">Vo.Bo. Coordinador Académico</div></td>
              </tr>
            </table>
          </div>
        </div>
      </body>
      </html>
    `;

    const safeCode = String(solicitud.codigoSolicitud || solicitud._id || 'solicitud')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `ficha_caracterizacion_${safeCode}.doc`;

    res.setHeader('Content-Type', 'application/msword; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.status(200).send(Buffer.from(htmlContent, 'utf8'));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createSolicitud,
  listSolicitudesConsulta,
  getSolicitudesReportes,
  sendSolicitudToCoordinator,
  sendSolicitudDirectToFuncionario,
  sendSolicitudToFuncionario,
  updateSolicitudByFuncionario,
  uploadSolicitudSofiaPlus,
  downloadSolicitudSofiaPlus,
  getSolicitudCaracterizacion,
  downloadSolicitudCaracterizacionWord
};

// Parsea estructura de horarios Campesena desde objeto o JSON.
const parseCampesenaHorarios = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  return null;
};

// Convierte horas HH:mm a un rango comparable en minutos.
const toTimeRange = (start, end) => {
  if (!start || !end) {
    return null;
  }

  const [startHour, startMinute] = String(start).split(':').map((item) => Number(item));
  const [endHour, endMinute] = String(end).split(':').map((item) => Number(item));

  if ([startHour, startMinute, endHour, endMinute].some((item) => Number.isNaN(item))) {
    return null;
  }

  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (endMinutes <= startMinutes) {
    return null;
  }

  return { startMinutes, endMinutes };
};

// Determina solape temporal entre dos rangos de horas.
const rangesOverlap = (firstRange, secondRange) => {
  if (!firstRange || !secondRange) {
    return false;
  }

  return firstRange.startMinutes < secondRange.endMinutes && secondRange.startMinutes < firstRange.endMinutes;
};

// Normaliza un horario por rol para validaciones de Campesena.
const normalizeRoleSchedule = (schedule) => {
  return {
    horaInicio: String(schedule?.horaInicio || '').trim(),
    horaFin: String(schedule?.horaFin || '').trim(),
    diasSemana: parseJsonArray(schedule?.diasSemana).map((item) => String(item).trim()).filter(Boolean),
    fechasCalendario: parseJsonArray(schedule?.fechasCalendario).map((item) => String(item).trim()).filter(Boolean)
  };
};

const getEstadoNombreNormalizado = (estado) => {
  // Extrae nombre de estado y lo normaliza para comparaciones semánticas.
  return normalizeTipoSolicitudKey(estado?.nombre || estado || '');
};

const isEstadoFichaCreada = (estado) => {
  // True cuando el estado corresponde a ficha creada/en creación.
  const normalized = getEstadoNombreNormalizado(estado);
  return normalized.includes('creada');
};

const isEstadoFichaMatriculada = (estado) => {
  // True cuando la ficha ya está matriculada (bloquea cambios).
  const normalized = getEstadoNombreNormalizado(estado);
  return normalized.includes('matriculad');
};

const isEstadoFichaRechazada = (estado) => {
  // True cuando el estado representa rechazo de la gestión.
  const normalized = getEstadoNombreNormalizado(estado);
  return normalized.includes('rechaz');
};

const resolveInitialEstadoFicha = async () => {
  // Resuelve estado inicial preferido para crear ficha cuando aún no existe.
  let estadoInicial = await EstadoFicha.findOne({ nombre: /cread|creacion|pend|espera/i })
    .sort({ legacyId: 1, nombre: 1 })
    .select('_id nombre')
    .lean();

  if (!estadoInicial) {
    estadoInicial = await EstadoFicha.findOne({})
      .sort({ legacyId: 1, nombre: 1 })
      .select('_id nombre')
      .lean();
  }

  return estadoInicial;
};