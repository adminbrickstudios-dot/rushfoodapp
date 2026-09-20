export { ErrorDB, escrituraVerificada, leerOpcional, leerUna } from './_comun'
export { getTenantBySlug, type TenantConConfig } from './tenants'
export {
  getMenu,
  type Menu,
  type MenuCategoria,
  type MenuGrupo,
  type MenuOpcion,
  type MenuProducto,
  type MenuVariante,
} from './menu'
export {
  cargarSnapshotApertura,
  estaAbierto,
  evaluarApertura,
  type AlcanceConsulta,
  type DiaEspecial,
  type HorarioSemanal,
  type MotivoCerrado,
  type PausaVigente,
  type ResultadoApertura,
  type SnapshotApertura,
} from './apertura'
export {
  calcularTiempoEstimado,
  cargarSnapshotTiempos,
  estimarConSnapshot,
  type ItemParaEstimar,
  type SnapshotTiempos,
  type TiempoEstimado,
} from './tiempos'
export {
  registrarDemandaPerdida,
  type DatosDemandaPerdida,
  type TipoDemandaPerdida,
} from './demanda'
