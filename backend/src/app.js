const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const env = require('./config/env');
const apiRoutes = require('./routes');

const app = express();

// CORS para permitir peticiones desde el frontend configurado.
app.use(
  cors({
    origin: env.clientUrl,
    credentials: true
  })
);
// Middleware base: parseo JSON, logs HTTP y archivos estáticos de media.
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use('/media', express.static(path.resolve(__dirname, '../media')));

// Prefijo principal de la API.
app.use('/api', apiRoutes);

// Fallback 404 para rutas no definidas.
app.use((req, res) => {
  return res.status(404).json({ message: 'Ruta no encontrada' });
});

// Manejador global de errores.
// En desarrollo expone detalle técnico para facilitar depuración.
app.use((error, _req, res, _next) => {
  return res.status(500).json({
    message: 'Error interno del servidor',
    detail: env.nodeEnv === 'development' ? error.message : undefined
  });
});

module.exports = app;