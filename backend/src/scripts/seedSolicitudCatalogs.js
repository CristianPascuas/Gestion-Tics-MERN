const fs = require('fs');
const path = require('path');
const connectMongo = require('../config/mongo');
const {
  Area,
  Modalidad,
  Departamento,
  Municipio,
  TipoEmpresa,
  Caracterizacion,
  TipoIdentificacion,
  Empresa,
  ProgramaEspecial,
  ProgramaFormacion,
  TipoSolicitud,
  Horario,
  EstadoFicha,
  EstadoCoordinador
} = require('../models/SolicitudCatalogs');

/**
 * Flujo general de este script (SQL -> MongoDB):
 *
 * 1) Lee el archivo CursosV17.sql (o una ruta enviada por argumento).
 * 2) Extrae solo sentencias INSERT de las tablas que nos interesan.
 * 3) Convierte cada fila SQL en objetos JavaScript por columna.
 * 4) Normaliza y limpia algunos valores (texto, fechas, tipos).
 * 5) Inserta/actualiza catálogos base en Mongo usando legacyId.
 * 6) Construye mapas legacyId -> _id para resolver referencias.
 * 7) Inserta/actualiza catálogos dependientes (municipio, programa, empresa, etc.).
 *
 * Importante:
 * - El proceso es idempotente gracias al upsert por legacyId:
 *   si ejecutas el seed varias veces, no duplica; actualiza lo existente.
 * - Este script migra catálogos, no registros transaccionales.
 */

const TARGET_TABLES = new Set([
  'area',
  'modalidad',
  'departamentos',
  'municipio',
  'tipoempresa',
  'caracterizacion',
  'tipoidentificacion',
  'empresa',
  'programaespecial',
  'programaformacion',
  'tiposolicitud',
  'horario',
  'estados',
  'estados_coordinador'
]);

// Ruta por defecto al dump SQL legado. Se puede reemplazar por argumento CLI.
// Ejemplo: node src/scripts/seedSolicitudCatalogs.js ./mi-archivo.sql

const DEFAULT_SQL_PATH = path.resolve(__dirname, '../../../../CursosV17.sql');

/**
 * Normaliza el tipo de solicitud para que en Mongo haya un catálogo consistente.
 *
 * Ejemplos:
 * - "Campesena", "campesena", "campesena " => "campesena"
 * - "regular", "normal" => "normal"
 */
const normalizeType = (value) => {
  if (!value) {
    return null;
  }

  const text = String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\u0300-\u036f]/g, '');

  if (text.includes('camp')) {
    return 'campesena';
  }

  if (text.includes('regular') || text.includes('normal')) {
    return 'normal';
  }

  return text;
};

/**
 * Convierte cada valor "crudo" del SQL a un tipo útil en JS:
 * - "NULL" o vacío -> null
 * - números enteros/decimales -> Number
 * - texto -> String
 */
const parseScalar = (rawValue) => {
  const text = String(rawValue).trim();

  if (!text.length) {
    return null;
  }

  if (/^NULL$/i.test(text)) {
    return null;
  }

  if (/^-?\d+$/.test(text)) {
    return Number(text);
  }

  if (/^-?\d+\.\d+$/.test(text)) {
    return Number(text);
  }

  return text;
};

// Interpreta secuencias escapadas típicas dentro de strings SQL.
const decodeEscapedChar = (char) => {
  if (char === 'n') {
    return '\n';
  }
  if (char === 'r') {
    return '\r';
  }
  if (char === 't') {
    return '\t';
  }
  return char;
};

/**
 * Toma el bloque VALUES de un INSERT y arma un arreglo de filas.
 *
 * Se recorre carácter por carácter para soportar:
 * - comillas simples
 * - comas dentro de strings
 * - caracteres escapados
 *
 * Resultado: un arreglo de filas, cada fila como arreglo de columnas.
 */
