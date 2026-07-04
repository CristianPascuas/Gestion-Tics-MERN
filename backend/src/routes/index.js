const { Router } = require('express');
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const catalogsRoutes = require('./catalogs.routes');
const solicitudesRoutes = require('./solicitudes.routes');
const programasRoutes = require('./programas.routes');

const router = Router();

// Endpoint de salud para monitoreo rápido del servicio.
router.get('/health', (_req, res) => {
  return res.status(200).json({ status: 'ok' });
});

// Montaje de módulos principales de la API.
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/catalogs', catalogsRoutes);
router.use('/solicitudes', solicitudesRoutes);
router.use('/programas', programasRoutes);

module.exports = router;