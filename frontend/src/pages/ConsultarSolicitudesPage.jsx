import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PortalLayout from '../components/PortalLayout';
import {
  fetchSolicitudesConsulta,
  fetchSolicitudSofiaPlus,
  sendSolicitudDirectToFuncionario,
  sendSolicitudToCoordinator,
  sendSolicitudToFuncionario,
  updateSolicitudByFuncionario
} from '../api/solicitudes';
import {
  deleteAspiranteBySolicitud,
  fetchAspirantesDocumentosPdf,
  fetchAspirantesBySolicitud,
  updateAspiranteBySolicitud
} from '../api/aspirantes';
import { useAuth } from '../context/AuthContext';

// Formatea fechas para visualización amigable en español (Colombia).
const formatDate = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('es-CO');
};

// Convierte fechas a formato YYYY-MM-DD para compararlas con input type="date".
const toDateInput = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().split('T')[0];
};

// Retorna la clase CSS de estado según el texto recibido.
const getEstadoClass = (estado) => {
  const normalized = String(estado || '').toLowerCase();
  if (normalized.includes('matriculada') || normalized.includes('aprobad')) {
    return 'estado-aprobado';
  }
  if (normalized.includes('rechaz')) {
    return 'estado-rechazado';
  }
  if (normalized.includes('creada')) {
    return 'estado-creada';
  }
  if (normalized.includes('creacion')) {
    return 'estado-creacion';
  }

  return 'estado-espera';
};

