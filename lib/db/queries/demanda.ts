import { clienteServicio, type ClienteRushFood } from '@/lib/db/client'
import type { DemandaPerdida } from '@/lib/types/db'
import { escrituraVerificada } from './_comun'

/**
 * · agotado      → pidió algo que no hay
 * · fuera_de_zona → pidió delivery a una zona no cubierta
 * · cerrado      → escribió con el local cerrado
 * · sin_delivery → quiso delivery y el tenant no lo hace / está pausado
 */
export type TipoDemandaPerdida = 'agotado' | 'fuera_de_zona' | 'cerrado' | 'sin_delivery'

export interface DatosDemandaPerdida {
  tenantId: string
  /** Qué producto quería, cuando se sabe cuál. */
  productoId?: string | null
  /** Lo que escribió textual: sirve cuando no se pudo matchear nada. */
  textoCliente?: string | null
  /** El barrio o dirección que dio, para 'fuera_de_zona'. */
  zonaTexto?: string | null
  conversacionId?: string | null
  db?: ClienteRushFood
}

/**
 * Registra una venta que no se pudo hacer.
 *
 * Es la materia prima del reporte de demanda perdida: "perdiste 34
 * pedidos por quedarte sin cheddar", "te pidieron 19 veces de una
 * zona a la que no llegás". Si no se registra en el momento, ese dato
 * no existe en ningún lado.
 *
 * La escritura se verifica: bajo RLS un tenant_id equivocado no
 * escribe nada y PostgREST no lo reporta como error. Acá cero filas
 * tira.
 *
 * @example
 *   await registrarDemandaPerdida('agotado', {
 *     tenantId, productoId, conversacionId,
 *   })
 */
export async function registrarDemandaPerdida(
  tipo: TipoDemandaPerdida,
  datos: DatosDemandaPerdida,
): Promise<DemandaPerdida> {
  const db = datos.db ?? clienteServicio()

  const res = await db
    .from('demanda_perdida')
    .insert({
      tenant_id: datos.tenantId,
      tipo,
      producto_id: datos.productoId ?? null,
      texto_cliente: datos.textoCliente ?? null,
      zona_texto: datos.zonaTexto ?? null,
      conversacion_id: datos.conversacionId ?? null,
    })
    .select()

  const [fila] = escrituraVerificada(res, `registrarDemandaPerdida(${tipo})`, 1)
  return fila as DemandaPerdida
}
