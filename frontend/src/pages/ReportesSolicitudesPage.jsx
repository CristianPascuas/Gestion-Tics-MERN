import { useEffect, useMemo, useState } from 'react';
import PortalLayout from '../components/PortalLayout';
import { fetchSolicitudesReportes } from '../api/solicitudes';
import { useAuth } from '../context/AuthContext';

// Filtros iniciales para la consulta paginada de reportes.
const DEFAULT_FILTERS = {
	areaId: '',
	programaId: '',
	tipoSolicitud: '',
	estadoFichaId: '',
	estadoCoordinadorId: '',
	fechaDesde: '',
	fechaHasta: '',
	coordinatorId: '',
	instructorId: '',
	funcionarioId: ''
};

// Convierte fechas de backend a formato legible para la tabla.
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

// Construye el fondo tipo pastel con gradiente cónico según la serie recibida.
const buildPieStyle = (series) => {
	const total = series.reduce((sum, item) => sum + Number(item.total || 0), 0);
	if (!total) {
		return { background: '#f0f0f0' };
	}

	const colors = ['#2E7D32', '#4CAF50', '#81C784', '#A5D6A7', '#C8E6C9', '#66BB6A', '#1B5E20'];
	let current = 0;

	const slices = series.map((item, index) => {
		const value = Number(item.total || 0);
		const angle = (value / total) * 360;
		const from = current;
		const to = current + angle;
		current = to;
		return `${colors[index % colors.length]} ${from}deg ${to}deg`;
	});

	return {
		background: `conic-gradient(${slices.join(', ')})`
	};
};

// Tarjeta reutilizable de gráfica + leyenda para top de categorías.
const TopSeriesCard = ({ title, series }) => {
	const topSeries = (series || []).slice(0, 6);
	const colors = ['#2E7D32', '#4CAF50', '#81C784', '#A5D6A7', '#C8E6C9', '#66BB6A', '#1B5E20'];

	return (
		<article className="reporte-grafica-card">
			<h3>{title}</h3>
			{topSeries.length ? (
				<div className="reporte-pie-layout">
					<div className="reporte-pie-chart" style={buildPieStyle(topSeries)} />
					<ul className="reporte-leyenda">
						{topSeries.map((item, index) => (
							<li key={`${title}-${item.key}`}>
								<span
									className="reporte-leyenda-color"
									style={{ backgroundColor: colors[index % colors.length] }}
								/>
								<span className="reporte-leyenda-label">{item.label}</span>
								<span className="reporte-leyenda-value">{item.total}</span>
							</li>
						))}
					</ul>
				</div>
			) : (
				<p>Sin datos para esta gráfica.</p>
			)}
		</article>
	);
};

