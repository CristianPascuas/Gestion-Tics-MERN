const { Router } = require('express');
const { listSolicitudCatalogs } = require('../controllers/catalogs.controller');
const { authRequired } = require('../middleware/auth');

const router = Router();

// Retorna catálogos necesarios para construir el formulario de solicitud.
// Requiere sesión activa.
router.get('/solicitud', authRequired, listSolicitudCatalogs);

module.exports = router;