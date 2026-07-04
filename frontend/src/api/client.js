import axios from 'axios';

// URL base de API (configurable por variable de entorno).
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// Instancia centralizada de axios para todo el frontend.
export const api = axios.create({
  baseURL: API_URL
});

api.interceptors.request.use((config) => {
  // Adjunta token bearer automáticamente si existe sesión activa.
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});