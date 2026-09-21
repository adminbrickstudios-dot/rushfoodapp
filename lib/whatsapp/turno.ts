import { reprogramarReintento } from './buffer'
import type { ContextoWhatsApp } from './contexto'
import { drenarOutbox, encolar } from './outbox'

/** Segundos que el lock se considera vigente antes de darse por muerto. */
export const LOCK_TIMEOUT_SEGUNDOS = 30
/** Fallas seguidas antes de derivar a un humano. */
export const MAX_INTENTOS_TURNO = 3
/** Espera entre reintentos de procesamiento. */
export const SEGUNDOS_REINTENTO = 5
/** Minutos de pausa del bot cuando se agotaron los reintentos. */
export const MINUTOS_PAUSA_AL_RENDIRSE = 15

export type ResultadoTurno =
  | { estado: 'procesado'; mensajes: number; outboxId: string }
  | { estado: 'sin_mensajes' }
  | { estado: 'ocupado' }
  | { estado: 'reintentara'; intento: number }
  | { estado: 'derivado'; ticketId: string }

/**
 * Menú estático de 3 botones.
 *
 * Es la respuesta de este paso: todavía no hay LLM, así que a
 * cualquier mensaje se contesta lo mismo. El objetivo es que mandar
 * "hola" desde un celular devuelva estos tres botones.
 */
export function menuInicial(destino: string) {
  return {
    clase: 'botones' as const,
    params: {
      destino,
      cuerpo: '¡Hola! 🍔 Soy el asistente de Mola. ¿Qué querés hacer?',
      botones: [
        { id: 'ver_menu', titulo: 'Ver el menú' },
        { id: 'hacer_pedido', titulo: 'Hacer un pedido' },
        { id: 'hablar_humano', titulo: 'Hablar con alguien' },
      ],
      pie: 'Delivery y retiro en el local',
    },
  }
}

export interface ProcesarTurnoParams {
  tenantId: string
  conversacionId: string
}

/**
 * Procesa un turno de conversación.
 *
 * Contrato: esta función NUNCA lanza por una falla de procesamiento.
 * O procesa, o deja registrado el reintento, o deriva a un humano.
 * Que un cliente se quede sin ninguna respuesta es el único
 * resultado inaceptable.
 */
export async function procesarTurno(
  ctx: ContextoWhatsApp,
  p: ProcesarTurnoParams,
): Promise<ResultadoTurno> {
  // ---- control de concurrencia ----
  // Dos disparos de QStash sobre la misma conversación (el viejo que
  // no se pudo cancelar y el nuevo) llegan a la vez. El UPDATE
  // condicional decide cuál trabaja.
  const tomado = await ctx.repo.tomarLock(p.conversacionId, p.tenantId, LOCK_TIMEOUT_SEGUNDOS)

  if (!tomado) {
    return { estado: 'ocupado' }
  }

  try {
    const pendientes = await ctx.repo.mensajesSinProcesar(p.conversacionId, p.tenantId)

    if (pendientes.length === 0) {
      // El disparo duplicado típico: el otro ya hizo el trabajo.
      return { estado: 'sin_mensajes' }
    }

    const conversacion = await ctx.repo.conversacionPorId(p.conversacionId)
    if (!conversacion) {
      throw new Error(`la conversación ${p.conversacionId} no existe`)
    }

    // Toda la tanda cuenta como UN turno: se responde una sola vez,
    // no una por mensaje.
    const salida = menuInicial(conversacion.wa_id)

    // Idempotencia del envío: la clave incluye el último mensaje del
    // turno, así que reprocesar la misma tanda no manda dos veces lo
    // mismo, pero una tanda nueva sí genera una respuesta nueva.
    const ultimo = pendientes[pendientes.length - 1]!
    const idempotencyKey = `turno:${p.conversacionId}:${ultimo.id}`

    const { id: outboxId } = await encolar(ctx, {
      tenantId: p.tenantId,
      conversacionId: p.conversacionId,
      salida,
      idempotencyKey,
    })

    const marcados = await ctx.repo.cerrarTurno(
      p.conversacionId,
      p.tenantId,
      pendientes.map((m) => m.id),
    )

    if (marcados === 0) {
      throw new Error(
        `cerrarTurno no marcó ningún mensaje de ${pendientes.length} en ${p.conversacionId}`,
      )
    }

    // Despachar en el acto: el cron de 1 minuto es la red de
    // seguridad, no el camino normal. Nadie espera un minuto por un
    // "hola".
    await drenarOutbox(ctx, 5)

    return { estado: 'procesado', mensajes: marcados, outboxId }
  } catch (err) {
    return manejarFalla(ctx, p, err)
  } finally {
    // Pase lo que pase, el lock se libera. Si no, la conversación
    // queda muda hasta que venza el timeout de 30 segundos.
    try {
      await ctx.repo.liberarLock(p.conversacionId, p.tenantId)
    } catch (err) {
      console.error('[turno] no se pudo liberar el lock', {
        conversacionId: p.conversacionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function manejarFalla(
  ctx: ContextoWhatsApp,
  p: ProcesarTurnoParams,
  err: unknown,
): Promise<ResultadoTurno> {
  const detalle = err instanceof Error ? `${err.name}: ${err.message}` : String(err)

  console.error('[turno] falló el procesamiento', {
    conversacionId: p.conversacionId,
    tenantId: p.tenantId,
    error: detalle,
  })

  try {
    const intento = await ctx.repo.registrarIntentoFallido(p.conversacionId, p.tenantId)

    if (intento < MAX_INTENTOS_TURNO) {
      await reprogramarReintento(ctx, {
        tenantId: p.tenantId,
        conversacionId: p.conversacionId,
        segundos: SEGUNDOS_REINTENTO,
      })
      return { estado: 'reintentara', intento }
    }

    // Tres fallas seguidas: el sistema no puede resolverlo solo.
    // Antes que dejar al cliente esperando, se despierta a un humano.
    const ticketId = await ctx.repo.rendirseYDerivar(
      p.conversacionId,
      p.tenantId,
      `El bot falló ${intento} veces seguidas procesando esta conversación. ` +
        `Último error: ${detalle}`,
      MINUTOS_PAUSA_AL_RENDIRSE,
    )

    return { estado: 'derivado', ticketId }
  } catch (errorDelManejo) {
    // Falló hasta el manejo de la falla. No hay nada más que hacer
    // desde acá, pero tiene que quedar en los logs.
    console.error('[turno] el manejo de la falla también falló', {
      conversacionId: p.conversacionId,
      errorOriginal: detalle,
      error:
        errorDelManejo instanceof Error ? errorDelManejo.message : String(errorDelManejo),
    })
    return { estado: 'reintentara', intento: -1 }
  }
}
