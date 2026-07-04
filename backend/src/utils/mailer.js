const nodemailer = require('nodemailer');
const env = require('../config/env');

// Transporter SMTP central para envío de correos transaccionales.
const transporter = nodemailer.createTransport({
  host: env.emailHost,
  port: env.emailPort,
  secure: false,
  auth: {
    user: env.emailUser,
    pass: env.emailPass
  }
});

// Paleta de colores usada para resaltar estados en correos HTML.
const DJANGO_STATUS_COLORS = {
  aprobado: '#4CAF50',
  rechazada: '#F44336',
  rechazadaAlt: '#F44336',
  creada: '#FFC107',
  creacion: '#2196F3',
  espera: '#000000',
  matriculada: '#4CAF50'
};

// Resuelve color de estado tolerando tildes, mayúsculas y variantes de texto.
const resolveDjangoEstadoColor = (estado) => {
  const normalized = String(estado || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalized.includes('rechaz')) {
    return DJANGO_STATUS_COLORS.rechazada;
  }

  if (normalized.includes('matriculad')) {
    return DJANGO_STATUS_COLORS.matriculada;
  }

  if (normalized.includes('creada')) {
    return DJANGO_STATUS_COLORS.creada;
  }

  if (normalized.includes('creacion')) {
    return DJANGO_STATUS_COLORS.creacion;
  }

  if (normalized.includes('aprob')) {
    return DJANGO_STATUS_COLORS.aprobado;
  }

  if (normalized.includes('espera') || normalized.includes('lista')) {
    return DJANGO_STATUS_COLORS.espera;
  }

  return '#2E7D32';
};

// Valida configuración SMTP requerida antes de enviar correos.
const ensureMailerConfig = () => {
  if (!env.emailHost || !env.emailUser || !env.emailPass || !env.emailPort) {
    throw new Error('Configuración SMTP incompleta: revise EMAIL_HOST, EMAIL_PORT, EMAIL_USER y EMAIL_PASS');
  }
};

// Envía correo de verificación inicial al registrar una cuenta.
const sendVerificationEmail = async ({ to, firstName, token }) => {
  ensureMailerConfig();

  // URL que el usuario abre para confirmar su cuenta.
  const verifyUrl = `${env.clientUrl}/verificar-cuenta?token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 24px;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.1);">
        <div style="background: #2E7D32; color: #ffffff; padding: 18px 24px;">
          <h2 style="margin: 0; font-size: 22px;">Sistema de Gestión SENA</h2>
        </div>
        <div style="padding: 24px; color: #212121;">
          <p style="font-size: 15px; margin: 0 0 16px;">Hola ${firstName || 'usuario'},</p>
          <p style="font-size: 15px; margin: 0 0 16px;">Tu cuenta fue creada correctamente. Para activar el acceso, confirma tu correo electrónico en el siguiente enlace:</p>
          <p style="margin: 24px 0;">
            <a href="${verifyUrl}" style="background: #2E7D32; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 6px; display: inline-block; font-weight: 600;">Confirmar cuenta</a>
          </p>
          <p style="font-size: 13px; color: #757575; margin: 0;">Si no solicitaste esta cuenta, puedes ignorar este correo.</p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: env.emailFrom,
    to,
    subject: 'Confirma tu cuenta - Sistema de Gestión SENA',
    html
  });
};

// Envía enlace temporal para restablecer contraseña.
const sendPasswordResetEmail = async ({ to, firstName, token }) => {
  ensureMailerConfig();

  // URL que el usuario abre para restablecer contraseña.
  const resetUrl = `${env.clientUrl}/recuperar-contrasena?token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 24px;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.1);">
        <div style="background: #2E7D32; color: #ffffff; padding: 18px 24px;">
          <h2 style="margin: 0; font-size: 22px;">Sistema de Gestión SENA</h2>
        </div>
        <div style="padding: 24px; color: #212121;">
          <p style="font-size: 15px; margin: 0 0 16px;">Hola ${firstName || 'usuario'},</p>
          <p style="font-size: 15px; margin: 0 0 16px;">Recibimos una solicitud para recuperar tu contraseña. Haz clic en el siguiente botón para continuar:</p>
          <p style="margin: 24px 0;">
            <a href="${resetUrl}" style="background: #2E7D32; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 6px; display: inline-block; font-weight: 600;">Restablecer contraseña</a>
          </p>
          <p style="font-size: 13px; color: #757575; margin: 0;">Si no solicitaste este cambio, puedes ignorar este correo.</p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: env.emailFrom,
    to,
    subject: 'Recuperación de contraseña - Sistema de Gestión SENA',
    html
  });
};

