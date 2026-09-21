import type { ContextoWhatsApp } from './contexto'

/**
 * Tope de reinicio del timer.
 *
 * Sin esto, un cliente que escribe una palabra cada 5 segundos
 * reinicia el buffer para siempre y nunca se le contesta. Pasados 20
 * segundos desde el primer mensaje sin procesar, el turno se dispara
 * cuando estaba programado, aunque sigan llegando mensajes.
 */
export const VENTANA_MAX_SEGUNDOS = 20

/** Ruta que QStash invoca cuando se cumple el retraso. */
export const RUTA_PROCESAR = '/api/whatsapp/procesar'

export interface ProgramarTurnoParams {
  tenantId: string
  conversacionId: string
  segundosBuffer: number
  ventanaMaxSegundos?: number
}

export interface ResultadoProgramacion {
  reprogramado: boolean
  scheduleId: string | null
  motivo: 'programado' | 'ventana_agotada'
}

/**
 * Programa —o reprograma— el disparo del turno de una conversación.
 *
 * El orden de las operaciones es deliberado y es lo más importante de
 * esta función:
 *
 *   1. se crea el schedule NUEVO
 *   2. se guarda su id
 *   3. recién entonces se cancela el VIEJO
 *
 * Al revés (cancelar primero) hay una ventana en la que, si falla la
 * creación del nuevo, la conversación queda sin ningún disparo
 * pendiente y el cliente nunca recibe respuesta. Con este orden, el
 * peor caso es que queden dos disparos vivos: el viejo llega, no
 * consigue el lock o no encuentra mensajes sin procesar, y se va sin
 * hacer nada. Duplicar trabajo inocuo es preferible a silencio.
 */
export async function programarTurno(
  ctx: ContextoWhatsApp,
  p: ProgramarTurnoParams,
): Promise<ResultadoProgramacion> {
  const plan = await ctx.repo.planificarTurno(
    p.conversacionId,
    p.tenantId,
    p.ventanaMaxSegundos ?? VENTANA_MAX_SEGUNDOS,
  )

  if (!plan.debeReprogramar) {
    // Ya pasaron los 20 segundos y hay un disparo vivo: se lo deja
    // llegar en vez de empujarlo otra vez hacia adelante.
    return { reprogramado: false, scheduleId: plan.scheduleAnterior, motivo: 'ventana_agotada' }
  }

  const nuevoId = await ctx.cola.programar({
    url: `${ctx.urlBase}${RUTA_PROCESAR}`,
    cuerpo: { conversacionId: p.conversacionId, tenantId: p.tenantId },
    retrasoSegundos: p.segundosBuffer,
  })

  await ctx.repo.guardarSchedule(p.conversacionId, p.tenantId, nuevoId)

  if (plan.scheduleAnterior && plan.scheduleAnterior !== nuevoId) {
    try {
      await ctx.cola.cancelar(plan.scheduleAnterior)
    } catch (err) {
      // Si no se pudo cancelar, el viejo va a disparar de más. Es
      // ruido, no una falla: el lock y el filtro de mensajes sin
      // procesar hacen que ese disparo sea inocuo.
      console.warn('[buffer] no se pudo cancelar el schedule anterior', {
        scheduleId: plan.scheduleAnterior,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { reprogramado: true, scheduleId: nuevoId, motivo: 'programado' }
}

/** Reprograma un reintento tras una falla de procesamiento. */
export async function reprogramarReintento(
  ctx: ContextoWhatsApp,
  p: { tenantId: string; conversacionId: string; segundos: number },
): Promise<string> {
  const id = await ctx.cola.programar({
    url: `${ctx.urlBase}${RUTA_PROCESAR}`,
    cuerpo: { conversacionId: p.conversacionId, tenantId: p.tenantId },
    retrasoSegundos: p.segundos,
  })

  await ctx.repo.guardarSchedule(p.conversacionId, p.tenantId, id)
  return id
}
