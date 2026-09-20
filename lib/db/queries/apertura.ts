import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { clienteServicio, type ClienteRushFood } from '@/lib/db/client'
import type { AlcancePausa } from '@/lib/types/db'
import { ErrorDB, leerOpcional } from './_comun'

/** Qué se está preguntando: el local entero, o un canal puntual. */
export type AlcanceConsulta = AlcancePausa

export type MotivoCerrado =
  | 'abierto'
  | 'pausa'
  | 'canal_deshabilitado'
  | 'dia_cerrado'
  | 'fuera_de_horario'
  | 'ultimo_pedido_pasado'
  | 'sin_horarios'

export interface HorarioSemanal {
  dia_semana: number // 0 = domingo
  abre: string // 'HH:MM:SS'
  cierra: string // 'HH:MM:SS' — si es <= abre, el turno cruza medianoche
  ultimo_pedido_min_antes: number
  activo: boolean
}

export interface DiaEspecial {
  fecha: string // 'YYYY-MM-DD'
  cerrado: boolean
  abre: string | null
  cierra: string | null
}

export interface PausaVigente {
  alcance: AlcancePausa
  hasta: string | Date
}

/**
 * Todo lo que estaAbierto() necesita saber, ya traído de la base.
 * Separarlo permite evaluar la lógica sin tocar Postgres — que es
 * como está testeada.
 */
export interface SnapshotApertura {
  timezone: string
  aceptaDelivery: boolean
  aceptaTakeaway: boolean
  horarios: HorarioSemanal[]
  diasEspeciales: DiaEspecial[]
  pausas: PausaVigente[]
}

export interface ResultadoApertura {
  abierto: boolean
  motivo: MotivoCerrado
  /** Fin del turno en curso, si hay uno. */
  cierraEn: Date | null
  /** Momento en que deja de tomar pedidos (cierre − ultimo_pedido_min_antes). */
  ultimoPedidoHasta: Date | null
  /** Próxima apertura, cuando está cerrado. */
  abreEn: Date | null
  /** Hasta cuándo dura la pausa, si el motivo es 'pausa'. */
  pausaHasta: Date | null
}

interface Turno {
  inicio: Date
  fin: Date
  ultimoPedido: Date
}

// ---------- utilidades de fecha civil ----------

