import { clienteServicio, type ClienteRushFood } from '@/lib/db/client'
import type { AlcancePausa } from '@/lib/types/db'
import { leerOpcional } from './_comun'

export interface MenuOpcion {
  id: string
  nombre: string
  precio: number
}

export interface MenuGrupo {
  id: string
  nombre: string
  min_selec: number
  max_selec: number
  obligatorio: boolean
  opciones: MenuOpcion[]
}

export interface MenuVariante {
  id: string
  nombre: string
  precio_delta: number
  minutos_extra: number
  es_default: boolean
}

export interface MenuProducto {
  id: string
  nombre: string
  descripcion: string | null
  ingredientes: string | null
  precio_base: number
  minutos_prep: number
  imagen_url: string | null
  alias: string[] | null
  variantes: MenuVariante[]
  grupos: MenuGrupo[]
}

export interface MenuCategoria {
  id: string
  nombre: string
  productos: MenuProducto[]
}

export interface Menu {
  categorias: MenuCategoria[]
  /**
   * Qué se puede pedir AHORA. Refleja tenant_config y las pausas
   * vigentes: el menú se muestra igual, pero con los dos en false no
   * hay que dejar confirmar nada.
   */
  disponibilidad: {
    delivery: boolean
    takeaway: boolean
    pausas: Array<{ alcance: AlcancePausa; hasta: string; motivo: string | null }>
  }
}

export interface OpcionesMenu {
  db?: ClienteRushFood
  /** Momento contra el que se evalúan las pausas. */
  fecha?: Date
}

/**
 * El menú vigente de un tenant.
 *
 * Excluye todo lo agotado — productos, variantes y opciones — porque
 * un agotado que se sigue ofreciendo es el bot vendiendo algo que no
 * existe. Excluye también lo inactivo, que es la baja lógica.
 *
 * Las pausas no filtran productos: apagan los canales. El cliente
 * puede mirar el menú mientras la cocina está frenada; lo que no
 * puede es confirmar.
 */
