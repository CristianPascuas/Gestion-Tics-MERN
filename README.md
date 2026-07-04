# Gestion-Tics MERN

Sistema web para la gestión de solicitudes de formación del SENA, desarrollado con el stack MERN. Permite a instructores crear y hacer seguimiento de solicitudes de apertura de programas, con flujo de aprobación por coordinador y funcionario.

## Características principales

- **Autenticación y roles**: registro con verificación de correo, JWT, recuperación de contraseña y cinco roles (`instructor`, `coordinador`, `funcionario`, `admin`, `curricular`).
- **Gestión de solicitudes**: creación de solicitudes tipo *Regular* y *CampeSENA*, carga de carta de solicitud en PDF, envío al coordinador y al funcionario SENA.
- **Gestión de aspirantes**: preinscripción pública, carga de documentos de identidad, formato de inscripción y exportación a Excel.
- **Programas curriculares**: consulta de programas disponibles para asociar a solicitudes.
- **Reportes y caracterización**: reportes agregados por coordinador/funcionario y generación de documento Word de caracterización.
- **Almacenamiento de archivos**: cartas PDF, documentos de aspirantes y archivos Sofia Plus (Excel) servidos como archivos estáticos.

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js 20 + Express |
| Base de datos | MongoDB Atlas (Mongoose) |
| Autenticación | JWT + Bcrypt |
| Correo | Nodemailer |

## Estructura del proyecto

```
merm-tics/
├── backend/      # API REST (Node.js + Express)
│   └── src/
│       ├── controllers/
│       ├── models/
│       ├── routes/
│       ├── middleware/
│       └── utils/
└── frontend/     # SPA (React + Vite)
    └── src/
        ├── pages/
        ├── components/
        ├── api/
        └── context/
```

## Instalación y ejecución

### Requisitos previos
- Node.js 20+
- Cuenta en MongoDB Atlas

### Backend

```bash
cd backend
cp .env.example .env   # Ajustar variables de entorno
npm install
npm run dev            # Puerto 4000 por defecto
```

### Frontend

```bash
cd frontend
cp .env.example .env   # Ajustar VITE_API_URL
npm install
npm run dev            # Puerto 5173 por defecto
```

### Variables de entorno principales

**`backend/.env`**
```env
PORT=4000
MONGO_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/gestion-tics
JWT_SECRET=secret_seguro
CLIENT_URL=http://localhost:5173
```

**`frontend/.env`**
```env
VITE_API_URL=http://localhost:4000/api
```

## Seed de administrador

```bash
cd backend
npm run seed:admin
```
Requiere las variables `ADMIN_NAME`, `ADMIN_EMAIL` y `ADMIN_PASSWORD` en el `.env`.

## API — Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servicio |
| POST | `/api/auth/register` | Registro de usuario |
| POST | `/api/auth/login` | Inicio de sesión |
| GET | `/api/auth/me` | Perfil autenticado |
| GET | `/api/solicitudes/consultas` | Listar solicitudes |
| POST | `/api/solicitudes` | Crear solicitud |
| GET | `/api/solicitudes/reportes` | Reportes agregados |
| GET | `/api/programas` | Programas curriculares |

> Las credenciales de MongoDB Atlas y el secreto JWT se gestionan exclusivamente por variables de entorno; nunca se deben hardcodear en el código.