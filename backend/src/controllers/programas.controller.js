const mongoose = require('mongoose');
const {
  ProgramaFormacion,
  Area,
  Modalidad
} = require('../models/SolicitudCatalogs');

// Valida identificadores Mongo enviados por query/body/params.
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || '').trim());

// Normaliza el código de programa preservando formato textual.
const normalizeCodigo = (value) => String(value || '').trim();

// Mantiene compatibilidad con legacyId numérico cuando el código es numérico.
const toLegacyId = (codigo) => {
  const parsed = Number(codigo);
  return Number.isFinite(parsed) ? parsed : null;
};

const listProgramas = async (req, res, next) => {
  try {
    // Permite incluir/excluir programas inactivos según query param.
    const includeInactive = String(req.query.includeInactive || 'true').toLowerCase() === 'true';

    const filter = includeInactive ? {} : { activo: { $ne: false } };

    const programas = await ProgramaFormacion.find(filter)
      .sort({ nombre: 1, version: 1 })
      .populate('area', 'nombre legacyId')
      .populate('modalidad', 'nombre legacyId')
      .lean();

    return res.status(200).json({
      // Normaliza respuesta para frontend (código y bandera activa).
      programas: programas.map((item) => ({
        ...item,
        codigo: item.codigo || (item.legacyId !== undefined && item.legacyId !== null ? String(item.legacyId) : ''),
        activo: item.activo !== false
      }))
    });
  } catch (error) {
    return next(error);
  }
};

const createPrograma = async (req, res, next) => {
  try {
    // Alta de programa con validaciones de catálogos y unicidad código+versión.
    const codigo = normalizeCodigo(req.body.codigo);
    const nombre = String(req.body.nombre || '').trim();
    const version = String(req.body.version || '').trim();
    const horas = Number(req.body.horas);
    const areaId = String(req.body.areaId || '').trim();
    const modalidadId = String(req.body.modalidadId || '').trim();

    if (!codigo || !nombre || !version || !Number.isFinite(horas) || horas <= 0 || !areaId || !modalidadId) {
      return res.status(400).json({
        message: 'Debe diligenciar código, nombre, versión, horas, área y modalidad válidos'
      });
    }

    if (!isValidObjectId(areaId) || !isValidObjectId(modalidadId)) {
      return res.status(400).json({ message: 'Área o modalidad inválida' });
    }

    const [area, modalidad] = await Promise.all([
      Area.findById(areaId).select('_id'),
      Modalidad.findById(modalidadId).select('_id')
    ]);

    if (!area || !modalidad) {
      return res.status(400).json({ message: 'Área o modalidad no existe' });
    }

    const exists = await ProgramaFormacion.findOne({
      codigo,
      version
    })
      .select('_id')
      .lean();

    if (exists) {
      return res.status(409).json({ message: 'Ya existe un programa con el mismo código y versión' });
    }

    const programa = await ProgramaFormacion.create({
      codigo,
      legacyId: toLegacyId(codigo),
      nombre,
      version,
      horas,
      area: area._id,
      modalidad: modalidad._id,
      activo: true
    });

    const result = await ProgramaFormacion.findById(programa._id)
      .populate('area', 'nombre legacyId')
      .populate('modalidad', 'nombre legacyId')
      .lean();

    return res.status(201).json({
      message: 'Programa creado correctamente',
      programa: {
        ...result,
        codigo: result.codigo || (result.legacyId !== undefined && result.legacyId !== null ? String(result.legacyId) : ''),
        activo: result.activo !== false
      }
    });
  } catch (error) {
    return next(error);
  }
};

const updatePrograma = async (req, res, next) => {
  try {
    // Actualiza programa existente preservando reglas de negocio del alta.
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Programa inválido' });
    }

    const programa = await ProgramaFormacion.findById(id);
    if (!programa) {
      return res.status(404).json({ message: 'Programa no encontrado' });
    }

    const codigo = normalizeCodigo(req.body.codigo ?? programa.codigo ?? programa.legacyId ?? '');
    const nombre = String(req.body.nombre ?? programa.nombre ?? '').trim();
    const version = String(req.body.version ?? programa.version ?? '').trim();
    const horas = req.body.horas !== undefined ? Number(req.body.horas) : programa.horas;
    const areaId = String(req.body.areaId ?? programa.area ?? '').trim();
    const modalidadId = String(req.body.modalidadId ?? programa.modalidad ?? '').trim();

    if (!codigo || !nombre || !version || !Number.isFinite(horas) || horas <= 0 || !areaId || !modalidadId) {
      return res.status(400).json({
        message: 'Debe diligenciar código, nombre, versión, horas, área y modalidad válidos'
      });
    }

    if (!isValidObjectId(areaId) || !isValidObjectId(modalidadId)) {
      return res.status(400).json({ message: 'Área o modalidad inválida' });
    }

    const [area, modalidad] = await Promise.all([
      Area.findById(areaId).select('_id'),
      Modalidad.findById(modalidadId).select('_id')
    ]);

    if (!area || !modalidad) {
      return res.status(400).json({ message: 'Área o modalidad no existe' });
    }

    const duplicated = await ProgramaFormacion.findOne({
      _id: { $ne: programa._id },
      codigo,
      version
    })
      .select('_id')
      .lean();

    if (duplicated) {
      return res.status(409).json({ message: 'Ya existe otro programa con el mismo código y versión' });
    }

    programa.codigo = codigo;
    programa.legacyId = toLegacyId(codigo);
    programa.nombre = nombre;
    programa.version = version;
    programa.horas = horas;
    programa.area = area._id;
    programa.modalidad = modalidad._id;

    await programa.save();

    const result = await ProgramaFormacion.findById(programa._id)
      .populate('area', 'nombre legacyId')
      .populate('modalidad', 'nombre legacyId')
      .lean();

    return res.status(200).json({
      message: 'Programa actualizado correctamente',
      programa: {
        ...result,
        codigo: result.codigo || (result.legacyId !== undefined && result.legacyId !== null ? String(result.legacyId) : ''),
        activo: result.activo !== false
      }
    });
  } catch (error) {
    return next(error);
  }
};

const updateProgramaEstado = async (req, res, next) => {
  try {
    // Cambia estado activo/inactivo sin modificar metadatos curriculares.
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Programa inválido' });
    }

    if (typeof req.body.activo !== 'boolean') {
      return res.status(400).json({ message: 'Debe indicar el estado activo/inactivo' });
    }

    const programa = await ProgramaFormacion.findById(id);

    if (!programa) {
      return res.status(404).json({ message: 'Programa no encontrado' });
    }

    programa.activo = req.body.activo;
    await programa.save();

    return res.status(200).json({
      message: req.body.activo ? 'Programa activado correctamente' : 'Programa inactivado correctamente'
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listProgramas,
  createPrograma,
  updatePrograma,
  updateProgramaEstado
};