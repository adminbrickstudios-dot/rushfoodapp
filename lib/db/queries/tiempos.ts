import { clienteServicio, type ClienteRushFood } from '@/lib/db/client'
import type { TipoEntrega } from '@/lib/types/db'
import { ErrorDB, leerOpcional } from './_comun'

export interface ItemParaEstimar {
  producto_id: string
  variante_id?: string | null
  /** Sólo informativo: no multiplica el tiempo. Ver nota abajo. */
  cantidad?: number
}

export interface SnapshotTiempos {
  minutosBufferCocina: number
  minutosExtraDelivery: number
  /** producto_id → minutos_prep */
  minutosPrepProducto: Record<string, number>
  /** variante_id → minutos_extra */
  minutosExtraVariante: Record<string, number>
  /** minutos_extra de la zona de entrega, 0 si es takeaway. */
  minutosExtraZona: number
}

export interface TiempoEstimado {
  /** Lo que se le promete al cliente. */
  minutos: number
  desglose: {
    preparacion: number
    bufferCocina: number
    zona: number
    delivery: number
  }
}

/**
 * Minutos a prometer para un pedido.
 *
 * Suma:
 *   · minutos_prep de cada producto
 *   · minutos_extra de la variante elegida
 *   · minutos_buffer_cocina del tenant (el botón de "+15" del panel)
 *   · minutos_extra de la zona, sólo en delivery
 *   · minutos_extra_delivery del tenant, sólo en delivery
 *
 * Dos decisiones que conviene tener a la vista:
 *
 * 1. `cantidad` NO multiplica. Dos hamburguesas iguales salen de la
 *    misma plancha en la misma tanda; multiplicar prometería 20
 *    minutos por algo que sale en 10. El costo del criterio es que un
 *    pedido de veinte unidades queda subestimado.
 *
 * 2. La suma es lineal, así que un pedido de cinco productos
 *    distintos promete la suma de los cinco, como si la cocina fuera
 *    una sola estación en serie. Con `estaciones` en el schema, lo
 *    correcto a futuro es agrupar por estación y tomar el máximo.
 *    Queda así porque es lo que pediste; sobreestimar es el lado
 *    seguro del error.
 */
export function estimarConSnapshot(
  items: ItemParaEstimar[],
  tipoEntrega: TipoEntrega,
  snapshot: SnapshotTiempos,
): TiempoEstimado {
  if (items.length === 0) {
    throw new ErrorDB('calcularTiempoEstimado: el pedido no tiene items')
  }

  let preparacion = 0

  for (const item of items) {
    const prep = snapshot.minutosPrepProducto[item.producto_id]
    if (prep === undefined) {
      // Un producto desconocido sumando 0 prometería un tiempo
      // inventado, que es exactamente lo que hay que evitar.
      throw new ErrorDB(
        `calcularTiempoEstimado: no hay minutos_prep para el producto ${item.producto_id}`,
      )
    }
    preparacion += prep

    if (item.variante_id) {
      const extra = snapshot.minutosExtraVariante[item.variante_id]
      if (extra === undefined) {
        throw new ErrorDB(
          `calcularTiempoEstimado: no hay minutos_extra para la variante ${item.variante_id}`,
        )
      }
      preparacion += extra
    }
  }

  const esDelivery = tipoEntrega === 'delivery'
  const zona = esDelivery ? snapshot.minutosExtraZona : 0
  const delivery = esDelivery ? snapshot.minutosExtraDelivery : 0
  const bufferCocina = snapshot.minutosBufferCocina

  return {
    minutos: preparacion + bufferCocina + zona + delivery,
    desglose: { preparacion, bufferCocina, zona, delivery },
  }
}

export interface OpcionesTiempo {
  tenantId?: string
  zonaId?: string | null
  db?: ClienteRushFood
  /** Datos ya cargados. Si viene, no se toca la base. */
  snapshot?: SnapshotTiempos
}

/** Trae de la base lo que estimarConSnapshot() necesita. */
export async function cargarSnapshotTiempos(
  tenantId: string,
  items: ItemParaEstimar[],
  zonaId: string | null | undefined,
  db: ClienteRushFood = clienteServicio(),
): Promise<SnapshotTiempos> {
  const ctx = `cargarSnapshotTiempos(${tenantId})`

  const idsProducto = [...new Set(items.map((i) => i.producto_id))]
  const idsVariante = [...new Set(items.map((i) => i.variante_id).filter((v): v is string => !!v))]

  const [config, productos, variantes, zona] = await Promise.all([
    db
      .from('tenant_config')
      .select('minutos_buffer_cocina, minutos_extra_delivery')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db.from('productos').select('id, minutos_prep').eq('tenant_id', tenantId).in('id', idsProducto),
    idsVariante.length > 0
      ? db
          .from('variantes')
          .select('id, minutos_extra')
          .eq('tenant_id', tenantId)
          .in('id', idsVariante)
      : Promise.resolve({ data: [], error: null }),
    zonaId
      ? db
          .from('zonas_delivery')
          .select('minutos_extra')
          .eq('tenant_id', tenantId)
          .eq('id', zonaId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const filaConfig = leerOpcional(config, `${ctx}: config`)
  const filasProducto = leerOpcional(productos, `${ctx}: productos`) ?? []
  const filasVariante = leerOpcional(variantes, `${ctx}: variantes`) ?? []
  const filaZona = leerOpcional(zona, `${ctx}: zona`)

  if (zonaId && !filaZona) {
    throw new ErrorDB(`${ctx}: la zona ${zonaId} no existe en este tenant`)
  }

  return {
    minutosBufferCocina: filaConfig?.minutos_buffer_cocina ?? 0,
    minutosExtraDelivery: filaConfig?.minutos_extra_delivery ?? 0,
    minutosPrepProducto: Object.fromEntries(filasProducto.map((p) => [p.id, p.minutos_prep])),
    minutosExtraVariante: Object.fromEntries(filasVariante.map((v) => [v.id, v.minutos_extra])),
    minutosExtraZona: filaZona?.minutos_extra ?? 0,
  }
}

/**
 * Minutos a prometer para un pedido. Ver `estimarConSnapshot` para el
 * detalle de la fórmula y sus dos supuestos.
 *
 * @example
 *   await calcularTiempoEstimado(items, 'delivery', { tenantId, zonaId })
 */
export async function calcularTiempoEstimado(
  items: ItemParaEstimar[],
  tipoEntrega: TipoEntrega,
  opciones: OpcionesTiempo = {},
): Promise<TiempoEstimado> {
  let snapshot = opciones.snapshot

  if (!snapshot) {
    if (!opciones.tenantId) {
      throw new ErrorDB('calcularTiempoEstimado: hace falta tenantId o snapshot')
    }
    snapshot = await cargarSnapshotTiempos(
      opciones.tenantId,
      items,
      opciones.zonaId,
      opciones.db,
    )
  }

  return estimarConSnapshot(items, tipoEntrega, snapshot)
}
