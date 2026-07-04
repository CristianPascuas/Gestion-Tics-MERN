import { api } from './client';

// Consulta catálogo de programas con filtros opcionales (incluye inactivos por parámetro).
export const fetchProgramas = async (params = {}) => {
  const response = await api.get('/programas', { params });
  return response.data || { programas: [] };
};

// Crea un programa de formación con los datos del formulario.
export const createPrograma = async (payload) => {
  const response = await api.post('/programas', payload);
  return response.data || null;
};

// Actualiza un programa existente por su identificador.
export const updatePrograma = async (programaId, payload) => {
  const response = await api.put(`/programas/${programaId}`, payload);
  return response.data || null;
};

// Cambia el estado activo/inactivo del programa seleccionado.
export const updateProgramaEstado = async (programaId, activo) => {
  const response = await api.patch(`/programas/${programaId}/estado`, { activo });
  return response.data || null;
};