const ReportesSolicitudesPage = () => {
	// Determina permisos de vista según rol autenticado.
	const { user } = useAuth();
	const roleKey = String(user?.role || '').toLowerCase();
	const isCoordinator = roleKey === 'coordinador';

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [reportData, setReportData] = useState(null);
	const [filters, setFilters] = useState(DEFAULT_FILTERS);
	const [page, setPage] = useState(1);
	const [showFiltersModal, setShowFiltersModal] = useState(false);

	// Consulta reportes considerando filtros y paginación actuales/objetivo.
	const loadReportes = async (targetFilters = filters, targetPage = page) => {
		try {
			setLoading(true);
			setError('');

			const payload = await fetchSolicitudesReportes({
				...targetFilters,
				page: targetPage,
				limit: 100
			});

			setReportData(payload || null);
		} catch (requestError) {
			setError(requestError?.response?.data?.message || 'No se pudieron cargar los reportes');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		// Carga inicial de la vista con filtros por defecto.
		loadReportes(DEFAULT_FILTERS, 1);
	}, []);

	const catalogs = reportData?.catalogos || {};
	const resumen = reportData?.resumen || { totalSolicitudes: 0, totalRegular: 0, totalCampesena: 0 };
	const graficas = reportData?.graficas || {};
	const tabla = reportData?.tabla || { page: 1, totalPages: 1, items: [] };

	// Limita el catálogo de programas al área seleccionada.
	const programasFiltrados = useMemo(() => {
		const allProgramas = catalogs.programas || [];
		if (!filters.areaId) {
			return allProgramas;
		}

		return allProgramas.filter((item) => String(item.areaId || '') === String(filters.areaId));
	}, [catalogs.programas, filters.areaId]);

	// Aplica cambios de filtros con reglas de dependencia entre campos.
	const handleFilterChange = (field, value) => {
		setFilters((prev) => {
			const next = { ...prev, [field]: value };
			if (field === 'areaId') {
				next.programaId = '';
			}

			if (field === 'coordinatorId' && value) {
				next.instructorId = '';
			}

			return next;
		});
	};

	// Ejecuta consulta con filtros activos y reinicia a página 1.
	const handleApplyFilters = async () => {
		setPage(1);
		await loadReportes(filters, 1);
		setShowFiltersModal(false);
	};

	// Restablece filtros y recarga datos base.
	const handleClearFilters = async () => {
		setFilters(DEFAULT_FILTERS);
		setPage(1);
		await loadReportes(DEFAULT_FILTERS, 1);
		setShowFiltersModal(false);
	};

	// Controla navegación de páginas respetando límites del backend.
	const goToPage = async (targetPage) => {
		const safePage = Math.max(1, Math.min(targetPage, Number(tabla.totalPages || 1)));
		setPage(safePage);
		await loadReportes(filters, safePage);
	};

	const canSeeCoordinatorFilter = !isCoordinator;
	const canSeeFuncionarioFilter = !isCoordinator;

	const totalFiltrosActivos = Object.values(filters).filter((value) => String(value || '').trim().length > 0).length;

	return (
		<PortalLayout>
			<div className="titulo-seccion">
				<h2 className="titulo-pagina">Reportes de solicitudes</h2>
				<p className="subtitulo-pagina">
					Consulte el consolidado de solicitudes por estado, tipo, programa, coordinador, instructor y funcionario.
				</p>
			</div>

			{error ? (
				<div className="alertas">
					<div className="alert alert-error">{error}</div>
				</div>
			) : null}

			<div className="reportes-actions">
				<button type="button" className="boton-enviar" onClick={() => setShowFiltersModal(true)} disabled={loading}>
					Filtros
				</button>
				<span className="reportes-filtros-activos">
					{totalFiltrosActivos ? `${totalFiltrosActivos} filtro(s) activo(s)` : 'Sin filtros activos'}
				</span>
			</div>

			<div className="reportes-kpis">
				<div className="reporte-kpi-card">
					<h3>Total solicitudes</h3>
					<strong>{resumen.totalSolicitudes || 0}</strong>
				</div>
				<div className="reporte-kpi-card">
					<h3>Total regular</h3>
					<strong>{resumen.totalRegular || 0}</strong>
				</div>
				<div className="reporte-kpi-card">
					<h3>Total campesena</h3>
					<strong>{resumen.totalCampesena || 0}</strong>
				</div>
			</div>

			<div className="reportes-graficas-grid">
				<TopSeriesCard title="Por estado de ficha" series={graficas.porEstadoFicha} />
				<TopSeriesCard title="Por estado de coordinación" series={graficas.porEstadoCoordinador} />
				<TopSeriesCard title="Por tipo de solicitud" series={graficas.porTipoSolicitud} />
				<TopSeriesCard title="Por área" series={graficas.porArea} />
			</div>

			<div className="contenedor-tabla-fichas">
				<table className="tabla-fichas tabla-reportes">
					<thead>
						<tr>
							<th>Fecha</th>
							<th>Programa</th>
							<th>Área</th>
							<th>Tipo</th>
							<th>Estado ficha</th>
							<th>Estado coordinación</th>
							<th>Instructor</th>
							<th>Coordinador</th>
							<th>Funcionario</th>
							<th>Código solicitud</th>
						</tr>
					</thead>
					<tbody>
						{(tabla.items || []).map((item) => (
							<tr key={item.id}>
								<td>{formatDate(item.fechaSolicitud)}</td>
								<td>{item.nombrePrograma}</td>
								<td>{item.areaPrograma}</td>
								<td>{item.tipoSolicitudLabel}</td>
								<td>{item.estadoFicha}</td>
								<td>{item.estadoCoordinador}</td>
								<td>{item.instructor || 'Sin instructor'}</td>
								<td>{item.coordinador || 'Sin coordinador'}</td>
								<td>{item.funcionario || 'Sin funcionario'}</td>
								<td>{item.codigoSolicitud || 'Sin código'}</td>
							</tr>
						))}
						{!loading && !(tabla.items || []).length ? (
							<tr>
								<td colSpan={10} className="celda-vacia-consultas">
									No hay resultados con los filtros actuales.
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>

			<div className="reportes-actions">
				<button
					type="button"
					className="boton-cancelar"
					disabled={loading || Number(tabla.page || 1) <= 1}
					onClick={() => goToPage(Number(tabla.page || 1) - 1)}
				>
					Anterior
				</button>
				<span className="reportes-filtros-activos">
					Página {tabla.page || 1} de {tabla.totalPages || 1}
				</span>
				<button
					type="button"
					className="boton-enviar"
					disabled={loading || Number(tabla.page || 1) >= Number(tabla.totalPages || 1)}
					onClick={() => goToPage(Number(tabla.page || 1) + 1)}
				>
					Siguiente
				</button>
			</div>

			{showFiltersModal ? (
				<div className="modal" role="dialog" aria-modal="true">
					<div className="modal-contenido reportes-modal">
						<button
							type="button"
							className="cerrar-modal"
							onClick={() => setShowFiltersModal(false)}
						>
							&times;
						</button>
						<h3>Filtros de reportes</h3>

						<section className="filtros-busqueda">
							<div className="filtro-area-programa">
								<label htmlFor="reporte-area">Área</label>
								<select
									id="reporte-area"
									value={filters.areaId}
									onChange={(event) => handleFilterChange('areaId', event.target.value)}
								>
									<option value="">-- Todas --</option>
									{(catalogs.areas || []).map((item) => (
										<option key={item.id} value={item.id}>{item.nombre}</option>
									))}
								</select>
							</div>

							<div className="filtro-area-programa">
								<label htmlFor="reporte-programa">Programa</label>
								<select
									id="reporte-programa"
									value={filters.programaId}
									onChange={(event) => handleFilterChange('programaId', event.target.value)}
								>
									<option value="">-- Todos --</option>
									{programasFiltrados.map((item) => (
										<option key={item.id} value={item.id}>{item.nombre}</option>
									))}
								</select>
							</div>

							<div className="filtro-estado-solicitud">
								<label htmlFor="reporte-tipo">Tipo solicitud</label>
								<select
									id="reporte-tipo"
									value={filters.tipoSolicitud}
									onChange={(event) => handleFilterChange('tipoSolicitud', event.target.value)}
								>
									<option value="">-- Todos --</option>
									{(catalogs.tiposSolicitud || []).map((item) => (
										<option key={item.id} value={item.id}>{item.nombre}</option>
									))}
								</select>
							</div>

							<div className="filtro-estado-solicitud">
								<label htmlFor="reporte-estado-ficha">Estado ficha</label>
								<select
									id="reporte-estado-ficha"
									value={filters.estadoFichaId}
									onChange={(event) => handleFilterChange('estadoFichaId', event.target.value)}
								>
									<option value="">-- Todos --</option>
									{(catalogs.estadosFicha || []).map((item) => (
										<option key={item.id} value={item.id}>{item.nombre}</option>
									))}
								</select>
							</div>

							<div className="filtro-estado-solicitud">
								<label htmlFor="reporte-estado-coord">Estado coordinación</label>
								<select
									id="reporte-estado-coord"
									value={filters.estadoCoordinadorId}
									onChange={(event) => handleFilterChange('estadoCoordinadorId', event.target.value)}
								>
									<option value="">-- Todos --</option>
									{(catalogs.estadosCoordinador || []).map((item) => (
										<option key={item.id} value={item.id}>{item.nombre}</option>
									))}
								</select>
							</div>

							{canSeeCoordinatorFilter ? (
								<div className="filtro-estado-solicitud">
									<label htmlFor="reporte-coordinador">Coordinador</label>
									<select
										id="reporte-coordinador"
										value={filters.coordinatorId}
										onChange={(event) => handleFilterChange('coordinatorId', event.target.value)}
									>
										<option value="">-- Todos --</option>
										{(catalogs.coordinadores || []).map((item) => (
											<option key={item.id} value={item.id}>{item.nombre}</option>
										))}
									</select>
								</div>
							) : null}

							<div className="filtro-estado-solicitud">
								<label htmlFor="reporte-instructor">Instructor</label>
								<select
									id="reporte-instructor"
									value={filters.instructorId}
									onChange={(event) => handleFilterChange('instructorId', event.target.value)}
								>
									<option value="">-- Todos --</option>
									{(catalogs.instructores || []).map((item) => (
										<option key={item.id} value={item.id}>{item.nombre}</option>
									))}
								</select>
							</div>

							{canSeeFuncionarioFilter ? (
								<div className="filtro-estado-solicitud">
									<label htmlFor="reporte-funcionario">Funcionario</label>
									<select
										id="reporte-funcionario"
										value={filters.funcionarioId}
										onChange={(event) => handleFilterChange('funcionarioId', event.target.value)}
									>
										<option value="">-- Todos --</option>
										{(catalogs.funcionarios || []).map((item) => (
											<option key={item.id} value={item.id}>{item.nombre}</option>
										))}
									</select>
								</div>
							) : null}

							<div className="filtro-fecha">
								<label htmlFor="reporte-fecha-desde">Fecha desde</label>
								<input
									id="reporte-fecha-desde"
									type="date"
									value={filters.fechaDesde}
									onChange={(event) => handleFilterChange('fechaDesde', event.target.value)}
								/>
							</div>

							<div className="filtro-fecha">
								<label htmlFor="reporte-fecha-hasta">Fecha hasta</label>
								<input
									id="reporte-fecha-hasta"
									type="date"
									value={filters.fechaHasta}
									onChange={(event) => handleFilterChange('fechaHasta', event.target.value)}
								/>
							</div>
						</section>

						<div className="reportes-actions" style={{ marginTop: '1.2rem' }}>
							<button type="button" className="boton-enviar" onClick={handleApplyFilters} disabled={loading}>
								{loading ? 'Consultando...' : 'Aplicar filtros'}
							</button>
							<button type="button" className="boton-cancelar" onClick={handleClearFilters} disabled={loading}>
								Limpiar
							</button>
						</div>
					</div>
				</div>
			) : null}
		</PortalLayout>
	);
};

export default ReportesSolicitudesPage;
