const {
  Area,
  Modalidad,
  Departamento,
  Municipio,
  TipoEmpresa,
  Empresa,
  Caracterizacion,
  TipoIdentificacion,
  ProgramaEspecial,
  ProgramaFormacion,
  TipoSolicitud,
  Horario,
  EstadoFicha,
  EstadoCoordinador
} = require('../models/SolicitudCatalogs');
const { User } = require('../models/User');

const listSolicitudCatalogs = async (req, res, next) => {
  try {
    // Filtro opcional de municipios por departamento (ObjectId o legacyId).
    const { departamentoId, departamentoLegacyId } = req.query;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const municipioFilter = {};
    if (departamentoId) {
      municipioFilter.departamento = departamentoId;
    }

    if (departamentoLegacyId) {
      const departamento = await Departamento.findOne({
        legacyId: Number(departamentoLegacyId)
      })
        .select('_id')
        .lean();

      if (departamento) {
        municipioFilter.departamento = departamento._id;
      }
    }

    const [
      tiposSolicitud,
      modalidades,
      areas,
      departamentos,
      municipios,
      tiposEmpresa,
      empresas,
      caracterizaciones,
      tiposIdentificacion,
      programasEspeciales,
      programasFormacion,
      horarios,
      estadosFicha,
      estadosCoordinador,
      instructoresCampesena
    ] = await Promise.all([
      // Catálogos base para construir formularios y consultas del módulo de solicitudes.
      TipoSolicitud.find().sort({ nombre: 1 }).lean(),
      Modalidad.find().sort({ nombre: 1 }).lean(),
      Area.find().sort({ nombre: 1 }).lean(),
      Departamento.find().sort({ nombre: 1 }).lean(),
      Municipio.find(municipioFilter).sort({ nombre: 1 }).populate('departamento', 'nombre legacyId').lean(),
      TipoEmpresa.find().sort({ nombre: 1 }).lean(),
      Empresa.find().sort({ nombre: 1 }).populate('tipoEmpresa', 'nombre legacyId').lean(),
      Caracterizacion.find().sort({ legacyId: 1, nombre: 1 }).lean(),
      TipoIdentificacion.find().sort({ legacyId: 1, nombre: 1 }).lean(),
      ProgramaEspecial.find().sort({ nombre: 1 }).lean(),
      ProgramaFormacion.find({ activo: { $ne: false } })
        .sort({ nombre: 1 })
        .populate('area', 'nombre legacyId')
        .populate('modalidad', 'nombre legacyId')
        .lean(),
      Horario.find().sort({ fechaInicio: -1 }).lean(),
      EstadoFicha.find().sort({ legacyId: 1, nombre: 1 }).lean(),
      EstadoCoordinador.find().sort({ legacyId: 1, nombre: 1 }).lean(),
      User.find({
        // Instructores Campesena vigentes para asignaciones en formularios.
        roleKey: 'instructor',
        instructorType: 'campesena',
        active: true,
        $or: [
          { contractType: 1 },
          { contractEndAt: { $gte: startOfToday } },
          { contractEndAt: null }
        ]
      })
        .select('_id firstName lastName email')
        .sort({ firstName: 1, lastName: 1 })
        .lean()
    ]);

    return res.status(200).json({
      // Respuesta consolidada de catálogos para minimizar llamadas desde frontend.
      tiposSolicitud,
      modalidades,
      areas,
      departamentos,
      municipios,
      tiposEmpresa,
      empresas,
      caracterizaciones,
      tiposIdentificacion,
      programasEspeciales,
      programasFormacion,
      horarios,
      estadosFicha,
      estadosCoordinador,
      instructoresCampesena: (instructoresCampesena || []).map((item) => ({
        _id: item._id,
        nombre: `${item.firstName || ''} ${item.lastName || ''}`.trim(),
        email: item.email || ''
      }))
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listSolicitudCatalogs
};