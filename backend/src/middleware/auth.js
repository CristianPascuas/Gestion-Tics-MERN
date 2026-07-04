const { User } = require('../models/User');
const { verifyToken } = require('../utils/jwt');

// Middleware que exige JWT válido y adjunta el usuario activo a req.user.
const authRequired = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Token inválido o ausente' });
    }

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);

    if (!user || !user.active) {
      return res.status(401).json({ message: 'Usuario no autorizado' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'No autorizado' });
  }
};

const authorize = (...roles) => {
  // Middleware de autorización por roleKey o roleId.
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'No autorizado' });
    }

    const allowed = roles.map((item) => String(item));
    const currentRoleKey = String(req.user.roleKey);
    const currentRoleId = String(req.user.roleId);

    if (!allowed.includes(currentRoleKey) && !allowed.includes(currentRoleId)) {
      return res.status(403).json({ message: 'Sin permisos para esta acción' });
    }

    return next();
  };
};

module.exports = {
  authRequired,
  authorize
};