import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

// Contexto global de autenticación para compartir sesión en toda la app.
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  // Token persistido en localStorage para mantener sesión entre recargas.
  const [token, setToken] = useState(() => localStorage.getItem('access_token'));
  // Datos del usuario autenticado.
  const [user, setUser] = useState(null);
  // Bandera de carga inicial mientras se valida sesión.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Al cambiar token, intenta recuperar el usuario actual desde backend.
    const loadUser = async () => {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const response = await api.get('/auth/me');
        setUser(response.data.user);
      } catch (_error) {
        // Si el token falla (inválido/expirado), limpia sesión local.
        localStorage.removeItem('access_token');
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, [token]);

  const login = async (numeroCedula, clave, rol) => {
    // Inicia sesión, guarda token y actualiza usuario en memoria.
    const response = await api.post('/auth/login', { numeroCedula, clave, rol });
    localStorage.setItem('access_token', response.data.token);
    setToken(response.data.token);
    setUser(response.data.user);
    return response.data.user;
  };

  const register = async (payload) => {
    // Registro de usuario (no inicia sesión automáticamente).
    const response = await api.post('/auth/register', payload);
    return response.data;
  };

  const logout = () => {
    // Cierra sesión localmente.
    localStorage.removeItem('access_token');
    setToken(null);
    setUser(null);
  };

  // Valor memoizado para evitar renders innecesarios de consumidores del contexto.
  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      isAuthenticated: Boolean(token && user),
      login,
      register,
      logout
    }),
    [token, user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  // Hook de conveniencia para consumir AuthContext con validación de uso.
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return context;
};