export async function getMenu(
  tenantId: string,
  opciones: OpcionesMenu = {},
): Promise<Menu> {
  const db = opciones.db ?? clienteServicio()
  const fecha = opciones.fecha ?? new Date()
  const ctx = `getMenu(${tenantId})`

  const [categorias, productos, config, pausas] = await Promise.all([
    db
      .from('categorias')
      .select('id, nombre, orden')
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .order('orden'),
    db
      .from('productos')
      .select(
        'id, categoria_id, nombre, descripcion, ingredientes, precio_base, minutos_prep, imagen_url, alias, orden',
      )
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .eq('agotado', false)
      .order('orden'),
    db
      .from('tenant_config')
      .select('acepta_delivery, acepta_takeaway')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('pausas')
      .select('alcance, hasta, motivo')
      .eq('tenant_id', tenantId)
      .gt('hasta', fecha.toISOString()),
  ])

  const filasCategoria = leerOpcional(categorias, `${ctx}: categorias`) ?? []
  const filasProducto = leerOpcional(productos, `${ctx}: productos`) ?? []
  const filaConfig = leerOpcional(config, `${ctx}: config`)
  const filasPausa = leerOpcional(pausas, `${ctx}: pausas`) ?? []

  const idsProducto = filasProducto.map((p) => p.id)

  const [variantes, vinculos] = await Promise.all([
    idsProducto.length > 0
      ? db
          .from('variantes')
          .select('id, producto_id, nombre, precio_delta, minutos_extra, es_default, orden')
          .eq('tenant_id', tenantId)
          .eq('agotado', false)
          .in('producto_id', idsProducto)
          .order('orden')
      : Promise.resolve({ data: [], error: null }),
    idsProducto.length > 0
      ? db
          .from('producto_grupos')
          .select('producto_id, grupo_id, orden')
          .eq('tenant_id', tenantId)
          .in('producto_id', idsProducto)
          .order('orden')
      : Promise.resolve({ data: [], error: null }),
  ])

  const filasVariante = leerOpcional(variantes, `${ctx}: variantes`) ?? []
  const filasVinculo = leerOpcional(vinculos, `${ctx}: producto_grupos`) ?? []

  const idsGrupo = [...new Set(filasVinculo.map((v) => v.grupo_id))]

  const [grupos, opcionesGrupo] = await Promise.all([
    idsGrupo.length > 0
      ? db
          .from('grupos_opciones')
          .select('id, nombre, min_selec, max_selec, obligatorio, orden')
          .eq('tenant_id', tenantId)
          .in('id', idsGrupo)
          .order('orden')
      : Promise.resolve({ data: [], error: null }),
    idsGrupo.length > 0
      ? db
          .from('opciones')
          .select('id, grupo_id, nombre, precio, orden')
          .eq('tenant_id', tenantId)
          .eq('agotado', false)
          .in('grupo_id', idsGrupo)
          .order('orden')
      : Promise.resolve({ data: [], error: null }),
  ])

  const filasGrupo = leerOpcional(grupos, `${ctx}: grupos_opciones`) ?? []
  const filasOpcion = leerOpcional(opcionesGrupo, `${ctx}: opciones`) ?? []

  // ---------- armado ----------
  const opcionesPorGrupo = new Map<string, MenuOpcion[]>()
  for (const o of filasOpcion) {
    const lista = opcionesPorGrupo.get(o.grupo_id) ?? []
    lista.push({ id: o.id, nombre: o.nombre, precio: o.precio })
    opcionesPorGrupo.set(o.grupo_id, lista)
  }

  const grupoPorId = new Map<string, MenuGrupo>(
    filasGrupo.map((g) => [
      g.id,
      {
        id: g.id,
        nombre: g.nombre,
        min_selec: g.min_selec,
        max_selec: g.max_selec,
        obligatorio: g.obligatorio,
        opciones: opcionesPorGrupo.get(g.id) ?? [],
      },
    ]),
  )

  const variantesPorProducto = new Map<string, MenuVariante[]>()
  for (const v of filasVariante) {
    const lista = variantesPorProducto.get(v.producto_id) ?? []
    lista.push({
      id: v.id,
      nombre: v.nombre,
      precio_delta: v.precio_delta,
      minutos_extra: v.minutos_extra,
      es_default: v.es_default,
    })
    variantesPorProducto.set(v.producto_id, lista)
  }

  const gruposPorProducto = new Map<string, MenuGrupo[]>()
  for (const v of filasVinculo) {
    const grupo = grupoPorId.get(v.grupo_id)
    if (!grupo) continue
    const lista = gruposPorProducto.get(v.producto_id) ?? []
    lista.push(grupo)
    gruposPorProducto.set(v.producto_id, lista)
  }

  const productosPorCategoria = new Map<string, MenuProducto[]>()
  for (const p of filasProducto) {
    if (!p.categoria_id) continue
    const lista = productosPorCategoria.get(p.categoria_id) ?? []
    lista.push({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      ingredientes: p.ingredientes,
      precio_base: p.precio_base,
      minutos_prep: p.minutos_prep,
      imagen_url: p.imagen_url,
      alias: p.alias,
      variantes: variantesPorProducto.get(p.id) ?? [],
      grupos: gruposPorProducto.get(p.id) ?? [],
    })
    productosPorCategoria.set(p.categoria_id, lista)
  }

  const pausaTodo = filasPausa.some((p) => p.alcance === 'todo')

  return {
    categorias: filasCategoria
      .map((c) => ({
        id: c.id,
        nombre: c.nombre,
        productos: productosPorCategoria.get(c.id) ?? [],
      }))
      // Una categoría sin nada disponible no se muestra vacía.
      .filter((c) => c.productos.length > 0),
    disponibilidad: {
      delivery:
        (filaConfig?.acepta_delivery ?? true) &&
        !pausaTodo &&
        !filasPausa.some((p) => p.alcance === 'delivery'),
      takeaway:
        (filaConfig?.acepta_takeaway ?? true) &&
        !pausaTodo &&
        !filasPausa.some((p) => p.alcance === 'takeaway'),
      pausas: filasPausa.map((p) => ({ alcance: p.alcance, hasta: p.hasta, motivo: p.motivo })),
    },
  }
}
