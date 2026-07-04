import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchSolicitudCaracterizacion, fetchSolicitudCaracterizacionWord } from '../api/solicitudes';

// Catálogo visual de días usado para dibujar la sección de programación.
const DAY_OPTIONS = [
  { code: '1', label: 'LUN' },
  { code: '2', label: 'MAR' },
  { code: '3', label: 'MIE' },
  { code: '4', label: 'JUE' },
  { code: '5', label: 'VIE' },
  { code: '6', label: 'SAB' },
  { code: '0', label: 'DOM' }
];

// Mapa auxiliar para convertir nombres de día (texto libre) a códigos 0..6.
const DAY_NAME_TO_CODE = {
  lun: '1',
  lunes: '1',
  mar: '2',
  martes: '2',
  mie: '3',
  miercoles: '3',
  miércoles: '3',
  jue: '4',
  jueves: '4',
  vie: '5',
  viernes: '5',
  sab: '6',
  sabado: '6',
  sábado: '6',
  dom: '0',
  domingo: '0'
};

// Índice rápido para convertir código de día a etiqueta visible.
const DAY_LABEL_BY_CODE = DAY_OPTIONS.reduce((accumulator, day) => {
  accumulator[String(day.code)] = day.label;
  return accumulator;
}, {});

// Catálogo de modalidades permitidas en la ficha.
const MODALIDADES = ['PRESENCIAL', 'DESESCOLARIZADA', 'VIRTUAL', 'COMBINADA'];

// Lista de programas especiales mostrada en el formato de caracterización.
const PROGRAMAS_ESPECIALES = [
  { id: 1, label: 'SENA EMPRENDE RURAL' },
  { id: 2, label: 'SENA EMPRENDE RURAL- POST CONFLICTO (ETCR)' },
  { id: 3, label: 'AULAS ABIERTAS' },
  { id: 4, label: 'PROGRAMA DE EMPRENDIMIENTO' },
  { id: 5, label: 'CATEDRA VIRTUAL DE PRODUCTIVIDAD' },
  { id: 6, label: 'PROGRAMA DE BILINGÜISMO' },
  { id: 7, label: 'JÓVENES RURALES SIN ALIANZAS' },
  { id: 8, label: 'CAPACIDAD DE GESTIÓN DE EXPORTACIONES' },
  { id: 9, label: 'LEOS – LABORATORIOS EXPERIMENTALES' },
  { id: 10, label: 'AULA MÓVIL' },
  { id: 11, label: 'AMBIENTES VIRTUALES DE APRENDIZAJE' },
  { id: 12, label: 'CATEDRA VIRTUAL DE PENSAMIENTO EMPRESARIAL' },
  { id: 13, label: 'PROGRAMA JÓVENES EN ACCIÓN' },
  { id: 14, label: 'ALIANZAS ESTRATÉGICAS' },
  { id: 15, label: 'ALTA GERENCIA' }
];

// Normaliza texto (minúsculas, sin tildes) para comparaciones robustas.
const normalizeText = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

// Formato de fecha legible para impresión/visualización.
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

// Une fechas de ejecución mostrando solo el día del mes (mes 1 / mes 2).
const joinDates = (dates) => {
  if (!Array.isArray(dates) || !dates.length) {
    return '';
  }

  return dates
    .map((value) => {
      const raw = String(value || '').trim();
      if (!raw) {
        return null;
      }

      // Caso típico: YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss...
      const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        return String(Number(isoMatch[3]));
      }

      // Fallback: intenta parsear como Date.
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return null;
      }

      return String(parsed.getDate());
    })
    .filter(Boolean)
    .join(', ');
};

// Divide un conjunto de fechas en hasta 5 bloques mensuales (mes 1..mes 5).
const splitExecutionDatesIntoMonths = (dates, maxMonths = 5) => {
  if (!Array.isArray(dates) || !dates.length) {
    return Array.from({ length: maxMonths }, () => '');
  }

  const monthBuckets = [];
  const monthIndexByKey = new Map();

  dates.forEach((value) => {
    const raw = String(value || '').trim();
    if (!raw) {
      return;
    }

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const year = isoMatch[1];
      const month = isoMatch[2];
      const day = String(Number(isoMatch[3]));
      const monthKey = `${year}-${month}`;

      if (!monthIndexByKey.has(monthKey)) {
        monthIndexByKey.set(monthKey, monthBuckets.length);
        monthBuckets.push([]);
      }

      monthBuckets[monthIndexByKey.get(monthKey)].push(day);
      return;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return;
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate());
    const monthKey = `${year}-${month}`;

    if (!monthIndexByKey.has(monthKey)) {
      monthIndexByKey.set(monthKey, monthBuckets.length);
      monthBuckets.push([]);
    }

    monthBuckets[monthIndexByKey.get(monthKey)].push(day);
  });

  const monthlyValues = monthBuckets.slice(0, maxMonths).map((days) => days.join(', '));

  while (monthlyValues.length < maxMonths) {
    monthlyValues.push('');
  }

  return monthlyValues;
};

