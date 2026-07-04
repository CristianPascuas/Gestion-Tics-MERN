import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

const VerifyEmailPage = () => {
  // useSearchParams expone los parámetros de la URL actual.
  // En este flujo esperamos algo como: /verificar-cuenta?token=XYZ
  const [searchParams] = useSearchParams();

  /**
   * useMemo (explicación detallada):
   *
   * - ¿Qué hace aquí?
   *   Deriva el token a partir de searchParams y devuelve siempre un string
   *   (si no existe token, retorna '').
   *
   * - ¿Por qué useMemo y no una lectura directa en cada render?
   *   Técnicamente searchParams.get('token') es barato, pero useMemo ayuda a:
   *   1) documentar explícitamente que "token" es un dato derivado,
   *   2) mantener una referencia estable entre renders mientras searchParams
   *      no cambie,
   *   3) coordinar mejor dependencias de efectos (useEffect) y evitar
   *      ejecuciones extra por recomputaciones innecesarias en escenarios
   *      más complejos.
   *
   * - ¿Cómo impacta el resto del código?
   *   El useEffect depende de token. Al estar memoizado, el efecto se dispara
   *   cuando realmente cambia el parámetro de URL y no por renders normales
   *   de estado (loading, status, message). Así se controla el flujo:
   *   obtener token -> validar -> consultar backend una sola vez por token.
   */
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);

  // Estado de UX del proceso de verificación.
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Función interna que ejecuta el flujo completo de validación.
    const verify = async () => {
      // Si no hay token en la URL, se marca error sin llamar al backend.
      if (!token) {
        setStatus('error');
        setMessage('El enlace de confirmación es inválido. Solicita uno nuevo al administrador.');
        setLoading(false);
        return;
      }

      try {
        // Llama al endpoint de confirmación con el token como query param.
        const response = await api.get('/auth/verify-email', {
          params: { token }
        });
        // Respuesta exitosa: cuenta verificada.
        setStatus('success');
        setMessage(response?.data?.message || 'Cuenta confirmada correctamente. Ya puedes iniciar sesión.');
      } catch (requestError) {
        // Si falla, intenta usar el mensaje del backend para mayor precisión.
        const backendMessage = requestError?.response?.data?.message;
        setStatus('error');

        // Normaliza para detectar patrones frecuentes de token inválido/expirado.
        const normalized = String(backendMessage || '').toLowerCase();
        const isInvalidOrExpired =
          normalized.includes('inválido') ||
          normalized.includes('invalido') ||
          normalized.includes('expiró') ||
          normalized.includes('expirado');

        setMessage(
          isInvalidOrExpired
            ? 'Token inválido o expirado. Solicita un nuevo enlace de confirmación.'
            : backendMessage || 'No se pudo confirmar la cuenta. El enlace puede estar vencido.'
        );
      } finally {
        // Finaliza estado de carga en cualquier escenario.
        setLoading(false);
      }
    };

    // Ejecuta verificación cuando cambia el token memoizado.
    verify();
  }, [token]);

  return (
    <div className="contenedor-principal">
      <header className="encabezado">
        <div className="logo-contenedor">
          <img src="/Sena.png" alt="Logo SENA" className="logo" />
          <h1 className="titulo-principal">Sistema de Gestión SENA</h1>
        </div>
      </header>

      <main className="contenido-principal">
        <div className="formulario-contenedor verificacion-contenedor">
          <h2 className="titulo-formulario">Confirmación de cuenta</h2>

          {loading ? (
            <div className="alert alert-info">Validando enlace de confirmación...</div>
          ) : (
            <div className={`alert ${status === 'success' ? 'alert-success' : 'alert-error'}`}>
              {message}
            </div>
          )}

          <div className="verificacion-acciones">
            <Link className="boton-ingresar" to="/login">
              Ir al inicio del programa
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
};

export default VerifyEmailPage;
