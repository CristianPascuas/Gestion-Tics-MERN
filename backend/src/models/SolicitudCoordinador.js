const mongoose = require('mongoose');

const { Schema } = mongoose;

const solicitudCoordinadorSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true, index: true },
    usuarioRevisador: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
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
      type: Schema.Types.ObjectId,
      ref: 'EstadoCoordinador',
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

solicitudCoordinadorSchema.index({ solicitud: 1, usuarioRevisador: 1, fecha: -1 });

const SolicitudCoordinador =
  mongoose.models.SolicitudCoordinador ||
  mongoose.model('SolicitudCoordinador', solicitudCoordinadorSchema);

module.exports = { SolicitudCoordinador };