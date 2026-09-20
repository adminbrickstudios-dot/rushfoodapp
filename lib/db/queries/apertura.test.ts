import { describe, expect, it } from 'vitest'
import { estaAbierto, type SnapshotApertura } from './apertura'

const TENANT = '00000000-0000-0000-0000-000000000001'
const TZ = 'America/Argentina/Salta' // UTC−3 todo el año

/**
 * Local que abre 20:00 y cierra 01:30, sólo los martes.
 * Turno real: martes 20:00 → miércoles 01:30 hora de Salta.
 *
 * Que abra un solo día es a propósito: si la lógica atribuyera el
 * turno al día de CIERRE en vez del de apertura, el miércoles a las
 * 00:30 daría cerrado y el test lo caza.
 */
function local(extra: Partial<SnapshotApertura> = {}): SnapshotApertura {
  return {
    timezone: TZ,
    aceptaDelivery: true,
    aceptaTakeaway: true,
    horarios: [
      { dia_semana: 2, abre: '20:00:00', cierra: '01:30:00', ultimo_pedido_min_antes: 0, activo: true },
    ],
    diasEspeciales: [],
    pausas: [],
    ...extra,
  }
}

// Salta es UTC−3: la hora local + 3 h da UTC.
const MARTES_21_00 = new Date('2026-09-23T00:00:00Z') // martes 21:00 local
const MIERCOLES_00_30 = new Date('2026-09-23T03:30:00Z') // miércoles 00:30 local
const MIERCOLES_01_29 = new Date('2026-09-23T04:29:00Z') // miércoles 01:29 local
const MIERCOLES_02_00 = new Date('2026-09-23T05:00:00Z') // miércoles 02:00 local
const MARTES_19_00 = new Date('2026-09-22T22:00:00Z') // martes 19:00 local

describe('estaAbierto — horario que cruza medianoche (20:00 → 01:30)', () => {
  it('a las 00:30 del miércoles está ABIERTO: sigue el turno del martes', async () => {
    const r = await estaAbierto(TENANT, MIERCOLES_00_30, { snapshot: local() })

    expect(r.abierto).toBe(true)
    expect(r.motivo).toBe('abierto')
    // El turno cierra el miércoles 01:30 local = 04:30 UTC.
    expect(r.cierraEn?.toISOString()).toBe('2026-09-23T04:30:00.000Z')
  })

  it('a las 01:29 del miércoles sigue abierto, un minuto antes de cerrar', async () => {
    const r = await estaAbierto(TENANT, MIERCOLES_01_29, { snapshot: local() })
    expect(r.abierto).toBe(true)
  })

  it('a las 02:00 del miércoles está CERRADO: el turno del martes ya terminó', async () => {
    const r = await estaAbierto(TENANT, MIERCOLES_02_00, { snapshot: local() })

    expect(r.abierto).toBe(false)
    // El miércoles no tiene horario propio.
    expect(r.motivo).toBe('dia_cerrado')
    // La próxima apertura es el martes siguiente a las 20:00 local.
    expect(r.abreEn?.toISOString()).toBe('2026-09-29T23:00:00.000Z')
  })

  it('a las 21:00 del martes está abierto', async () => {
    const r = await estaAbierto(TENANT, MARTES_21_00, { snapshot: local() })
    expect(r.abierto).toBe(true)
  })

  it('a las 19:00 del martes está cerrado: todavía no abrió', async () => {
    const r = await estaAbierto(TENANT, MARTES_19_00, { snapshot: local() })

    expect(r.abierto).toBe(false)
    expect(r.motivo).toBe('fuera_de_horario')
    expect(r.abreEn?.toISOString()).toBe('2026-09-22T23:00:00.000Z')
  })
})

