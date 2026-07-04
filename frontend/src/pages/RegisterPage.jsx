import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

const RegisterPage = () => {
  // register viene del contexto y encapsula la llamada de creación de usuario.
  const { register } = useAuth();

  // Catálogos dinámicos que llegan desde backend.
  const [roleOptions, setRoleOptions] = useState([]);
  const [documentTypes, setDocumentTypes] = useState([]);
  const [contractTypes, setContractTypes] = useState([]);
  const [instructorTypes, setInstructorTypes] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);

  // Se usa para comparar si el rol seleccionado corresponde a instructor.
  const instructorRole = roleOptions.find((item) => item.key === 'instructor');

  // Estado centralizado del formulario.
  const [formData, setFormData] = useState({
    nombre: '',
    apellido: '',
    rol: '',
    tipo_documento: '',
    numeroCedula: '',
    telefono: '',
    correo: '',
    clave: '',
    contrato: '',
    numeroContrato: '',
    inicioContrato: '',
    finContrato: '',
    tipoInstructor: '',
    coordinadorId: ''
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Carga inicial de catálogos y coordinadores al montar la vista.
    const loadData = async () => {
      setLoadingCatalogs(true);
      setError('');

      try {
        // Se consumen ambos endpoints en paralelo para mejorar tiempos de carga.
        const [catalogsResponse, coordinatorsResponse] = await Promise.all([
          api.get('/auth/catalogs'),
          api.get('/auth/coordinators')
        ]);

        // Normalización mínima para dejar listas listas para renderizar en select.
        setRoleOptions(catalogsResponse.data?.roles || []);
        setDocumentTypes(
          (catalogsResponse.data?.documentTypes || []).map((item) => ({ id: item, label: item }))
        );
        setContractTypes(catalogsResponse.data?.contractTypes || []);
        setInstructorTypes(catalogsResponse.data?.instructorTypes || []);
        setCoordinators(coordinatorsResponse.data?.coordinators || []);
      } catch (_requestError) {
        setError('No se pudieron cargar los catálogos del formulario. Recarga la página.');
      } finally {
        setLoadingCatalogs(false);
      }
    };

    loadData();
  }, []);

  const onChange = (event) => {
    const { name, value } = event.target;

    // Actualiza el campo editado y aplica reglas de limpieza condicional:
    // - Si el tipo de contrato ya no es 2, se limpian datos de contrato.
    // - Si el rol ya no es instructor, se limpian campos propios de instructor.
    setFormData((current) => ({
      ...current,
      [name]: value,
      ...(name === 'contrato' && value !== '2'
        ? { numeroContrato: '', inicioContrato: '', finContrato: '' }
        : {}),
      ...(name === 'rol' && String(value) !== String(instructorRole?.id)
        ? { tipoInstructor: '', coordinadorId: '' }
        : {})
    }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);

    try {
      // Conversión explícita a Number para campos que el backend espera numéricos.
      const response = await register({
        ...formData,
        rol: Number(formData.rol),
        contrato: Number(formData.contrato)
      });

      setMessage(
        response?.message ||
          'Registro exitoso. Revisa tu correo electrónico para confirmar la cuenta antes de iniciar sesión.'
      );
    } catch (requestError) {
      // Si existe mensaje del backend, se muestra al usuario para mayor claridad.
      const backendMessage = requestError?.response?.data?.message;
      setError(backendMessage || 'No se pudo completar el registro');
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

        <div className="formulario-contenedor formulario-registro">
          <h2 className="titulo-formulario">Registro personal SENA</h2>

          {loadingCatalogs ? <p className="registro-full">Cargando catálogos...</p> : null}

          <form className="formulario-login registro-horizontal" onSubmit={onSubmit}>
            <div className="campo-entrada">
              <label htmlFor="nombre" className="etiqueta-campo">
                Nombres*:
              </label>
              <input
                type="text"
                id="nombre"
                name="nombre"
                className="entrada-texto"
                placeholder="Ingrese sus nombres"
                required
                value={formData.nombre}
                onChange={onChange}
              />
            </div>

            <div className="campo-entrada">
              <label htmlFor="apellido" className="etiqueta-campo">
                Apellidos*:
              </label>
              <input
                type="text"
                id="apellido"
                name="apellido"
                className="entrada-texto"
                placeholder="Ingrese sus apellidos"
                required
                value={formData.apellido}
                onChange={onChange}
              />
            </div>

            <div className="campo-entrada">
              <label htmlFor="rol" className="etiqueta-campo">
                Rol*:
              </label>
              <select
                id="rol"
                name="rol"
                className="selector-usuario"
                required
                value={formData.rol}
                onChange={onChange}
                disabled={loadingCatalogs}
              >
                <option value="">Seleccione su rol</option>
                {roleOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo-entrada">
              <label htmlFor="tipo_documento" className="etiqueta-campo">
                Tipos documento *
              </label>
              <select
                id="tipo_documento"
                name="tipo_documento"
                className="selector-usuario"
                required
                value={formData.tipo_documento}
                onChange={onChange}
                disabled={loadingCatalogs}
              >
                <option value="">Seleccione una opción</option>
                {documentTypes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="campo-entrada">
              <label htmlFor="numeroCedula" className="etiqueta-campo">
                Número de Cédula*:
              </label>
              <input
                type="text"
                id="numeroCedula"
                name="numeroCedula"
                className="entrada-texto"
                placeholder="Ingrese su número de cédula"
                required
                value={formData.numeroCedula}
                onChange={onChange}
              />
            </div>

            <div className="campo-entrada">
              <label htmlFor="telefono" className="etiqueta-campo">
                Número de teléfono*:
              </label>
              <input
                type="text"
                id="telefono"
                name="telefono"
                className="entrada-texto"
                placeholder="Ingrese su número de teléfono"
                required
                value={formData.telefono}
                onChange={onChange}
              />
            </div>

            <div className="campo-entrada">
              <label htmlFor="correo" className="etiqueta-campo">
                Correo*:
              </label>
              <input
                type="email"
                id="correo"
                name="correo"
                className="entrada-texto"
                placeholder="Ingrese su correo electronico"
                required
                value={formData.correo}
                onChange={onChange}
              />
            </div>

            <div className="campo-entrada">
              <label htmlFor="clave" className="etiqueta-campo">
                Contraseña*:
              </label>
              <input
                type="password"
                id="clave"
                name="clave"
                className="entrada-texto"
                placeholder="Ingrese su contraseña"
                required
                minLength={8}
                value={formData.clave}
                onChange={onChange}
              />
              <span>La contraseña debe tener minimo 8 caracteres</span>
            </div>

            <div className="campo-entrada">
              <label htmlFor="contrato" className="etiqueta-campo">
                Tipo de contrato*:
              </label>
              <select
                id="contrato"
                name="contrato"
                className="selector-usuario"
                required
                value={formData.contrato}
                onChange={onChange}
                disabled={loadingCatalogs}
              >
                <option value="">Seleccione una opción</option>
                {contractTypes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            {formData.contrato === '2' ? (
              <>
                <div className="campo-entrada">
                  <label htmlFor="numeroContrato" className="etiqueta-campo">
                    Número de Contrato*:
                  </label>
                  <input
                    type="text"
                    id="numeroContrato"
                    name="numeroContrato"
                    className="entrada-texto"
                    placeholder="Ingrese el número de contrato"
                    required
                    value={formData.numeroContrato}
                    onChange={onChange}
                  />
                </div>

                <div className="campo-entrada">
                  <label htmlFor="inicioContrato" className="etiqueta-campo">
                    Fecha de inicio del contrato*:
                  </label>
                  <input
                    type="date"
                    id="inicioContrato"
                    name="inicioContrato"
                    className="entrada-texto"
                    required
                    value={formData.inicioContrato}
                    onChange={onChange}
                  />
                </div>

                <div className="campo-entrada">
                  <label htmlFor="finContrato" className="etiqueta-campo">
                    Fecha de finalización del contrato*:
                  </label>
                  <input
                    type="date"
                    id="finContrato"
                    name="finContrato"
                    className="entrada-texto"
                    required
                    value={formData.finContrato}
                    onChange={onChange}
                  />
                </div>
              </>
            ) : null}

            {String(formData.rol) === String(instructorRole?.id) ? (
              <>
                <div className="campo-entrada">
                  <label htmlFor="tipoInstructor" className="etiqueta-campo">
                    Tipo de instructor*:
                  </label>
                  <select
                    id="tipoInstructor"
                    name="tipoInstructor"
                    className="selector-usuario"
                    required
                    value={formData.tipoInstructor}
                    onChange={onChange}
                  >
                    <option value="">Seleccione una opción</option>
                    {instructorTypes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="campo-entrada">
                  <label htmlFor="coordinadorId" className="etiqueta-campo">
                    Coordinador al que está ligado*:
                  </label>
                  <select
                    id="coordinadorId"
                    name="coordinadorId"
                    className="selector-usuario"
                    required
                    value={formData.coordinadorId}
                    onChange={onChange}
                  >
                    <option value="">Seleccione una opción</option>
                    {coordinators.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}

            <input
              type="submit"
              className="boton-ingresar registro-full"
              value={submitting ? 'Registrando...' : 'Registrarse'}
              disabled={submitting}
            />

            <p className="center-link registro-full">
              ¿Ya estás registrado?
              <Link to="/login" className="linkLogin">
                {' '}
                Iniciar Sesión
              </Link>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
};

export default RegisterPage;