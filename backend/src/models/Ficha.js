const mongoose = require('mongoose');

const { Schema } = mongoose;

const fichaSchema = new Schema(
  {
    legacyId: { type: Number, unique: true, sparse: true, index: true },
    codigoFicha: { type: Number, default: null, unique: true, sparse: true },
    solicitud: {
      type: Schema.Types.ObjectId,
      ref: 'Solicitud',
      required: true,
      index: true
    },
    estado: {
      type: Schema.Types.ObjectId,
      ref: 'EstadoFicha',
      required: true,
      index: true
    },
    usuario: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    observacion: { type: String, trim: true, default: '' },
    excelSofiaPlusPath: { type: String, trim: true, default: null },
    excelGenerado: { type: Boolean, default: false }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

fichaSchema.index({ solicitud: 1, estado: 1 });

const Ficha = mongoose.models.Ficha || mongoose.model('Ficha', fichaSchema);

module.exports = { Ficha };