const parseRows = (valuesBlock) => {
  const rows = [];
  let index = 0;

  while (index < valuesBlock.length) {
    const start = valuesBlock.indexOf('(', index);
    if (start === -1) {
      break;
    }

    const row = [];
    let current = '';
    let inQuote = false;
    let escaped = false;

    index = start + 1;

    while (index < valuesBlock.length) {
      const char = valuesBlock[index];

      if (inQuote) {
        if (escaped) {
          current += decodeEscapedChar(char);
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === "'") {
          inQuote = false;
        } else {
          current += char;
        }

        index += 1;
        continue;
      }

      if (char === "'") {
        inQuote = true;
        index += 1;
        continue;
      }

      if (char === ',') {
        row.push(parseScalar(current));
        current = '';
        index += 1;
        continue;
      }

      if (char === ')') {
        row.push(parseScalar(current));
        rows.push(row);
        index += 1;
        break;
      }

      current += char;
      index += 1;
    }
  }

  return rows;
};

/**
 * Extrae todas las sentencias INSERT del SQL y se queda solo con tablas objetivo.
 *
 * Por cada INSERT:
 * - lee nombre de tabla
 * - obtiene columnas
 * - parsea filas
 * - convierte fila[] => objeto { columna: valor }
 *
 * Retorna un Map:
 *   key   => nombre tabla
 *   value => arreglo de objetos fila ya interpretados
 */
const extractTableRows = (sqlContent) => {
  const insertRegex = /INSERT INTO\s+`([^`]+)`\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?);/gi;
  const parsed = new Map();
  let match = insertRegex.exec(sqlContent);

  while (match) {
    const [, tableName, columnsBlock, valuesBlock] = match;

    if (TARGET_TABLES.has(tableName)) {
      const columns = columnsBlock
        .split(',')
        .map((item) => item.replace(/`/g, '').trim());

      const rows = parseRows(valuesBlock);
      const asObjects = rows
        .filter((row) => row.length === columns.length)
        .map((row) => {
          const data = {};
          columns.forEach((column, position) => {
            data[column] = row[position];
          });
          return data;
        });

      const current = parsed.get(tableName) || [];
      parsed.set(tableName, current.concat(asObjects));
    }

    match = insertRegex.exec(sqlContent);
  }

  return parsed;
};

// Intenta convertir un valor de fecha a Date válida; si no puede, retorna null.
const toDate = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Inserta o actualiza en lote (bulkWrite) para ganar rendimiento.
 *
 * Regla principal:
 * - Si existe legacyId, se usa como llave de sincronización con la BD vieja.
 * - Si no hay legacyId, usa el documento completo como filtro (fallback).
 */
const bulkUpsert = async (Model, docs) => {
  if (!docs.length) {
    return 0;
  }

  const operations = docs.map((doc) => ({
    updateOne: {
      filter: doc.legacyId ? { legacyId: doc.legacyId } : doc,
      update: { $set: doc },
      upsert: true
    }
  }));

  await Model.bulkWrite(operations, { ordered: false });
  return docs.length;
};

// Elimina índices antiguos que puedan chocar con la migración actual.
const dropIndexIfExists = async (Model, indexName) => {
  try {
    await Model.collection.dropIndex(indexName);
  } catch (error) {
    if (!error.message || !error.message.includes('index not found')) {
      throw error;
    }
  }
};

/**
 * Construye un mapa para resolver referencias entre catálogos:
 * legacyId (SQL) -> _id (Mongo)
 */
const loadLegacyMap = async (Model) => {
  const rows = await Model.find({ legacyId: { $ne: null } }).select('_id legacyId').lean();
  const map = new Map();

  rows.forEach((item) => {
    map.set(Number(item.legacyId), item._id);
  });

  return map;
};