// Obtiene los meses de ejecución por subrol CampeSENA usando meses explícitos o fallback por fechas.
const getCampesenaRoleExecutionMonths = (horario) => {
  if (!horario) {
    return Array.from({ length: 5 }, () => '');
  }

  const explicitMonths = [horario.mes1, horario.mes2, horario.mes3, horario.mes4, horario.mes5];
  const hasExplicitMonths = explicitMonths.some((monthDates) => Array.isArray(monthDates) && monthDates.length);

  if (hasExplicitMonths) {
    return explicitMonths.map((monthDates) => joinDates(monthDates));
  }

  return splitExecutionDatesIntoMonths(horario.fechas, 5);
};

// Une códigos de días devolviendo etiquetas cortas (LUN, MAR, ...).
const joinDayLabels = (dayCodes) => {
  if (!Array.isArray(dayCodes) || !dayCodes.length) {
    return '';
  }

  return dayCodes
    .map((value) => {
      const code = String(value || '').trim();
      if (!code) {
        return null;
      }

      return DAY_LABEL_BY_CODE[code] || code.toUpperCase();
    })
    .filter(Boolean)
    .join(', ');
};

// Normaliza días recibidos desde BD (código o nombre) a códigos 0..6.
const normalizeDayCodes = (dayCodes) => {
  if (!Array.isArray(dayCodes)) {
    return [];
  }

  return dayCodes
    .map((value) => {
      const raw = String(value || '').trim();
      if (!raw) {
        return null;
      }

      if (/^[0-6]$/.test(raw)) {
        return raw;
      }

      const normalized = normalizeText(raw);
      return DAY_NAME_TO_CODE[normalized] || null;
    })
    .filter(Boolean);
};

// Representación visual de casilla marcada en el formato tipo documento.
const mark = (checked) => (checked ? 'X' : '');

