const { User } = require('../models/User');

const listUsers = async (_req, res, next) => {
  try {
    // Listado completo para gestión administrativa, ordenado por creación reciente.
    const users = await User.find().sort({ createdAt: -1 });
    return res.status(200).json({
      // Se serializa cada usuario con proyección segura.
      users: users.map((item) => item.toSafeObject())
    });
  } catch (error) {
    return next(error);
  }
};

const listPendingUsers = async (_req, res, next) => {
  try {
    // Lista cuentas pendientes de activación para flujo de aprobación administrativa.
    const users = await User.find({ active: false }).sort({ createdAt: -1 });
    return res.status(200).json({
      users: users.map((item) => item.toSafeObject())
    });
  } catch (error) {
    return next(error);
  }
};

const approveUser = async (req, res, next) => {
  try {
    // Activa la cuenta seleccionada cuando pasa la revisión del administrador.
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    if (user.roleKey === 'admin' && !user.active) {
      return res.status(400).json({ message: 'No se puede aprobar esta cuenta de administrador desde este flujo' });
    }

    user.active = true;
    await user.save();

    return res.status(200).json({
      message: 'Usuario aprobado correctamente',
      user: user.toSafeObject()
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listUsers,
  listPendingUsers,
  approveUser
};