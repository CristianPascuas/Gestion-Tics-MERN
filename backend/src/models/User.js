const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Catálogo central de roles usados en validaciones, UI y autorización.
const ROLE_OPTIONS = [
  { id: 1, key: 'instructor', label: 'Instructor' },
  { id: 2, key: 'coordinador', label: 'Coordinador' },
  { id: 3, key: 'funcionario', label: 'Funcionario' },
  { id: 4, key: 'admin', label: 'Administrador' },
  { id: 5, key: 'curricular', label: 'Curricular' }
];

const ROLE_IDS = ROLE_OPTIONS.map((item) => item.id);
const ROLE_KEYS = ROLE_OPTIONS.map((item) => item.key);
const DOCUMENT_TYPES = ['CC', 'TI', 'CE', 'PASAPORTE'];
const CONTRACT_TYPES = [1, 2];
const INSTRUCTOR_TYPES = ['regular', 'campesena'];

// Utilidad para resolver rápidamente metadatos del rol por ID.
const getRoleById = (roleId) => ROLE_OPTIONS.find((item) => item.id === Number(roleId));

// Esquema principal de usuarios del portal.
const userSchema = new mongoose.Schema(
  {
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
      enum: DOCUMENT_TYPES,
      required: true
    },
    documentNumber: {
      type: String,
      required: true,
      unique: true,
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
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: true,
      minlength: 8
    },
    roleId: {
      type: Number,
      enum: ROLE_IDS,
      required: true
    },
    roleKey: {
      type: String,
      enum: ROLE_KEYS,
      required: true
    },
    contractType: {
      type: Number,
      enum: CONTRACT_TYPES,
      required: true
    },
    contractNumber: {
      type: String,
      default: null,
      trim: true
    },
    contractStartAt: {
      type: Date,
      default: null
    },
    contractEndAt: {
      type: Date,
      default: null
    },
    instructorType: {
      type: String,
      enum: INSTRUCTOR_TYPES,
      default: null
    },
    coordinatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    verified: {
      type: Boolean,
      default: false
    },
    verifiedAt: {
      type: Date,
      default: null
    },
    accountTokenHash: {
      type: String,
      default: null
    },
    accountTokenExpiresAt: {
      type: Date,
      default: null
    },
    active: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

userSchema.pre('validate', function setDerivedFields(next) {
  // Deriva campos normalizados y valida reglas de negocio antes de guardar.
  const role = getRoleById(this.roleId);
  if (!role) {
    return next(new Error('Rol inválido'));
  }

  this.roleKey = role.key;
  this.firstName = this.firstName.trim().toUpperCase();
  this.lastName = this.lastName.trim().toUpperCase();
  this.phone = this.phone ? String(this.phone).trim() : '';

  if (!this.phone) {
    return next(new Error('El número de teléfono es obligatorio'));
  }

  if (this.roleKey === 'instructor') {
    if (!this.instructorType) {
      return next(new Error('El tipo de instructor es obligatorio'));
    }

    if (!this.coordinatorId) {
      return next(new Error('Debes seleccionar el coordinador al cual estás ligado'));
    }
  } else {
    this.instructorType = null;
    this.coordinatorId = null;
  }

  if (this.contractType === 1) {
    this.contractNumber = null;
    this.contractStartAt = null;
    this.contractEndAt = null;
  }

  if (this.contractType === 2 && !this.contractNumber) {
    return next(new Error('El número de contrato es obligatorio para tipo Contrato'));
  }

  if (this.contractType === 2 && !this.contractStartAt) {
    return next(new Error('La fecha de inicio de contrato es obligatoria'));
  }

  if (this.contractType === 2 && !this.contractEndAt) {
    return next(new Error('La fecha de finalización del contrato es obligatoria'));
  }

  if (
    this.contractType === 2 &&
    this.contractStartAt &&
    this.contractEndAt &&
    new Date(this.contractEndAt).getTime() < new Date(this.contractStartAt).getTime()
  ) {
    return next(new Error('La fecha de finalización no puede ser menor que la fecha de inicio'));
  }

  return next();
});

userSchema.pre('save', async function hashPassword(next) {
  // Solo re-hashea si la contraseña fue modificada en esta operación.
  if (!this.isModified('password')) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  return next();
});

userSchema.methods.comparePassword = function comparePassword(plainPassword) {
  // Comparación segura usando bcrypt.
  return bcrypt.compare(plainPassword, this.password);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  // Proyección segura para respuestas API (sin exponer password ni hashes internos).
  const role = getRoleById(this.roleId);

  return {
    id: this._id,
    name: `${this.firstName} ${this.lastName}`,
    firstName: this.firstName,
    lastName: this.lastName,
    documentType: this.documentType,
    documentNumber: this.documentNumber,
    phone: this.phone,
    email: this.email,
    roleId: this.roleId,
    role: this.roleKey,
    roleLabel: role ? role.label : 'Desconocido',
    contractType: this.contractType,
    contractNumber: this.contractNumber,
    contractStartAt: this.contractStartAt,
    contractEndAt: this.contractEndAt,
    instructorType: this.instructorType,
    coordinatorId: this.coordinatorId,
    verified: this.verified,
    verifiedAt: this.verifiedAt,
    active: this.active,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

module.exports = {
  // Se exporta el modelo junto con catálogos para reutilizarlos en validaciones/controladores.
  User: mongoose.model('User', userSchema),
  ROLE_OPTIONS,
  ROLE_IDS,
  DOCUMENT_TYPES,
  CONTRACT_TYPES,
  INSTRUCTOR_TYPES
};