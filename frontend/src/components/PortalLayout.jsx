import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Título principal del portal según rol del usuario.
const ROLE_PORTAL_TITLE = {
  instructor: 'Portal del Instructor',
  coordinador: 'Portal del Coordinador',
  funcionario: 'Portal del Funcionario',
  admin: 'Portal del administrador',
  curricular: 'Modificación de programas'
};

// Opciones de menú habilitadas por rol.
const MENU_BY_ROLE = {
  instructor: [
    { label: 'Inicio', to: '/' },
    { label: 'Crear Solicitud', to: '/solicitudes/crear' },
    { label: 'Consultar Solicitudes', to: '/solicitudes/consultar' }
  ],
  coordinador: [
    { label: 'Inicio', to: '/' },
    { label: 'Consultar Solicitudes', to: '/solicitudes/consultar' },
    { label: 'Reportes', to: '/solicitudes/reportes' }
  ],
  funcionario: [
    { label: 'Inicio', to: '/' },
    { label: 'Consultar Solicitudes', to: '/solicitudes/consultar' },
    { label: 'Reportes', to: '/solicitudes/reportes' }
  ],
  admin: [
    { label: 'Inicio', to: '/' },
    { label: 'Consultar Solicitudes (Instructor)', to: '/solicitudes/consultar?vista=instructor' },
    { label: 'Consultar Solicitudes (Coordinador)', to: '/solicitudes/consultar?vista=coordinador' },
    { label: 'Consultar Solicitudes (Funcionario)', to: '/solicitudes/consultar?vista=funcionario' },
    { label: 'Crear Solicitud', to: '/solicitudes/crear' },
    { label: 'Reportes', to: '/solicitudes/reportes' },
    { label: 'Verificar usuario', to: '/usuarios/verificar' }
  ],
  curricular: [
    { label: 'Inicio', to: '/' },
    { label: 'Programas de formación', to: '/programas' }
  ]
};

const PortalLayout = ({ children }) => {
  // Usuario autenticado y acción de cierre de sesión.
  const { user, logout } = useAuth();
  // Ruta actual para resaltar opción activa en menú.
  const location = useLocation();
  const roleKey = user?.role || 'instructor';
  const title = ROLE_PORTAL_TITLE[roleKey] || 'Portal de usuario';
  const menuOptions = MENU_BY_ROLE[roleKey] || [];

  const isActive = (to) => {
    // Determina si un enlace debe mostrarse como activo.
    if (!to) {
      return false;
    }

    if (to === '/') {
      return location.pathname === '/';
    }

    if (to.includes('?')) {
      return `${location.pathname}${location.search}` === to;
    }

    return location.pathname.startsWith(to);
  };

  return (
    // Layout base reutilizable: header + nav + contenido + footer.
    <div className="contenedor-principal">
      <header className="encabezado">
        <div className="titulo-encabezado">
          <h1 className="titulo-principal">{title}</h1>
        </div>

        <nav className="barra-navegacion" aria-label="Navegación principal">
          <ul className="menu-navegacion">
            {menuOptions.map((option) => (
              <li key={option.label} className="elemento-menu">
                {option.to ? (
                  <Link className={isActive(option.to) ? 'enlace-menu activo' : 'enlace-menu'} to={option.to}>
                    {option.label}
                  </Link>
                ) : (
                  <span className="enlace-menu enlace-menu-deshabilitado">{option.label}</span>
                )}
              </li>
            ))}
            <li className="elemento-menu">
              <button className="boton-cerrar-sesion" onClick={logout} type="button">
                Cerrar Sesión
              </button>
            </li>
          </ul>
        </nav>
      </header>

      <main className="contenido-principal">{children}</main>

      <footer className="pie-pagina">
        <p className="texto-pie">© 2025 SENA - Servicio Nacional de Aprendizaje</p>
      </footer>
    </div>
  );
};

export default PortalLayout;