/** 'HH:MM' o 'HH:MM:SS(.ms)' → 'HH:MM:SS' */
function normalizarHora(hora: string): string {
  const [h = '00', m = '00', s = '00'] = hora.split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.slice(0, 2).padStart(2, '0')}`
}

/** La fecha civil ('YYYY-MM-DD') que se está viviendo en ese timezone. */
function fechaCivil(instante: Date, timezone: string): string {
  return formatInTimeZone(instante, timezone, 'yyyy-MM-dd')
}

function sumarDiasCivil(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Día de semana de una fecha civil, 0 = domingo.
 * Se ancla a mediodía UTC: el día de la semana de una fecha civil no
 * depende del timezone, pero anclarlo a medianoche sí se puede correr
 * un día por redondeo.
 */
function diaSemanaCivil(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay()
}

/**
 * Instante absoluto de una hora local en una fecha civil.
 * fromZonedTime resuelve el offset real de esa fecha, así que un
 * cambio de huso o un DST futuro no rompe el cálculo.
 */
function instanteLocal(fecha: string, hora: string, timezone: string): Date {
  return fromZonedTime(`${fecha}T${normalizarHora(hora)}`, timezone)
}

// ---------- construcción de turnos ----------

/**
 * Los turnos que ABREN en una fecha civil dada.
 *
 * Un turno que cruza medianoche (abre 20:00, cierra 01:30) pertenece
 * al día en que ABRE. Por eso a las 00:30 del miércoles el local está
 * en el turno del martes, no en uno del miércoles.
 */
function turnosDe(fecha: string, snapshot: SnapshotApertura): Turno[] {
  const { timezone, horarios, diasEspeciales } = snapshot

  const especial = diasEspeciales.find((d) => d.fecha === fecha)

  // Los días especiales PISAN al horario semanal, no se suman.
  if (especial) {
    if (especial.cerrado || !especial.abre || !especial.cierra) return []

    // dias_especiales no tiene ultimo_pedido_min_antes propio: se
    // hereda del horario de ese día de la semana, porque "cortar 30
    // min antes de cerrar" es una política del local, no del feriado.
    const delDia = horarios.filter((h) => h.dia_semana === diaSemanaCivil(fecha) && h.activo)
    const corte = delDia.length > 0 ? Math.max(...delDia.map((h) => h.ultimo_pedido_min_antes)) : 0

    return [construirTurno(fecha, especial.abre, especial.cierra, corte, timezone)]
  }

  return horarios
    .filter((h) => h.activo && h.dia_semana === diaSemanaCivil(fecha))
    .map((h) => construirTurno(fecha, h.abre, h.cierra, h.ultimo_pedido_min_antes, timezone))
}

function construirTurno(
  fecha: string,
  abre: string,
  cierra: string,
  ultimoPedidoMinAntes: number,
  timezone: string,
): Turno {
  const inicio = instanteLocal(fecha, abre, timezone)

  // cierra <= abre significa que el turno termina al día siguiente.
  const cruzaMedianoche = normalizarHora(cierra) <= normalizarHora(abre)
  const fechaCierre = cruzaMedianoche ? sumarDiasCivil(fecha, 1) : fecha
  const fin = instanteLocal(fechaCierre, cierra, timezone)

  return {
    inicio,
    fin,
    ultimoPedido: new Date(fin.getTime() - ultimoPedidoMinAntes * 60_000),
  }
}

// ---------- evaluación ----------

/**
 * ¿El local toma pedidos en este momento?
 *
 * Contempla, en este orden:
 *   1. Pausas vigentes (tabla `pausas`), por alcance.
 *   2. Canal deshabilitado en tenant_config.
 *   3. `dias_especiales`, que pisan el horario semanal de esa fecha.
 *   4. Horarios que cruzan medianoche, atribuidos al día de apertura.
 *   5. `ultimo_pedido_min_antes`: dentro del turno pero pasado el
 *      corte, el local está abierto pero NO toma pedidos.
 *
 * Todo en el timezone del tenant, que para Mola es
 * America/Argentina/Salta.
 */
export function evaluarApertura(
  snapshot: SnapshotApertura,
  fecha: Date,
  alcance: AlcanceConsulta = 'todo',
): ResultadoApertura {
  const base: ResultadoApertura = {
    abierto: false,
    motivo: 'fuera_de_horario',
    cierraEn: null,
    ultimoPedidoHasta: null,
    abreEn: null,
    pausaHasta: null,
  }

  // 1. Pausas. Una pausa de alcance 'todo' corta cualquier consulta;
  //    una de 'delivery' sólo corta delivery (y no la consulta
  //    general, porque el local sigue tomando retiros).
  const pausas = snapshot.pausas
    .map((p) => ({ ...p, hasta: p.hasta instanceof Date ? p.hasta : new Date(p.hasta) }))
    .filter((p) => p.hasta.getTime() > fecha.getTime())
    .filter((p) => p.alcance === 'todo' || p.alcance === alcance)

  if (pausas.length > 0) {
    const masLarga = pausas.reduce((a, b) => (a.hasta > b.hasta ? a : b))
    return { ...base, motivo: 'pausa', pausaHasta: masLarga.hasta }
  }

  // 2. Canal apagado desde la configuración.
  if (alcance === 'delivery' && !snapshot.aceptaDelivery) {
    return { ...base, motivo: 'canal_deshabilitado' }
  }
  if (alcance === 'takeaway' && !snapshot.aceptaTakeaway) {
    return { ...base, motivo: 'canal_deshabilitado' }
  }

  if (snapshot.horarios.length === 0 && snapshot.diasEspeciales.length === 0) {
    return { ...base, motivo: 'sin_horarios' }
  }

  const hoy = fechaCivil(fecha, snapshot.timezone)
  const ayer = sumarDiasCivil(hoy, -1)

  // Sólo hacen falta ayer y hoy: ningún turno dura más de 24 h, así
  // que uno de anteayer no puede seguir vivo.
  const candidatos = [...turnosDe(ayer, snapshot), ...turnosDe(hoy, snapshot)]

  const enCurso = candidatos.find(
    (t) => fecha.getTime() >= t.inicio.getTime() && fecha.getTime() < t.fin.getTime(),
  )

  if (enCurso) {
    const tomaPedidos = fecha.getTime() < enCurso.ultimoPedido.getTime()
    return {
      abierto: tomaPedidos,
      motivo: tomaPedidos ? 'abierto' : 'ultimo_pedido_pasado',
      cierraEn: enCurso.fin,
      ultimoPedidoHasta: enCurso.ultimoPedido,
      abreEn: tomaPedidos ? null : proximaApertura(snapshot, fecha, hoy),
      pausaHasta: null,
    }
  }

  // Cerrado. Distinguir "hoy no abre" de "todavía no abrió" ayuda al
  // bot a redactar el mensaje.
  const especialHoy = snapshot.diasEspeciales.find((d) => d.fecha === hoy)
  const motivo: MotivoCerrado =
    especialHoy?.cerrado || turnosDe(hoy, snapshot).length === 0 ? 'dia_cerrado' : 'fuera_de_horario'

  return { ...base, motivo, abreEn: proximaApertura(snapshot, fecha, hoy) }
}

/** Primera apertura posterior a `fecha`, buscando hasta 10 días. */
function proximaApertura(snapshot: SnapshotApertura, fecha: Date, hoy: string): Date | null {
  for (let i = 0; i <= 10; i++) {
    const turnos = turnosDe(sumarDiasCivil(hoy, i), snapshot)
      .filter((t) => t.inicio.getTime() > fecha.getTime())
      .sort((a, b) => a.inicio.getTime() - b.inicio.getTime())

    if (turnos.length > 0) return turnos[0]!.inicio
  }
  return null
}

// ---------- carga desde la base ----------

/** Trae de la base todo lo que evaluarApertura() necesita. */
export async function cargarSnapshotApertura(
  tenantId: string,
  db: ClienteRushFood = clienteServicio(),
  fecha: Date = new Date(),
): Promise<SnapshotApertura> {
  const ctx = `cargarSnapshotApertura(${tenantId})`

  const [tenant, config, horarios, especiales, pausas] = await Promise.all([
    db.from('tenants').select('timezone').eq('id', tenantId).maybeSingle(),
    db
      .from('tenant_config')
      .select('acepta_delivery, acepta_takeaway')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('horarios')
      .select('dia_semana, abre, cierra, ultimo_pedido_min_antes, activo')
      .eq('tenant_id', tenantId)
      .eq('activo', true),
    // Ventana chica alrededor de la fecha: alcanza para ayer/hoy y
    // para buscar la próxima apertura.
    db
      .from('dias_especiales')
      .select('fecha, cerrado, abre, cierra')
      .eq('tenant_id', tenantId)
      .gte('fecha', new Date(fecha.getTime() - 2 * 86_400_000).toISOString().slice(0, 10))
      .lte('fecha', new Date(fecha.getTime() + 12 * 86_400_000).toISOString().slice(0, 10)),
    db
      .from('pausas')
      .select('alcance, hasta')
      .eq('tenant_id', tenantId)
      .gt('hasta', fecha.toISOString()),
  ])

  const filaTenant = leerOpcional(tenant, `${ctx}: tenant`)
  if (!filaTenant) throw new ErrorDB(`${ctx}: el tenant no existe`)

  const filaConfig = leerOpcional(config, `${ctx}: config`)

  return {
    timezone: filaTenant.timezone,
    // Sin config todavía cargada, el default es aceptar: el local
    // recién creado no tiene por qué verse cerrado.
    aceptaDelivery: filaConfig?.acepta_delivery ?? true,
    aceptaTakeaway: filaConfig?.acepta_takeaway ?? true,
    horarios: leerOpcional(horarios, `${ctx}: horarios`) ?? [],
    diasEspeciales: leerOpcional(especiales, `${ctx}: dias_especiales`) ?? [],
    pausas: leerOpcional(pausas, `${ctx}: pausas`) ?? [],
  }
}

export interface OpcionesApertura {
  alcance?: AlcanceConsulta
  db?: ClienteRushFood
  /** Datos ya cargados. Si viene, no se toca la base. */
  snapshot?: SnapshotApertura
}

/**
 * ¿El tenant toma pedidos en `fecha`?
 *
 * @example
 *   await estaAbierto(molaId, new Date())
 *   await estaAbierto(molaId, new Date(), { alcance: 'delivery' })
 */
export async function estaAbierto(
  tenantId: string,
  fecha: Date = new Date(),
  opciones: OpcionesApertura = {},
): Promise<ResultadoApertura> {
  const snapshot =
    opciones.snapshot ?? (await cargarSnapshotApertura(tenantId, opciones.db, fecha))

  return evaluarApertura(snapshot, fecha, opciones.alcance ?? 'todo')
}
