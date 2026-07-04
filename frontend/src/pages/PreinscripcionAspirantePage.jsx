import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchInscripcionPublica, registerAspirantePublic } from '../api/aspirantes';

// Estado inicial del formulario de preinscripción pública.
const initialForm = {
  firstName: '',
  lastName: '',
  documentType: '',
  documentNumber: '',
  phone: '',
  email: '',
  caracterizacion: ''
};

const PreinscripcionAspirantePage = () => {
  // ID de solicitud recibido por la ruta pública /inscripcion/:id.
  const { id } = useParams();

  // Estado de carga inicial del formulario público y estado de envío.
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Payload de la solicitud y catálogos de selección.
  const [inscripcionData, setInscripcionData] = useState(null);

  // Estado del formulario de aspirante.
  const [form, setForm] = useState(initialForm);
  const [pdfFile, setPdfFile] = useState(null);

  // Consulta datos públicos de la solicitud y catálogos para los select.
  const loadPublicData = async () => {
    try {
      setError('');
      const payload = await fetchInscripcionPublica(id);
      setInscripcionData(payload);

      // Mantiene ambos select sin selección inicial para forzar elección explícita.
      setForm((prev) => ({
        ...prev,
        documentType: prev.documentType || '',
        caracterizacion: prev.caracterizacion || ''
      }));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo cargar la inscripción pública');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Carga inicial al entrar o cambiar el ID de solicitud en la URL.
    loadPublicData();
  }, [id]);

  // Atajos para lectura del payload en render.
  const solicitud = inscripcionData?.solicitud || null;
  const catalogs = inscripcionData?.catalogs || { documentTypes: [], caracterizaciones: [] };

  // Determina si la inscripción debe mostrarse cerrada por cupo.
  const isClosed = useMemo(() => {
    return Boolean(solicitud?.inscripcionCerrada);
  }, [solicitud]);

  // Actualiza una propiedad del formulario sin recrear toda la estructura manualmente.
  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Envía la preinscripción con FormData y documento PDF obligatorio.
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!pdfFile) {
      setError('Debe adjuntar el documento de identidad en PDF');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      setSuccess('');

      const payload = new FormData();
      // Payload compatible con backend multipart/form-data.
      payload.append('firstName', form.firstName);
      payload.append('lastName', form.lastName);
      payload.append('documentType', form.documentType);
      payload.append('documentNumber', form.documentNumber);
      payload.append('phone', form.phone);
      payload.append('email', form.email);
      payload.append('caracterizacion', form.caracterizacion);
      payload.append('documentoIdentidadPdf', pdfFile);

      await registerAspirantePublic(id, payload);

      // Reinicia formulario después de éxito y recarga cupos disponibles.
      setSuccess('Preinscripción realizada correctamente');
      setForm(initialForm);
      setPdfFile(null);

      await loadPublicData();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo registrar el aspirante');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="preinscripcion-django-page">
      <div className="preinscripcion-django-shell">
        <header className="encabezado preinscripcion-django-header">
          <div className="titulo-encabezado">
            <h1 className="titulo-principal">Portal Preinscripción al curso</h1>
          </div>
        </header>

        <main className="contenido-principal preinscripcion-django-content">
          {loading ? <div className="estado-carga">Cargando información...</div> : null}

          {!loading && solicitud ? (
            <div className="preinscripcion-resumen">
              <p><strong>Programa:</strong> {solicitud.programa || 'Sin programa'}</p>
              <p><strong>Cupos:</strong> {solicitud.totalAspirantes || 0} / {solicitud.cupo || 0}</p>
            </div>
          ) : null}

          {error ? (
            <div className="alertas">
              <div className="alert alert-error">{error}</div>
            </div>
          ) : null}

          {success ? (
            <div className="alertas">
              <div className="alert alert-success">{success}</div>
            </div>
          ) : null}

          {!loading && isClosed ? (
            <div className="alertas">
              <div className="alert alert-warning">Las inscripciones están cerradas porque se alcanzó el cupo.</div>
            </div>
          ) : null}

          {!loading && !isClosed ? (
            <form onSubmit={handleSubmit} className="formulario-ficha preinscripcion-formulario" id="formulario-aspirantes">
              <div className="seccion-formulario">
                <h3 className="titulo-seccion-form">Datos personales</h3>

                <div className="campo-entrada">
                  <label htmlFor="firstName" className="etiqueta-campo">Nombres*</label>
                  <input
                    id="firstName"
                    className="entrada-texto"
                    placeholder="Escriba su nombre o nombres"
                    value={form.firstName}
                    onChange={(event) => handleChange('firstName', event.target.value)}
                    required
                  />
                </div>

                <div className="campo-entrada">
                  <label htmlFor="lastName" className="etiqueta-campo">Apellidos*</label>
                  <input
                    id="lastName"
                    className="entrada-texto"
                    placeholder="Escriba su apellido o apellidos"
                    value={form.lastName}
                    onChange={(event) => handleChange('lastName', event.target.value)}
                    required
                  />
                </div>

                <div className="campo-entrada">
                  <label htmlFor="caracterizacion" className="etiqueta-campo">Tipos caracterización *</label>
                  <select
                    id="caracterizacion"
                    className="entrada-select"
                    value={form.caracterizacion}
                    onChange={(event) => handleChange('caracterizacion', event.target.value)}
                    required
                  >
                    <option value="">Seleccione una opción</option>
                    {catalogs.caracterizaciones?.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>

                <div className="campo-entrada">
                  <label htmlFor="phone" className="etiqueta-campo">Teléfono*:</label>
                  <input
                    id="phone"
                    className="entrada-texto"
                    placeholder="Número de teléfono"
                    value={form.phone}
                    onChange={(event) => handleChange('phone', event.target.value)}
                    required
                  />
                </div>

                <div className="campo-entrada">
                  <label htmlFor="documentoIdentidadPdf" className="etiqueta-campo">Documento (PDF)*:</label>
                  <input
                    id="documentoIdentidadPdf"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) => setPdfFile(event.target.files?.[0] || null)}
                    required
                  />
                </div>

                <div className="campo-entrada">
                  <label htmlFor="documentType" className="etiqueta-campo">Tipos documento *</label>
                  <select
                    id="documentType"
                    className="entrada-select"
                    value={form.documentType}
                    onChange={(event) => handleChange('documentType', event.target.value)}
                    required
                  >
                    <option value="">Seleccione una opción</option>
                    {catalogs.documentTypes?.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>

                <div className="campo-entrada">
                  <label htmlFor="documentNumber" className="etiqueta-campo">Número identificación*:</label>
                  <input
                    id="documentNumber"
                    className="entrada-texto"
                    placeholder="Número de identificación"
                    value={form.documentNumber}
                    onChange={(event) => handleChange('documentNumber', event.target.value)}
                    required
                  />
                </div>

                <div className="campo-entrada">
                  <label htmlFor="email" className="etiqueta-campo">Correo*</label>
                  <input
                    id="email"
                    type="email"
                    className="entrada-texto"
                    placeholder="Escriba su correo"
                    value={form.email}
                    onChange={(event) => handleChange('email', event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="contenedor-botones-formulario">
                <button type="submit" className="boton-enviar" disabled={submitting}>
                  {submitting ? 'Guardando...' : 'Preinscribirme a este curso'}
                </button>
              </div>
            </form>
          ) : null}
        </main>

        <footer className="pie-pagina preinscripcion-django-footer">
          <p className="texto-pie">© 2025 SENA - Servicio Nacional de Aprendizaje</p>
        </footer>
      </div>
    </div>
  );
};

export default PreinscripcionAspirantePage;