const run = async () => {
  // 1) Definir archivo SQL fuente
  const sqlPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SQL_PATH;

  if (!fs.existsSync(sqlPath)) {
    throw new Error(`No se encontró el archivo SQL en: ${sqlPath}`);
  }

  // 2) Leer y parsear sentencias INSERT del SQL legado
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  const tableRows = extractTableRows(sqlContent);

  // 3) Conectar a MongoDB
  await connectMongo();

  // 4) Limpiar algunos índices heredados para evitar errores de unicidad
  await dropIndexIfExists(Area, 'nombre_1');
  await dropIndexIfExists(Modalidad, 'nombre_1');
  await dropIndexIfExists(Departamento, 'nombre_1');
  await dropIndexIfExists(TipoEmpresa, 'nombre_1');
  await dropIndexIfExists(Caracterizacion, 'nombre_1');
  await dropIndexIfExists(TipoIdentificacion, 'nombre_1');
  await dropIndexIfExists(ProgramaEspecial, 'nombre_1');

  // 5) Transformar tablas base (sin dependencias) del formato SQL al modelo Mongo
  const areaDocs = (tableRows.get('area') || []).map((item) => ({
    legacyId: Number(item.idarea),
    nombre: String(item.area || '').trim()
  }));

  const modalidadDocs = (tableRows.get('modalidad') || []).map((item) => ({
    legacyId: Number(item.idmodalidad),
    nombre: String(item.modalidad || '').trim()
  }));

  const departamentoDocs = (tableRows.get('departamentos') || []).map((item) => ({
    legacyId: Number(item.codigodepartamentos),
    nombre: String(item.departamentos || '').trim()
  }));

  const tipoEmpresaDocs = (tableRows.get('tipoempresa') || []).map((item) => ({
    legacyId: Number(item.idtipoempresa),
    nombre: String(item.tipoempresa || '').trim()
  }));

  const caracterizacionDocs = (tableRows.get('caracterizacion') || []).map((item) => ({
    legacyId: Number(item.idcaracterizacion),
    nombre: String(item.caracterizacion || '').trim()
  }));

  const tipoIdentificacionDocs = (tableRows.get('tipoidentificacion') || []).map((item) => ({
    legacyId: Number(item.idtipoidentificacion),
    nombre: String(item.tipoidentificacion || '').trim()
  }));

  const programaEspecialDocs = (tableRows.get('programaespecial') || []).map((item) => ({
    legacyId: Number(item.idespecial),
    nombre: String(item.programaespecial || '').trim()
  }));

  const tipoSolicitudDocs = (tableRows.get('tiposolicitud') || []).map((item) => ({
    legacyId: Number(item.idtiposolicitud),
    nombre: normalizeType(item.tiposolicitud)
  }));

  const estadoFichaDocs = (tableRows.get('estados') || []).map((item) => ({
    legacyId: Number(item.idestado),
    nombre: String(item.estados || '').trim()
  }));

  const estadoCoordinadorDocs = (tableRows.get('estados_coordinador') || []).map((item) => ({
    legacyId: Number(item.id),
    nombre: String(item.estado || '').trim()
  }));

  // 6) Persistir catálogos base primero
  await bulkUpsert(Area, areaDocs);
  await bulkUpsert(Modalidad, modalidadDocs);
  await bulkUpsert(Departamento, departamentoDocs);
  await bulkUpsert(TipoEmpresa, tipoEmpresaDocs);
  await bulkUpsert(Caracterizacion, caracterizacionDocs);
  await bulkUpsert(TipoIdentificacion, tipoIdentificacionDocs);
  await bulkUpsert(ProgramaEspecial, programaEspecialDocs);
  await bulkUpsert(TipoSolicitud, tipoSolicitudDocs);
  await bulkUpsert(EstadoFicha, estadoFichaDocs);
  await bulkUpsert(EstadoCoordinador, estadoCoordinadorDocs);

  // 7) Crear mapas para convertir llaves foráneas SQL en ObjectId de Mongo
  const departamentoMap = await loadLegacyMap(Departamento);
  const areaMap = await loadLegacyMap(Area);
  const modalidadMap = await loadLegacyMap(Modalidad);
  const tipoEmpresaMap = await loadLegacyMap(TipoEmpresa);

  // 8) Migrar municipio enlazando departamento por referencia
  const municipioDocs = (tableRows.get('municipio') || [])
    .map((item) => ({
      legacyId: Number(item.codigomunicipio),
      nombre: String(item.municipio || '').trim(),
      departamento: departamentoMap.get(Number(item.codigodepartamento))
    }))
    // Si no existe departamento destino, se omite para mantener integridad referencial
    .filter((item) => item.departamento);

  await bulkUpsert(Municipio, municipioDocs);

  // 9) Migrar programas enlazando área y modalidad
  const programaDocs = (tableRows.get('programaformacion') || [])
    .map((item) => ({
      legacyId: Number(item.codigoprograma),
      version: String(item.verision || '').trim() || '1',
      nombre: String(item.nombreprograma || '').trim(),
      horas: Number(item.horas || 0),
      area: areaMap.get(Number(item.idarea)),
      modalidad: modalidadMap.get(Number(item.idmodalidad))
    }))
    // Se filtra lo incompleto o inválido para cumplir reglas del schema
    .filter((item) => item.nombre && item.horas > 0 && item.area && item.modalidad);

  await bulkUpsert(ProgramaFormacion, programaDocs);

  // 10) Migrar horarios con conversión de fechas
  const horarioDocs = (tableRows.get('horario') || [])
    .map((item) => ({
      legacyId: Number(item.idhorario),
      fechaInicio: toDate(item.fechainicio),
      fechaFin: toDate(item.fechafin),
      mes1: item.mes1 ? String(item.mes1) : null,
      mes2: item.mes2 ? String(item.mes2) : null,
      horas: item.horas ? String(item.horas) : null,
      diasSemana: item.diassemana ? String(item.diassemana) : null
    }))
    .filter((item) => item.fechaInicio && item.fechaFin);

  await bulkUpsert(Horario, horarioDocs);

  // 11) Migrar empresas enlazando tipo de empresa
  const empresaDocs = (tableRows.get('empresa') || [])
    .map((item) => ({
      legacyId: Number(item.idempresa),
      nombre: String(item.nombreempresa || '').trim(),
      representante: String(item.representanteempresa || '').trim() || 'SIN DEFINIR',
      correo: String(item.correoempresa || '').trim().toLowerCase(),
      nit: String(item.nitempresa || '').trim(),
      tipoEmpresa: tipoEmpresaMap.get(Number(item.idtipoempresa))
    }))
    .filter((item) => item.nombre && item.correo && item.nit && item.tipoEmpresa);

  await bulkUpsert(Empresa, empresaDocs);

  // 12) Reporte final de filas procesadas por catálogo
  process.stdout.write('Catálogos de solicitud migrados correctamente\n');
  process.stdout.write(
    [
      `area=${areaDocs.length}`,
      `modalidad=${modalidadDocs.length}`,
      `departamento=${departamentoDocs.length}`,
      `municipio=${municipioDocs.length}`,
      `tipoempresa=${tipoEmpresaDocs.length}`,
      `caracterizacion=${caracterizacionDocs.length}`,
      `tipoidentificacion=${tipoIdentificacionDocs.length}`,
      `empresa=${empresaDocs.length}`,
      `programaespecial=${programaEspecialDocs.length}`,
      `programaformacion=${programaDocs.length}`,
      `tiposolicitud=${tipoSolicitudDocs.length}`,
      `horario=${horarioDocs.length}`,
      `estados=${estadoFichaDocs.length}`,
      `estados_coordinador=${estadoCoordinadorDocs.length}`
    ].join(' | ') + '\n'
  );

  process.exit(0);
};

run().catch((error) => {
  process.stderr.write(`Error migrando catálogos: ${error.message}\n`);
  process.exit(1);
});