import { useEffect, useMemo, useRef, useState } from 'react';
import PortalLayout from '../components/PortalLayout';
import { api } from '../api/client';
import {
  createPrograma,
  fetchProgramas,
  updatePrograma,
  updateProgramaEstado
} from '../api/programas';

// Estructura inicial del formulario de creación/edición.
const INITIAL_FORM = {
  codigo: '',
  nombre: '',
  version: '',
  horas: '',
  areaId: '',
  modalidadId: ''
};

// Filtros iniciales para tabla de programas.
const INITIAL_FILTERS = {
  nombre: '',
  areaId: '',
  horas: ''
};

const ProgramasCurricularesPage = () => {
  // Estados globales de carga/guardado y mensajería.
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [catalogs, setCatalogs] = useState({ areas: [], modalidades: [] });
  const [programas, setProgramas] = useState([]);

  const [editingId, setEditingId] = useState('');
  const [showFormModal, setShowFormModal] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const tableContainerRef = useRef(null);
  const topScrollbarRef = useRef(null);
  const topScrollbarInnerRef = useRef(null);
  const syncingScrollRef = useRef(false);

  // Indica si el modal está en modo edición o creación.
  const isEditing = Boolean(editingId);

  // Carga catálogos de solicitud y listado completo de programas.
  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const [catalogsResponse, programasResponse] = await Promise.all([
        api.get('/catalogs/solicitud'),
        fetchProgramas({ includeInactive: true })
      ]);

      setCatalogs({
        areas: catalogsResponse?.data?.areas || [],
        modalidades: catalogsResponse?.data?.modalidades || []
      });
      setProgramas(programasResponse?.programas || []);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo cargar la gestión de programas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Inicializa la vista al montar componente.
    loadData();
  }, []);

  // Limpia formulario y cierra modal.
  const resetForm = () => {
    setEditingId('');
    setForm(INITIAL_FORM);
    setShowFormModal(false);
  };

  // Abre modal en modo crear.
  const onOpenCreate = () => {
    setEditingId('');
    setForm(INITIAL_FORM);
    setError('');
    setSuccess('');
    setShowFormModal(true);
  };

  // Actualiza estado del formulario según input cambiado.
  const onInputChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // Abre modal y precarga datos del programa seleccionado.
  const onEdit = (item) => {
    setEditingId(String(item._id));
    setForm({
      codigo: String(item.codigo || item.legacyId || ''),
      nombre: String(item.nombre || ''),
      version: String(item.version || ''),
      horas: String(item.horas || ''),
      areaId: String(item.area?._id || ''),
      modalidadId: String(item.modalidad?._id || '')
    });
    setError('');
    setSuccess('');
    setShowFormModal(true);
  };

  // Validaciones de negocio mínimas antes de enviar al backend.
  const validateForm = () => {
    if (!String(form.codigo).trim()) {
      return 'El código del programa es obligatorio';
    }

    if (!String(form.nombre).trim()) {
      return 'El nombre del programa es obligatorio';
    }

    if (!String(form.version).trim()) {
      return 'La versión es obligatoria';
    }

    const hours = Number(form.horas);
    if (!Number.isFinite(hours) || hours <= 0) {
      return 'Las horas deben ser un número mayor a 0';
    }

    if (!String(form.areaId).trim() || !String(form.modalidadId).trim()) {
      return 'Debe seleccionar área y modalidad';
    }

    return '';
  };

  // Crea o actualiza programa según el modo activo del formulario.
  const onSubmit = async (event) => {
    event.preventDefault();

    const validationMessage = validateForm();
    if (validationMessage) {
      setError(validationMessage);
      setSuccess('');
      return;
    }

    try {
      setSaving(true);
      setError('');
      setSuccess('');

      const payload = {
        codigo: String(form.codigo).trim(),
        nombre: String(form.nombre).trim(),
        version: String(form.version).trim(),
        horas: Number(form.horas),
        areaId: form.areaId,
        modalidadId: form.modalidadId
      };

      if (isEditing) {
        const response = await updatePrograma(editingId, payload);
        setSuccess(response?.message || 'Programa actualizado correctamente');
      } else {
        const response = await createPrograma(payload);
        setSuccess(response?.message || 'Programa creado correctamente');
      }

      resetForm();
      await loadData();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo guardar el programa');
      setSuccess('');
    } finally {
      setSaving(false);
    }
  };

  // Activa/inactiva programa y refresca el listado.
  const onToggleEstado = async (item) => {
    try {
      setError('');
      setSuccess('');
      await updateProgramaEstado(item._id, !(item.activo !== false));
      setSuccess(item.activo !== false ? 'Programa inactivado correctamente' : 'Programa activado correctamente');
      await loadData();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo actualizar el estado del programa');
    }
  };

  // Ordena programas por nombre para mantener tabla consistente.
  const programasOrdenados = useMemo(() => {
    return [...programas].sort((left, right) => {
      const nombreLeft = String(left?.nombre || '').toLowerCase();
      const nombreRight = String(right?.nombre || '').toLowerCase();
      if (nombreLeft < nombreRight) {
        return -1;
      }
      if (nombreLeft > nombreRight) {
        return 1;
      }
      return 0;
    });
  }, [programas]);

  // Obtiene lista única de horas para el filtro dedicado.
  const uniqueHours = useMemo(() => {
    const allHours = programasOrdenados
      .map((item) => String(item?.horas || '').trim())
      .filter(Boolean);

    return [...new Set(allHours)].sort((left, right) => Number(left) - Number(right));
  }, [programasOrdenados]);

  // Aplica filtros de nombre, área y horas sobre la lista ordenada.
  const programasFiltrados = useMemo(() => {
    const normalizedName = String(filters.nombre || '').trim().toLowerCase();

    return programasOrdenados.filter((item) => {
      const matchNombre = !normalizedName || String(item?.nombre || '').toLowerCase().includes(normalizedName);
      const matchArea = !filters.areaId || String(item?.area?._id || '') === String(filters.areaId);
      const matchHoras = !filters.horas || String(item?.horas || '') === String(filters.horas);
      return matchNombre && matchArea && matchHoras;
    });
  }, [programasOrdenados, filters]);

  // Actualiza el estado de filtros de la tabla.
  const onFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  useEffect(() => {
    // Sincroniza ancho de la barra superior con el ancho real de la tabla.
    const updateTopScrollbarWidth = () => {
      if (!tableContainerRef.current || !topScrollbarInnerRef.current) {
        return;
      }

      topScrollbarInnerRef.current.style.width = `${tableContainerRef.current.scrollWidth}px`;
    };

    updateTopScrollbarWidth();
    window.addEventListener('resize', updateTopScrollbarWidth);

    return () => {
      window.removeEventListener('resize', updateTopScrollbarWidth);
    };
  }, [loading, programasFiltrados.length]);

  // Propaga desplazamiento horizontal de barra superior hacia tabla.
  const onTopScrollbarScroll = () => {
    if (!topScrollbarRef.current || !tableContainerRef.current) {
      return;
    }

    if (syncingScrollRef.current) {
      return;
    }

    syncingScrollRef.current = true;
    tableContainerRef.current.scrollLeft = topScrollbarRef.current.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  };

  // Propaga desplazamiento horizontal de tabla hacia barra superior.
  const onTableContainerScroll = () => {
    if (!tableContainerRef.current || !topScrollbarRef.current) {
      return;
    }

    if (syncingScrollRef.current) {
      return;
    }

    syncingScrollRef.current = true;
    topScrollbarRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  };

  return (
    <PortalLayout>
      <div className="titulo-seccion">
        <h2 className="titulo-pagina">Gestión de programas de formación</h2>
        <p className="subtitulo-pagina">
          Cree, edite y active/inactive programas de formación. El código del programa es obligatorio.
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

      <div className="reportes-actions">
        <button type="button" className="boton-enviar" onClick={onOpenCreate}>
          Crear programa
        </button>
      </div>

      <section className="filtros-busqueda" aria-label="Filtros de programas">
        <div className="filtro-nombre-programa">
          <label htmlFor="filtro-programa-nombre">Filtrar por nombre</label>
          <input
            id="filtro-programa-nombre"
            name="nombre"
            type="text"
            value={filters.nombre}
            onChange={onFilterChange}
            placeholder="Escriba el nombre"
          />
        </div>

        <div className="filtro-area-programa">
          <label htmlFor="filtro-programa-area">Filtrar por área</label>
          <select id="filtro-programa-area" name="areaId" value={filters.areaId} onChange={onFilterChange}>
            <option value="">Todas</option>
            {catalogs.areas.map((item) => (
              <option key={item._id} value={item._id}>{item.nombre}</option>
            ))}
          </select>
        </div>

        <div className="filtro-estado-solicitud">
          <label htmlFor="filtro-programa-horas">Filtrar por horas</label>
          <select id="filtro-programa-horas" name="horas" value={filters.horas} onChange={onFilterChange}>
            <option value="">Todas</option>
            {uniqueHours.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      </section>

      {loading ? (
        <div className="estado-carga">Cargando programas...</div>
      ) : (
        <>
          <div className="programas-scroll-top" ref={topScrollbarRef} onScroll={onTopScrollbarScroll}>
            <div className="programas-scroll-top-inner" ref={topScrollbarInnerRef} />
          </div>

          <div className="contenedor-tabla-fichas" ref={tableContainerRef} onScroll={onTableContainerScroll}>
          <table className="tabla-fichas">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Versión</th>
                <th>Horas</th>
                <th>Área</th>
                <th>Modalidad</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {programasFiltrados.map((item) => (
                <tr key={item._id}>
                  <td>{item.codigo || item.legacyId || ''}</td>
                  <td>{item.nombre}</td>
                  <td>{item.version}</td>
                  <td>{item.horas}</td>
                  <td>{item.area?.nombre || '-'}</td>
                  <td>{item.modalidad?.nombre || '-'}</td>
                  <td>{item.activo !== false ? 'Activo' : 'Inactivo'}</td>
                  <td>
                    <div className="acciones-tabla-gestion">
                      <button type="button" className="boton-descargar boton-mini" onClick={() => onEdit(item)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="boton-descargar boton-mini"
                        onClick={() => onToggleEstado(item)}
                      >
                        {item.activo !== false ? 'Inactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!programasFiltrados.length ? (
                <tr>
                  <td colSpan={8} className="celda-vacia-consultas">
                    No hay programas que coincidan con los filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </>
      )}

      {showFormModal ? (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-contenido reportes-modal programas-modal">
            <button
              type="button"
              className="cerrar-modal"
              onClick={resetForm}
              disabled={saving}
            >
              &times;
            </button>
            <h3>{isEditing ? 'Editar programa' : 'Crear programa'}</h3>

            <form className="programas-modal-form" onSubmit={onSubmit}>
              <div className="programas-modal-grid">
                <label className="programas-modal-field" htmlFor="codigo">
                  <span>Código</span>
                  <input id="codigo" name="codigo" type="text" value={form.codigo} onChange={onInputChange} />
                </label>

                <label className="programas-modal-field" htmlFor="nombre">
                  <span>Nombre</span>
                  <input id="nombre" name="nombre" type="text" value={form.nombre} onChange={onInputChange} />
                </label>

                <label className="programas-modal-field" htmlFor="version">
                  <span>Versión</span>
                  <input id="version" name="version" type="text" value={form.version} onChange={onInputChange} />
                </label>

                <label className="programas-modal-field" htmlFor="horas">
                  <span>Horas</span>
                  <input id="horas" name="horas" type="number" min="1" value={form.horas} onChange={onInputChange} />
                </label>

                <label className="programas-modal-field" htmlFor="areaId">
                  <span>Área</span>
                  <select id="areaId" name="areaId" value={form.areaId} onChange={onInputChange}>
                    <option value="">Seleccione</option>
                    {catalogs.areas.map((item) => (
                      <option key={item._id} value={item._id}>{item.nombre}</option>
                    ))}
                  </select>
                </label>

                <label className="programas-modal-field" htmlFor="modalidadId">
                  <span>Modalidad</span>
                  <select id="modalidadId" name="modalidadId" value={form.modalidadId} onChange={onInputChange}>
                    <option value="">Seleccione</option>
                    {catalogs.modalidades.map((item) => (
                      <option key={item._id} value={item._id}>{item.nombre}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="programas-modal-actions">
                <button type="submit" className="boton-enviar" disabled={saving || loading}>
                  {saving ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear programa'}
                </button>
                <button type="button" className="boton-cancelar" onClick={resetForm} disabled={saving}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </PortalLayout>
  );
};

export default ProgramasCurricularesPage;