describe('estaAbierto — pausas', () => {
  it('con una pausa vigente de alcance "todo" está CERRADO aunque sea horario', async () => {
    const pausaHasta = new Date('2026-09-23T04:00:00Z') // 01:00 local, después de las 00:30
    const r = await estaAbierto(TENANT, MIERCOLES_00_30, {
      snapshot: local({ pausas: [{ alcance: 'todo', hasta: pausaHasta }] }),
    })

    expect(r.abierto).toBe(false)
    expect(r.motivo).toBe('pausa')
    expect(r.pausaHasta?.toISOString()).toBe(pausaHasta.toISOString())
  })

  it('una pausa ya vencida no cierra nada', async () => {
    const r = await estaAbierto(TENANT, MIERCOLES_00_30, {
      snapshot: local({ pausas: [{ alcance: 'todo', hasta: new Date('2026-09-23T03:00:00Z') }] }),
    })

    expect(r.abierto).toBe(true)
  })

  it('una pausa de delivery no frena el takeaway', async () => {
    const snapshot = local({
      pausas: [{ alcance: 'delivery', hasta: new Date('2026-09-23T04:00:00Z') }],
    })

    const delivery = await estaAbierto(TENANT, MIERCOLES_00_30, { snapshot, alcance: 'delivery' })
    const takeaway = await estaAbierto(TENANT, MIERCOLES_00_30, { snapshot, alcance: 'takeaway' })

    expect(delivery.abierto).toBe(false)
    expect(delivery.motivo).toBe('pausa')
    expect(takeaway.abierto).toBe(true)
  })

  it('acepta el timestamp de la pausa como string, que es como viene de Postgres', async () => {
    const r = await estaAbierto(TENANT, MIERCOLES_00_30, {
      snapshot: local({ pausas: [{ alcance: 'todo', hasta: '2026-09-23T04:00:00+00:00' }] }),
    })

    expect(r.abierto).toBe(false)
    expect(r.motivo).toBe('pausa')
  })
})

describe('estaAbierto — ultimo_pedido_min_antes', () => {
  it('deja de tomar pedidos 30 min antes de cerrar, sin estar cerrado', async () => {
    const snapshot = local({
      horarios: [
        { dia_semana: 2, abre: '20:00:00', cierra: '01:30:00', ultimo_pedido_min_antes: 30, activo: true },
      ],
    })

    // 01:10 local: dentro del turno, pero pasado el corte de las 01:00.
    const r = await estaAbierto(TENANT, new Date('2026-09-23T04:10:00Z'), { snapshot })

    expect(r.abierto).toBe(false)
    expect(r.motivo).toBe('ultimo_pedido_pasado')
    expect(r.ultimoPedidoHasta?.toISOString()).toBe('2026-09-23T04:00:00.000Z')
    expect(r.cierraEn?.toISOString()).toBe('2026-09-23T04:30:00.000Z')
  })

  it('justo antes del corte todavía toma pedidos', async () => {
    const snapshot = local({
      horarios: [
        { dia_semana: 2, abre: '20:00:00', cierra: '01:30:00', ultimo_pedido_min_antes: 30, activo: true },
      ],
    })

    const r = await estaAbierto(TENANT, new Date('2026-09-23T03:59:00Z'), { snapshot })
    expect(r.abierto).toBe(true)
  })
})

describe('estaAbierto — dias_especiales', () => {
  it('un feriado cerrado pisa el horario semanal', async () => {
    const r = await estaAbierto(TENANT, MARTES_21_00, {
      snapshot: local({
        diasEspeciales: [{ fecha: '2026-09-22', cerrado: true, abre: null, cierra: null }],
      }),
    })

    expect(r.abierto).toBe(false)
    expect(r.motivo).toBe('dia_cerrado')
  })

  it('un día especial con horario propio reemplaza al semanal', async () => {
    const snapshot = local({
      diasEspeciales: [
        { fecha: '2026-09-22', cerrado: false, abre: '12:00:00', cierra: '16:00:00' },
      ],
    })

    // 21:00 del martes: abierto según el horario semanal, cerrado
    // según el día especial. Gana el especial.
    const noche = await estaAbierto(TENANT, MARTES_21_00, { snapshot })
    // 14:00 local del martes, que el horario semanal no cubre.
    const tarde = await estaAbierto(TENANT, new Date('2026-09-22T17:00:00Z'), { snapshot })

    expect(noche.abierto).toBe(false)
    expect(tarde.abierto).toBe(true)
  })

  it('el cierre del día especial NO cruza medianoche si no corresponde', async () => {
    const r = await estaAbierto(TENANT, new Date('2026-09-23T03:30:00Z'), {
      snapshot: local({
        diasEspeciales: [
          { fecha: '2026-09-22', cerrado: false, abre: '12:00:00', cierra: '16:00:00' },
        ],
      }),
    })

    expect(r.abierto).toBe(false)
  })
})

