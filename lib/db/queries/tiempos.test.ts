import { describe, expect, it } from 'vitest'
import { calcularTiempoEstimado, type SnapshotTiempos } from './tiempos'
import { ErrorDB } from './_comun'

const BURGER = 'p-burger'
const PAPAS = 'p-papas'
const DOBLE = 'v-doble'
const SIMPLE = 'v-simple'

function snapshot(extra: Partial<SnapshotTiempos> = {}): SnapshotTiempos {
  return {
    minutosBufferCocina: 0,
    minutosExtraDelivery: 15,
    minutosPrepProducto: { [BURGER]: 10, [PAPAS]: 8 },
    minutosExtraVariante: { [SIMPLE]: 0, [DOBLE]: 3 },
    minutosExtraZona: 0,
    ...extra,
  }
}

describe('calcularTiempoEstimado — takeaway', () => {
  it('un producto sin variante es su minutos_prep', async () => {
    const r = await calcularTiempoEstimado([{ producto_id: BURGER }], 'takeaway', {
      snapshot: snapshot(),
    })

    expect(r.minutos).toBe(10)
    expect(r.desglose).toEqual({ preparacion: 10, bufferCocina: 0, zona: 0, delivery: 0 })
  })

  it('suma los minutos_extra de la variante', async () => {
    const r = await calcularTiempoEstimado(
      [{ producto_id: BURGER, variante_id: DOBLE }],
      'takeaway',
      { snapshot: snapshot() },
    )

    expect(r.minutos).toBe(13) // 10 + 3
  })

  it('suma los minutos_prep de cada producto del pedido', async () => {
    const r = await calcularTiempoEstimado(
      [{ producto_id: BURGER, variante_id: DOBLE }, { producto_id: PAPAS }],
      'takeaway',
      { snapshot: snapshot() },
    )

    expect(r.minutos).toBe(21) // (10 + 3) + 8
  })

  it('suma el minutos_buffer_cocina del tenant', async () => {
    const r = await calcularTiempoEstimado([{ producto_id: BURGER }], 'takeaway', {
      snapshot: snapshot({ minutosBufferCocina: 15 }),
    })

    expect(r.minutos).toBe(25) // 10 + 15
    expect(r.desglose.bufferCocina).toBe(15)
  })

  it('en takeaway no suma ni zona ni delivery', async () => {
    const r = await calcularTiempoEstimado([{ producto_id: BURGER }], 'takeaway', {
      snapshot: snapshot({ minutosExtraZona: 18, minutosExtraDelivery: 15 }),
    })

    expect(r.minutos).toBe(10)
    expect(r.desglose.zona).toBe(0)
    expect(r.desglose.delivery).toBe(0)
  })

  it('la cantidad no multiplica el tiempo: la misma plancha, la misma tanda', async () => {
    const uno = await calcularTiempoEstimado([{ producto_id: BURGER, cantidad: 1 }], 'takeaway', {
      snapshot: snapshot(),
    })
    const cinco = await calcularTiempoEstimado([{ producto_id: BURGER, cantidad: 5 }], 'takeaway', {
      snapshot: snapshot(),
    })

    expect(cinco.minutos).toBe(uno.minutos)
  })
})

describe('calcularTiempoEstimado — delivery', () => {
  it('suma los minutos_extra de la zona', async () => {
    const r = await calcularTiempoEstimado([{ producto_id: BURGER }], 'delivery', {
      snapshot: snapshot({ minutosExtraZona: 18 }),
    })

    expect(r.minutos).toBe(43) // 10 prep + 18 zona + 15 delivery
    expect(r.desglose).toEqual({ preparacion: 10, bufferCocina: 0, zona: 18, delivery: 15 })
  })

  it('el pedido completo de Mola a Zona Sur, con la cocina saturada', async () => {
    // Doble + papas, buffer de 15 por saturación, Zona Sur (+18).
    const r = await calcularTiempoEstimado(
      [{ producto_id: BURGER, variante_id: DOBLE }, { producto_id: PAPAS }],
      'delivery',
      { snapshot: snapshot({ minutosBufferCocina: 15, minutosExtraZona: 18 }) },
    )

    // (10 + 3) + 8 = 21 prep, + 15 buffer + 18 zona + 15 delivery
    expect(r.minutos).toBe(69)
  })

  it('con zona sin recargo sigue sumando el extra de delivery del tenant', async () => {
    const r = await calcularTiempoEstimado([{ producto_id: BURGER }], 'delivery', {
      snapshot: snapshot({ minutosExtraZona: 0 }),
    })

    expect(r.minutos).toBe(25) // 10 + 15
  })
})

describe('calcularTiempoEstimado — no promete tiempos inventados', () => {
  it('falla si el pedido viene vacío', async () => {
    await expect(calcularTiempoEstimado([], 'takeaway', { snapshot: snapshot() })).rejects.toThrow(
      ErrorDB,
    )
  })

  it('falla si un producto no tiene minutos_prep conocido', async () => {
    await expect(
      calcularTiempoEstimado([{ producto_id: 'p-fantasma' }], 'takeaway', {
        snapshot: snapshot(),
      }),
    ).rejects.toThrow(/p-fantasma/)
  })

  it('falla si la variante no tiene minutos_extra conocido', async () => {
    await expect(
      calcularTiempoEstimado([{ producto_id: BURGER, variante_id: 'v-fantasma' }], 'takeaway', {
        snapshot: snapshot(),
      }),
    ).rejects.toThrow(/v-fantasma/)
  })

  it('falla si no hay ni tenantId ni snapshot', async () => {
    await expect(calcularTiempoEstimado([{ producto_id: BURGER }], 'takeaway', {})).rejects.toThrow(
      /tenantId o snapshot/,
    )
  })
})
