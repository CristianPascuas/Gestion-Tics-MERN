import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Catálogo local de roles para el selector del formulario de inicio de sesión.
// Se mantiene en esta vista porque es una lista corta y estable.
const ROLE_OPTIONS = [
  { id: 1, label: 'Instructor' },
  { id: 2, label: 'Coordinador' },
  { id: 3, label: 'Funcionario' },
  { id: 4, label: 'Administrador' },
  { id: 5, label: 'Curricular' }
];

const LoginPage = () => {
  // useNavigate permite redirigir al usuario cuando el login sea exitoso.
  const navigate = useNavigate();
  // Desde AuthContext se consume la función login para autenticar contra el backend.
  const { login } = useAuth();

  // Estados del formulario y de UX.
  const [numeroCedula, setNumeroCedula] = useState('');
  const [clave, setClave] = useState('');
  const [rol, setRol] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    // Limpia errores anteriores antes de intentar una nueva autenticación.
    setError('');
    setSubmitting(true);

    try {
      // Envía credenciales al contexto de autenticación.
      await login(numeroCedula, clave, Number(rol));
      // Si todo sale bien, lleva al usuario al dashboard principal.
      navigate('/', { replace: true });
    } catch (requestError) {
      // Prioriza el mensaje del backend para dar retroalimentación real al usuario.
      const backendMessage = requestError?.response?.data?.message;
      setError(backendMessage || 'Credenciales inválidas');
    } finally {
      // Independiente del resultado, se desbloquea el botón.
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

        <div className="formulario-contenedor">
          <h2 className="titulo-formulario">Inicio de sesión</h2>

          <form className="formulario-login" onSubmit={onSubmit}>
            <div className="campo-entrada">
              <label htmlFor="numeroCedula" className="etiqueta-campo">
                Número de Cédula:
              </label>
              <input
                type="text"
                id="numeroCedula"
                name="numeroCedula"
                className="entrada-texto"
                placeholder="Ingrese su número de cédula"
                required
                value={numeroCedula}
                onChange={(event) => setNumeroCedula(event.target.value)}
              />
            </div>

            <div className="campo-entrada">
              <label htmlFor="clave" className="etiqueta-campo">
                Contraseña:
              </label>
              <input
                type="password"
                id="clave"
                name="clave"
                className="entrada-texto"
                placeholder="Ingrese su contraseña"
                required
                value={clave}
                onChange={(event) => setClave(event.target.value)}
              />
            </div>

            <div className="campo-entrada">
              <label htmlFor="rol" className="etiqueta-campo">
                Tipo de Usuario:
              </label>
              <select
                id="rol"
                name="rol"
                className="selector-usuario"
                required
                value={rol}
                onChange={(event) => setRol(event.target.value)}
              >
                <option value="">Seleccione su rol</option>
                {ROLE_OPTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <input
              type="submit"
              className="boton-ingresar"
              value={submitting ? 'Ingresando...' : 'Ingresar'}
              disabled={submitting}
            />

            <p className="center-link">
              <Link to="/olvide-contrasena" className="linkLogin">
                ¿Olvidaste tu contraseña?
              </Link>
            </p>
          </form>

          <p className="texto-registro">
            ¿Aún no estás registrado? <Link to="/register" className="enlace-registro">Regístrate aquí</Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default LoginPage;