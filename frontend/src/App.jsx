import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import ConsultarSolicitudesPage from './pages/ConsultarSolicitudesPage';
import CreateSolicitudCampesenaPage from './pages/CreateSolicitudCampesenaPage';
import CreateSolicitudPage from './pages/CreateSolicitudPage';
import CreateSolicitudRegularPage from './pages/CreateSolicitudRegularPage';
import DashboardPage from './pages/DashboardPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import LoginPage from './pages/LoginPage';
import PreinscripcionAspirantePage from './pages/PreinscripcionAspirantePage';
import ProgramasCurricularesPage from './pages/ProgramasCurricularesPage';
import RegisterPage from './pages/RegisterPage';
import ReportesSolicitudesPage from './pages/ReportesSolicitudesPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SolicitudCaracterizacionPage from './pages/SolicitudCaracterizacionPage';
import SolicitudFormatoInscripcionPage from './pages/SolicitudFormatoInscripcionPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import VerifyUsersPage from './pages/VerifyUsersPage';
import { useAuth } from './context/AuthContext';

const App = () => {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/" replace /> : <RegisterPage />}
      />
      <Route path="/verificar-cuenta" element={<VerifyEmailPage />} />
      <Route path="/inscripcion/:id" element={<PreinscripcionAspirantePage />} />
      <Route path="/olvide-contrasena" element={<ForgotPasswordPage />} />
      <Route path="/recuperar-contrasena" element={<ResetPasswordPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/solicitudes/crear"
        element={
          <ProtectedRoute allowedRoles={['instructor', 'admin']}>
            <CreateSolicitudPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/solicitudes/crear/regular"
        element={
          <ProtectedRoute allowedRoles={['instructor', 'admin']}>
            <CreateSolicitudRegularPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/solicitudes/crear/campesena"
        element={
          <ProtectedRoute allowedRoles={['instructor', 'admin']}>
            <CreateSolicitudCampesenaPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/solicitudes/consultar"
        element={
          <ProtectedRoute allowedRoles={['instructor', 'coordinador', 'funcionario', 'admin']}>
            <ConsultarSolicitudesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/solicitudes/consultar/:id/ficha"
        element={
          <ProtectedRoute allowedRoles={['instructor', 'coordinador', 'funcionario', 'admin']}>
            <SolicitudCaracterizacionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/solicitudes/consultar/:id/formato-inscripcion"
        element={
          <ProtectedRoute allowedRoles={['instructor', 'coordinador', 'funcionario', 'admin']}>
            <SolicitudFormatoInscripcionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/solicitudes/reportes"
        element={
          <ProtectedRoute allowedRoles={['coordinador', 'funcionario', 'admin']}>
            <ReportesSolicitudesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/usuarios/verificar"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <VerifyUsersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/programas"
        element={
          <ProtectedRoute allowedRoles={['curricular', 'admin']}>
            <ProgramasCurricularesPage />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to={isAuthenticated ? '/' : '/login'} replace />} />
    </Routes>
  );
};

export default App;