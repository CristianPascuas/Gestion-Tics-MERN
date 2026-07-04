import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

const ForgotPasswordPage = () => {
  // Estado del formulario y mensajes de retroalimentación.
  const [correo, setCorreo] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    // Limpia mensajes previos antes de enviar una nueva solicitud.
    setError('');
    setMessage('');
    setSubmitting(true);

    try {
      // Solicita al backend el envío del enlace de recuperación.
      const response = await api.post('/auth/forgot-password', { correo });
      setMessage(
        response?.data?.message ||
          'Si el correo existe en el sistema, te enviaremos un enlace para recuperar la contraseña.'
      );
    } catch (requestError) {
      // Muestra mensaje específico del backend cuando esté disponible.
      const backendMessage = requestError?.response?.data?.message;
      setError(backendMessage || 'No se pudo procesar la solicitud de recuperación');
    } finally {
      // Reactiva el botón al terminar la operación.
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
          <h2 className="titulo-formulario">Recuperar contraseña</h2>

          <form className="formulario-login" onSubmit={onSubmit}>
            <div className="campo-entrada">
              <label htmlFor="correo" className="etiqueta-campo">
                Correo electrónico:
              </label>
              <input
                type="email"
                id="correo"
                name="correo"
                className="entrada-texto"
                placeholder="Ingrese su correo registrado"
                required
                value={correo}
                onChange={(event) => setCorreo(event.target.value)}
              />
            </div>

            <input
              type="submit"
              className="boton-ingresar"
              value={submitting ? 'Enviando...' : 'Enviar enlace de recuperación'}
              disabled={submitting}
            />
          </form>

          <p className="center-link">
            <Link to="/login" className="linkLogin">
              Volver al inicio de sesión
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default ForgotPasswordPage;
