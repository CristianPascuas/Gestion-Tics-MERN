import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

const ResetPasswordPage = () => {
  // Lectura de query params (ejemplo: ?token=abc123).
  const [searchParams] = useSearchParams();
  // Se deriva el token y se memoriza para trabajar con un valor estable en la vista.
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);

  // Estado del formulario de nueva contraseña.
  const [clave, setClave] = useState('');
  const [confirmarClave, setConfirmarClave] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Si no llega token, no tiene sentido continuar con el flujo.
    if (!token) {
      setError('Token inválido o expirado');
    }
  }, [token]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');

    // Validaciones del lado cliente para evitar solicitudes innecesarias.
    if (!token) {
      setError('Token inválido o expirado');
      return;
    }

    if (clave.length < 8) {
      setError('La contraseña debe tener mínimo 8 caracteres');
      return;
    }

    if (clave !== confirmarClave) {
      setError('Las contraseñas no coinciden');
      return;
    }

    try {
      setSubmitting(true);
      // Envía token + nueva contraseña al backend para actualizar credencial.
      const response = await api.post('/auth/reset-password', { token, clave });
      setMessage(response?.data?.message || 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.');
      // Limpia los campos tras un cambio exitoso.
      setClave('');
      setConfirmarClave('');
    } catch (requestError) {
      const backendMessage = requestError?.response?.data?.message;
      setError(backendMessage || 'No se pudo restablecer la contraseña');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="contenedor-principal">
      <header className="encabezado">
        <div className="logo-contenedor">
          <img src="/Sena.png" alt="Logo SENA" className="logo" />
          <h1 className="titulo-principal">Sistema de Gestión SENA</h1>
        </div>
      </header>

      <main className="contenido-principal">
        {error ? (
          <div className="alertas">
            <div className="alert alert-error">{error}</div>
          </div>
        ) : null}

        {message ? (
          <div className="alertas">
            <div className="alert alert-success">{message}</div>
          </div>
        ) : null}

        <div className="formulario-contenedor verificacion-contenedor">
          <h2 className="titulo-formulario">Restablecer contraseña</h2>

          <form className="formulario-login" onSubmit={onSubmit}>
            <div className="campo-entrada">
              <label htmlFor="clave" className="etiqueta-campo">
                Nueva contraseña:
              </label>
              <input
                type="password"
                id="clave"
                name="clave"
                className="entrada-texto"
                placeholder="Ingrese la nueva contraseña"
                required
                minLength={8}
                value={clave}
                onChange={(event) => setClave(event.target.value)}
              />
            </div>

            <div className="campo-entrada">
              <label htmlFor="confirmarClave" className="etiqueta-campo">
                Confirmar contraseña:
              </label>
              <input
                type="password"
                id="confirmarClave"
                name="confirmarClave"
                className="entrada-texto"
                placeholder="Repita la nueva contraseña"
                required
                minLength={8}
                value={confirmarClave}
                onChange={(event) => setConfirmarClave(event.target.value)}
              />
            </div>

            <input
              type="submit"
              className="boton-ingresar"
              value={submitting ? 'Actualizando...' : 'Guardar nueva contraseña'}
              disabled={submitting || !token}
            />
          </form>

          <p className="center-link">
            <Link to="/login" className="linkLogin">
              Ir al inicio del programa
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default ResetPasswordPage;
