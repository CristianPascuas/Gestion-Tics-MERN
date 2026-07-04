# Gestión TICS MERN 

Sistema web para la gestión y creación de cursos cortos del **SENA**, diseñado para digitalizar y automatizar los procesos que anteriormente se realizaban de forma manual. La plataforma centraliza la administración de solicitudes, aspirantes y programas curriculares, y genera automáticamente los documentos y archivos requeridos en cada etapa del proceso, reduciendo significativamente los márgenes de error y el tiempo operativo.

## Características principales

- Registro y seguimiento de solicitudes de cursos cortos (regular y campesino)
- Gestión de aspirantes con preinscripción en línea
- Generación automática de cartas de solicitud, formatos de inscripción y archivos SOFIA Plus
- Control de estados del proceso por roles (funcionario, coordinador, administrador)
- Autenticación segura con JWT y verificación de correo electrónico
- Panel de reportes y consulta de solicitudes

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Base de datos | MongoDB Atlas (Mongoose) |
| Autenticación | JWT + bcrypt |
| Correo | Nodemailer |

## Requisitos previos

- Node.js 20+
- Cuenta en MongoDB Atlas

---

## Instalación

### 1. Backend

```bash
cd backend
cp .env.example .env   # Ajustar variables de entorno
npm install
npm run dev            # Inicia en http://localhost:4000
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env   # Ajustar VITE_API_URL
npm install
npm run dev            # Inicia en http://localhost:5173
```

### 3. Seed de administrador inicial

```bash
cd backend
npm run seed:admin
```

Variables requeridas en `.env`:

```
ADMIN_NAME=Nombre
ADMIN_EMAIL=correo@ejemplo.com
ADMIN_PASSWORD=contraseña_segura
```

---

## Variables de entorno

### `backend/.env`

```
PORT=4000
MONGO_URI=mongodb+srv://...
JWT_SECRET=tu_secreto_jwt
MAIL_HOST=smtp.ejemplo.com
MAIL_PORT=587
MAIL_USER=correo@ejemplo.com
MAIL_PASS=contraseña
```

### `frontend/.env`

```
VITE_API_URL=http://localhost:4000/api
```

---

## Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servidor |
| POST | `/api/auth/register` | Registro de usuario |
| POST | `/api/auth/login` | Inicio de sesión |
| GET | `/api/auth/me` | Perfil autenticado |
| GET | `/api/solicitudes` | Listar solicitudes |
| POST | `/api/solicitudes` | Crear solicitud |
| GET | `/api/programas` | Programas curriculares |

---

## Seguridad

Las credenciales de MongoDB Atlas, secretos JWT y contraseñas de correo se gestionan exclusivamente mediante variables de entorno (`.env`). **Nunca** deben incluirse en el código fuente ni en el repositorio.