describe('estaAbierto — canales y datos faltantes', () => {
  it('con acepta_delivery en false, delivery está cerrado y takeaway no', async () => {
    const snapshot = local({ aceptaDelivery: false })

    const delivery = await estaAbierto(TENANT, MIERCOLES_00_30, { snapshot, alcance: 'delivery' })
    const takeaway = await estaAbierto(TENANT, MIERCOLES_00_30, { snapshot, alcance: 'takeaway' })

    expect(delivery.abierto).toBe(false)
    expect(delivery.motivo).toBe('canal_deshabilitado')
    expect(takeaway.abierto).toBe(true)
  })

  it('sin horarios cargados no inventa que está abierto', async () => {
    const r = await estaAbierto(TENANT, MIERCOLES_00_30, {
      snapshot: local({ horarios: [], diasEspeciales: [] }),
    })

    expect(r.abierto).toBe(false)
    expect(r.motivo).toBe('sin_horarios')
  })

  it('un horario inactivo no cuenta', async () => {
    const r = await estaAbierto(TENANT, MARTES_21_00, {
      snapshot: local({
        horarios: [
          { dia_semana: 2, abre: '20:00:00', cierra: '01:30:00', ultimo_pedido_min_antes: 0, activo: false },
        ],
      }),
    })

    expect(r.abierto).toBe(false)
  })
})

describe('estaAbierto — el seed de Mola (martes a domingo, 20:00 a 01:00)', () => {
  const mola = (): SnapshotApertura => ({
    timezone: TZ,
    aceptaDelivery: true,
    aceptaTakeaway: true,
    horarios: [2, 3, 4, 5, 6, 0].map((dia) => ({
      dia_semana: dia,
      abre: '20:00:00',
      cierra: '01:00:00',
      ultimo_pedido_min_antes: 30,
      activo: true,
    })),
    diasEspeciales: [],
    pausas: [],
  })

  it('el lunes a las 22:00 está cerrado: es el único día que no abre', async () => {
    // Lunes 2026-09-21, 22:00 local = 2026-09-22T01:00:00Z
    const r = await estaAbierto(TENANT, new Date('2026-09-22T01:00:00Z'), { snapshot: mola() })

    expect(r.abierto).toBe(false)
    expect(r.motivo).toBe('dia_cerrado')
  })

  it('el lunes a las 00:15 está abierto: viene del turno del domingo', async () => {
    // Lunes 2026-09-21, 00:15 local = 2026-09-21T03:15:00Z
    const r = await estaAbierto(TENANT, new Date('2026-09-21T03:15:00Z'), { snapshot: mola() })

    expect(r.abierto).toBe(true)
    // Cierra el lunes 01:00 local = 04:00 UTC.
    expect(r.cierraEn?.toISOString()).toBe('2026-09-21T04:00:00.000Z')
  })

  it('el lunes a las 00:30 en punto ya no toma pedidos: es el corte exacto', async () => {
    // Cierra 01:00 y corta 30 min antes ⇒ el último pedido entra
    // hasta las 00:29:59. A las 00:30 clavadas el local sigue
    // abierto, pero no toma nada más.
    const r = await estaAbierto(TENANT, new Date('2026-09-21T03:30:00Z'), { snapshot: mola() })

    expect(r.abierto).toBe(false)
    expect(r.motivo).toBe('ultimo_pedido_pasado')
    expect(r.ultimoPedidoHasta?.toISOString()).toBe('2026-09-21T03:30:00.000Z')
  })
})
