import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalLayout from '../components/PortalLayout';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Días disponibles para seleccionar programación semanal.
// value usa la convención de JS Date.getDay(): domingo=0, lunes=1, etc.
const DAY_OPTIONS = [
  { label: 'Lunes', value: '1' },
  { label: 'Martes', value: '2' },
  { label: 'Miércoles', value: '3' },
  { label: 'Jueves', value: '4' },
  { label: 'Viernes', value: '5' },
  { label: 'Sábado', value: '6' },
  { label: 'Domingo', value: '0' }
];

// Etiquetas cortas para pintar cabeceras del calendario.
const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Nombres de mes en español para mostrar periodos del calendario.
const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre'
];

// Catálogo de cargos válidos para el flujo CampeSENA.
// Cada cargo tiene su etiqueta y una clase visual para estilos del calendario.
const CAMPESENA_ROLE_OPTIONS = [
  { value: 'instructor_tecnico', label: 'Instructor Técnico', requiereHorario: true, colorClass: 'tecnico' },
  { value: 'instructor_empresarial', label: 'Instructor Empresarial', requiereHorario: true, colorClass: 'empresarial' },
  { value: 'instructor_full_popular', label: 'Instructor Full Popular', requiereHorario: true, colorClass: 'fullpopular' }
];

// Mapeo entre cargo CampeSENA y nombres de campos dentro del estado del formulario.
// Esto permite reutilizar la misma lógica para cada cargo sin duplicar código.
const CAMPESENA_ROLE_FIELDS = {
  instructor_tecnico: {
    horarioInicio: 'campesenaHorarioInicioTecnico',
    horarioFin: 'campesenaHorarioFinTecnico',
    dias: 'campesenaDiasTecnico'
  },
  instructor_empresarial: {
    horarioInicio: 'campesenaHorarioInicioEmpresarial',
    horarioFin: 'campesenaHorarioFinEmpresarial',
    dias: 'campesenaDiasEmpresarial'
  },
  instructor_full_popular: {
    horarioInicio: 'campesenaHorarioInicioFullPopular',
    horarioFin: 'campesenaHorarioFinFullPopular',
    dias: 'campesenaDiasFullPopular'
  }
};

// Convierte HH:mm a minutos absolutos para comparar horarios con facilidad.
const toMinutes = (timeValue) => {
  if (!timeValue || !timeValue.includes(':')) {
    return null;
  }

  const [hours, minutes] = timeValue.split(':').map((value) => Number(value));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
};

// Convierte Date a string ISO corto YYYY-MM-DD.
const toIsoDate = (date) => date.toISOString().split('T')[0];

// Extrae el primer número encontrado en el texto de horas del programa.
const parseProgramHours = (hoursValue) => {
  const raw = String(hoursValue || '').trim();
  if (!raw.length) {
    return 0;
  }

  const match = raw.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
};

// Redondea horas a 2 decimales para mostrar resumenes estables en UI.
const formatHours = (hoursValue) => {
  const numericValue = Number(hoursValue);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Number(numericValue.toFixed(2));
};

// Compara dos arreglos (mismo orden y longitud) para evitar renders innecesarios.
const sameArray = (left, right) => {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
};

/**
 * Resuelve el instructor asignado por cargo en CampeSENA.
 *
 * Prioridad:
 * 1) Si el usuario actual marcó que asume ese cargo, usa su propio id.
 * 2) Si no, toma el instructor seleccionado en el campo correspondiente.
 */
function resolveInstructorIdByRole(formState, currentUser, roleValue) {
  if (formState.campesenaRolesUsuario.includes(roleValue)) {
    return currentUser?.id || '';
  }

  if (roleValue === 'instructor_tecnico') {
    return formState.campesenaInstructorTecnicoId;
  }

  if (roleValue === 'instructor_empresarial') {
    return formState.campesenaInstructorEmpresarialId;
  }

  if (roleValue === 'instructor_full_popular') {
    return formState.campesenaInstructorFullPopularId;
  }

  return '';
}

