import { api } from './client';

// Consulta pública del estado de inscripción de una solicitud.
export const fetchInscripcionPublica = async (solicitudId) => {
  const response = await api.get(`/solicitudes/${solicitudId}/inscripcion`);
  return response.data || null;
};

// Registro público de aspirante con documento PDF.
export const registerAspirantePublic = async (solicitudId, formData) => {
  const response = await api.post(`/solicitudes/${solicitudId}/inscripcion`, formData);
  return response.data || null;
};

// Lista de aspirantes para modal interno en consultar solicitudes.
export const fetchAspirantesBySolicitud = async (solicitudId) => {
  const response = await api.get(`/solicitudes/${solicitudId}/aspirantes`);
  return response.data || { solicitud: null, aspirantes: [] };
};

// Actualiza datos de un aspirante; puede incluir PDF nuevo.
export const updateAspiranteBySolicitud = async (solicitudId, aspiranteId, payload) => {
  const response = await api.put(`/solicitudes/${solicitudId}/aspirantes/${aspiranteId}`, payload);
  return response.data || null;
};

// Elimina un aspirante inscrito y libera cupo.
export const deleteAspiranteBySolicitud = async (solicitudId, aspiranteId) => {
  const response = await api.delete(`/solicitudes/${solicitudId}/aspirantes/${aspiranteId}`);
  return response.data || null;
};

// Obtiene PDF consolidado de documentos de identidad en orden de inscripción.
export const fetchAspirantesDocumentosPdf = async (solicitudId) => {
  const response = await api.get(`/solicitudes/${solicitudId}/aspirantes/documentos-identidad`, {
    responseType: 'blob'
  });

  return response.data;
};
