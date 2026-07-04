const mongoose = require('mongoose');

const { Schema } = mongoose;

// Modelo de aspirantes inscritos a una solicitud específica.
const aspiranteSchema = new Schema(
  {
    solicitud: {
      type: Schema.Types.ObjectId,
      ref: 'Solicitud',
      required: true,
      index: true
    },
    firstName: {
      type: String,
      required: true,
      trim: true
    },
    lastName: {
      type: String,
      required: true,
      trim: true
    },
    documentType: {
      type: String,
      required: true
    },
    documentNumber: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    caracterizacion: {
      type: String,
      required: true,
      trim: true
    },
    documentPdfPath: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

// Normaliza los datos críticos antes de validar/persistir el aspirante.
aspiranteSchema.pre('validate', function normalizeCandidateData(next) {
  this.firstName = String(this.firstName || '').trim().toUpperCase();
  this.lastName = String(this.lastName || '').trim().toUpperCase();
  this.documentNumber = String(this.documentNumber || '').trim();
  this.phone = String(this.phone || '').trim();
  this.email = String(this.email || '').trim().toLowerCase();
  this.caracterizacion = String(this.caracterizacion || '').trim();
  return next();
});

// Regla de duplicados por solicitud: evita conflictos entre solicitudes distintas.
aspiranteSchema.index({ solicitud: 1, documentNumber: 1 }, { unique: true });
aspiranteSchema.index({ solicitud: 1, phone: 1 }, { unique: true });
aspiranteSchema.index({ solicitud: 1, email: 1 }, { unique: true });

// Objeto seguro para respuestas API sin exponer internals de Mongo.
aspiranteSchema.methods.toSafeObject = function toSafeObject() {
  return {
    id: this._id,
    solicitudId: this.solicitud,
    firstName: this.firstName,
    lastName: this.lastName,
    name: `${this.firstName} ${this.lastName}`.trim(),
    documentType: this.documentType,
    documentNumber: this.documentNumber,
    phone: this.phone,
    email: this.email,
    caracterizacion: this.caracterizacion,
    documentUrl: this.documentPdfPath ? `/media/${this.documentPdfPath}` : null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

// Evita recompilar el modelo cuando Nodemon recarga en desarrollo.
const Aspirante = mongoose.models.Aspirante || mongoose.model('Aspirante', aspiranteSchema);

module.exports = {
  Aspirante
};