const SolicitudFormPage = ({ variant }) => {
  // Usuario autenticado para reglas por rol y validaciones de autoría.
  const { user } = useAuth();

  // Define si el formulario opera en modo regular o CampeSENA.
  const isCampesena = variant === 'campesena';
  // Máximo de meses de calendario por tipo de solicitud.
  const maxCalendarMonths = isCampesena ? 5 : 2;

  // Catálogos que llegan desde backend y alimentan selects/tablas.
  const [catalogs, setCatalogs] = useState({
    areas: [],
    departamentos: [],
    municipios: [],
    tiposEmpresa: [],
    programasEspeciales: [],
    programasFormacion: [],
    instructoresCampesena: []
  });

  // Estado general de pantalla y modales.
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);
  const [showProgramModal, setShowProgramModal] = useState(false);
  const [showCampesenaHorarioModal, setShowCampesenaHorarioModal] = useState(false);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [activeCampesenaRole, setActiveCampesenaRole] = useState('instructor_tecnico');
  const [submitting, setSubmitting] = useState(false);
  const [selectedCalendarDates, setSelectedCalendarDates] = useState([]);
  const [campesenaCalendarDates, setCampesenaCalendarDates] = useState({
    instructor_tecnico: [],
    instructor_empresarial: [],
    instructor_full_popular: []
  });

  // Alertas superiores para éxito/error de validaciones o envío.
  const [alert, setAlert] = useState(null);

  // Estado completo del formulario.
  // Incluye campos comunes, campos de empresa y campos específicos CampeSENA.
  const [form, setForm] = useState({
    tieneEmpresa: '',
    tipoPrograma: '',
    tipoProgramaId: '',
    horasPrograma: '',
    nombrePrograma: '',
    codigoCurso: '',
    versionPrograma: '',
    subsectorEconomico: '',
    empresaSolicitante: '',
    tipoEmpresa: '',
    nombreResponsable: '',
    nitEmpresa: '',
    convenioEmpresa: '',
    fechaCreacionEmpresa: '',
    direccionEmpresa: '',
    nombreContactoEmpresa: '',
    correoContactoEmpresa: '',
    numeroEmpleadosEmpresa: '',
    cupoAprendices: '',
    departamentoFormacion: '',
    municipioFormacion: '',
    direccionFormacion: '',
    programaEspecial: '',
    nombreAmbiente: '',
    fechaInicio: '',
    fechaFinalizacion: '',
    horarioInicio: '',
    horarioFin: '',
    diasSemana: [],
    campesenaRolesUsuario: [],
    campesenaInstructorTecnicoId: '',
    campesenaInstructorEmpresarialId: '',
    campesenaInstructorFullPopularId: '',
    campesenaDiasTecnico: [],
    campesenaDiasEmpresarial: [],
    campesenaDiasFullPopular: [],
    campesenaHorarioInicioTecnico: '',
    campesenaHorarioFinTecnico: '',
    campesenaHorarioInicioEmpresarial: '',
    campesenaHorarioFinEmpresarial: '',
    campesenaHorarioInicioFullPopular: '',
    campesenaHorarioFinFullPopular: ''
  });

  const [modalFilter, setModalFilter] = useState({
    areaId: '',
    horas: ''
  });

  useEffect(() => {
    // Carga inicial de catálogos para todos los combos de la pantalla.
    const loadCatalogs = async () => {
      try {
        const response = await api.get('/catalogs/solicitud');
        setCatalogs({
          areas: response.data.areas || [],
          departamentos: response.data.departamentos || [],
          municipios: response.data.municipios || [],
          tiposEmpresa: response.data.tiposEmpresa || [],
          programasEspeciales: response.data.programasEspeciales || [],
          programasFormacion: response.data.programasFormacion || [],
          instructoresCampesena: response.data.instructoresCampesena || []
        });
      } finally {
        setLoadingCatalogs(false);
      }
    };

    loadCatalogs();
  }, []);

  useEffect(() => {
    // Inicializa fechaInicio al primer día del mes actual, solo si aún está vacío.
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const minDate = firstDay.toISOString().split('T')[0];

    setForm((prev) => {
      if (prev.fechaInicio) {
        return prev;
      }

      return {
        ...prev,
        fechaInicio: minDate
      };
    });
  }, []);

  const filteredMunicipios = useMemo(() => {
    // Filtra municipios según departamento seleccionado.
    if (!form.departamentoFormacion) {
      return [];
    }

    return catalogs.municipios.filter(
      (item) => item.departamento?._id === form.departamentoFormacion
    );
  }, [catalogs.municipios, form.departamentoFormacion]);

  const uniqueHours = useMemo(() => {
    // Construye lista única de horas para el modal de filtrado de programas.
    const allHours = catalogs.programasFormacion
      .map((item) => String(item.horas || '').trim())
      .filter((item) => item.length > 0);

    return [...new Set(allHours)].sort((left, right) => Number(left) - Number(right));
  }, [catalogs.programasFormacion]);

  const programsForModal = useMemo(() => {
    // Programas visibles en modal según filtros de área y horas.
    return catalogs.programasFormacion.filter((item) => {
      const areaMatch = !modalFilter.areaId || item.area?._id === modalFilter.areaId;
      const hoursMatch = !modalFilter.horas || String(item.horas) === modalFilter.horas;
      return areaMatch && hoursMatch;
    });
  }, [catalogs.programasFormacion, modalFilter.areaId, modalFilter.horas]);

  const totalHours = useMemo(() => parseProgramHours(form.horasPrograma), [form.horasPrograma]);

  const campesenaEnabledRoles = useMemo(() => {
    // Cargos que realmente tienen instructor asignado y, por tanto, se pueden configurar.
    return CAMPESENA_ROLE_OPTIONS
      .filter((role) => Boolean(resolveInstructorIdByRole(form, user, role.value)))
      .map((role) => role.value);
  }, [form, user]);

  const effectiveCampesenaRole = useMemo(() => {
    // Rol activo real para editar horario:
    // si el rol visible actual no aplica, toma el primer rol habilitado.
    if (!isCampesena) {
      return null;
    }

    if (campesenaEnabledRoles.includes(activeCampesenaRole)) {
      return activeCampesenaRole;
    }

    return campesenaEnabledRoles[0] || 'instructor_tecnico';
  }, [isCampesena, activeCampesenaRole, campesenaEnabledRoles]);

  useEffect(() => {
    // Mantiene sincronizada la pestaña/rol activo cuando cambian asignaciones.
    if (!isCampesena) {
      return;
    }

    if (effectiveCampesenaRole && effectiveCampesenaRole !== activeCampesenaRole) {
      setActiveCampesenaRole(effectiveCampesenaRole);
    }
  }, [isCampesena, effectiveCampesenaRole, activeCampesenaRole]);

  const activeRoleFields = useMemo(() => {
    // Obtiene nombres de campos asociados al rol CampeSENA activo.
    if (!isCampesena || !effectiveCampesenaRole) {
      return null;
    }

    return CAMPESENA_ROLE_FIELDS[effectiveCampesenaRole];
  }, [isCampesena, effectiveCampesenaRole]);

  const activeRoleDays = useMemo(() => {
    // Días seleccionados para el rol activo (o días generales en regular).
    if (!isCampesena || !activeRoleFields) {
      return form.diasSemana;
    }

    return form[activeRoleFields.dias] || [];
  }, [isCampesena, activeRoleFields, form]);

  const activeRoleTime = useMemo(() => {
    // Rango horario del rol activo (o horario general en regular).
    if (!isCampesena || !activeRoleFields) {
      return {
        inicio: form.horarioInicio,
        fin: form.horarioFin
      };
    }

    return {
      inicio: form[activeRoleFields.horarioInicio] || '',
      fin: form[activeRoleFields.horarioFin] || ''
    };
  }, [isCampesena, activeRoleFields, form]);

  const hoursPerDay = useMemo(() => {
    // Horas efectivas por día según hora inicio/fin.
    const startMinutes = toMinutes(activeRoleTime.inicio);
    const endMinutes = toMinutes(activeRoleTime.fin);

    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      return 0;
    }

    return (endMinutes - startMinutes) / 60;
  }, [activeRoleTime]);

  const requiredDays = useMemo(() => {
    // Número de días requeridos para cubrir las horas del programa.
    if (hoursPerDay <= 0 || totalHours <= 0) {
      return 0;
    }

    return Math.ceil(totalHours / hoursPerDay);
  }, [hoursPerDay, totalHours]);

  const campeSenaRoleStats = useMemo(() => {
    // Acumulado de días y horas entre todos los cargos CampeSENA activos.
    return CAMPESENA_ROLE_OPTIONS.reduce(
      (accumulator, roleOption) => {
        const instructorId = resolveInstructorIdByRole(form, user, roleOption.value);
        if (!instructorId) {
          return accumulator;
        }

        const fields = CAMPESENA_ROLE_FIELDS[roleOption.value];
        if (!fields) {
          return accumulator;
        }

        const startMinutes = toMinutes(form[fields.horarioInicio]);
        const endMinutes = toMinutes(form[fields.horarioFin]);
        if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
          return accumulator;
        }

        const roleHoursPerDay = (endMinutes - startMinutes) / 60;
        const roleDates = campesenaCalendarDates[roleOption.value] || [];

        accumulator.totalDays += roleDates.length;
        accumulator.totalHours += roleDates.length * roleHoursPerDay;

        return accumulator;
      },
      { totalDays: 0, totalHours: 0 }
    );
  }, [form, user, campesenaCalendarDates]);

  const campeSenaCombinedHours = campeSenaRoleStats.totalHours;
  const campeSenaCombinedDays = campeSenaRoleStats.totalDays;
  const campeSenaRemainingHours = Math.max(0, totalHours - campeSenaCombinedHours);

  const calendarMonths = useMemo(() => {
    // Genera estructura de calendario mensual con días seleccionables según:
    // - fecha de inicio
    // - días de semana marcados
    // - límite de meses por modalidad/cargo
    if (!form.fechaInicio || !activeRoleDays.length || hoursPerDay <= 0) {
      return [];
    }

    const selectedWeekDays = new Set(activeRoleDays.map((item) => Number(item)));
    const startDate = new Date(`${form.fechaInicio}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) {
      return [];
    }

    const firstMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

    const months = [];
    const cursor = new Date(firstMonth);

    const monthsLimit = isCampesena && effectiveCampesenaRole === 'instructor_full_popular' ? 2 : maxCalendarMonths;

    for (let monthIndex = 0; monthIndex < monthsLimit; monthIndex += 1) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      const prefixBlanks = monthStart.getDay();
      const days = [];

      for (let day = 1; day <= monthEnd.getDate(); day += 1) {
        const date = new Date(year, month, day);
        const iso = toIsoDate(date);
        const selectable = date >= startDate && selectedWeekDays.has(date.getDay());

        days.push({
          iso,
          day,
          selectable
        });
      }

      months.push({
        id: `${year}-${month}`,
        label: `${MONTH_LABELS[month]} ${year}`,
        prefixBlanks,
        days
      });

      cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
  }, [form.fechaInicio, activeRoleDays, hoursPerDay, maxCalendarMonths, isCampesena, effectiveCampesenaRole]);

  const availableCalendarDates = useMemo(
    // Fechas potenciales seleccionables (solo días habilitados en calendario).
    () => calendarMonths.flatMap((month) => month.days.filter((day) => day.selectable).map((day) => day.iso)),
    [calendarMonths]
  );

  const currentCampesenaCalendarDates = useMemo(() => {
    // Fechas del rol CampeSENA actualmente activo.
    if (!isCampesena || !effectiveCampesenaRole) {
      return [];
    }

    return campesenaCalendarDates[effectiveCampesenaRole] || [];
  }, [isCampesena, effectiveCampesenaRole, campesenaCalendarDates]);

  const currentCalendarDates = isCampesena ? currentCampesenaCalendarDates : selectedCalendarDates;

  // El calendario solo aparece cuando hay suficiente información para calcularlo.
  const isCalendarVisible =
    Boolean(form.fechaInicio) && activeRoleDays.length > 0 && hoursPerDay > 0 && calendarMonths.length > 0;

  useEffect(() => {
    // En modo regular, autoselecciona fechas por defecto según días requeridos.
    if (isCampesena) {
      return;
    }

    if (!availableCalendarDates.length) {
      setSelectedCalendarDates((prev) => (prev.length ? [] : prev));
      return;
    }

    const next =
      requiredDays > 0 ? availableCalendarDates.slice(0, requiredDays) : [...availableCalendarDates];

    setSelectedCalendarDates((prev) => (sameArray(prev, next) ? prev : next));
  }, [availableCalendarDates, requiredDays, isCampesena]);

  useEffect(() => {
    // Calcula fechaFinalizacion a partir de la última fecha seleccionada.
    // En CampeSENA usa unión de fechas de todos los cargos.
    const sourceDates = isCampesena
      ? [...new Set([
        ...campesenaCalendarDates.instructor_tecnico,
        ...campesenaCalendarDates.instructor_empresarial,
        ...campesenaCalendarDates.instructor_full_popular
      ])]
      : selectedCalendarDates;

    const lastDate = [...sourceDates].sort().at(-1) || '';

    setForm((prev) => {
      if (prev.fechaFinalizacion === lastDate) {
        return prev;
      }

      return {
        ...prev,
        fechaFinalizacion: lastDate
      };
    });
  }, [selectedCalendarDates, campesenaCalendarDates, isCampesena]);

  const selectedCalendarSet = useMemo(() => new Set(currentCalendarDates), [currentCalendarDates]);

  const isCampesenaDateBlockedByOtherRole = (isoDate) => {
    // Regla CampeSENA: evita reutilizar la misma fecha en cargos distintos.
    if (!isCampesena || !effectiveCampesenaRole) {
      return false;
    }

    return CAMPESENA_ROLE_OPTIONS.some((role) => {
      if (role.value === effectiveCampesenaRole) {
        return false;
      }

      if (!getInstructorIdForRole(role.value)) {
        return false;
      }

      const otherDates = campesenaCalendarDates[role.value] || [];
      if (!otherDates.includes(isoDate)) {
        return false;
      }

      return true;
    });
  };

  const onToggleCalendarDate = (isoDate) => {
    // Alterna selección de fecha en calendario según modo (regular/campesena).
    if (isCampesena && effectiveCampesenaRole) {
      if (isCampesenaDateBlockedByOtherRole(isoDate)) {
        return;
      }

      setCampesenaCalendarDates((prev) => {
        const roleDates = prev[effectiveCampesenaRole] || [];
        const exists = roleDates.includes(isoDate);
        const nextRoleDates = exists
          ? roleDates.filter((item) => item !== isoDate)
          : [...roleDates, isoDate].sort();

        return {
          ...prev,
          [effectiveCampesenaRole]: nextRoleDates
        };
      });
      return;
    }

    setSelectedCalendarDates((prev) => {
      const exists = prev.includes(isoDate);
      if (exists) {
        return prev.filter((item) => item !== isoDate);
      }

      if (requiredDays > 0 && prev.length >= requiredDays) {
        return prev;
      }

      return [...prev, isoDate].sort();
    });
  };

  const onSelectAllCalendarDates = (selectAll) => {
    // Solo aplica en regular: selección masiva de fechas.
    if (isCampesena) {
      return;
    }

    if (!selectAll) {
      setSelectedCalendarDates([]);
      return;
    }

    setSelectedCalendarDates(
      requiredDays > 0 ? availableCalendarDates.slice(0, requiredDays) : [...availableCalendarDates]
    );
  };

  const onInput = (event) => {
    // Handler genérico para inputs controlados.
    const { name, value } = event.target;

    setForm((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const onToggleDay = (dayValue) => {
    // Activa/desactiva días de semana del flujo regular.
    setForm((prev) => {
      const exists = prev.diasSemana.includes(dayValue);
      return {
        ...prev,
        diasSemana: exists
          ? prev.diasSemana.filter((item) => item !== dayValue)
          : prev.diasSemana.concat(dayValue)
      };
    });
  };

  const onToggleCampesenaRole = (roleValue) => {
    // Marca cargos que asumirá el usuario actual en CampeSENA.
    setForm((prev) => {
      const exists = prev.campesenaRolesUsuario.includes(roleValue);
      const nextRoles = exists
        ? prev.campesenaRolesUsuario.filter((item) => item !== roleValue)
        : prev.campesenaRolesUsuario.concat(roleValue);

      return {
        ...prev,
        campesenaRolesUsuario: nextRoles
      };
    });
  };

  const onToggleCampesenaRoleDay = (fieldName, dayValue) => {
    // Activa/desactiva días semanales para un cargo específico CampeSENA.
    setForm((prev) => {
      const current = Array.isArray(prev[fieldName]) ? prev[fieldName] : [];
      const exists = current.includes(dayValue);
      return {
        ...prev,
        [fieldName]: exists ? current.filter((item) => item !== dayValue) : current.concat(dayValue)
      };
    });
  };

  const getInstructorIdForRole = (roleValue) => {
    // Helper centralizado para resolver instructor por cargo.
    return resolveInstructorIdByRole(form, user, roleValue);
  };

  const getRoleSchedule = (roleValue) => {
    // Retorna estructura homogénea de horario para un cargo CampeSENA.
    const fields = CAMPESENA_ROLE_FIELDS[roleValue];
    if (!fields) {
      return {
        horaInicio: '',
        horaFin: '',
        diasSemana: [],
        fechasCalendario: []
      };
    }

    return {
      horaInicio: form[fields.horarioInicio] || '',
      horaFin: form[fields.horarioFin] || '',
      diasSemana: form[fields.dias] || [],
      fechasCalendario: (campesenaCalendarDates[roleValue] || []).slice().sort()
    };
  };

  const onChangeOferta = (event) => {
    // Cambia entre oferta abierta/cerrada y limpia campos no aplicables.
    const value = event.target.value;

    setForm((prev) => ({
      ...prev,
      tieneEmpresa: value,
      cupoAprendices:
        value === 'no' && Number(prev.cupoAprendices || 0) < 25 ? '25' : prev.cupoAprendices,
      empresaSolicitante: value === 'si' ? prev.empresaSolicitante : '',
      tipoEmpresa: value === 'si' ? prev.tipoEmpresa : '',
      nombreResponsable: value === 'si' ? prev.nombreResponsable : '',
      nitEmpresa: value === 'si' ? prev.nitEmpresa : '',
      convenioEmpresa: value === 'si' ? prev.convenioEmpresa : '',
      fechaCreacionEmpresa: value === 'si' ? prev.fechaCreacionEmpresa : '',
      direccionEmpresa: value === 'si' ? prev.direccionEmpresa : '',
      nombreContactoEmpresa: value === 'si' ? prev.nombreContactoEmpresa : '',
      correoContactoEmpresa: value === 'si' ? prev.correoContactoEmpresa : '',
      numeroEmpleadosEmpresa: value === 'si' ? prev.numeroEmpleadosEmpresa : ''
    }));
  };

  const onSelectProgram = () => {
    // Toma programa elegido en modal y copia sus datos clave al formulario.
    const selected = catalogs.programasFormacion.find((item) => item._id === selectedProgramId);
    if (!selected) {
      return;
    }

    setForm((prev) => ({
      ...prev,
      tipoPrograma: selected.area?.nombre || '',
      tipoProgramaId: selected.area?._id || '',
      horasPrograma: String(selected.horas || ''),
      nombrePrograma: selected.nombre || '',
      codigoCurso: String(selected.legacyId || ''),
      versionPrograma: selected.version || ''
    }));

    setSelectedCalendarDates([]);
    setCampesenaCalendarDates({
      instructor_tecnico: [],
      instructor_empresarial: [],
      instructor_full_popular: []
    });

    setShowProgramModal(false);
  };

  const onSubmit = async (event) => {
    // Flujo de envío:
    // 1) validaciones de negocio
    // 2) armado de FormData
    // 3) POST al backend
    event.preventDefault();

    const showAlert = (type, message) => {
      setAlert({ type, message });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const cupo = Number(form.cupoAprendices || 0);
    if (form.tieneEmpresa === 'no' && (!Number.isFinite(cupo) || cupo < 25)) {
      showAlert('error', 'Para oferta abierta, el cupo mínimo es 25 aprendices.');
      return;
    }

    if (!isCampesena && !form.diasSemana.length) {
      showAlert('error', 'Debe seleccionar al menos un día de la semana.');
      return;
    }

    if (!form.codigoCurso) {
      showAlert('error', 'Debe seleccionar un programa de formación.');
      return;
    }

    if (!isCampesena && hoursPerDay <= 0) {
      showAlert('error', 'Debe seleccionar horarios de inicio y fin válidos.');
      return;
    }

    if (!isCampesena && isCalendarVisible && selectedCalendarDates.length === 0) {
      showAlert('error', 'Debe seleccionar al menos una fecha específica del calendario.');
      return;
    }

    if (!isCampesena && requiredDays > 0 && selectedCalendarDates.length !== requiredDays) {
      const difference = requiredDays - selectedCalendarDates.length;
      const message =
        difference > 0
          ? `Faltan ${difference} día(s) por seleccionar.`
          : `Hay ${Math.abs(difference)} día(s) de más seleccionados.`;

      showAlert(
        'error',
        `No puede continuar. Horas del programa: ${totalHours} | Horas por día: ${hoursPerDay} | Días necesarios: ${requiredDays} | Días seleccionados: ${selectedCalendarDates.length}. ${message}`
      );
      return;
    }

    let campesenaAsignaciones = [];
    let campesenaHorariosPayload = null;
    if (isCampesena) {
      // Construye asignaciones de cargos con instructores y días asociados.
      campesenaAsignaciones = CAMPESENA_ROLE_OPTIONS.reduce((accumulator, roleOption) => {
        const instructorId = getInstructorIdForRole(roleOption.value);
        if (!instructorId) {
          return accumulator;
        }

        const schedule = getRoleSchedule(roleOption.value);

        accumulator.push({
          cargo: roleOption.value,
          instructorId,
          diasSemana: schedule.diasSemana
        });

        return accumulator;
      }, []);

      if (!campesenaAsignaciones.length) {
        showAlert('error', 'Para ficha CampeSENA debe asignar al menos un cargo de instructor.');
        return;
      }

      // Validación de integridad por cargo: días, rango horario y fechas.
      const missingDaysRole = campesenaAsignaciones.find((item) => !item.diasSemana?.length);
      if (missingDaysRole) {
        const roleLabel = CAMPESENA_ROLE_OPTIONS.find((item) => item.value === missingDaysRole.cargo)?.label || 'el cargo';
        showAlert('error', `Debe seleccionar días para ${roleLabel}.`);
        return;
      }

      let totalCampesenaHorasAsignadas = 0;
      for (const asignacion of campesenaAsignaciones) {
        const schedule = getRoleSchedule(asignacion.cargo);
        const startMinutes = toMinutes(schedule.horaInicio);
        const endMinutes = toMinutes(schedule.horaFin);
        const roleLabel = CAMPESENA_ROLE_OPTIONS.find((item) => item.value === asignacion.cargo)?.label || asignacion.cargo;

        if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
          showAlert('error', `Debe configurar hora de inicio y fin válidas para ${roleLabel}.`);
          return;
        }

        if (!schedule.fechasCalendario.length) {
          showAlert('error', `Debe seleccionar fechas del calendario para ${roleLabel}.`);
          return;
        }

        const roleHoursPerDay = (endMinutes - startMinutes) / 60;
        totalCampesenaHorasAsignadas += schedule.fechasCalendario.length * roleHoursPerDay;

        const monthLimit = asignacion.cargo === 'instructor_full_popular' ? 2 : 5;
        const roleMonths = [...new Set(
          schedule.fechasCalendario.map((date) => date.slice(0, 7)).filter(Boolean)
        )];
        if (roleMonths.length > monthLimit) {
          showAlert('error', `${roleLabel} solo puede abarcar máximo ${monthLimit} mes(es).`);
          return;
        }
      }

      if (Math.abs(totalCampesenaHorasAsignadas - totalHours) > 0.01) {
        // Valida que la suma de horas de todos los cargos coincida con horas del programa.
        const faltantes = Math.max(0, totalHours - totalCampesenaHorasAsignadas);
        const excedentes = Math.max(0, totalCampesenaHorasAsignadas - totalHours);
        showAlert(
          'error',
          totalCampesenaHorasAsignadas < totalHours
            ? `Las horas asignadas entre todos los cargos no alcanzan las horas del programa. Horas programa: ${totalHours} | Horas asignadas: ${formatHours(totalCampesenaHorasAsignadas)} | Faltan: ${formatHours(faltantes)}.`
            : `Las horas asignadas entre todos los cargos superan las horas del programa. Horas programa: ${totalHours} | Horas asignadas: ${formatHours(totalCampesenaHorasAsignadas)} | Excedente: ${formatHours(excedentes)}.`
        );
        return;
      }

      for (let index = 0; index < campesenaAsignaciones.length; index += 1) {
        // Regla de no solape por fecha entre cargos CampeSENA.
        for (let nested = index + 1; nested < campesenaAsignaciones.length; nested += 1) {
          const left = campesenaAsignaciones[index];
          const right = campesenaAsignaciones[nested];

          const leftDates = getRoleSchedule(left.cargo).fechasCalendario;
          const rightDates = getRoleSchedule(right.cargo).fechasCalendario;
          const hasDateOverlap = leftDates.some((date) => rightDates.includes(date));
          if (hasDateOverlap) {
            const leftLabel = CAMPESENA_ROLE_OPTIONS.find((item) => item.value === left.cargo)?.label || left.cargo;
            const rightLabel = CAMPESENA_ROLE_OPTIONS.find((item) => item.value === right.cargo)?.label || right.cargo;
            showAlert('error', `No se permite compartir fechas de calendario entre ${leftLabel} y ${rightLabel}, aunque tengan horarios distintos.`);
            return;
          }
        }
      }

      if (!campesenaAsignaciones.some((item) => item.instructorId === user?.id)) {
        // El creador debe quedar asignado al menos en un cargo.
        showAlert('error', 'Debe asignarse al menos un cargo al instructor que está creando la solicitud.');
        return;
      }

      campesenaHorariosPayload = {
        fechaInicioCompartida: form.fechaInicio,
        tecnico: getRoleSchedule('instructor_tecnico'),
        empresarial: getRoleSchedule('instructor_empresarial'),
        fullPopular: getRoleSchedule('instructor_full_popular')
      };

      const allDates = [
        ...campesenaHorariosPayload.tecnico.fechasCalendario,
        ...campesenaHorariosPayload.empresarial.fechasCalendario,
        ...campesenaHorariosPayload.fullPopular.fechasCalendario
      ].filter(Boolean);

      if (!allDates.length) {
        showAlert('error', 'Debe seleccionar al menos una fecha de calendario en Campesena.');
        return;
      }
    }

    if (form.tieneEmpresa === 'si') {
      // Validación de campos obligatorios cuando la oferta es cerrada.
      const requiredCompanyFields = {
        'Empresa Solicitante': form.empresaSolicitante.trim(),
        'Tipo de Empresa': form.tipoEmpresa.trim(),
        'Nombre del Responsable': form.nombreResponsable.trim(),
        'NIT de la Empresa': form.nitEmpresa.trim(),
        Convenio: form.convenioEmpresa.trim(),
        'Fecha de creación de la empresa': form.fechaCreacionEmpresa,
        'Dirección de la empresa': form.direccionEmpresa.trim(),
        'Nombre del contacto': form.nombreContactoEmpresa.trim(),
        'Correo de contacto': form.correoContactoEmpresa.trim(),
        'Número de empleados': form.numeroEmpleadosEmpresa,
        'Carta de Solicitud': document.getElementById('cartaSolicitud')?.value || ''
      };

      const missing = Object.keys(requiredCompanyFields).filter(
        (field) => !requiredCompanyFields[field]
      );

      if (missing.length) {
        showAlert('error', `Faltan datos obligatorios: ${missing.join(', ')}`);
        return;
      }
    }

    try {
      setSubmitting(true);
      setAlert(null);

      // FormData permite enviar datos + archivo PDF en una sola petición.
      const payload = new FormData();
      payload.append('tipoSolicitud', isCampesena ? 'campesena' : 'normal');
      payload.append('tipoOferta', form.tieneEmpresa);
      payload.append('programaId', selectedProgramId);
      payload.append('subsectorEconomico', form.subsectorEconomico || '');
      payload.append('cupoAprendices', String(Number(form.cupoAprendices)));
      payload.append('municipioFormacion', form.municipioFormacion);
      payload.append('direccionFormacion', form.direccionFormacion || '');
      payload.append('programaEspecial', form.programaEspecial);
      payload.append('nombreAmbiente', form.nombreAmbiente || '');
      payload.append('fechaInicio', form.fechaInicio);
      payload.append('fechaFinalizacion', form.fechaFinalizacion);
      payload.append('horarioInicio', form.horarioInicio);
      payload.append('horarioFin', form.horarioFin);
      const unionDaysCampesena = [...new Set([
        ...form.campesenaDiasTecnico,
        ...form.campesenaDiasEmpresarial,
        ...form.campesenaDiasFullPopular
      ])];
      const unionDatesCampesena = [...new Set([
        ...(campesenaCalendarDates.instructor_tecnico || []),
        ...(campesenaCalendarDates.instructor_empresarial || []),
        ...(campesenaCalendarDates.instructor_full_popular || [])
      ])].sort();

      payload.append('diasSemana', JSON.stringify(isCampesena ? unionDaysCampesena : form.diasSemana));
      payload.append('fechasCalendario', JSON.stringify(isCampesena ? unionDatesCampesena : selectedCalendarDates));
      payload.append('campesenaAsignaciones', JSON.stringify(campesenaAsignaciones));
      payload.append('campesenaHorarios', JSON.stringify(campesenaHorariosPayload));
      payload.append('empresaSolicitante', form.empresaSolicitante || '');
      payload.append('tipoEmpresa', form.tipoEmpresa || '');
      payload.append('nombreResponsable', form.nombreResponsable || '');
      payload.append('nitEmpresa', form.nitEmpresa || '');
      payload.append('convenioEmpresa', form.convenioEmpresa || '');
      payload.append('fechaCreacionEmpresa', form.fechaCreacionEmpresa || '');
      payload.append('direccionEmpresa', form.direccionEmpresa || '');
      payload.append('nombreContactoEmpresa', form.nombreContactoEmpresa || '');
      payload.append('correoContactoEmpresa', form.correoContactoEmpresa || '');
      payload.append('numeroEmpleadosEmpresa', form.numeroEmpleadosEmpresa || '');

      const cartaFile = document.getElementById('cartaSolicitud')?.files?.[0] || null;
      if (cartaFile) {
        payload.append('cartaSolicitud', cartaFile);
      }

      await api.post('/solicitudes', payload, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      showAlert('success', 'Solicitud registrada correctamente.');
    } catch (error) {
      const message = error?.response?.data?.message || 'No se pudo registrar la solicitud';
      showAlert('error', message);
    } finally {
      setSubmitting(false);
    }
  };

  const cupoMinimo = form.tieneEmpresa === 'no' ? 25 : 1;

  // Métricas mostradas en el bloque de resumen de horas/calendario.
  const displaySelectedDays = isCampesena ? campeSenaCombinedDays : currentCalendarDates.length;
  const displayAccumulatedHours = isCampesena ? campeSenaCombinedHours : currentCalendarDates.length * hoursPerDay;

  const infoHoursClass =
    displaySelectedDays === 0 || totalHours === 0
      ? 'estado-faltante'
      : Math.abs(displayAccumulatedHours - totalHours) < 0.01
        ? 'estado-correcto'
        : displayAccumulatedHours < totalHours
          ? 'estado-faltante'
          : 'estado-exceso';

  return (
    <PortalLayout>
      {/* Encabezado dinámico según variante de formulario. */}
      <div className="titulo-seccion">
        <h2 className="titulo-pagina">
          {isCampesena ? 'FORMULARIO FICHA CAMPESENA' : 'FORMULARIO FICHA REGULAR'}
        </h2>
        <p className="subtitulo-pagina">
          {isCampesena
            ? 'Complete todos los campos requeridos para crear la solicitud de ficha CampeSENA'
            : 'Complete todos los campos requeridos para crear la solicitud de ficha'}
        </p>
      </div>

      {alert ? (
        <div className="alertas">
          <div className={`alert ${alert.type === 'error' ? 'alert-error' : 'alert-success'}`}>
            {alert.message}
          </div>
        </div>
      ) : null}

      {loadingCatalogs ? (
        <div className="estado-carga">Cargando catálogos...</div>
      ) : (
        // Formulario principal de creación de solicitud.
        <form className="formulario-ficha" onSubmit={onSubmit}>
          <div className="seccion-formulario">
            <h3 className="titulo-seccion-form">Información del Programa</h3>

            <div className="fila-campos-2">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="tieneEmpresa">Tipo de oferta*:</label>
                <select
                  className="entrada-select"
                  id="tieneEmpresa"
                  name="tieneEmpresa"
                  required
                  value={form.tieneEmpresa}
                  onChange={onChangeOferta}
                >
                  <option value="">Seleccione una opción</option>
                  <option value="no">Abierta</option>
                  <option value="si">Cerrada</option>
                </select>
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo">&nbsp;</label>
                <button className="boton-modal" type="button" onClick={() => setShowProgramModal(true)}>
                  Filtrar y Seleccionar Programa
                </button>
              </div>
            </div>

            <div className="fila-campos-2">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="tipoPrograma">Tipo de Programa*:</label>
                <input className="entrada-texto" id="tipoPrograma" name="tipoPrograma" readOnly required value={form.tipoPrograma} />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="horasPrograma">Horas del Programa*:</label>
                <input className="entrada-texto" id="horasPrograma" name="horasPrograma" readOnly required value={form.horasPrograma} />
              </div>
            </div>

            <div className="campo-entrada">
              <label className="etiqueta-campo" htmlFor="nombrePrograma">Nombre del Programa*:</label>
              <input className="entrada-texto" id="nombrePrograma" name="nombrePrograma" readOnly required value={form.nombrePrograma} />
            </div>

            <div className="fila-campos-3">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="codigoCurso">Código de Curso*:</label>
                <input className="entrada-texto" id="codigoCurso" name="codigoCurso" readOnly required value={form.codigoCurso} />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="versionPrograma">Versión del Programa*:</label>
                <input className="entrada-texto" id="versionPrograma" name="versionPrograma" readOnly required value={form.versionPrograma} />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="subsectorEconomico">Subsector Económico*:</label>
                <input
                  className="entrada-texto"
                  id="subsectorEconomico"
                  name="subsectorEconomico"
                  required
                  value={form.subsectorEconomico}
                  onChange={onInput}
                />
              </div>
            </div>
          </div>

          {isCampesena ? (
            // Sección exclusiva de asignación y configuración CampeSENA.
            <div className="seccion-formulario">
              <h3 className="titulo-seccion-form">Asignación de Instructores CampeSENA</h3>

              <div className="campo-entrada">
                <label className="etiqueta-campo">Cargo(s) que usted ocupará en esta solicitud:</label>
                <div className="contenedor-checkboxes">
                  {CAMPESENA_ROLE_OPTIONS.map((roleOption) => (
                    <label key={`role-user-${roleOption.value}`}>
                      <input
                        checked={form.campesenaRolesUsuario.includes(roleOption.value)}
                        onChange={() => onToggleCampesenaRole(roleOption.value)}
                        type="checkbox"
                        value={roleOption.value}
                      />
                      {roleOption.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="fila-campos-3">
                <div className="campo-entrada">
                  <label className="etiqueta-campo" htmlFor="campesenaInstructorTecnicoId">
                    Instructor para cargo Técnico
                  </label>
                  <select
                    className="entrada-select"
                    id="campesenaInstructorTecnicoId"
                    name="campesenaInstructorTecnicoId"
                    disabled={form.campesenaRolesUsuario.includes('instructor_tecnico')}
                    value={form.campesenaRolesUsuario.includes('instructor_tecnico') ? user?.id || '' : form.campesenaInstructorTecnicoId}
                    onChange={onInput}
                  >
                    <option value="">{form.campesenaRolesUsuario.includes('instructor_tecnico') ? 'Lo ocupa usted' : 'Seleccione instructor'}</option>
                    {catalogs.instructoresCampesena
                      .filter((item) => String(item._id) !== String(user?.id || ''))
                      .map((item) => (
                        <option key={`tec-${item._id}`} value={item._id}>{item.nombre}</option>
                      ))}
                  </select>
                </div>

                <div className="campo-entrada">
                  <label className="etiqueta-campo" htmlFor="campesenaInstructorEmpresarialId">
                    Instructor para cargo Empresarial
                  </label>
                  <select
                    className="entrada-select"
                    id="campesenaInstructorEmpresarialId"
                    name="campesenaInstructorEmpresarialId"
                    disabled={form.campesenaRolesUsuario.includes('instructor_empresarial')}
                    value={form.campesenaRolesUsuario.includes('instructor_empresarial') ? user?.id || '' : form.campesenaInstructorEmpresarialId}
                    onChange={onInput}
                  >
                    <option value="">{form.campesenaRolesUsuario.includes('instructor_empresarial') ? 'Lo ocupa usted' : 'Seleccione instructor'}</option>
                    {catalogs.instructoresCampesena
                      .filter((item) => String(item._id) !== String(user?.id || ''))
                      .map((item) => (
                        <option key={`emp-${item._id}`} value={item._id}>{item.nombre}</option>
                      ))}
                  </select>
                </div>

                <div className="campo-entrada">
                  <label className="etiqueta-campo" htmlFor="campesenaInstructorFullPopularId">
                    Instructor para cargo Full Popular
                  </label>
                  <select
                    className="entrada-select"
                    id="campesenaInstructorFullPopularId"
                    name="campesenaInstructorFullPopularId"
                    disabled={form.campesenaRolesUsuario.includes('instructor_full_popular')}
                    value={form.campesenaRolesUsuario.includes('instructor_full_popular') ? user?.id || '' : form.campesenaInstructorFullPopularId}
                    onChange={onInput}
                  >
                    <option value="">{form.campesenaRolesUsuario.includes('instructor_full_popular') ? 'Lo ocupa usted' : 'Seleccione instructor'}</option>
                    {catalogs.instructoresCampesena
                      .filter((item) => String(item._id) !== String(user?.id || ''))
                      .map((item) => (
                        <option key={`full-${item._id}`} value={item._id}>{item.nombre}</option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="campo-entrada">
                <button
                  className="boton-modal"
                  type="button"
                  onClick={() => setShowCampesenaHorarioModal(true)}
                  disabled={!campesenaEnabledRoles.length}
                >
                  Configurar Horario CampeSENA
                </button>
                <small className="texto-ayuda">
                  Aquí configura fecha de inicio, jornada, días y calendario por cargo. Asigne primero al menos un instructor.
                </small>
              </div>
            </div>
          ) : null}

          <div className="seccion-formulario" id="seccionEmpresa" style={{ display: form.tieneEmpresa === 'si' ? 'block' : 'none' }}>
            <h3 className="titulo-seccion-form">Empresa y Responsable</h3>

            <div className="info-empresa">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="empresaSolicitante">Empresa Solicitante*:</label>
                <input
                  className="entrada-texto"
                  id="empresaSolicitante"
                  name="empresaSolicitante"
                  placeholder="Nombre de la empresa"
                  required={form.tieneEmpresa === 'si'}
                  value={form.empresaSolicitante}
                  onChange={onInput}
                />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="tipoEmpresa">Tipo de Empresa*:</label>
                <select
                  className="entrada-select"
                  id="tipoEmpresa"
                  name="tipoEmpresa"
                  required={form.tieneEmpresa === 'si'}
                  value={form.tipoEmpresa}
                  onChange={onInput}
                >
                  <option value="">Seleccione...</option>
                  {catalogs.tiposEmpresa.map((tipo) => (
                    <option key={tipo._id} value={tipo._id}>{tipo.nombre}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="responsable-empresa">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="nombreResponsable">Nombre del Responsable*:</label>
                <input
                  className="entrada-texto"
                  id="nombreResponsable"
                  name="nombreResponsable"
                  placeholder="Nombre completo"
                  required={form.tieneEmpresa === 'si'}
                  value={form.nombreResponsable}
                  onChange={onInput}
                />
              </div>
            </div>

            <div className="fila-campos-2">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="nitEmpresa">NIT de la Empresa*:</label>
                <input
                  className="entrada-texto"
                  id="nitEmpresa"
                  name="nitEmpresa"
                  placeholder="123.456.789-0"
                  required={form.tieneEmpresa === 'si'}
                  value={form.nitEmpresa}
                  onChange={onInput}
                />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="convenioEmpresa">Convenio*:</label>
                <input
                  className="entrada-texto"
                  id="convenioEmpresa"
                  name="convenioEmpresa"
                  placeholder="Nombre o código del convenio"
                  required={form.tieneEmpresa === 'si'}
                  value={form.convenioEmpresa}
                  onChange={onInput}
                />
              </div>
            </div>

            <div className="fila-campos-3">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="fechaCreacionEmpresa">Fecha de creación de la empresa*:</label>
                <input
                  className="entrada-texto"
                  id="fechaCreacionEmpresa"
                  name="fechaCreacionEmpresa"
                  type="date"
                  required={form.tieneEmpresa === 'si'}
                  value={form.fechaCreacionEmpresa}
                  onChange={onInput}
                />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="nombreContactoEmpresa">Nombre del contacto de la empresa*:</label>
                <input
                  className="entrada-texto"
                  id="nombreContactoEmpresa"
                  name="nombreContactoEmpresa"
                  placeholder="Nombre de contacto"
                  required={form.tieneEmpresa === 'si'}
                  value={form.nombreContactoEmpresa}
                  onChange={onInput}
                />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="correoContactoEmpresa">Correo de contacto*:</label>
                <input
                  className="entrada-texto"
                  id="correoContactoEmpresa"
                  name="correoContactoEmpresa"
                  type="email"
                  placeholder="contacto@empresa.com"
                  required={form.tieneEmpresa === 'si'}
                  value={form.correoContactoEmpresa}
                  onChange={onInput}
                />
              </div>
            </div>

            <div className="fila-campos-2">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="direccionEmpresa">Dirección de la empresa*:</label>
                <input
                  className="entrada-texto"
                  id="direccionEmpresa"
                  name="direccionEmpresa"
                  placeholder="Dirección de la empresa"
                  required={form.tieneEmpresa === 'si'}
                  value={form.direccionEmpresa}
                  onChange={onInput}
                />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="numeroEmpleadosEmpresa">Número de empleados de la empresa*:</label>
                <input
                  className="entrada-texto"
                  id="numeroEmpleadosEmpresa"
                  name="numeroEmpleadosEmpresa"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Ej: 50"
                  required={form.tieneEmpresa === 'si'}
                  value={form.numeroEmpleadosEmpresa}
                  onChange={onInput}
                />
              </div>
            </div>

            <div className="fila-campos-2">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="cartaSolicitud">Carta de Solicitud (PDF)*:</label>
                <input id="cartaSolicitud" name="cartaSolicitud" type="file" accept=".pdf" required={form.tieneEmpresa === 'si'} />
                <small className="texto-ayuda">Solo archivos PDF. Máximo 5MB.</small>
              </div>
            </div>
          </div>

          <div className="seccion-formulario">
            <h3 className="titulo-seccion-form">Cupos y Ubicación de Formación</h3>

            <div className="fila-campos-3">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="cupoAprendices">Cupo de Aprendices*:</label>
                <input
                  className="entrada-texto"
                  id="cupoAprendices"
                  name="cupoAprendices"
                  min={cupoMinimo}
                  required
                  step="1"
                  type="number"
                  value={form.cupoAprendices}
                  onChange={onInput}
                />
                {form.tieneEmpresa === 'no' ? (
                  <small className="texto-ayuda">Para oferta abierta, el cupo mínimo es 25 aprendices.</small>
                ) : null}
              </div>

              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="departamentoFormacion">Departamento de Formación*:</label>
                <select
                  className="entrada-select"
                  id="departamentoFormacion"
                  name="departamentoFormacion"
                  required
                  value={form.departamentoFormacion}
                  onChange={(event) => {
                    setForm((prev) => ({
                      ...prev,
                      departamentoFormacion: event.target.value,
                      municipioFormacion: ''
                    }));
                  }}
                >
                  <option value="">Seleccione departamento</option>
                  {catalogs.departamentos.map((item) => (
                    <option key={item._id} value={item._id}>{item.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="municipioFormacion">Municipio de Formación*:</label>
                <select
                  className="entrada-select"
                  id="municipioFormacion"
                  name="municipioFormacion"
                  required
                  value={form.municipioFormacion}
                  onChange={onInput}
                >
                  <option value="">
                    {form.departamentoFormacion ? 'Seleccione municipio' : 'Primero seleccione departamento'}
                  </option>
                  {filteredMunicipios.map((item) => (
                    <option key={item._id} value={item._id}>{item.nombre}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="campo-entrada">
              <label className="etiqueta-campo" htmlFor="direccionFormacion">Dirección de Formación*:</label>
              <textarea
                className="entrada-textarea"
                id="direccionFormacion"
                name="direccionFormacion"
                required
                rows="3"
                value={form.direccionFormacion}
                onChange={onInput}
              />
            </div>
          </div>

          <div className="seccion-formulario">
            <h3 className="titulo-seccion-form">Programa Especial y Ambiente de Formación</h3>
            <div className="fila-campos-2">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="programaEspecial">Programa Especial*:</label>
                <select
                  className="entrada-select"
                  id="programaEspecial"
                  name="programaEspecial"
                  required
                  value={form.programaEspecial}
                  onChange={onInput}
                >
                  <option value="">Seleccione programa</option>
                  {catalogs.programasEspeciales.map((item) => (
                    <option key={item._id} value={item._id}>{item.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="nombreAmbiente">Nombre del Ambiente*:</label>
                <input
                  className="entrada-texto"
                  id="nombreAmbiente"
                  name="nombreAmbiente"
                  placeholder="Nombre del ambiente"
                  value={form.nombreAmbiente}
                  onChange={onInput}
                />
              </div>
            </div>
          </div>

          {!isCampesena ? (
          // Sección exclusiva de programación para solicitud regular.
          <div className="seccion-formulario">
            <h3 className="titulo-seccion-form">Programación del Curso y Horario</h3>
            <div className="fila-campos-2">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="fechaInicio">Fecha de Inicio*:</label>
                <input
                  className="entrada-texto"
                  id="fechaInicio"
                  min={new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]}
                  name="fechaInicio"
                  required
                  type="date"
                  value={form.fechaInicio}
                  onChange={onInput}
                />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="fechaFinalizacion">Fecha de Finalización*:</label>
                <input
                  className="entrada-texto"
                  id="fechaFinalizacion"
                  name="fechaFinalizacion"
                  readOnly
                  type="date"
                  value={form.fechaFinalizacion}
                  onChange={onInput}
                />
              </div>
            </div>

            <div className="contenedor-horarios">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="horarioInicio">Hora de Inicio*:</label>
                <input className="entrada-texto" id="horarioInicio" name="horarioInicio" required type="time" value={form.horarioInicio} onChange={onInput} />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="horarioFin">Hora de Fin*:</label>
                <input className="entrada-texto" id="horarioFin" name="horarioFin" required type="time" value={form.horarioFin} onChange={onInput} />
              </div>
            </div>

            <div className="campo-entrada">
              <label className="etiqueta-campo">Días de la Semana*:</label>
              <div className="contenedor-checkboxes">
                {DAY_OPTIONS.map((item) => (
                  <label key={item.value}>
                    <input
                      checked={form.diasSemana.includes(item.value)}
                      onChange={() => onToggleDay(item.value)}
                      type="checkbox"
                      value={item.value}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>

            {isCalendarVisible ? (
              <div className="calendario-container">
                <h4 className="calendario-titulo">Selecciona los días específicos del curso:</h4>

                <div className={`info-horas ${infoHoursClass}`}>
                  <div className="resumen-horas">
                    <p><strong>Horas del programa:</strong> <span>{totalHours} horas</span></p>
                    <p><strong>Horas acumuladas:</strong> <span>{formatHours(displayAccumulatedHours)} horas</span></p>
                    {isCampesena ? <p><strong>Horas faltantes:</strong> <span>{formatHours(campeSenaRemainingHours)} horas</span></p> : null}
                    {!isCampesena ? <p><strong>Días necesarios:</strong> <span>{requiredDays} días</span></p> : null}
                    <p><strong>Días seleccionados:</strong> <span>{displaySelectedDays} días seleccionados</span></p>
                  </div>
                </div>

                <div className="calendario-meses">
                  {calendarMonths.map((month) => (
                    <div key={month.id} className="calendar-mes">
                      <h5>{month.label}</h5>
                      <div className="calendar-header">
                        {WEEKDAY_LABELS.map((label) => (
                          <div key={`${month.id}-${label}`}>{label}</div>
                        ))}
                      </div>
                      <div className="calendar-grid">
                        {Array.from({ length: month.prefixBlanks }).map((_, index) => (
                          <div key={`${month.id}-blank-${index}`} />
                        ))}
                        {month.days.map((day) => {
                          if (!day.selectable) {
                            return (
                              <div key={day.iso} className="calendar-day calendar-day--disabled">
                                {day.day}
                              </div>
                            );
                          }

                          return (
                            <div key={day.iso} className="calendar-day calendar-day--selectable">
                              <label>
                                <input
                                  checked={selectedCalendarSet.has(day.iso)}
                                  name="fechasEspecificas[]"
                                  onChange={() => onToggleCalendarDate(day.iso)}
                                  type="checkbox"
                                  value={day.iso}
                                />
                                {day.day}
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="calendario-controles">
                  <button className="boton-secundario" onClick={() => onSelectAllCalendarDates(true)} type="button">
                    Seleccionar Todos
                  </button>
                  <button className="boton-secundario" onClick={() => onSelectAllCalendarDates(false)} type="button">
                    Deseleccionar Todos
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          ) : null}

          <div className="contenedor-botones-formulario">
            <Link className="boton-cancelar" to="/solicitudes/crear">
              Cancelar
            </Link>
            <button className="boton-enviar" disabled={submitting} type="submit">
              {submitting
                ? 'Guardando...'
                : isCampesena
                  ? 'Enviar Solicitud CampeSENA'
                  : 'Siguiente'}
            </button>
          </div>
        </form>
      )}

      {showCampesenaHorarioModal ? (
        // Modal para configurar calendarios y horarios por cargo CampeSENA.
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-contenido">
            <button className="cerrar-modal" onClick={() => setShowCampesenaHorarioModal(false)} type="button">&times;</button>
            <h3>Programación del Curso y Horario (Campesena)</h3>

            <div className="campo-entrada">
              <label className="etiqueta-campo">Sección de horario activa:</label>
              <div className="calendario-controles" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
                {CAMPESENA_ROLE_OPTIONS.filter((role) => campesenaEnabledRoles.includes(role.value)).map((role) => (
                  <button
                    key={`switch-${role.value}`}
                    className={`boton-secundario ${effectiveCampesenaRole === role.value ? `boton-${role.colorClass}` : ''}`}
                    type="button"
                    onClick={() => setActiveCampesenaRole(role.value)}
                  >
                    {role.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="fila-campos-2">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="fechaInicioModal">Fecha de Inicio*:</label>
                <input
                  className="entrada-texto"
                  id="fechaInicioModal"
                  min={new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]}
                  name="fechaInicio"
                  type="date"
                  value={form.fechaInicio}
                  onChange={onInput}
                />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="fechaFinalizacionModal">Fecha de Finalización*:</label>
                <input
                  className="entrada-texto"
                  id="fechaFinalizacionModal"
                  name="fechaFinalizacion"
                  readOnly
                  type="date"
                  value={form.fechaFinalizacion}
                  onChange={onInput}
                />
              </div>
            </div>

            <div className="contenedor-horarios">
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="horarioInicioModal">Hora de Inicio ({CAMPESENA_ROLE_OPTIONS.find((item) => item.value === effectiveCampesenaRole)?.label || ''})*:</label>
                <input
                  className="entrada-texto"
                  id="horarioInicioModal"
                  name={activeRoleFields?.horarioInicio}
                  type="time"
                  value={activeRoleFields ? form[activeRoleFields.horarioInicio] : ''}
                  onChange={onInput}
                />
              </div>
              <div className="campo-entrada">
                <label className="etiqueta-campo" htmlFor="horarioFinModal">Hora de Fin ({CAMPESENA_ROLE_OPTIONS.find((item) => item.value === effectiveCampesenaRole)?.label || ''})*:</label>
                <input
                  className="entrada-texto"
                  id="horarioFinModal"
                  name={activeRoleFields?.horarioFin}
                  type="time"
                  value={activeRoleFields ? form[activeRoleFields.horarioFin] : ''}
                  onChange={onInput}
                />
              </div>
            </div>

            <div className="campo-entrada">
              <label className="etiqueta-campo">Días de semana para {CAMPESENA_ROLE_OPTIONS.find((item) => item.value === effectiveCampesenaRole)?.label || 'cargo'}:</label>
              <div className="contenedor-checkboxes">
                {DAY_OPTIONS.map((item) => (
                  <label key={`modal-role-day-${item.value}`}>
                    <input
                      checked={activeRoleFields ? (form[activeRoleFields.dias] || []).includes(item.value) : false}
                      onChange={() => activeRoleFields && onToggleCampesenaRoleDay(activeRoleFields.dias, item.value)}
                      type="checkbox"
                      value={item.value}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>

            {isCalendarVisible ? (
              <div className="calendario-container">
                <h4 className="calendario-titulo">Selecciona los días específicos del curso:</h4>

                <div className={`info-horas ${infoHoursClass}`}>
                  <div className="resumen-horas">
                    <p><strong>Horas del programa:</strong> <span>{totalHours} horas</span></p>
                    <p><strong>Horas acumuladas:</strong> <span>{formatHours(displayAccumulatedHours)} horas</span></p>
                    {isCampesena ? <p><strong>Horas faltantes:</strong> <span>{formatHours(campeSenaRemainingHours)} horas</span></p> : null}
                    {!isCampesena ? <p><strong>Días necesarios:</strong> <span>{requiredDays} días</span></p> : null}
                    <p><strong>Días seleccionados:</strong> <span>{displaySelectedDays} días seleccionados</span></p>
                  </div>
                </div>

                <div className="calendario-meses">
                  {calendarMonths.map((month) => (
                    <div key={`modal-${month.id}`} className="calendar-mes">
                      <h5>{month.label}</h5>
                      <div className="calendar-header">
                        {WEEKDAY_LABELS.map((label) => (
                          <div key={`${month.id}-modal-${label}`}>{label}</div>
                        ))}
                      </div>
                      <div className="calendar-grid">
                        {Array.from({ length: month.prefixBlanks }).map((_, index) => (
                          <div key={`${month.id}-modal-blank-${index}`} />
                        ))}
                        {month.days.map((day) => {
                          const blockedByOtherRole = isCampesenaDateBlockedByOtherRole(day.iso);

                          if (!day.selectable || blockedByOtherRole) {
                            return (
                              <div key={`modal-${day.iso}`} className={`calendar-day ${blockedByOtherRole ? 'calendar-day--blocked' : 'calendar-day--disabled'}`}>
                                {day.day}
                              </div>
                            );
                          }

                          return (
                            <div key={`modal-${day.iso}`} className={`calendar-day calendar-day--selectable calendar-day--${CAMPESENA_ROLE_OPTIONS.find((item) => item.value === effectiveCampesenaRole)?.colorClass || 'tecnico'}`}>
                              <label>
                                <input
                                  checked={selectedCalendarSet.has(day.iso)}
                                  name="fechasEspecificas[]"
                                  onChange={() => onToggleCalendarDate(day.iso)}
                                  type="checkbox"
                                  value={day.iso}
                                />
                                {day.day}
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <button className="boton-seleccionar-programa" onClick={() => setShowCampesenaHorarioModal(false)} type="button">
              Guardar Configuración de Horario
            </button>
          </div>
        </div>
      ) : null}

      {showProgramModal ? (
        // Modal para filtrar y seleccionar programa de formación.
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-contenido">
            <button className="cerrar-modal" onClick={() => setShowProgramModal(false)} type="button">&times;</button>
            <h3>Filtrar Programa de Formación</h3>

            <label htmlFor="modalArea">Área del Programa:</label>
            <select
              className="entrada-select"
              id="modalArea"
              value={modalFilter.areaId}
              onChange={(event) => setModalFilter((prev) => ({ ...prev, areaId: event.target.value }))}
            >
              <option value="">Todas las áreas</option>
              {catalogs.areas.map((item) => (
                <option key={item._id} value={item._id}>{item.nombre}</option>
              ))}
            </select>

            <label htmlFor="modalHoras">Horas del Programa:</label>
            <select
              className="entrada-select"
              id="modalHoras"
              value={modalFilter.horas}
              onChange={(event) => setModalFilter((prev) => ({ ...prev, horas: event.target.value }))}
            >
              <option value="">Todas las horas</option>
              {uniqueHours.map((hours) => (
                <option key={hours} value={hours}>{hours}</option>
              ))}
            </select>

            <label>Programas Disponibles:</label>
            <div className="tabla-programas-wrapper" aria-label="Programas disponibles">
              <table className="tabla-programas">
                <thead>
                  <tr>
                    <th className="col-codigo">Código</th>
                    <th>Programa</th>
                    <th>Área</th>
                    <th className="col-horas">Horas</th>
                    <th className="col-version">Versión</th>
                  </tr>
                </thead>
                <tbody>
                  {programsForModal.map((program) => (
                    <tr
                      key={program._id}
                      className={selectedProgramId === program._id ? 'is-selected' : ''}
                      onClick={() => setSelectedProgramId(program._id)}
                    >
                      <td>{program.legacyId}</td>
                      <td>{program.nombre}</td>
                      <td>{program.area?.nombre}</td>
                      <td>{program.horas}</td>
                      <td>{program.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button className="boton-seleccionar-programa" disabled={!selectedProgramId} onClick={onSelectProgram} type="button">
              Seleccionar Programa
            </button>
          </div>
        </div>
      ) : null}
    </PortalLayout>
  );
};

export default SolicitudFormPage;