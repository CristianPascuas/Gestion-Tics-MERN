const { Router } = require('express');
const {
	createSolicitud,
	listSolicitudesConsulta,
	getSolicitudesReportes,
	sendSolicitudToCoordinator,
	sendSolicitudDirectToFuncionario,
	sendSolicitudToFuncionario,
	updateSolicitudByFuncionario,
	uploadSolicitudSofiaPlus,
	downloadSolicitudSofiaPlus,
	getSolicitudCaracterizacion,
	downloadSolicitudCaracterizacionWord
} = require('../controllers/solicitud.controller');
const {
	getInscripcionPublica,
	registerAspirantePublic,
	listAspirantesBySolicitud,
	updateAspirante,
	deleteAspirante,
	viewAspirantesIdentityDocuments,
	getAspirantesInscripcionFormato,
	downloadAspirantesInscripcionFormatoExcel
} = require('../controllers/aspirantes.controller');
const { authRequired, authorize } = require('../middleware/auth');
const { uploadCartaSolicitud, uploadDocumentoAspirante, uploadSofiaPlusExcel } = require('../middleware/upload');

const router = Router();

// Crea una nueva solicitud (regular o CampeSENA).
// Solo instructor/admin y admite carga de carta PDF.
router.post(
	'/',
	authRequired,
	authorize('instructor', 'admin'),
	uploadCartaSolicitud.single('cartaSolicitud'),
	createSolicitud
);

// Lista solicitudes para consulta según permisos del rol autenticado.
router.get(
	'/consultas',
	authRequired,
	authorize('instructor', 'coordinador', 'funcionario', 'admin'),
	listSolicitudesConsulta
);

// Reportes agregados de solicitudes para coordinador/admin.
router.get(
	'/reportes',
	authRequired,
	authorize('coordinador', 'funcionario', 'admin'),
	getSolicitudesReportes
);

// Envía solicitud al coordinador ligado al instructor dueño.
router.post(
	'/:id/enviar-coordinador',
	authRequired,
	authorize('instructor', 'admin'),
	sendSolicitudToCoordinator
);

// Reenvía solicitud retornada por funcionario directamente al funcionario.
router.post(
	'/:id/enviar-funcionario-directo',
	authRequired,
	authorize('instructor'),
	sendSolicitudDirectToFuncionario
);

// Envía solicitud revisada desde coordinación hacia funcionario con observación.
router.post(
	'/:id/enviar-funcionario',
	authRequired,
	authorize('coordinador', 'admin'),
	sendSolicitudToFuncionario
);

// Gestión de estado/códigos de solicitud-ficha por funcionario.
router.put(
	'/:id/gestion-funcionario',
	authRequired,
	authorize('funcionario'),
	uploadSofiaPlusExcel.single('sofiaPlusExcel'),
	updateSolicitudByFuncionario
);

// Carga de formato de inscripción masiva SOFiA Plus por funcionario.
router.post(
	'/:id/sofia-plus',
	authRequired,
	authorize('funcionario'),
	uploadSofiaPlusExcel.single('sofiaPlusExcel'),
	uploadSolicitudSofiaPlus
);

// Descarga del formato SOFiA Plus para instructor dueño de la solicitud.
router.get(
	'/:id/sofia-plus',
	authRequired,
	authorize('instructor', 'funcionario', 'admin'),
	downloadSolicitudSofiaPlus
);

// Datos públicos de inscripción por solicitud (sin autenticación).
router.get('/:id/inscripcion', getInscripcionPublica);

// Registro público de aspirantes con PDF de identidad.
router.post('/:id/inscripcion', uploadDocumentoAspirante.single('documentoIdentidadPdf'), registerAspirantePublic);

// Gestión interna de aspirantes por solicitud desde consultar solicitudes.
router.get(
	'/:id/aspirantes',
	authRequired,
	authorize('instructor', 'admin'),
	listAspirantesBySolicitud
);

// Descarga/visualiza PDF consolidado de documentos de identidad por solicitud.
router.get(
	'/:id/aspirantes/documentos-identidad',
	authRequired,
	authorize('instructor', 'coordinador', 'funcionario', 'admin'),
	viewAspirantesIdentityDocuments
);

// Estructura del formato de inscripción masiva estilo Excel por solicitud.
router.get(
	'/:id/aspirantes/formato-inscripcion',
	authRequired,
	authorize('instructor', 'coordinador', 'funcionario', 'admin'),
	getAspirantesInscripcionFormato
);

// Descarga del formato de inscripción masiva en archivo Excel real.
router.get(
	'/:id/aspirantes/formato-inscripcion.xlsx',
	authRequired,
	authorize('instructor', 'coordinador', 'funcionario', 'admin'),
	downloadAspirantesInscripcionFormatoExcel
);

// Actualiza datos de aspirante y opcionalmente reemplaza su PDF de identidad.
router.put(
	'/:id/aspirantes/:aspiranteId',
	authRequired,
	authorize('instructor', 'admin'),
	uploadDocumentoAspirante.single('documentoIdentidadPdf'),
	updateAspirante
);

// Elimina aspirante de la solicitud y su documento asociado en disco.
router.delete(
	'/:id/aspirantes/:aspiranteId',
	authRequired,
	authorize('instructor', 'admin'),
	deleteAspirante
);

// Detalle de ficha de caracterización por solicitud.
router.get(
	'/:id/caracterizacion',
	authRequired,
	authorize('instructor', 'coordinador', 'funcionario', 'admin'),
	getSolicitudCaracterizacion
);

// Descarga de ficha de caracterización en formato Word compatible (.doc).
router.get(
	'/:id/caracterizacion.doc',
	authRequired,
	authorize('instructor', 'coordinador', 'funcionario', 'admin'),
	downloadSolicitudCaracterizacionWord
);

module.exports = router;