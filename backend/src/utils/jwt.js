const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Firma un JWT con la configuración de expiración definida en entorno.
const signToken = (payload) => {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
};

// Verifica y decodifica un JWT; lanza error si no es válido.
const verifyToken = (token) => {
  return jwt.verify(token, env.jwtSecret);
};

module.exports = {
  signToken,
  verifyToken
};