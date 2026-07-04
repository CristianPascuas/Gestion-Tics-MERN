const { validationResult } = require('express-validator');
const crypto = require('crypto');
const { User, ROLE_OPTIONS } = require('../models/User');
const { signToken } = require('../utils/jwt');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/mailer');

// Referencias de roles usadas para validar registro de instructores.
const COORDINATOR_ROLE = ROLE_OPTIONS.find((item) => item.key === 'coordinador');
const INSTRUCTOR_ROLE = ROLE_OPTIONS.find((item) => item.key === 'instructor');

// Genera token temporal y su hash persistible para confirmación/recuperación.
const createAccountTokenData = (expiresInMs) => {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  return {
    token,
    tokenHash,
    expiresAt: new Date(Date.now() + expiresInMs)
  };
};

// Extrae y transforma errores de validación para respuestas homogéneas.
const getValidationErrors = (req) => {
  // Normaliza los errores de express-validator a un formato uniforme de API.
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return null;
  }

  return errors.array().map((item) => ({
    field: item.path,
    message: item.msg
  }));
};

const register = async (req, res, next) => {
  try {
    // Registro con validación de duplicados y envío de correo de verificación.
    const validationErrors = getValidationErrors(req);
    if (validationErrors) {
      return res.status(400).json({ message: 'Datos inválidos', errors: validationErrors });
    }

    const {
      nombre,
      apellido,
      rol,
      tipo_documento,
      numeroCedula,
      telefono,
      correo,
      clave,
      contrato,
      numeroContrato,
      inicioContrato,
      finContrato,
      tipoInstructor,
      coordinadorId
    } = req.body;

    const existsDocument = await User.findOne({ documentNumber: String(numeroCedula).trim() });

    if (existsDocument) {
      return res.status(409).json({ message: 'El número de cédula ya está registrado' });
    }

    const existsEmail = await User.findOne({ email: correo.toLowerCase() });

    if (existsEmail) {
      return res.status(409).json({ message: 'El correo ya está registrado' });
    }

    const roleId = Number(rol);

    if (roleId === INSTRUCTOR_ROLE?.id) {
      const coordinatorExists = await User.findOne({
        _id: coordinadorId,
        roleId: COORDINATOR_ROLE?.id,
        active: true,
        verified: true
      });

      if (!coordinatorExists) {
        return res.status(400).json({ message: 'El coordinador seleccionado no es válido' });
      }
    }

    const accountTokenData = createAccountTokenData(1000 * 60 * 60 * 24);

    const user = await User.create({
      firstName: nombre,
      lastName: apellido,
      roleId,
      documentType: tipo_documento,
      documentNumber: String(numeroCedula).trim(),
      phone: String(telefono || '').trim(),
      email: correo,
      password: clave,
      contractType: Number(contrato),
      contractNumber: Number(contrato) === 2 ? String(numeroContrato || '').trim() : null,
      contractStartAt: Number(contrato) === 2 ? new Date(inicioContrato) : null,
      contractEndAt: Number(contrato) === 2 ? new Date(finContrato) : null,
      instructorType: roleId === INSTRUCTOR_ROLE?.id ? tipoInstructor : null,
      coordinatorId: roleId === INSTRUCTOR_ROLE?.id ? coordinadorId : null,
      verified: false,
      verifiedAt: null,
      accountTokenHash: accountTokenData.tokenHash,
      accountTokenExpiresAt: accountTokenData.expiresAt,
      active: false
    });

    try {
      await sendVerificationEmail({
        to: user.email,
        firstName: user.firstName,
        token: accountTokenData.token
      });
    } catch (_mailError) {
      await User.findByIdAndDelete(user._id);
      return res
        .status(500)
        .json({ message: 'No se pudo enviar el correo de confirmación. Intente nuevamente.' });
    }

    return res.status(201).json({
      message:
        'Registro exitoso. Te enviamos un correo de confirmación. Debes confirmar el correo y esperar aprobación del administrador para poder ingresar.',
      user: user.toSafeObject()
    });
  } catch (error) {
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    // Inicio de sesión por documento + rol, con verificación de cuenta y vigencia contractual.
    const validationErrors = getValidationErrors(req);
    if (validationErrors) {
      return res.status(400).json({ message: 'Datos inválidos', errors: validationErrors });
    }

    const { numeroCedula, clave, rol } = req.body;
    const user = await User.findOne({
      documentNumber: String(numeroCedula).trim(),
      roleId: Number(rol)
    });

    if (!user) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    if (!user.verified && !user.active) {
      return res.status(403).json({
        message:
          'Tu cuenta aún no está lista. Debes confirmar tu correo electrónico y esperar aprobación del administrador.'
      });
    }

    if (!user.verified) {
      return res.status(403).json({ message: 'Debes confirmar tu correo electrónico antes de iniciar sesión.' });
    }

    if (!user.active) {
      return res.status(403).json({ message: 'Tu cuenta está pendiente de aprobación por parte del administrador.' });
    }

    if (
      user.contractType === 2 &&
      user.contractEndAt &&
      new Date(user.contractEndAt).getTime() < Date.now()
    ) {
      return res.status(403).json({
        message:
          'Tu contrato se encuentra vencido. Contacta al coordinador para actualizar la vigencia antes de iniciar sesión.'
      });
    }

    const isValid = await user.comparePassword(clave);
    if (!isValid) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const token = signToken({
      sub: String(user._id),
      role: user.roleKey,
      roleId: user.roleId,
      documentNumber: user.documentNumber
    });

    return res.status(200).json({
      token,
      user: user.toSafeObject()
    });
  } catch (error) {
    return next(error);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    // Confirmación de cuenta mediante token hash y fecha de expiración.
    const token = String(req.query.token || '').trim();

    if (!token) {
      return res.status(400).json({ message: 'Token de verificación inválido' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      accountTokenHash: tokenHash,
      accountTokenExpiresAt: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ message: 'El enlace de confirmación es inválido o ya expiró' });
    }

    user.verified = true;
    user.verifiedAt = new Date();
    user.accountTokenHash = null;
    user.accountTokenExpiresAt = null;
    await user.save();

    return res.status(200).json({ message: 'Cuenta confirmada correctamente. Ya puedes iniciar sesión.' });
  } catch (error) {
    return next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    // Solicita restablecimiento sin revelar si el correo existe (respuesta neutra).
    const validationErrors = getValidationErrors(req);
    if (validationErrors) {
      return res.status(400).json({ message: 'Datos inválidos', errors: validationErrors });
    }

    const email = String(req.body.correo || '').trim().toLowerCase();
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(200).json({
        message:
          'Si el correo existe en el sistema, te enviaremos un enlace para recuperar la contraseña.'
      });
    }

    const accountTokenData = createAccountTokenData(1000 * 60 * 30);

    user.accountTokenHash = accountTokenData.tokenHash;
    user.accountTokenExpiresAt = accountTokenData.expiresAt;
    await user.save();

    await sendPasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      token: accountTokenData.token
    });

    return res.status(200).json({
      message:
        'Si el correo existe en el sistema, te enviaremos un enlace para recuperar la contraseña.'
    });
  } catch (error) {
    return next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    // Restablece la contraseña cuando el token es válido y no expiró.
    const validationErrors = getValidationErrors(req);
    if (validationErrors) {
      return res.status(400).json({ message: 'Datos inválidos', errors: validationErrors });
    }

    const token = String(req.body.token || '').trim();
    const newPassword = String(req.body.clave || '');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      accountTokenHash: tokenHash,
      accountTokenExpiresAt: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Token inválido o expirado' });
    }

    user.password = newPassword;
    user.accountTokenHash = null;
    user.accountTokenExpiresAt = null;
    await user.save();

    return res.status(200).json({ message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
  } catch (error) {
    return next(error);
  }
};

const me = async (req, res) => {
  // Devuelve la sesión actual en formato seguro.
  return res.status(200).json({ user: req.user.toSafeObject() });
};

const getCoordinators = async (_req, res, next) => {
  try {
    // Lista coordinadores activos/verificados para asignación de instructores.
    const coordinators = await User.find({
      roleId: COORDINATOR_ROLE?.id,
      active: true,
      verified: true
    })
      .select('_id firstName lastName')
      .sort({ firstName: 1, lastName: 1 })
      .lean();

    return res.status(200).json({
      coordinators: coordinators.map((item) => ({
        id: String(item._id),
        name: `${item.firstName} ${item.lastName}`.trim()
      }))
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  register,
  login,
  me,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getCoordinators
};
