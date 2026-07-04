const mongoose = require('mongoose');
const env = require('./env');
const { Aspirante } = require('../models/Aspirante');

// Inicializa la conexión Mongo y sincroniza índices críticos del dominio.
const connectMongo = async () => {
  if (!env.mongoUri) {
    throw new Error('MONGO_URI no está configurada');
  }

  await mongoose.connect(env.mongoUri);

  // Alinea índices reales con el esquema actual (elimina índices obsoletos/globales).
  await Aspirante.syncIndexes();
};

module.exports = connectMongo;