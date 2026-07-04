const mongoose = require('mongoose');

const { Schema } = mongoose;

const solicitudFuncionarioSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true, index: true },
    usuarioRevisador: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true,
      default: null
    },
    usuarioSolicitud: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    solicitud: {
      type: Schema.Types.ObjectId,
      ref: 'Solicitud',
      required: true,
      index: true
    },
    estado: {
      type: String,
      enum: ['reenviado', 'aprobado', 'rechazado'],
      required: true,
      index: true
    },
    observacion: { type: String, trim: true, default: null },
    fecha: { type: Date, default: Date.now }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

solicitudFuncionarioSchema.index({ solicitud: 1, fecha: -1, createdAt: -1 });

const SolicitudFuncionario =
  mongoose.models.SolicitudFuncionario ||
  mongoose.model('SolicitudFuncionario', solicitudFuncionarioSchema);

module.exports = { SolicitudFuncionario };
