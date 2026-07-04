import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchSolicitudFormatoInscripcion, fetchSolicitudFormatoInscripcionExcel } from '../api/solicitudes';

const SolicitudFormatoInscripcionPage = () => {
  // ID de solicitud recibido desde la URL.
  const { id } = useParams();
  // Estado principal del documento y descarga.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  useEffect(() => {
    // Carga los datos del formato de inscripción para la solicitud.
    const loadFormato = async () => {
      try {
        setError('');
        const response = await fetchSolicitudFormatoInscripcion(id);
        setData(response);
      } catch (requestError) {
        const message = requestError?.response?.data?.message || 'No se pudo cargar el formato de inscripción masiva';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadFormato();
  }, [id]);

  const encabezados = data?.formato?.encabezados || [];
  const filas = data?.formato?.filas || [];
  const titulo = data?.formato?.titulo || 'FORMATO PARA LA INSCRIPCIÓN DE ASPIRANTES EN SOFIA PLUS v1.0';

  // Genera y descarga el archivo Excel del formato masivo.
  const handleDownloadExcel = async () => {
    try {
      setDownloadingExcel(true);
      setError('');

      const blob = await fetchSolicitudFormatoInscripcionExcel(id);
      const blobUrl = window.URL.createObjectURL(blob);
      const safeCode = String(data?.solicitud?.codigoSolicitud || id || 'solicitud').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `formato_inscripcion_${safeCode}.xlsx`;

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo descargar el formato de inscripción en Excel');
    } finally {
      setDownloadingExcel(false);
    }
  };

  return (
    <div className="doc-page-wrap excel-format-wrap">
      <div className="doc-actions">
        <Link to="/solicitudes/consultar" className="doc-page-back">Volver a consultar solicitudes</Link>
        <button
          type="button"
          className="doc-action-btn"
          onClick={handleDownloadExcel}
          disabled={downloadingExcel || loading || !!error || !data}
        >
          {downloadingExcel ? 'Descargando...' : 'Descargar Excel'}
        </button>
      </div>

      <div className="doc-page-sheet excel-format-sheet">
        {loading ? <div className="estado-carga">Cargando formato de inscripción...</div> : null}

        {!loading && error ? (
          <div className="alertas">
            <div className="alert alert-error">{error}</div>
          </div>
        ) : null}

        {!loading && !error && data ? (
          <div className="excel-format-document">
            <div className="excel-programa-caption">
              <strong>Programa:</strong> {data?.solicitud?.nombrePrograma || 'Sin programa'}
            </div>

            <div className="excel-table-wrap">
              <table className="excel-main-table">
                <thead>
                  <tr>
                    <th colSpan={encabezados.length || 7} className="excel-title-cell">{titulo}</th>
                  </tr>
                  <tr>
                    {encabezados.map((item, index) => (
                      <th key={`head-${index}`}>{item}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.length ? filas.map((fila, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {fila.map((celda, colIndex) => (
                        <td key={`row-${rowIndex}-col-${colIndex}`}>{celda}</td>
                      ))}
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={encabezados.length || 7} className="celda-vacia-consultas">
                        No hay aspirantes registrados para generar el formato de inscripción masiva.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SolicitudFormatoInscripcionPage;
