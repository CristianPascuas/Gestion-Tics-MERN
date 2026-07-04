const mongoose = require('mongoose');

const { Schema } = mongoose;

const campesenaCargoSchema = new Schema(
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
    }
  },
  { _id: false }
);

const solicitudSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true, index: true },
    tipoSolicitud: {
      type: Schema.Types.ObjectId,
      ref: 'TipoSolicitud',
      required: true,
      index: true
    },
    codigoSolicitud: {
      type: Number,
      default: null,
      index: true
    },
    programa: {
      type: Schema.Types.ObjectId,
      ref: 'ProgramaFormacion',
      required: true,
      index: true
    },
    horario: {
      type: Schema.Types.ObjectId,
      ref: 'Horario',
      required: true,
      index: true
    },
    cupo: { type: Number, required: true, min: 1 },
    modalidad: {
      type: Schema.Types.ObjectId,
      ref: 'Modalidad',
      required: true,
      index: true
    },
    municipio: {
      type: Schema.Types.ObjectId,
      ref: 'Municipio',
      required: true,
      index: true
    },
    direccion: { type: String, required: true, trim: true },
    usuario: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    empresa: {
      type: Schema.Types.ObjectId,
      ref: 'Empresa',
      default: null,
      index: true
    },
    subsectorEconomico: { type: String, trim: true, default: null },
    programaEspecial: {
      type: Schema.Types.ObjectId,
      ref: 'ProgramaEspecial',
      required: true,
      index: true
    },
    ambiente: { type: String, trim: true, default: null },
    cartaRuta: { type: String, trim: true, default: null },
    cartaTipo: {
      type: String,
      enum: ['subida_empresa', 'generada_interna'],
      default: null
    },
    fechaSolicitud: { type: Date, required: true, default: Date.now },
    revisado: { type: Boolean, default: false },
    linkPreinscripcion: { type: String, trim: true, default: null },
    campesenaCargos: {
      type: [campesenaCargoSchema],
      default: []
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

solicitudSchema.index({ usuario: 1, fechaSolicitud: -1 });
solicitudSchema.index({ tipoSolicitud: 1, revisado: 1 });

const Solicitud = mongoose.models.Solicitud || mongoose.model('Solicitud', solicitudSchema);

module.exports = { Solicitud };