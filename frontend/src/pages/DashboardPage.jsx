import PortalLayout from '../components/PortalLayout';
import { useAuth } from '../context/AuthContext';

// Etiquetas legibles para mostrar el rol en el saludo principal.
const ROLE_WELCOME_LABEL = {
  instructor: 'Instructor',
  coordinador: 'Coordinador',
  funcionario: 'Funcionario',
  admin: 'Administrador',
  curricular: 'Modificador'
};

const DashboardPage = () => {
  // Usuario autenticado desde contexto global.
  const { user } = useAuth();
  const roleKey = user?.role || 'instructor';
  const welcomeRole = ROLE_WELCOME_LABEL[roleKey] || 'Usuario';

  return (
    <PortalLayout>
      {roleKey === 'admin' ? (
        <div className="titulo-seccion">
          <h2 className="titulo-pagina">Panel de administración</h2>
          <p className="subtitulo-pagina">
            Utilice el menú superior para consultar solicitudes por vista (instructor, coordinador o funcionario),
            crear solicitudes y revisar reportes.
          </p>
        </div>
      ) : null}

      {/* La mayoría de roles ve mensaje institucional + video informativo. */}
      {roleKey !== 'curricular' && roleKey !== 'admin' ? (
        <div className="titulo-seccion">
          <h2 className="titulo-pagina">Bienvenido {welcomeRole} {user?.name}</h2>
          <p className="subtitulo-pagina">
            Apreciados Instructores, este espacio virtual ha sido creado para facilitar los
            procesos que permanentemente llevamos a cabo en la Coordinación de Administración
            Educativa del Centro Agropecuario de la Regional Cauca, aprovechando las
            potencialidades que nos ofrecen hoy en día las Tecnologías de la Información y
            Comunicación TIC.s
          </p>
          <iframe
            width="560"
            height="315"
            src="https://www.youtube.com/embed/UdZFTpIqmcs?si=p96uWaYvQHspkwBy"
            title="Video informativo"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      ) : roleKey === 'curricular' ? (
        <div className="titulo-seccion">
          <h2 className="titulo-pagina">Bienvenido {welcomeRole} {user?.name}</h2>
          <p className="subtitulo-pagina">Use el menú superior para navegar por los módulos habilitados.</p>
        </div>
      ) : null}
    </PortalLayout>
  );
};

export default DashboardPage;