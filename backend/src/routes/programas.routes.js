const { Router } = require('express');
const {
  listProgramas,
  createPrograma,
  updatePrograma,
  updateProgramaEstado
} = require('../controllers/programas.controller');
const { authRequired, authorize } = require('../middleware/auth');

const router = Router();

router.get('/', authRequired, authorize('curricular', 'admin'), listProgramas);
router.post('/', authRequired, authorize('curricular', 'admin'), createPrograma);
router.put('/:id', authRequired, authorize('curricular', 'admin'), updatePrograma);
router.patch('/:id/estado', authRequired, authorize('curricular', 'admin'), updateProgramaEstado);

module.exports = router;