const SolicitudCaracterizacionPage = () => {
  // ID de solicitud tomado de la ruta.
  const { id } = useParams();
  // Estado de carga, error y payload de ficha.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [downloadingWord, setDownloadingWord] = useState(false);

  useEffect(() => {
    // Carga el detalle completo de la ficha para la solicitud indicada.
    const loadFicha = async () => {
      try {
        setError('');
        const response = await fetchSolicitudCaracterizacion(id);
        setData(response);
      } catch (requestError) {
        const message = requestError?.response?.data?.message || 'No se pudo cargar la ficha de caracterización';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadFicha();
  }, [id]);

  // Conjunto para búsquedas O(1) al marcar días seleccionados.
  const selectedDays = useMemo(() => {
    return new Set((data?.horario?.diasSemanaCodigos || []).map((item) => String(item)));
  }, [data]);

  // Valores normalizados para comparar modalidad y programa especial sin errores por tildes/mayúsculas.
  const selectedModalidad = normalizeText(data?.modalidad?.nombre);
  const selectedProgramaEspecialByName = normalizeText(data?.programaEspecial?.nombre);
  const programaEspecialSeleccionadoId = Number(data?.programaEspecial?.id || 0);
  const isCampesena = normalizeText(data?.solicitud?.tipoSolicitud).includes('campesena');

  // Helpers de comparación para marcar checks en modalidad/programa especial.
  const isModalidad = (value) => normalizeText(value) === selectedModalidad;
  const isProgramaEspecial = (item) => {
    return programaEspecialSeleccionadoId === item.id || normalizeText(item.label) === selectedProgramaEspecialByName;
  };

  // Descarga la ficha renderizada por backend en formato Word.
  const handleDownloadWord = async () => {
    try {
      setDownloadingWord(true);
      setError('');

      const blob = await fetchSolicitudCaracterizacionWord(id);
      const blobUrl = window.URL.createObjectURL(blob);
      const safeCode = String(data?.solicitud?.codigoSolicitud || id || 'solicitud').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `ficha_caracterizacion_${safeCode}.doc`;

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo descargar la ficha de caracterización en Word');
    } finally {
      setDownloadingWord(false);
    }
  };

  return (
    <div className="doc-page-wrap sena-format-wrap">
      <div className="doc-actions">
        <Link to="/solicitudes/consultar" className="doc-page-back">Volver a consultar solicitudes</Link>
        <button
          type="button"
          className="doc-action-btn"
          onClick={handleDownloadWord}
          disabled={downloadingWord || loading || !!error || !data}
        >
          {downloadingWord ? 'Descargando...' : 'Descargar Word'}
        </button>
      </div>
      <div className="doc-page-sheet sena-format-sheet">

        {loading ? <div className="estado-carga">Cargando ficha...</div> : null}

        {!loading && error ? (
          <div className="alertas">
            <div className="alert alert-error">{error}</div>
          </div>
        ) : null}

        {!loading && !error && data ? (
          <div className="sena-format-document">
            <div className="sena-head-row">
              <div className="sena-head-logo">
                <img src="/SenaVerde.png" alt="Logo SENA" />
              </div>
              <div className="sena-head-title">
                <div>SERVICIO NACIONAL DE APRENDIZAJE</div>
                <div>SISTEMA INTEGRADO DE GESTIÓN</div>
              </div>
              <div className="sena-head-radicado">
                <div>La presente formación se programa en atención a la solicitud con Radicado</div>
                <div>
                  No {data?.solicitud?.codigoSolicitud || '________'} Fecha de asignación desde Coordinación Académica {formatDate(data?.solicitud?.fechaSolicitud) || '___/___/____'}
                </div>
              </div>
            </div>

            <table className="sena-main-table">
              <tbody>
                <tr>
                  <td className="label-cell" colSpan={2} />
                  <td colSpan={8} className="formacion-cell">
                    <div className="choice-grid choice-grid-2">
                      <div className="choice-item">
                        <span>COMPLEMENTARIA</span>
                        <span className="choice-check">X</span>
                      </div>
                      <div className="choice-item">
                        <span>TITULADA</span>
                        <span className="choice-check" />
                      </div>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td className="label-cell" colSpan={2}>Código programa de formación*</td>
                  <td colSpan={8}>{data?.programa?.codigo || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Nombre del Programa*</td>
                  <td colSpan={8}>{data?.programa?.nombre || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Versión del programa*</td>
                  <td colSpan={8}>{data?.programa?.version || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Duración Máxima (Horas)*</td>
                  <td colSpan={8}>{data?.programa?.horas || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Fecha de Inicio*</td>
                  <td colSpan={8}>{formatDate(data?.horario?.fechaInicio)}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Fecha prevista de terminación*</td>
                  <td colSpan={8}>{formatDate(data?.horario?.fechaFin)}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Cupo*</td>
                  <td colSpan={8}>{data?.solicitud?.cupo || ''}</td>
                </tr>

                <tr>
                  <td className="label-cell" colSpan={2}>Modalidad del programa*</td>
                  <td colSpan={8} className="modalidad-cell">
                    <div className="choice-grid choice-grid-4">
                      <div className="choice-item">
                        <span className="choice-check">{mark(isModalidad('PRESENCIAL'))}</span>
                        <span>PRESENCIAL</span>
                      </div>
                      <div className="choice-item">
                        <span className="choice-check">{mark(isModalidad('DESESCOLARIZADA'))}</span>
                        <span>DESESCOLARIZADA</span>
                      </div>
                      <div className="choice-item">
                        <span className="choice-check">{mark(isModalidad('VIRTUAL'))}</span>
                        <span>VIRTUAL</span>
                      </div>
                      <div className="choice-item">
                        <span className="choice-check">{mark(isModalidad('COMBINADA'))}</span>
                        <span>COMBINADA</span>
                      </div>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td className="label-cell" colSpan={2}>Departamento desarrollo de formación*</td>
                  <td colSpan={8}>{data?.ubicacion?.departamento || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Municipio desarrollo de formación*</td>
                  <td colSpan={8}>{data?.ubicacion?.municipio || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Dirección donde se va a realizar la formación*</td>
                  <td colSpan={8}>{data?.solicitud?.direccion || ''}</td>
                </tr>

                <tr>
                  <td className="label-cell" colSpan={2}>Nombre responsable*</td>
                  <td colSpan={5}>{data?.responsable?.nombre || ''}</td>
                  <td className="center-cell">CC #</td>
                  <td colSpan={2}>{data?.responsable?.documento || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Correo electrónico*</td>
                  <td colSpan={8}>{data?.responsable?.correo || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Empresa solicitante</td>
                  <td colSpan={8}>{data?.empresa?.nombre || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Subsector económico*</td>
                  <td colSpan={8}>{data?.solicitud?.subsectorEconomico || ''}</td>
                </tr>

                <tr>
                  <td className="label-cell" colSpan={2}>Programa Especial*</td>
                  <td colSpan={8} className="programa-especial-cell">
                    {PROGRAMAS_ESPECIALES.map((item) => (
                      <div key={item.id} className="programa-especial-line">
                        <span className="programa-check">{mark(isProgramaEspecial(item))}</span>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </td>
                </tr>

                <tr>
                  <td className="label-cell" colSpan={2}>Convenio</td>
                  <td colSpan={8}>{data?.empresa?.convenio || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Nombre y área en metros del ambiente</td>
                  <td colSpan={8}>{data?.solicitud?.ambiente || ''}</td>
                </tr>

                {!isCampesena ? (
                  <>
                    <tr>
                      <td className="label-cell" colSpan={2}>Días semana de programación*</td>
                      <td colSpan={8} className="dias-cell">
                        <div className="choice-grid choice-grid-7">
                          {DAY_OPTIONS.map((day) => (
                            <div className="choice-item" key={day.code}>
                              <span className="choice-check">{mark(selectedDays.has(day.code))}</span>
                              <span>{day.label}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td className="label-cell" colSpan={2}>Horario de ejecución de la formación*</td>
                      <td colSpan={8}>{data?.horario?.horas || ''}</td>
                    </tr>
                    <tr>
                      <td className="label-cell" colSpan={2}>Fechas de ejecución de la formación mes 1</td>
                      <td colSpan={8}>{joinDates(data?.horario?.mes1)}</td>
                    </tr>
                    <tr>
                      <td className="label-cell" colSpan={2}>Fechas de ejecución de la formación mes 2</td>
                      <td colSpan={8}>{joinDates(data?.horario?.mes2)}</td>
                    </tr>
                  </>
                ) : (
                  <>
                    {(data?.campesena?.roles || []).map((role) => (
                      <Fragment key={role.cargo}>
                        <tr key={`${role.cargo}-titulo`}>
                          <td className="label-cell" colSpan={2}>Subrol instructor CampeSENA</td>
                          <td colSpan={8}>{role?.etiqueta || ''}</td>
                        </tr>
                        <tr key={`${role.cargo}-horario`}>
                          <td className="label-cell" colSpan={2}>Horario</td>
                          <td colSpan={8}>
                            {role?.horario?.horaInicio && role?.horario?.horaFin
                              ? `${role.horario.horaInicio} - ${role.horario.horaFin}`
                              : ''}
                          </td>
                        </tr>
                        <tr key={`${role.cargo}-dias`}>
                          <td className="label-cell" colSpan={2}>Días de semana</td>
                          <td colSpan={8} className="dias-cell">
                            <div className="choice-grid choice-grid-7">
                              {(() => {
                                const selectedRoleDays = new Set(normalizeDayCodes(role?.horario?.diasSemanaCodigos));
                                return DAY_OPTIONS.map((day) => (
                                  <div className="choice-item" key={`${role.cargo}-${day.code}`}>
                                    <span className="choice-check">{mark(selectedRoleDays.has(day.code))}</span>
                                    <span>{day.label}</span>
                                  </div>
                                ));
                              })()}
                            </div>
                          </td>
                        </tr>
                        {getCampesenaRoleExecutionMonths(role?.horario).map((fechasMes, monthIndex) => (
                          <tr key={`${role.cargo}-fechas-mes-${monthIndex + 1}`}>
                            <td className="label-cell" colSpan={2}>{`Fechas de ejecución mes ${monthIndex + 1}`}</td>
                            <td colSpan={8}>{fechasMes}</td>
                          </tr>
                        ))}
                        <tr key={`${role.cargo}-nombre`}>
                          <td className="label-cell" colSpan={2}>Instructor asignado</td>
                          <td colSpan={8}>{role?.instructor?.nombre || ''}</td>
                        </tr>
                        <tr key={`${role.cargo}-documento`}>
                          <td className="label-cell" colSpan={2}>Documento instructor</td>
                          <td colSpan={8}>{role?.instructor?.documento || ''}</td>
                        </tr>
                        <tr key={`${role.cargo}-correo`}>
                          <td className="label-cell" colSpan={2}>Correo instructor</td>
                          <td colSpan={8}>{role?.instructor?.correo || ''}</td>
                        </tr>
                      </Fragment>
                    ))}
                  </>
                )}

                <tr>
                  <td className="label-cell" colSpan={2}>Código de solicitud</td>
                  <td colSpan={8}>{data?.solicitud?.codigoSolicitud || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Código de ficha</td>
                  <td colSpan={8}>{data?.ficha?.codigoFicha || ''}</td>
                </tr>
                <tr>
                  <td className="label-cell" colSpan={2}>Fecha de inscripción</td>
                  <td colSpan={8}>{formatDate(data?.solicitud?.fechaSolicitud)}</td>
                </tr>
              </tbody>
            </table>

            <div className="sena-sign-row sena-sign-final">
              <div className="instructor-name">Nombre del instructor: {data?.responsable?.nombre || ''}</div>
              <div className="sign-line">Firma Instructor</div>
              <div className="sign-line">Vo.Bo. Coordinador Académico</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SolicitudCaracterizacionPage;
