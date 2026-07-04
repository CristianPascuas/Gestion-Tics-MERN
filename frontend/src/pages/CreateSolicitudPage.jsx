import { Link } from 'react-router-dom';
import PortalLayout from '../components/PortalLayout';
import { useAuth } from '../context/AuthContext';

const CreateSolicitudPage = () => {
  // Datos del usuario autenticado para decidir qué opciones mostrar.
  const { user } = useAuth();
  const isInstructor = user?.role === 'instructor';

  // Regla de visibilidad:
  // - Si no es instructor, se muestran ambas opciones.
  // - Si es instructor, depende del tipo de instructor asignado.
  const showRegular = !isInstructor || user?.instructorType === 'regular';
  const showCampesena = !isInstructor || user?.instructorType === 'campesena';

  return (
    <PortalLayout>
      <div className="titulo-seccion">
        <h2 className="titulo-pagina">REGISTRO DE SOLICITUD</h2>
        <div className="descripcion-registro">
          <p>
            <strong>Fecha de corte:</strong> El día 15 de cada mes es el plazo máximo para el envío
            de solicitudes de creación de fichas para el mismo mes.
          </p>
          <br />
          <p>
            <strong>ATENCIÓN:</strong> Para poder diligenciar la solicitud, debe tener una cuenta de
            correo de xxx@gmail.com la cual previamente debe haber sido aprobada por el
            administrador de la aplicación.
          </p>
        </div>
      </div>

      <div className="contenedor-opciones-ficha">
        {/* Tarjeta para iniciar solicitud de ficha regular. */}
        {showRegular ? (
          <div className="opcion-ficha">
            <div className="icono-opcion">📋</div>
            <h3 className="titulo-opcion">REGULAR</h3>
            <p className="descripcion-opcion">
              Seleccione esta opción si desea solicitar la CREACIÓN de una ficha complementaria
            </p>
            <Link className="boton-opcion" to="/solicitudes/crear/regular">
              Crear Ficha Regular
            </Link>
          </div>
        ) : null}

        {/* Tarjeta para iniciar solicitud de ficha CampeSENA. */}
        {showCampesena ? (
          <div className="opcion-ficha">
            <div className="icono-opcion">🌾</div>
            <h3 className="titulo-opcion">CAMPESENA</h3>
            <p className="descripcion-opcion">
              Seleccione esta opción si desea solicitar la CREACIÓN de una ficha complementaria
            </p>
            <Link className="boton-opcion" to="/solicitudes/crear/campesena">
              Crear Ficha CampeSENA
            </Link>
          </div>
        ) : null}
      </div>
    </PortalLayout>
  );
};

export default CreateSolicitudPage;