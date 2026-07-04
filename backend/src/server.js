const app = require('./app');
const connectMongo = require('./config/mongo');
const env = require('./config/env');

const startServer = async () => {
  // Verificación mínima de configuración crítica antes de iniciar.
  if (!env.jwtSecret) {
    throw new Error('JWT_SECRET no está configurado');
  }

  // Conexión a base de datos antes de levantar el servidor HTTP.
  await connectMongo();

  // Inicio de API en el puerto configurado.
  app.listen(env.port, () => {
    process.stdout.write(`API escuchando en http://localhost:${env.port}\n`);
  });
};

// Arranque controlado con salida explícita ante error fatal.
startServer().catch((error) => {
  process.stderr.write(`No se pudo iniciar el servidor: ${error.message}\n`);
  process.exit(1);
});