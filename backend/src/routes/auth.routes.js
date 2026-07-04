const { Router } = require('express');
const { body } = require('express-validator');
const {
  register,
  login,
  me,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getCoordinators
} = require('../controllers/auth.controller');
const { authRequired } = require('../middleware/auth');
const {
  ROLE_IDS,
  ROLE_OPTIONS,
  DOCUMENT_TYPES,
  CONTRACT_TYPES,
  INSTRUCTOR_TYPES
} = require('../models/User');

const router = Router();
// Se usa para validar reglas condicionales cuando el rol es instructor.
const INSTRUCTOR_ROLE = ROLE_OPTIONS.find((item) => item.key === 'instructor');

// Registro de usuario con validaciones de campos base y reglas de negocio.
router.post(
  '/register',
  body('nombre').notEmpty().withMessage('El nombre es requerido'),
  body('apellido').notEmpty().withMessage('El apellido es requerido'),
  body('rol').isInt().toInt().isIn(ROLE_IDS).withMessage('Rol inválido'),
  body('tipo_documento').isIn(DOCUMENT_TYPES).withMessage('Tipo de documento inválido'),
  body('numeroCedula').notEmpty().withMessage('La cédula es requerida'),
  body('telefono').notEmpty().withMessage('El número de teléfono es requerido'),
  body('correo').isEmail().withMessage('Correo inválido'),
  body('clave').isLength({ min: 8 }).withMessage('La contraseña debe tener mínimo 8 caracteres'),
  body('contrato').isInt().toInt().isIn(CONTRACT_TYPES).withMessage('Tipo de contrato inválido'),
  body('numeroContrato')
    .optional({ values: 'falsy' })
    .isLength({ min: 1 })
    .withMessage('Número de contrato inválido'),
  body('inicioContrato')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Fecha de inicio de contrato inválida'),
  body('finContrato')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Fecha de finalización de contrato inválida'),
  body('tipoInstructor')
    .optional({ values: 'falsy' })
    .isIn(INSTRUCTOR_TYPES)
    .withMessage('Tipo de instructor inválido'),
  body('coordinadorId')
    .optional({ values: 'falsy' })
    .isMongoId()
    .withMessage('Coordinador inválido'),
  body().custom((value) => {
    if (Number(value.contrato) === 2) {
      if (!value.numeroContrato) {
        throw new Error('El número de contrato es obligatorio para contrato tipo Contrato');
      }

      if (!value.inicioContrato || !value.finContrato) {
        throw new Error('Debes registrar fecha de inicio y fecha de finalización del contrato');
      }

      if (new Date(value.finContrato).getTime() < new Date(value.inicioContrato).getTime()) {
        throw new Error('La fecha de finalización no puede ser menor que la fecha de inicio');
      }
    }

    if (Number(value.rol) === INSTRUCTOR_ROLE?.id) {
      if (!value.tipoInstructor) {
        throw new Error('Debes seleccionar si eres instructor Regular o CampeSENA');
      }

      if (!value.coordinadorId) {
        throw new Error('Debes seleccionar el coordinador al cual estás ligado');
      }
    }

    return true;
  }),
  register
);

// Inicio de sesión con validación básica de credenciales y rol.
router.post(
  '/login',
  body('numeroCedula').notEmpty().withMessage('La cédula es requerida'),
  body('clave').notEmpty().withMessage('La contraseña es requerida'),
  body('rol').isInt().toInt().isIn(ROLE_IDS).withMessage('Rol inválido'),
  login
);

// Verificación de cuenta, recuperación de contraseña y perfil actual.
router.get('/verify-email', verifyEmail);
router.get('/coordinators', getCoordinators);
router.post(
  '/forgot-password',
  body('correo').isEmail().withMessage('Correo inválido'),
  forgotPassword
);
router.post(
  '/reset-password',
  body('token').notEmpty().withMessage('Token requerido'),
  body('clave').isLength({ min: 8 }).withMessage('La contraseña debe tener mínimo 8 caracteres'),
  resetPassword
);
router.get('/me', authRequired, me);

// Catálogos auxiliares para poblar formularios de autenticación/registro.
router.get('/catalogs', (_req, res) => {
  return res.status(200).json({
    roles: ROLE_OPTIONS,
    documentTypes: DOCUMENT_TYPES,
    contractTypes: [
      { id: 1, label: 'Planta' },
      { id: 2, label: 'Contrato' }
    ],
    instructorTypes: [
      { id: 'regular', label: 'Regular' },
      { id: 'campesena', label: 'CampeSENA' }
    ]
  });
});

module.exports = router;