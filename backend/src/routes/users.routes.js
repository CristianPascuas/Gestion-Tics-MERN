const { Router } = require('express');
const { listUsers, listPendingUsers, approveUser } = require('../controllers/users.controller');
const { authRequired, authorize } = require('../middleware/auth');

const router = Router();

// Listado de usuarios (acceso exclusivo para administrador).
router.get('/', authRequired, authorize('admin'), listUsers);
router.get('/pending', authRequired, authorize('admin'), listPendingUsers);
router.patch('/:id/approve', authRequired, authorize('admin'), approveUser);

module.exports = router;