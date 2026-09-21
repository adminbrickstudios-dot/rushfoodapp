import type { Json, WaOutbox } from '@/lib/types/db'
import type { ContextoWhatsApp } from './contexto'
import {
  payloadBotones,
  payloadCtaUrl,
  payloadLista,
  payloadPlantilla,
  payloadTexto,
  WhatsAppApiError,
  type EnvioBotones,
  type EnvioCtaUrl,
  type EnvioLista,
  type EnvioPlantilla,
  type EnvioTexto,
  type ResultadoEnvio,
} from './provider'

/** Máximo de intentos antes de dar por fallido un envío. */
export const MAX_INTENTOS = 5
/** Meta admite 1 mensaje cada 6 segundos por destinatario. */
export const SEGUNDOS_ENTRE_ENVIOS = 6
/** Minutos de pausa del bot cuando un envío se da por perdido. */
export const MINUTOS_PAUSA_ENVIO_FALLIDO = 15

export type SalidaWhatsApp =
  | { clase: 'texto'; params: EnvioTexto }
  | { clase: 'botones'; params: EnvioBotones }
  | { clase: 'lista'; params: EnvioLista }
  | { clase: 'plantilla'; params: EnvioPlantilla }
  | { clase: 'ctaUrl'; params: EnvioCtaUrl }

/**
 * Valida el payload sin mandarlo.
 *
 * Se corre al ENCOLAR, no sólo al despachar. Si no, un mensaje con 4
 * botones se encolaría sin chistar y recién explotaría dentro del cron
 * —donde nadie está mirando— con el cliente esperando una respuesta
 * que no va a llegar nunca.
 */
export function validarSalida(salida: SalidaWhatsApp): void {
  switch (salida.clase) {
    case 'texto':
      payloadTexto(salida.params)
      return
    case 'botones':
      payloadBotones(salida.params)
      return
    case 'lista':
      payloadLista(salida.params)
      return
    case 'plantilla':
      payloadPlantilla(salida.params)
      return
    case 'ctaUrl':
      payloadCtaUrl(salida.params)
      return
  }
}

export interface EncolarParams {
  tenantId: string
  conversacionId: string | null
  salida: SalidaWhatsApp
  /**
   * Clave de deduplicación. Dos intentos de encolar lo mismo con la
   * misma clave producen UN solo envío.
   */
  idempotencyKey: string
}

/**
 * Encola un mensaje saliente. Todo mensaje que sale del sistema pasa
 * por acá: nada llama al proveedor directamente.
 */
export async function encolar(
  ctx: ContextoWhatsApp,
  p: EncolarParams,
): Promise<{ id: string; duplicado: boolean }> {
  validarSalida(p.salida)

  return ctx.repo.encolarSalida({
    tenantId: p.tenantId,
    conversacionId: p.conversacionId,
    destino: p.salida.params.destino,
    payload: p.salida as unknown as Json,
    idempotencyKey: p.idempotencyKey,
  })
}

async function despachar(
  ctx: ContextoWhatsApp,
  salida: SalidaWhatsApp,
): Promise<ResultadoEnvio> {
  const { proveedor } = ctx
  switch (salida.clase) {
    case 'texto':
      return proveedor.sendText(salida.params)
    case 'botones':
      return proveedor.sendButtons(salida.params)
    case 'lista':
      return proveedor.sendList(salida.params)
    case 'plantilla':
      return proveedor.sendTemplate(salida.params)
    case 'ctaUrl':
      return proveedor.sendCtaUrl(salida.params)
  }
}

export interface ResumenDrenaje {
  reclamados: number
  enviados: number
  pospuestos: number
  fallidos: number
  errores: string[]
}

/**
 * Drena la cola de salida.
 *
 * Las filas se reclaman con FOR UPDATE SKIP LOCKED, así que dos
 * corridas solapadas del cron no se pisan. El slot de 6 segundos por
 * destinatario se reserva atómicamente antes de cada envío; el que no
 * lo consigue se pospone sin gastar un intento.
 */
export async function drenarOutbox(
  ctx: ContextoWhatsApp,
  limite = 20,
): Promise<ResumenDrenaje> {
  const filas = await ctx.repo.reclamarOutbox(limite)

  const resumen: ResumenDrenaje = {
    reclamados: filas.length,
    enviados: 0,
    pospuestos: 0,
    fallidos: 0,
    errores: [],
  }

  for (const fila of filas) {
    try {
      await despacharFila(ctx, fila, resumen)
    } catch (err) {
      // Nunca cortar el drenaje por una fila: las que siguen pueden
      // ser de otros clientes que no tienen nada que ver.
      const texto = err instanceof Error ? err.message : String(err)
      resumen.errores.push(`${fila.id}: ${texto}`)
      resumen.fallidos += 1
      console.error('[outbox] fila no despachada', { id: fila.id, error: texto })
    }
  }

  return resumen
}

async function despacharFila(
  ctx: ContextoWhatsApp,
  fila: WaOutbox,
  resumen: ResumenDrenaje,
): Promise<void> {
  const reserva = await ctx.repo.reservarEnvio(
    fila.tenant_id,
    fila.destino,
    SEGUNDOS_ENTRE_ENVIOS,
  )

  if (!reserva.permitido) {
    // No es una falla del envío: al destinatario todavía no se le
    // puede escribir. Vuelve a la cola sin gastar un intento.
    await ctx.repo.posponerOutbox(fila.id, fila.tenant_id, reserva.esperarSegundos)
    resumen.pospuestos += 1
    return
  }

  const salida = fila.payload as unknown as SalidaWhatsApp

  try {
    const { waMessageId } = await despachar(ctx, salida)
    await ctx.repo.marcarOutboxEnviado(fila.id, fila.tenant_id, waMessageId)
    resumen.enviados += 1
  } catch (err) {
    const texto = err instanceof Error ? err.message : String(err)

    // Un 4xx de payload no mejora reintentando: se marca fallido ya,
    // en vez de gastar cinco intentos contra la misma pared.
    const definitivo = err instanceof WhatsAppApiError && !err.reintentable
    const estado = await ctx.repo.marcarOutboxFallido(
      fila.id,
      fila.tenant_id,
      texto,
      definitivo ? 0 : MAX_INTENTOS,
    )

    resumen.errores.push(`${fila.id}: ${texto}`)

    if (estado !== 'fallido') return

    resumen.fallidos += 1

    // Se agotaron los reintentos del envío. Sin esto, el cliente se
    // queda sin ninguna respuesta y nadie se entera: la cola marca la
    // fila 'fallido' y ahí muere. Se despierta a un humano, que es la
    // regla que manda sobre todo lo demás.
    if (!fila.conversacion_id) return

    try {
      await ctx.repo.rendirseYDerivar(
        fila.conversacion_id,
        fila.tenant_id,
        `No se pudo entregar un mensaje a ${fila.destino} tras ${fila.intentos} intentos. ` +
          `Último error: ${texto}`,
        MINUTOS_PAUSA_ENVIO_FALLIDO,
      )
    } catch (errorDerivacion) {
      console.error('[outbox] no se pudo derivar un envío fallido', {
        id: fila.id,
        error:
          errorDerivacion instanceof Error ? errorDerivacion.message : String(errorDerivacion),
      })
    }
  }
}