// Convierte rutas relativas del backend (/media/...) en URL absoluta.
const toAbsoluteBackendUrl = (url) => {
  if (!url) {
    return null;
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
  const backendOrigin = apiBase.replace(/\/api\/?$/, '');
  const normalizedPath = String(url).startsWith('/') ? url : `/${url}`;

  return `${backendOrigin}${normalizedPath}`;
};

// Plantilla vacía reutilizable para limpiar formulario de edición de aspirantes.
const emptyEditForm = {
  aspiranteId: '',
  firstName: '',
  lastName: '',
  documentType: 'CC',
  documentNumber: '',
  phone: '',
  email: '',
  caracterizacion: ''
};

const ConsultarSolicitudesPage = () => {
  // Datos del usuario para personalizar el título por rol.
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  // Estado principal: datos, carga y errores.
  const [solicitudes, setSolicitudes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filtros de búsqueda de la tabla.
  const [filters, setFilters] = useState({
    programa: '',
    area: '',
    estado: '',
    fecha: ''
  });

  // Estado de modal para gestión de aspirantes.
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');
  const [activeSolicitud, setActiveSolicitud] = useState(null);
  const [aspirantes, setAspirantes] = useState([]);
  const [aspirantesResumen, setAspirantesResumen] = useState(null);
  const [aspirantesCatalogs, setAspirantesCatalogs] = useState({ documentTypes: [], caracterizaciones: [] });

  // Estado de edición dentro del modal.
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editPdf, setEditPdf] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingAspiranteId, setDeletingAspiranteId] = useState('');
  const [deleteConfirmAspiranteId, setDeleteConfirmAspiranteId] = useState('');
  const [viewingDocsSolicitudId, setViewingDocsSolicitudId] = useState('');
  const [downloadingSofiaSolicitudId, setDownloadingSofiaSolicitudId] = useState('');
  const [sendingToCoordinatorId, setSendingToCoordinatorId] = useState('');
  const [sendingDirectToFuncionarioId, setSendingDirectToFuncionarioId] = useState('');
  const [sendingToFuncionarioId, setSendingToFuncionarioId] = useState('');
  const [coordinadorObservaciones, setCoordinadorObservaciones] = useState({});
  const [coordinadorDecisiones, setCoordinadorDecisiones] = useState({});
  const [estadoFichaOptions, setEstadoFichaOptions] = useState([]);
  const [funcionarioDraftBySolicitud, setFuncionarioDraftBySolicitud] = useState({});
  const [savingFuncionarioSolicitudId, setSavingFuncionarioSolicitudId] = useState('');
  const [sofiaFilesBySolicitud, setSofiaFilesBySolicitud] = useState({});

  // Define rol efectivo: si es admin, puede alternar vista por query param.
  const userRole = String(user?.role || '').toLowerCase();
  const requestedVista = String(searchParams.get('vista') || '').toLowerCase();
  const adminVista = ['instructor', 'coordinador', 'funcionario'].includes(requestedVista)
    ? requestedVista
    : 'instructor';
  const effectiveRole = userRole === 'admin' ? adminVista : userRole;

  const roleLabelByKey = {
    instructor: 'Instructor',
    coordinador: 'Coordinador',
    funcionario: 'Funcionario',
    admin: 'Administrador'
  };

  const roleLabel = roleLabelByKey[effectiveRole] || user?.roleLabel || 'Usuario';
  const isCoordinatorView = effectiveRole === 'coordinador';
  const isFuncionarioView = effectiveRole === 'funcionario';
  const isInstructorView = effectiveRole === 'instructor';
  const canDecideAsCoordinator = effectiveRole === 'coordinador';
  // Permisos para abrir el modal de gestión según política actual.
  const canManageAspirantes = effectiveRole === 'instructor';
  const canViewAspirantesResources = canManageAspirantes || isCoordinatorView || isFuncionarioView;
  const canOperateFuncionarioActions = isFuncionarioView && userRole === 'funcionario';
  const showAspirantesColumn = !isCoordinatorView && !isFuncionarioView;
  const showInscripcionColumn = !isCoordinatorView && !isFuncionarioView;

  // Calcula columnas dinámicas para mantener colSpan correcto en estado vacío.
  const tableColumnCount = useMemo(() => {
    let total = 9;
    if (!isCoordinatorView) {
      total += 1;
      total += 2;
    }
    if (showAspirantesColumn) {
      total += 1;
    }
    if (showInscripcionColumn) {
      total += 1;
    }
    if (isFuncionarioView) {
      total += 1;
      total += 1;
    }
    if (canDecideAsCoordinator) {
      total += 1;
    }

    return total;
  }, [isCoordinatorView, showAspirantesColumn, showInscripcionColumn, isFuncionarioView, canDecideAsCoordinator]);

  // Carga principal de solicitudes para la tabla de consulta.
  const loadSolicitudes = async () => {
    try {
      setError('');
      const payload = await fetchSolicitudesConsulta();
      const rows = payload?.solicitudes || [];
      setSolicitudes(rows);
      setEstadoFichaOptions(payload?.catalogs?.estadosFicha || []);
      setFuncionarioDraftBySolicitud(() => {
        const next = {};
        for (const item of rows) {
          const key = String(item.id);
          next[key] = {
            estadoFichaId: item.estadoFichaId || '',
            codigoSolicitud: item.codigoSolicitud ?? '',
            codigoFicha: item.codigoFicha ?? '',
            observacionFuncionario: item.observacionFuncionarioActual || ''
          };
        }

        return next;
      });
    } catch (requestError) {
      const message = requestError?.response?.data?.message || 'No se pudieron cargar las solicitudes';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Carga inicial de solicitudes al montar la página.
    loadSolicitudes();
  }, []);

  // useMemo evita recalcular el filtrado en renders que no cambian datos/filtros.
  const filteredSolicitudes = useMemo(() => {
    return solicitudes.filter((item) => {
      // Filtro por nombre de programa (contiene texto).
      const matchPrograma = item.nombrePrograma
        .toLowerCase()
        .includes(filters.programa.trim().toLowerCase());

      // Filtro por área de programa.
      const matchArea =
        !filters.area ||
        String(item.areaPrograma || '').toLowerCase() === String(filters.area || '').toLowerCase();

      // Filtro por estado actual de la solicitud.
      const matchEstado =
        !filters.estado ||
        String(item.estado || '').toLowerCase() === String(filters.estado || '').toLowerCase();

      // Filtro exacto por fecha de solicitud.
      const matchFecha = !filters.fecha || toDateInput(item.fechaSolicitud) === filters.fecha;

      return matchPrograma && matchArea && matchEstado && matchFecha;
    });
  }, [solicitudes, filters]);

    // Catálogo de áreas derivado de los datos cargados.
  const areaOptions = useMemo(() => {
    const values = Array.from(new Set(
      solicitudes
        .map((item) => String(item.areaPrograma || '').trim())
        .filter(Boolean)
    ));

    return values.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [solicitudes]);

  // Catálogo de estados derivado de los datos cargados.
  const estadoOptions = useMemo(() => {
    const values = Array.from(new Set(
      solicitudes
        .map((item) => String(item.estado || '').trim())
        .filter(Boolean)
    ));

    return values.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [solicitudes]);

  const closeModal = () => {
    // Limpia estado transitorio del modal para evitar arrastre entre solicitudes.
    setModalOpen(false);
    setModalError('');
    setModalSuccess('');
    setActiveSolicitud(null);
    setAspirantes([]);
    setAspirantesResumen(null);
    setAspirantesCatalogs({ documentTypes: [], caracterizaciones: [] });
    setEditForm(emptyEditForm);
    setEditPdf(null);
    setDeletingAspiranteId('');
    setDeleteConfirmAspiranteId('');
  };

  const loadAspirantesModal = async (solicitud) => {
    // Obtiene inscritos + catálogos dinámicos para edición desde el modal.
    try {
      setModalLoading(true);
      setModalError('');
      setModalSuccess('');
      const payload = await fetchAspirantesBySolicitud(solicitud.id);
      setAspirantes(payload.aspirantes || []);
      setAspirantesResumen(payload.solicitud || null);
      setAspirantesCatalogs(payload.catalogs || { documentTypes: [], caracterizaciones: [] });
      setActiveSolicitud(solicitud);
      setModalOpen(true);
    } catch (requestError) {
      setModalError(requestError?.response?.data?.message || 'No se pudo cargar el listado de aspirantes');
      setModalOpen(true);
    } finally {
      setModalLoading(false);
    }
  };

  const startEdit = (aspirante) => {
    // Precarga formulario de edición con datos del aspirante seleccionado.
    if (aspirantesResumen?.gestionBloqueada) {
      return;
    }

    setModalError('');
    setModalSuccess('');
    setEditPdf(null);
    setDeleteConfirmAspiranteId('');
    setEditForm({
      aspiranteId: aspirante.id,
      firstName: aspirante.firstName || '',
      lastName: aspirante.lastName || '',
      documentType: aspirante.documentType || 'CC',
      documentNumber: aspirante.documentNumber || '',
      phone: aspirante.phone || '',
      email: aspirante.email || '',
      caracterizacion: aspirante.caracterizacion || ''
    });
  };

  const reloadActiveAspirantes = async () => {
    // Refresca modal después de editar/eliminar sin cerrarlo.
    if (!activeSolicitud?.id) {
      return;
    }

    const payload = await fetchAspirantesBySolicitud(activeSolicitud.id);
    setAspirantes(payload.aspirantes || []);
    setAspirantesResumen(payload.solicitud || null);
    setAspirantesCatalogs(payload.catalogs || { documentTypes: [], caracterizaciones: [] });
  };

  const handleSaveEdit = async (event) => {
    // Actualiza aspirante con opción de reemplazar el PDF de identidad.
    event.preventDefault();
    if (aspirantesResumen?.gestionBloqueada) {
      return;
    }

    if (!activeSolicitud?.id || !editForm.aspiranteId) {
      return;
    }

    try {
      setSavingEdit(true);
      setModalError('');
      setModalSuccess('');

      const payload = new FormData();
      // Formato multipart requerido por backend para campo de archivo.
      payload.append('firstName', editForm.firstName);
      payload.append('lastName', editForm.lastName);
      payload.append('documentType', editForm.documentType);
      payload.append('documentNumber', editForm.documentNumber);
      payload.append('phone', editForm.phone);
      payload.append('email', editForm.email);
      payload.append('caracterizacion', editForm.caracterizacion);
      if (editPdf) {
        payload.append('documentoIdentidadPdf', editPdf);
      }

      await updateAspiranteBySolicitud(activeSolicitud.id, editForm.aspiranteId, payload);
      await reloadActiveAspirantes();
      await loadSolicitudes();

      setModalSuccess('Aspirante actualizado correctamente');
      setEditForm(emptyEditForm);
      setEditPdf(null);
    } catch (requestError) {
      setModalError(requestError?.response?.data?.message || 'No se pudo actualizar el aspirante');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteAspirante = async (aspirante) => {
    // Elimina aspirante de la solicitud activa y refresca resumen de cupos.
    if (!activeSolicitud?.id || !aspirante?.id) {
      return;
    }

    try {
      setDeletingAspiranteId(String(aspirante.id));
      setModalError('');
      setModalSuccess('');
      await deleteAspiranteBySolicitud(activeSolicitud.id, aspirante.id);
      await reloadActiveAspirantes();
      await loadSolicitudes();
      setModalSuccess('Aspirante eliminado correctamente');
      setDeleteConfirmAspiranteId('');

      if (editForm.aspiranteId === aspirante.id) {
        setEditForm(emptyEditForm);
        setEditPdf(null);
      }
    } catch (requestError) {
      setModalError(requestError?.response?.data?.message || 'No se pudo eliminar el aspirante');
    } finally {
      setDeletingAspiranteId('');
    }
  };

  const handleViewAspirantesDocuments = async (solicitud) => {
    // Abre en nueva pestaña el PDF consolidado de documentos de identidad.
    if (!solicitud?.id) {
      return;
    }

    try {
      setViewingDocsSolicitudId(String(solicitud.id));
      setError('');

      const pdfBlob = await fetchAspirantesDocumentosPdf(solicitud.id);
      const blobUrl = window.URL.createObjectURL(pdfBlob);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo abrir el PDF consolidado de documentos de identidad');
    } finally {
      setViewingDocsSolicitudId('');
    }
  };

  const handleSendToCoordinator = async (solicitud) => {
    // Envía solicitud desde instructor hacia coordinación académica.
    if (!solicitud?.id) {
      return;
    }

    try {
      setSendingToCoordinatorId(String(solicitud.id));
      setError('');
      setSuccess('');
      const response = await sendSolicitudToCoordinator(solicitud.id);
      await loadSolicitudes();
      setSuccess(response?.message || 'Solicitud enviada al coordinador correctamente');

      if (activeSolicitud?.id === solicitud.id) {
        await reloadActiveAspirantes();
      }
    } catch (requestError) {
      setSuccess('');
      setError(requestError?.response?.data?.message || 'No se pudo enviar la solicitud al coordinador');
    } finally {
      setSendingToCoordinatorId('');
    }
  };

  const getCoordinadorObservacion = (solicitud) => {
    // Prioriza borrador local de observación sobre valor persistido.
    const key = String(solicitud?.id || '');
    if (!key) {
      return '';
    }

    if (Object.prototype.hasOwnProperty.call(coordinadorObservaciones, key)) {
      return coordinadorObservaciones[key];
    }

    return solicitud?.observacionCoordinador || '';
  };

  const getCoordinadorDecision = (solicitud) => {
    // Obtiene decisión local (si existe) o decisión actual persistida.
    const key = String(solicitud?.id || '');
    if (!key) {
      return '';
    }

    if (Object.prototype.hasOwnProperty.call(coordinadorDecisiones, key)) {
      return coordinadorDecisiones[key];
    }

    const current = String(solicitud?.decisionCoordinadorActual || '').toLowerCase();
    if (current === 'aprobado' || current === 'rechazado') {
      return current;
    }

    return '';
  };

  const getFuncionarioDraft = (solicitud) => {
    // Devuelve borrador local de funcionario con fallback a datos actuales.
    const key = String(solicitud?.id || '');
    if (!key) {
      return {
        estadoFichaId: '',
        codigoSolicitud: '',
        codigoFicha: '',
        observacionFuncionario: ''
      };
    }

    if (Object.prototype.hasOwnProperty.call(funcionarioDraftBySolicitud, key)) {
      return funcionarioDraftBySolicitud[key];
    }

    return {
      estadoFichaId: solicitud?.estadoFichaId || '',
      codigoSolicitud: solicitud?.codigoSolicitud ?? '',
      codigoFicha: solicitud?.codigoFicha ?? '',
      observacionFuncionario: solicitud?.observacionFuncionarioActual || ''
    };
  };

  const handleFuncionarioDraftChange = (solicitud, field, value) => {
    // Actualiza un campo puntual del borrador de funcionario por solicitud.
    const key = String(solicitud?.id || '');
    if (!key) {
      return;
    }

    setFuncionarioDraftBySolicitud((prev) => ({
      ...prev,
      [key]: {
        ...getFuncionarioDraft(solicitud),
        [field]: value
      }
    }));
  };

  const handleSendFuncionarioChanges = async (solicitud) => {
    // Envía cambios de funcionario (estado/códigos/observación/archivo SOFiA).
    if (!solicitud?.id) {
      return;
    }

    const key = String(solicitud.id);
    const draft = getFuncionarioDraft(solicitud);
    const file = sofiaFilesBySolicitud[key];

    try {
      setSavingFuncionarioSolicitudId(key);
      setError('');
      setSuccess('');

      const payload = new FormData();
      payload.append('estadoFichaId', draft.estadoFichaId || '');
      payload.append('codigoSolicitud', draft.codigoSolicitud ?? '');
      payload.append('codigoFicha', draft.codigoFicha ?? '');
      payload.append('observacionFuncionario', draft.observacionFuncionario || '');
      if (file) {
        payload.append('sofiaPlusExcel', file);
      }

      const response = await updateSolicitudByFuncionario(solicitud.id, payload);
      await loadSolicitudes();
      setSofiaFilesBySolicitud((prev) => ({ ...prev, [key]: null }));
      setSuccess(response?.message || 'Solicitud enviada por funcionario correctamente');
    } catch (requestError) {
      setSuccess('');
      setError(requestError?.response?.data?.message || 'No se pudo enviar la gestión del funcionario');
    } finally {
      setSavingFuncionarioSolicitudId('');
    }
  };

  const handleSelectSofiaFile = (solicitud, file) => {
    // Guarda temporalmente el archivo SOFiA seleccionado por fila.
    const key = String(solicitud?.id || '');
    if (!key) {
      return;
    }

    setSofiaFilesBySolicitud((prev) => ({
      ...prev,
      [key]: file || null
    }));
  };

  const handleSendToFuncionario = async (solicitud) => {
    // Envía decisión de coordinación (aprobado/rechazado) al funcionario.
    if (!solicitud?.id) {
      return;
    }

    const observacion = getCoordinadorObservacion(solicitud).trim();
    const decision = getCoordinadorDecision(solicitud);

    if (!decision) {
      setError('Debe seleccionar una decisión: Aprobado o Rechazado');
      return;
    }

    if (!observacion) {
      setError('Debe escribir una observación para enviar la decisión');
      return;
    }

    try {
      setSendingToFuncionarioId(String(solicitud.id));
      setError('');
      setSuccess('');
      const response = await sendSolicitudToFuncionario(solicitud.id, { observacion, decision });
      await loadSolicitudes();
      setSuccess(response?.message || 'Decisión enviada correctamente');
    } catch (requestError) {
      setSuccess('');
      setError(requestError?.response?.data?.message || 'No se pudo enviar la decisión de coordinación');
    } finally {
      setSendingToFuncionarioId('');
    }
  };

  const handleDownloadSofiaPlus = async (solicitud) => {
    // Descarga el Excel de inscripción masiva para cargue en SOFiA Plus.
    if (!solicitud?.id) {
      return;
    }

    try {
      setDownloadingSofiaSolicitudId(String(solicitud.id));
      setError('');

      const fileBlob = await fetchSolicitudSofiaPlus(solicitud.id);
      const blobUrl = window.URL.createObjectURL(fileBlob);
      const safeCode = String(solicitud.codigoSolicitud || solicitud.id || 'solicitud').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `sofia_plus_${safeCode}.xlsx`;

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo descargar el archivo SOFiA Plus');
    } finally {
      setDownloadingSofiaSolicitudId('');
    }
  };

  const handleSendDirectToFuncionario = async (solicitud) => {
    // Reenvía directamente al funcionario (flujo administrativo especial).
    if (!solicitud?.id) {
      return;
    }

    try {
      setSendingDirectToFuncionarioId(String(solicitud.id));
      setError('');
      setSuccess('');
      const response = await sendSolicitudDirectToFuncionario(solicitud.id);
      await loadSolicitudes();
      setSuccess(response?.message || 'Solicitud reenviada directamente al funcionario');
    } catch (requestError) {
      setSuccess('');
      setError(requestError?.response?.data?.message || 'No se pudo reenviar la solicitud al funcionario');
    } finally {
      setSendingDirectToFuncionarioId('');
    }
  };

  return (
    <PortalLayout>
      <div className="titulo-seccion">
        <h2 className="titulo-pagina">Consultar solicitudes {roleLabel}</h2>
        <p className="subtitulo-pagina">
          Aquí puede consultar el estado de las fichas solicitadas y gestionar la inscripción de aspirantes.
        </p>
      </div>

      {error ? (
        <div className="alertas">
          <div className="alert alert-error">{error}</div>
        </div>
      ) : null}

      {success ? (
        <div className="alertas">
          <div className="alert alert-success">{success}</div>
        </div>
      ) : null}

      <div className="filtros-busqueda">
        <div className="filtro-nombre-programa">
          <label htmlFor="filtro-programa">Filtrar por Nombre de Programa:</label>
          <input
            id="filtro-programa"
            type="text"
            value={filters.programa}
            onChange={(event) => setFilters((prev) => ({ ...prev, programa: event.target.value }))}
            placeholder="Ingrese el nombre del programa"
          />
        </div>

        <div className="filtro-area-programa">
          <label htmlFor="filtro-area">Filtrar por Área:</label>
          <select
            id="filtro-area"
            value={filters.area}
            onChange={(event) => setFilters((prev) => ({ ...prev, area: event.target.value }))}
          >
            <option value="">-- Todos --</option>
            {areaOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        <div className="filtro-estado-solicitud">
          <label htmlFor="filtro-estado">Filtrar por Estado:</label>
          <select
            id="filtro-estado"
            value={filters.estado}
            onChange={(event) => setFilters((prev) => ({ ...prev, estado: event.target.value }))}
          >
            <option value="">-- Todos --</option>
            {estadoOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        <div className="filtro-fecha">
          <label htmlFor="filtro-fecha-general">Filtrar por Fecha:</label>
          <input
            id="filtro-fecha-general"
            type="date"
            value={filters.fecha}
            onChange={(event) => setFilters((prev) => ({ ...prev, fecha: event.target.value }))}
          />
        </div>
      </div>

      {loading ? (
        <div className="estado-carga">Cargando solicitudes...</div>
      ) : (
        <div className="contenedor-tabla-fichas">
          <table className="tabla-fichas">
            <thead>
              <tr>
                <th>Nombre del Programa</th>
                <th>Área</th>
                {isFuncionarioView ? <th>Coordinador aprobador</th> : null}
                <th>Estado de Solicitud</th>
                {!isCoordinatorView ? <th>{isFuncionarioView ? 'Observación coordinador' : 'Observación funcionario'}</th> : null}
                <th>Ficha de Caracterización</th>
                <th>Documentos aspirantes</th>
                <th>Carta de solicitud</th>
                <th>Formato de Inscripción masiva</th>
                <th>Formato de Inscripción masiva (SOFiA Plus)</th>
                {showAspirantesColumn ? <th>Aspirantes</th> : null}
                {showInscripcionColumn ? <th>Inscripción pública</th> : null}
                <th>Fecha de Creación</th>
                {!isCoordinatorView ? <th>Código de solicitud</th> : null}
                {!isCoordinatorView ? <th>Código de ficha</th> : null}
                {isFuncionarioView ? <th>Observación</th> : null}
                {canDecideAsCoordinator ? <th>Observación</th> : null}
                <th>Enviar</th>
              </tr>
            </thead>
            <tbody>
              {filteredSolicitudes.map((item) => {
                // Reglas por fila para habilitar/deshabilitar acciones según rol/estado.
                const inscripcionAbierta = !item.inscripcionCerrada;
                const envioEnProceso = sendingToCoordinatorId === String(item.id);
                const envioDirectoFuncionarioEnProceso = sendingDirectToFuncionarioId === String(item.id);
                const envioFuncionarioEnProceso = sendingToFuncionarioId === String(item.id);
                const guardadoFuncionarioEnProceso = savingFuncionarioSolicitudId === String(item.id);
                const gestionBloqueada = Boolean(item.gestionAspirantesBloqueada);
                const bloqueadaPorMatriculada =
                  Boolean(item.bloqueadaPorMatriculada)
                  || String(item.estado || '').toLowerCase().includes('matriculad');
                const puedeEnviarCoordinador = Boolean(canManageAspirantes && item.puedeEnviarCoordinador && !gestionBloqueada);
                const observacionValue = getCoordinadorObservacion(item);
                const observacionValida = observacionValue.trim().length > 0;
                const decisionValue = getCoordinadorDecision(item);
                const decisionValida = decisionValue === 'aprobado' || decisionValue === 'rechazado';
                const funcionarioDraft = getFuncionarioDraft(item);
                const tieneArchivoSofiaNuevo = Boolean(sofiaFilesBySolicitud[String(item.id)]);
                const puedeDecidirCoordinacion = Boolean(
                  canDecideAsCoordinator
                  && (item.puedeEnviarFuncionario || item.enviadoFuncionario || item.decisionCoordinadorActual === 'pendiente')
                );
                return (
                  <tr key={item.id}>
                    <td>{item.nombrePrograma}</td>
                    <td>{item.areaPrograma || 'Sin área'}</td>
                    {isFuncionarioView ? <td>{item.coordinadorAprobador || 'Sin coordinador aprobador'}</td> : null}
                    <td>
                      {isFuncionarioView ? (
                        <select
                          className="entrada-select decision-en-estado"
                          value={funcionarioDraft.estadoFichaId || ''}
                          onChange={(event) => handleFuncionarioDraftChange(item, 'estadoFichaId', event.target.value)}
                          disabled={guardadoFuncionarioEnProceso || bloqueadaPorMatriculada || !canOperateFuncionarioActions}
                        >
                          <option value="">Seleccione estado de ficha</option>
                          {estadoFichaOptions.map((estadoFicha) => (
                            <option key={estadoFicha.id} value={estadoFicha.id}>{estadoFicha.nombre}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={getEstadoClass(item.estado)}>{item.estado}</span>
                      )}
                      {puedeDecidirCoordinacion && !isFuncionarioView ? (
                        <select
                          className="entrada-select decision-en-estado"
                          value={decisionValue}
                          onChange={(event) => {
                            const key = String(item.id);
                            const value = event.target.value;
                            setCoordinadorDecisiones((prev) => ({ ...prev, [key]: value }));
                          }}
                          disabled={Boolean(item.enviadoFuncionario)}
                        >
                          <option value="">Seleccione decisión</option>
                          <option value="aprobado">Aprobado</option>
                          <option value="rechazado">Rechazado</option>
                        </select>
                      ) : null}
                    </td>
                    {!isCoordinatorView ? <td>{isFuncionarioView ? (item.observacionCoordinador || 'Sin observación') : (item.observacionFuncionario || 'Sin observación')}</td> : null}
                    <td>
                      {item.fichaCaracterizacionUrl ? (
                        <Link to={item.fichaCaracterizacionUrl} className="boton-descargar">
                          Ver ficha de caracterización
                        </Link>
                      ) : (
                        <span className="boton-descargar disabled-link">No disponible</span>
                      )}
                    </td>
                    <td>
                      {canViewAspirantesResources ? (
                        <button
                          type="button"
                          className="boton-descargar boton-mini boton-columna"
                          onClick={() => handleViewAspirantesDocuments(item)}
                          disabled={viewingDocsSolicitudId === String(item.id)}
                        >
                          {viewingDocsSolicitudId === String(item.id) ? 'Abriendo...' : 'Ver documentos'}
                        </button>
                      ) : (
                        <span className="boton-descargar disabled-link">No disponible</span>
                      )}
                    </td>
                    <td>
                      {item.cartaUrl ? (
                        <a href={toAbsoluteBackendUrl(item.cartaUrl)} target="_blank" rel="noreferrer" className="boton-descargar">
                          Ver carta de solicitud
                        </a>
                      ) : (
                        <span className="boton-descargar disabled-link">No disponible</span>
                      )}
                    </td>
                    <td>
                      {canViewAspirantesResources ? (
                        <Link to={`/solicitudes/consultar/${item.id}/formato-inscripcion`} className="boton-descargar">
                          Ver formato Excel
                        </Link>
                      ) : (
                        <span className="boton-descargar disabled-link">No disponible</span>
                      )}
                    </td>
                    <td>
                      {isFuncionarioView ? (
                        bloqueadaPorMatriculada ? (
                          item.tieneExcelSofiaPlus ? (
                            <button
                              type="button"
                              className="boton-descargar boton-mini boton-columna"
                              onClick={() => handleDownloadSofiaPlus(item)}
                              disabled={downloadingSofiaSolicitudId === String(item.id)}
                            >
                              {downloadingSofiaSolicitudId === String(item.id) ? 'Descargando...' : 'Descargar'}
                            </button>
                          ) : (
                            <span className="boton-descargar disabled-link">No disponible</span>
                          )
                        ) : (
                          <div className="sofia-upload-cell">
                            <input
                              type="file"
                              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                              className="input-file-sofia"
                              disabled={!canOperateFuncionarioActions}
                              onChange={(event) => handleSelectSofiaFile(item, event.target.files?.[0] || null)}
                            />
                            <span className="texto-ayuda-sofia">
                              {tieneArchivoSofiaNuevo
                                ? 'Archivo listo para enviar'
                                : item.tieneExcelSofiaPlus
                                  ? 'Archivo cargado'
                                  : 'Seleccione archivo'}
                            </span>
                          </div>
                        )
                      ) : isInstructorView ? (
                        item.tieneExcelSofiaPlus ? (
                          <button
                            type="button"
                            className="boton-descargar boton-mini boton-columna"
                            onClick={() => handleDownloadSofiaPlus(item)}
                            disabled={downloadingSofiaSolicitudId === String(item.id)}
                          >
                            {downloadingSofiaSolicitudId === String(item.id) ? 'Descargando...' : 'Descargar'}
                          </button>
                        ) : (
                          <span className="boton-descargar disabled-link">No disponible</span>
                        )
                      ) : (
                        <span className="boton-descargar disabled-link">No disponible</span>
                      )}
                    </td>
                    {showAspirantesColumn ? (
                      <td>
                        <div className="aspirantes-cell">
                          <span className="aspirantes-counter">{item.cantidadAspirantes || 0} / {item.cupo || 0}</span>
                          {canManageAspirantes ? (
                            <button
                              type="button"
                              className="boton-descargar boton-mini"
                              onClick={() => loadAspirantesModal(item)}
                              disabled={gestionBloqueada}
                            >
                              {gestionBloqueada ? 'Bloqueado' : 'Gestionar'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                    {showInscripcionColumn ? (
                      <td>
                        {inscripcionAbierta ? (
                          <a href={item.linkInscripcionPublica} target="_blank" rel="noreferrer" className="boton-descargar">
                            Abrir enlace
                          </a>
                        ) : (
                          <span className="boton-descargar disabled-link">Cupo agotado</span>
                        )}
                      </td>
                    ) : null}
                    <td>{formatDate(item.fechaSolicitud)}</td>
                    {!isCoordinatorView ? (
                      <td>
                        {isFuncionarioView ? (
                          <input
                            type="number"
                            className="input-tabla-numero"
                            value={funcionarioDraft.codigoSolicitud ?? ''}
                            onChange={(event) => handleFuncionarioDraftChange(item, 'codigoSolicitud', event.target.value)}
                            disabled={guardadoFuncionarioEnProceso || bloqueadaPorMatriculada || !canOperateFuncionarioActions}
                            placeholder="Sin código"
                          />
                        ) : (
                          item.codigoSolicitud || 'Sin código'
                        )}
                      </td>
                    ) : null}
                    {!isCoordinatorView ? (
                      <td>
                        {isFuncionarioView ? (
                          <input
                            type="number"
                            className="input-tabla-numero"
                            value={funcionarioDraft.codigoFicha ?? ''}
                            onChange={(event) => handleFuncionarioDraftChange(item, 'codigoFicha', event.target.value)}
                            disabled={guardadoFuncionarioEnProceso || bloqueadaPorMatriculada || !canOperateFuncionarioActions}
                            placeholder="Sin ficha"
                          />
                        ) : (
                          item.codigoFicha || 'Sin ficha'
                        )}
                      </td>
                    ) : null}
                    {isFuncionarioView ? (
                      <td>
                        <textarea
                          className="entrada-textarea observacion-expandible"
                          rows={2}
                          value={funcionarioDraft.observacionFuncionario || ''}
                          onChange={(event) => handleFuncionarioDraftChange(item, 'observacionFuncionario', event.target.value)}
                          placeholder="Observación de funcionario (obligatoria para rechazada)"
                          disabled={guardadoFuncionarioEnProceso || bloqueadaPorMatriculada || !canOperateFuncionarioActions}
                        />
                      </td>
                    ) : null}
                    {canDecideAsCoordinator ? (
                      <td>
                        {puedeDecidirCoordinacion ? (
                          <textarea
                            className="entrada-textarea observacion-expandible"
                            rows={2}
                            value={observacionValue}
                            onChange={(event) => {
                              const key = String(item.id);
                              const value = event.target.value;
                              setCoordinadorObservaciones((prev) => ({ ...prev, [key]: value }));
                            }}
                            placeholder="Escriba observación para enviar la decisión"
                            disabled={Boolean(item.enviadoFuncionario)}
                          />
                        ) : (
                          <span>{item.observacionCoordinador || 'Sin observación'}</span>
                        )}
                      </td>
                    ) : null}
                    <td>
                      {puedeDecidirCoordinacion ? (
                        item.enviadoFuncionario ? (
                          <span className="boton-descargar disabled-link">Enviado</span>
                        ) : !item.puedeEnviarFuncionario ? (
                          <span className="boton-descargar disabled-link">Enviar</span>
                        ) : (
                          <button
                            type="button"
                            className="boton-descargar boton-mini boton-columna"
                            onClick={() => handleSendToFuncionario(item)}
                            disabled={envioFuncionarioEnProceso || !observacionValida || !decisionValida}
                          >
                            {envioFuncionarioEnProceso ? 'Enviando...' : 'Enviar'}
                          </button>
                        )
                      ) : isFuncionarioView ? (
                        !canOperateFuncionarioActions ? (
                          <span className="boton-descargar disabled-link">No disponible</span>
                        ) : (
                        bloqueadaPorMatriculada ? (
                          <span className="boton-descargar disabled-link">Enviar</span>
                        ) : (
                          <button
                            type="button"
                            className="boton-descargar boton-mini boton-columna"
                            onClick={() => handleSendFuncionarioChanges(item)}
                            disabled={guardadoFuncionarioEnProceso || !funcionarioDraft.estadoFichaId}
                          >
                            {guardadoFuncionarioEnProceso ? 'Enviando...' : 'Enviar'}
                          </button>
                        )
                        )
                      ) : item.puedeReenviarDirectoFuncionario ? (
                        <button
                          type="button"
                          className="boton-descargar boton-mini boton-columna"
                          onClick={() => handleSendDirectToFuncionario(item)}
                          disabled={envioDirectoFuncionarioEnProceso}
                        >
                          {envioDirectoFuncionarioEnProceso ? 'Enviando...' : 'Enviar'}
                        </button>
                      ) : canManageAspirantes ? (
                        item.enviadoCoordinador ? (
                          <span className="boton-descargar disabled-link">Enviado</span>
                        ) : !item.puedeEnviarCoordinador ? (
                          <span className="boton-descargar disabled-link">Enviar</span>
                        ) : (
                          <button
                            type="button"
                            className="boton-descargar boton-mini boton-columna"
                            onClick={() => handleSendToCoordinator(item)}
                            disabled={envioEnProceso || !puedeEnviarCoordinador}
                          >
                            {envioEnProceso ? 'Enviando...' : 'Enviar'}
                          </button>
                        )
                      ) : (
                        <span className="boton-descargar disabled-link">No disponible</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!filteredSolicitudes.length ? (
                <tr>
                  <td colSpan={tableColumnCount} className="celda-vacia-consultas">
                    No hay solicitudes para mostrar con los filtros actuales.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        // Modal de inscritos por solicitud: ver documento, editar y eliminar.
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-contenido aspirantes-modal">
            <button type="button" className="cerrar-modal" onClick={closeModal}>&times;</button>
            <h3>Aspirantes inscritos</h3>

            {activeSolicitud ? (
              <p className="aspirantes-modal-subtitle">
                 {activeSolicitud.nombrePrograma}
              </p>
            ) : null}

            {aspirantesResumen ? (
              <p className="aspirantes-modal-subtitle">
                {aspirantesResumen.gestionBloqueada
                  ? 'Solicitud enviada a coordinador: la gestión de aspirantes está bloqueada.'
                  : 'Puede gestionar aspirantes mientras la solicitud no haya sido enviada a coordinación.'}
              </p>
            ) : null}

            {modalLoading ? <div className="estado-carga">Cargando aspirantes...</div> : null}

            {modalError ? (
              <div className="alertas">
                <div className="alert alert-error">{modalError}</div>
              </div>
            ) : null}

            {modalSuccess ? (
              <div className="alertas">
                <div className="alert alert-success">{modalSuccess}</div>
              </div>
            ) : null}

            {!modalLoading ? (
              <div className="aspirantes-modal-list">
                {aspirantes.length ? aspirantes.map((aspirante) => (
                  <div key={aspirante.id} className="aspirante-item">
                    <div className="aspirante-main">
                      <strong>{aspirante.name}</strong>
                      <span>{aspirante.documentType} {aspirante.documentNumber}</span>
                      <span>Tel: {aspirante.phone}</span>
                      <span>Correo: {aspirante.email}</span>
                      <span>Caracterización: {aspirante.caracterizacion}</span>
                    </div>
                    <div className="aspirante-actions">
                      {aspirante.documentUrl ? (
                        <a
                          href={toAbsoluteBackendUrl(aspirante.documentUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="boton-descargar boton-mini"
                        >
                          Ver documento
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="boton-descargar boton-mini"
                        onClick={() => startEdit(aspirante)}
                        disabled={Boolean(aspirantesResumen?.gestionBloqueada)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="boton-descargar boton-mini boton-peligro"
                        onClick={() => {
                          setModalError('');
                          setModalSuccess('');
                          setDeleteConfirmAspiranteId(String(aspirante.id));
                        }}
                        disabled={deletingAspiranteId === String(aspirante.id) || Boolean(aspirantesResumen?.gestionBloqueada)}
                      >
                        Eliminar
                      </button>
                    </div>

                    {deleteConfirmAspiranteId === String(aspirante.id) ? (
                      <div className="aspirante-delete-alert">
                        <span>¿Eliminar a {aspirante.name || 'este aspirante'}?</span>
                        <div className="aspirante-delete-actions">
                          <button
                            type="button"
                            className="boton-descargar boton-mini boton-peligro"
                            onClick={() => handleDeleteAspirante(aspirante)}
                            disabled={deletingAspiranteId === String(aspirante.id) || Boolean(aspirantesResumen?.gestionBloqueada)}
                          >
                            {deletingAspiranteId === String(aspirante.id) ? 'Eliminando...' : 'Confirmar eliminación'}
                          </button>
                          <button
                            type="button"
                            className="boton-cancelar"
                            onClick={() => setDeleteConfirmAspiranteId('')}
                            disabled={deletingAspiranteId === String(aspirante.id) || Boolean(aspirantesResumen?.gestionBloqueada)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {editForm.aspiranteId === aspirante.id ? (
                      <form onSubmit={handleSaveEdit} className="aspirante-edit-form">
                        <h4>Editar aspirante</h4>
                        <div className="fila-campos-2">
                          <div className="campo-formulario">
                            <label htmlFor="edit-firstName">Nombres</label>
                            <input
                              id="edit-firstName"
                              className="entrada-select"
                              value={editForm.firstName}
                              onChange={(event) => setEditForm((prev) => ({ ...prev, firstName: event.target.value }))}
                              required
                            />
                          </div>
                          <div className="campo-formulario">
                            <label htmlFor="edit-lastName">Apellidos</label>
                            <input
                              id="edit-lastName"
                              className="entrada-select"
                              value={editForm.lastName}
                              onChange={(event) => setEditForm((prev) => ({ ...prev, lastName: event.target.value }))}
                              required
                            />
                          </div>
                        </div>
                        <div className="fila-campos-3">
                          <div className="campo-formulario">
                            <label htmlFor="edit-documentType">Tipo documento</label>
                            <select
                              id="edit-documentType"
                              className="entrada-select"
                              value={editForm.documentType}
                              onChange={(event) => setEditForm((prev) => ({ ...prev, documentType: event.target.value }))}
                              required
                            >
                              {aspirantesCatalogs.documentTypes?.map((item) => (
                                <option key={item} value={item}>{item}</option>
                              ))}
                            </select>
                          </div>
                          <div className="campo-formulario">
                            <label htmlFor="edit-documentNumber">Número documento</label>
                            <input
                              id="edit-documentNumber"
                              className="entrada-select"
                              value={editForm.documentNumber}
                              onChange={(event) => setEditForm((prev) => ({ ...prev, documentNumber: event.target.value }))}
                              required
                            />
                          </div>
                          <div className="campo-formulario">
                            <label htmlFor="edit-phone">Teléfono</label>
                            <input
                              id="edit-phone"
                              className="entrada-select"
                              value={editForm.phone}
                              onChange={(event) => setEditForm((prev) => ({ ...prev, phone: event.target.value }))}
                              required
                            />
                          </div>
                        </div>

                        <div className="fila-campos-2">
                          <div className="campo-formulario">
                            <label htmlFor="edit-email">Correo</label>
                            <input
                              id="edit-email"
                              type="email"
                              className="entrada-select"
                              value={editForm.email}
                              onChange={(event) => setEditForm((prev) => ({ ...prev, email: event.target.value }))}
                              required
                            />
                          </div>
                          <div className="campo-formulario">
                            <label htmlFor="edit-caracterizacion">Caracterización</label>
                            <select
                              id="edit-caracterizacion"
                              className="entrada-select"
                              value={editForm.caracterizacion}
                              onChange={(event) => setEditForm((prev) => ({ ...prev, caracterizacion: event.target.value }))}
                              required
                            >
                              {aspirantesCatalogs.caracterizaciones?.map((item) => (
                                <option key={item} value={item}>{item}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="campo-formulario">
                          <label htmlFor="edit-pdf">Reemplazar documento (PDF opcional)</label>
                          <input
                            id="edit-pdf"
                            type="file"
                            accept="application/pdf,.pdf"
                            onChange={(event) => setEditPdf(event.target.files?.[0] || null)}
                          />
                        </div>

                        <div className="contenedor-botones-formulario">
                          <button type="submit" className="boton-enviar" disabled={savingEdit}>
                            {savingEdit ? 'Guardando...' : 'Guardar cambios'}
                          </button>
                          <button
                            type="button"
                            className="boton-cancelar"
                            onClick={() => {
                              setEditForm(emptyEditForm);
                              setEditPdf(null);
                            }}
                          >
                            Cancelar edición
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                )) : (
                  <div className="celda-vacia-consultas">No hay aspirantes registrados para esta solicitud.</div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </PortalLayout>
  );
};

export default ConsultarSolicitudesPage;
