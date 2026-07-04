import { api } from './client';

// Obtiene listado de solicitudes para la pantalla de consulta.
export const fetchSolicitudesConsulta = async () => {
  const response = await api.get('/solicitudes/consultas');
  return response.data || { solicitudes: [], catalogs: { estadosFicha: [] } };
};

// Obtiene reporte agregado de solicitudes con filtros opcionales.
export const fetchSolicitudesReportes = async (params = {}) => {
  const cleanParams = Object.entries(params).reduce((accumulator, [key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});

  const response = await api.get('/solicitudes/reportes', { params: cleanParams });
  return response.data || null;
};

// Envía una solicitud al coordinador asignado al instructor dueño.
export const sendSolicitudToCoordinator = async (solicitudId) => {
  const response = await api.post(`/solicitudes/${solicitudId}/enviar-coordinador`);
  return response.data || null;
};

// Reenvía solicitud retornada por funcionario directamente al funcionario.
export const sendSolicitudDirectToFuncionario = async (solicitudId) => {
  const response = await api.post(`/solicitudes/${solicitudId}/enviar-funcionario-directo`);
  return response.data || null;
};

// Envía solicitud revisada por coordinador al funcionario con observación.
export const sendSolicitudToFuncionario = async (solicitudId, payload) => {
  const response = await api.post(`/solicitudes/${solicitudId}/enviar-funcionario`, payload);
  return response.data || null;
};

// Actualiza estado de ficha y/o códigos de solicitud/ficha por funcionario.
export const updateSolicitudByFuncionario = async (solicitudId, payload) => {
  const response = await api.put(`/solicitudes/${solicitudId}/gestion-funcionario`, payload, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
  return response.data || null;
};

// Descarga el archivo SOFiA Plus asociado a una solicitud.
export const fetchSolicitudSofiaPlus = async (solicitudId) => {
  const response = await api.get(`/solicitudes/${solicitudId}/sofia-plus`, {
    responseType: 'blob'
  });

  return response.data;
};

// Obtiene detalle de ficha de caracterización por id de solicitud.
export const fetchSolicitudCaracterizacion = async (solicitudId) => {
  const response = await api.get(`/solicitudes/${solicitudId}/caracterizacion`);
  return response.data?.fichaCaracterizacion || null;
};

// Obtiene estructura tabular del formato de inscripción masiva por solicitud.
export const fetchSolicitudFormatoInscripcion = async (solicitudId) => {
  const response = await api.get(`/solicitudes/${solicitudId}/aspirantes/formato-inscripcion`);
  return response.data || { formato: { titulo: '', encabezados: [], filas: [] }, solicitud: null };
};

// Descarga el formato masivo de inscripción en archivo Excel.
export const fetchSolicitudFormatoInscripcionExcel = async (solicitudId) => {
  const response = await api.get(`/solicitudes/${solicitudId}/aspirantes/formato-inscripcion.xlsx`, {
    responseType: 'blob'
  });

  return response.data;
};

// Descarga la ficha de caracterización en formato Word compatible.
export const fetchSolicitudCaracterizacionWord = async (solicitudId) => {
  const response = await api.get(`/solicitudes/${solicitudId}/caracterizacion.doc`, {
    responseType: 'blob'
  });

  return response.data;
};
