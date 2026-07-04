# MERM Tics - Inicio de migración

Este directorio contiene la nueva implementación separada:

- `backend`: API Node.js + Express + MongoDB Atlas + JWT
- `frontend`: React + Vite + Tailwind CSS

## 1) Backend

### Requisitos

- Node.js 20+

### Configuración

1. Copiar `backend/.env.example` a `backend/.env`
2. Ajustar variables de entorno

### Instalar y ejecutar

```bash
cd backend
npm install
npm run dev
```

### Endpoints iniciales

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `GET /api/users` (requiere rol `admin`)

## 2) Frontend

### Instalar y ejecutar

```bash
cd frontend
npm install
npm run dev
```

### Variables de entorno

Crear `frontend/.env` con:

```bash
VITE_API_URL=http://localhost:4000/api
```

## 3) Seed de administrador

Con el backend configurado:

```bash
cd backend
npm run seed:admin
```

Variables requeridas:

- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## Nota de seguridad

No hardcodear credenciales de Mongo Atlas ni secretos JWT en el código. Se manejan por `.env`.