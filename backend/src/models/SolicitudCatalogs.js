const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Este archivo define los catálogos principales usados por el módulo de solicitudes.
 *
 * Relación con el seed SQL -> Mongo:
 * - El script seedSolicitudCatalogs.js lee tablas del SQL legado.
 * - Convierte columnas SQL a documentos con estos esquemas.
 * - Guarda legacyId para conservar trazabilidad con la BD anterior.
 *
 * En términos simples:
 * - SQL viejo usa IDs numéricos (idarea, codigoprograma, etc.).
 * - Mongo usa ObjectId para referencias internas.
 * - legacyId permite "traducir" de un mundo al otro durante la migración.
 */

const buildModel = (modelName, schemaDefinition, options = {}) => {
  // - permite extender con opciones específicas por esquema
  const schema = new Schema(schemaDefinition, {
    timestamps: true,
    versionKey: false,
    ...options
  });

  return mongoose.models[modelName] || mongoose.model(modelName, schema);
};

const Area = buildModel('Area', {
  // ID heredado de SQL para sincronización idempotente en seeds
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  nombre: { type: String, required: true, trim: true }
});

const Modalidad = buildModel('Modalidad', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  nombre: { type: String, required: true, trim: true }
});

const Departamento = buildModel('Departamento', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  nombre: { type: String, required: true, trim: true }
});

const Municipio = buildModel('Municipio', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  nombre: { type: String, required: true, trim: true },
  // Referencia al documento Departamento (_id en Mongo)
  // Durante seed se resuelve desde codigodepartamento del SQL.
  departamento: {
    type: Schema.Types.ObjectId,
    ref: 'Departamento',
    required: true,
    index: true
  }
}, {
  // Evita duplicados del mismo municipio dentro de un departamento.
  indexes: [{ key: { nombre: 1, departamento: 1 }, unique: true }]
});

const TipoEmpresa = buildModel('TipoEmpresa', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  nombre: { type: String, required: true, trim: true }
});

const Caracterizacion = buildModel('Caracterizacion', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  nombre: { type: String, required: true, trim: true, unique: true }
});

const TipoIdentificacion = buildModel('TipoIdentificacion', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  nombre: { type: String, required: true, trim: true, unique: true }
});

const Empresa = buildModel('Empresa', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  nombre: { type: String, required: true, trim: true, unique: true },
  representante: { type: String, required: true, trim: true },
  correo: { type: String, required: true, trim: true, lowercase: true, unique: true },
  nit: { type: String, required: true, trim: true, unique: true },
  // Campos opcionales: en el seed desde SQL pueden no venir, por eso default null.
  convenio: { type: String, trim: true, default: null },
  fechaCreacionEmpresa: { type: Date, default: null },
  direccionEmpresa: { type: String, trim: true, default: null },
  nombreContactoEmpresa: { type: String, trim: true, default: null },
  correoContactoEmpresa: { type: String, trim: true, lowercase: true, default: null },
  numeroEmpleadosEmpresa: { type: Number, min: 1, default: null },
  // FK lógica hacia TipoEmpresa
  tipoEmpresa: {
    type: Schema.Types.ObjectId,
    ref: 'TipoEmpresa',
    required: true,
    index: true
  }
});

const ProgramaEspecial = buildModel('ProgramaEspecial', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  nombre: { type: String, required: true, trim: true }
});

const ProgramaFormacion = buildModel('ProgramaFormacion', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  codigo: { type: String, trim: true, default: null, index: true },
  version: { type: String, required: true, trim: true },
  nombre: { type: String, required: true, trim: true },
  horas: { type: Number, required: true, min: 1 },
  // En SQL venía como idarea; seed lo transforma a ObjectId de Area.
  area: {
    type: Schema.Types.ObjectId,
    ref: 'Area',
    required: true,
    index: true
  },
  // En SQL venía como idmodalidad; seed lo transforma a ObjectId de Modalidad.
  modalidad: {
    type: Schema.Types.ObjectId,
    ref: 'Modalidad',
    required: true,
    index: true
  },
  activo: { type: Boolean, default: true, index: true }
});

const TipoSolicitud = buildModel('TipoSolicitud', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  // Se guarda único para evitar duplicados semánticos (normal/campesena).
  nombre: { type: String, required: true, trim: true, unique: true }
});

// Estructuras embebidas para horarios especiales de modalidad Campesena.
const horarioCampesenaRoleSchema = new Schema(
  {
    horaInicio: { type: String, trim: true, default: null },
    horaFin: { type: String, trim: true, default: null },
    diasSemana: [{ type: String, trim: true }],
    fechasCalendario: [{ type: String, trim: true }]
  },
  { _id: false }
);

const horarioCampesenaHorariosSchema = new Schema(
  {
    fechaInicioCompartida: { type: Date, default: null },
    tecnico: { type: horarioCampesenaRoleSchema, default: () => ({}) },
    empresarial: { type: horarioCampesenaRoleSchema, default: () => ({}) },
    fullPopular: { type: horarioCampesenaRoleSchema, default: () => ({}) }
  },
  { _id: false }
);

const horarioCampesenaCargoSchema = new Schema(
  {
    cargo: {
      type: String,
      enum: ['instructor_tecnico', 'instructor_empresarial', 'instructor_full_popular'],
      required: true
    },
    instructor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    diasSemana: [{ type: String, trim: true }]
  },
  { _id: false }
);

const Horario = buildModel('Horario', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  // Campos mínimos exigidos por negocio y por schema
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  mes1: { type: String, trim: true, default: null },
  mes2: { type: String, trim: true, default: null },
  mes3: { type: String, trim: true, default: null },
  mes4: { type: String, trim: true, default: null },
  mes5: { type: String, trim: true, default: null },
  horas: { type: String, trim: true, default: null },
  diasSemana: { type: String, trim: true, default: null },
  campesenaHorarios: {
    type: horarioCampesenaHorariosSchema,
    default: null
  },
  campesenaCargos: {
    type: [horarioCampesenaCargoSchema],
    default: []
  }
});

const EstadoFicha = buildModel('EstadoFicha', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  // Estado de ciclo de vida de la ficha
  nombre: { type: String, required: true, trim: true, unique: true }
});

const EstadoCoordinador = buildModel('EstadoCoordinador', {
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  // Estado específico usado por coordinación
  nombre: { type: String, required: true, trim: true, unique: true }
});

module.exports = {
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
};