// Notifica al instructor la decisión tomada por coordinación sobre su solicitud.
const sendSolicitudDecisionEmail = async ({
  to,
  firstName,
  decision,
  observacion,
  codigoSolicitud,
  nombrePrograma,
  coordinadorNombre
}) => {
  ensureMailerConfig();

  const decisionLabel = String(decision || '').toLowerCase() === 'aprobado' ? 'APROBADA' : 'RECHAZADA';
  const decisionColor = String(decision || '').toLowerCase() === 'aprobado'
    ? DJANGO_STATUS_COLORS.aprobado
    : DJANGO_STATUS_COLORS.rechazada;
  const codigoSolicitudText = codigoSolicitud ? ` <strong>${codigoSolicitud}</strong>` : '';
  const programaText = nombrePrograma || 'Programa de formación';

  const html = `
    <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 24px;">
      <div style="max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.1);">
        <div style="background: ${decisionColor}; color: #ffffff; padding: 18px 24px;">
          <h2 style="margin: 0; font-size: 22px;">Sistema de Gestión SENA</h2>
        </div>
        <div style="padding: 24px; color: #212121;">
          <p style="font-size: 15px; margin: 0 0 16px;">Hola ${firstName || 'instructor'},</p>
          <p style="font-size: 15px; margin: 0 0 16px;">Tu solicitud${codigoSolicitudText} del programa <strong>${programaText}</strong> fue <strong style="color: ${decisionColor};">${decisionLabel}</strong> por coordinación.</p>
          <p style="font-size: 15px; margin: 0 0 8px;"><strong>Observación de coordinación:</strong></p>
          <div style="background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; margin: 0 0 16px; font-size: 14px; white-space: pre-wrap;">${observacion || 'Sin observación'}</div>
          <p style="font-size: 13px; color: #757575; margin: 0;">Revisado por: ${coordinadorNombre || 'Coordinación Académica'}.</p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: env.emailFrom,
    to,
    subject: `Solicitud ${decisionLabel} - Sistema de Gestión SENA`,
    html
  });
};

// Notifica al instructor la actualización de estado realizada por funcionario.
const sendFuncionarioSolicitudStatusEmail = async ({
  to,
  firstName,
  estadoFicha,
  observacion,
  codigoSolicitud,
  nombrePrograma,
  funcionarioNombre
}) => {
  ensureMailerConfig();

  const estadoNormalizado = String(estadoFicha || '').trim().toLowerCase();
  const estadoLabel = estadoFicha || 'Actualizada';
  const estadoColor = resolveDjangoEstadoColor(estadoFicha || estadoNormalizado);
  const codigoSolicitudText = codigoSolicitud ? ` <strong>${codigoSolicitud}</strong>` : '';
  const programaText = nombrePrograma || 'Programa de formación';

  const html = `
    <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 24px;">
      <div style="max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.1);">
        <div style="background: ${estadoColor}; color: #ffffff; padding: 18px 24px;">
          <h2 style="margin: 0; font-size: 22px;">Sistema de Gestión SENA</h2>
        </div>
        <div style="padding: 24px; color: #212121;">
          <p style="font-size: 15px; margin: 0 0 16px;">Hola ${firstName || 'instructor'},</p>
          <p style="font-size: 15px; margin: 0 0 16px;">Tu solicitud${codigoSolicitudText} del programa <strong>${programaText}</strong> fue actualizada por funcionario al estado <strong style="color: ${estadoColor};">${estadoLabel}</strong>.</p>
          <p style="font-size: 15px; margin: 0 0 8px;"><strong>Observación del funcionario:</strong></p>
          <div style="background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; margin: 0 0 16px; font-size: 14px; white-space: pre-wrap;">${observacion || 'Sin observación'}</div>
          <p style="font-size: 13px; color: #757575; margin: 0;">Gestionado por: ${funcionarioNombre || 'Funcionario'}.</p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: env.emailFrom,
    to,
    subject: `Estado actualizado a ${estadoLabel} - Sistema de Gestión SENA`,
    html
  });
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSolicitudDecisionEmail,
  sendFuncionarioSolicitudStatusEmail
};
