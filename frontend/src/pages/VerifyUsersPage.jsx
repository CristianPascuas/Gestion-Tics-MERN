import { useEffect, useState } from 'react';
import PortalLayout from '../components/PortalLayout';
import { approveUserByAdmin, fetchPendingUsers } from '../api/users';

// Formatea fechas para mostrar el registro en formato local (es-CO).
const formatDate = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('es-CO');
};

const VerifyUsersPage = () => {
  // Estado base de la pantalla de aprobación de usuarios.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [users, setUsers] = useState([]);
  const [approvingUserId, setApprovingUserId] = useState('');

  // Consulta el listado de usuarios pendientes de validación administrativa.
  const loadPendingUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const payload = await fetchPendingUsers();
      setUsers(payload?.users || []);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo cargar el listado de usuarios pendientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Carga inicial al montar la vista.
    loadPendingUsers();
  }, []);

  // Aprueba un usuario y recarga la tabla para reflejar cambios.
  const handleApproveUser = async (userId) => {
    try {
      setApprovingUserId(String(userId));
      setError('');
      setSuccess('');
      const payload = await approveUserByAdmin(userId);
      setSuccess(payload?.message || 'Usuario aprobado correctamente');
      await loadPendingUsers();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'No se pudo aprobar el usuario');
    } finally {
      setApprovingUserId('');
    }
  };

  return (
    <PortalLayout>
      <div className="titulo-seccion">
        <h2 className="titulo-pagina">Verificar usuario</h2>
        <p className="subtitulo-pagina">
          Aquí se muestran los usuarios registrados pendientes de aprobación administrativa.
        </p>
      </div>

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

      {loading ? (
        <div className="estado-carga">Cargando usuarios pendientes...</div>
      ) : (
        <div className="contenedor-tabla-fichas">
          <table className="tabla-fichas">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Documento</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Correo confirmado</th>
                <th>Fecha registro</th>
                <th>Aprobar</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.documentType} {item.documentNumber}</td>
                  <td>{item.email}</td>
                  <td>{item.roleLabel}</td>
                  <td>{item.verified ? 'Sí' : 'No'}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="boton-descargar boton-mini"
                      onClick={() => handleApproveUser(item.id)}
                      disabled={approvingUserId === String(item.id)}
                    >
                      {approvingUserId === String(item.id) ? 'Aprobando...' : 'Aprobar'}
                    </button>
                  </td>
                </tr>
              ))}
              {!users.length ? (
                <tr>
                  <td colSpan={7} className="celda-vacia-consultas">
                    No hay usuarios pendientes de aprobación.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </PortalLayout>
  );
};

export default VerifyUsersPage;
