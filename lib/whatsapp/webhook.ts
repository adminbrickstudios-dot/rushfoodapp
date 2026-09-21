import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Json } from '@/lib/types/db'
import { programarTurno } from './buffer'
import type { ContextoWhatsApp } from './contexto'
import { disparaBuffer, normalizarEvento, type MensajeNormalizado } from './entrada'

/** Minutos que el bot se calla cuando un humano escribe desde su celular. */
export const MINUTOS_TAKEOVER = 30

/**
 * Compara dos strings en tiempo constante.
 *
 * Un `===` sobre un secreto filtra, por el tiempo que tarda en
 * fallar, cuántos caracteres del principio coinciden. Con suficientes
 * intentos eso permite reconstruir la firma carácter por carácter.
 *
 * Las longitudes se comparan antes porque timingSafeEqual tira si los
 * buffers miden distinto; eso sí filtra la longitud, que no es
 * secreta.
 */
export function igualdadSegura(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * Valida el X-Hub-Signature-256 de Meta.
 *
 * El HMAC se calcula sobre el body CRUDO. Si se reserializara el JSON
 * ya parseado, cualquier diferencia de orden de claves, espacios o
 * escapes daría una firma distinta y rechazaría mensajes legítimos.
 */
export function verificarFirmaMeta(
  cuerpoCrudo: Buffer,
  cabecera: string | null,
  appSecret: string,
): boolean {
  if (!cabecera) return false

  const esperado = 'sha256=' + createHmac('sha256', appSecret).update(cuerpoCrudo).digest('hex')
  return igualdadSegura(cabecera, esperado)
}

/**
 * Id de deduplicación del evento.
 *
 * Meta no manda un id de entrega, así que se usa el hash del body
 * crudo: un reintento del mismo evento trae exactamente los mismos
 * bytes y por lo tanto el mismo hash, y el unique
 * (proveedor, external_id) lo frena.
 */
export function idEvento(cuerpoCrudo: Buffer): string {
  return createHash('sha256').update(cuerpoCrudo).digest('hex')
}

export interface ResultadoHandshake {
  ok: boolean
  challenge: string | null
}

/** Handshake GET de verificación del webhook. */
export function resolverHandshake(url: URL, verifyToken: string): ResultadoHandshake {
  const modo = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (modo !== 'subscribe' || !token || !igualdadSegura(token, verifyToken)) {
    return { ok: false, challenge: null }
  }
  return { ok: true, challenge: challenge ?? '' }
}

export interface ResumenProcesamiento {
  mensajes: number
  duplicados: number
  echos: number
  turnosProgramados: number
  ignorados: number
}

/**
 * Procesa un evento ya verificado. Corre en segundo plano: para
 * cuando esto arranca, Meta ya recibió su 200.
 */
export async function procesarEventoEntrante(
  ctx: ContextoWhatsApp,
  payload: unknown,
): Promise<ResumenProcesamiento> {
  const resumen: ResumenProcesamiento = {
    mensajes: 0,
    duplicados: 0,
    echos: 0,
    turnosProgramados: 0,
    ignorados: 0,
  }

  const evento = normalizarEvento(payload)

  if (evento.mensajes.length === 0) {
    // Puede ser un webhook sólo de statuses (delivered/read). No es
    // un error: simplemente no hay turno que disparar.
    return resumen
  }

  if (!evento.phoneNumberId) {
    throw new Error('evento sin metadata.phone_number_id: no se puede resolver el tenant')
  }

  const cuenta = await ctx.repo.resolverCuenta(evento.phoneNumberId)
  if (!cuenta) {
    // Un número que no es nuestro, o una cuenta dada de baja. Se
    // registra y se sigue: no hay tenant al que atribuirlo.
    throw new Error(`no hay wa_cuenta activa para phone_number_id ${evento.phoneNumberId}`)
  }

  for (const mensaje of evento.mensajes) {
    await procesarMensaje(ctx, cuenta.tenantId, mensaje, resumen)
  }

  return resumen
}

async function procesarMensaje(
  ctx: ContextoWhatsApp,
  tenantId: string,
  mensaje: MensajeNormalizado,
  resumen: ResumenProcesamiento,
): Promise<void> {
  const conversacion = await ctx.repo.obtenerOCrearConversacion(tenantId, mensaje.waIdCliente)

  const { duplicado } = await ctx.repo.guardarMensaje(tenantId, conversacion.id, mensaje)

  if (duplicado) {
    // Segunda capa de idempotencia, por si dos entregas de Meta con
    // bodies distintos repiten el mismo mensaje.
    resumen.duplicados += 1
    return
  }

  resumen.mensajes += 1

  // ---- echo de agente: takeover humano ----
  if (mensaje.esEcho) {
    // Un empleado contestó desde la app de WhatsApp Business. El bot
    // se calla 30 minutos en ESTA conversación, no en todas.
    await ctx.repo.pausarBot(conversacion.id, tenantId, MINUTOS_TAKEOVER)
    resumen.echos += 1
    return
  }

  await ctx.repo.registrarEntrada(tenantId, conversacion.id, mensaje.recibidoEn)

  // Marcar leído es cortesía, no parte del contrato: si la API de
  // WhatsApp está caída, el pedido tiene que entrar igual.
  try {
    await ctx.proveedor.markAsRead(mensaje.waMessageId)
  } catch (err) {
    console.warn('[whatsapp] markAsRead falló', {
      waMessageId: mensaje.waMessageId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  if (!disparaBuffer(mensaje)) {
    // Media, ubicación, reacciones: se guardan, pero todavía no
    // despiertan al bot.
    resumen.ignorados += 1
    return
  }

  // Bot pausado por takeover humano: el mensaje queda guardado y sin
  // procesar, para que el recepcionista lo vea en el panel.
  if (conversacion.bot_pausado_hasta && new Date(conversacion.bot_pausado_hasta) > new Date()) {
    resumen.ignorados += 1
    return
  }

  const config = await ctx.repo.configConversacion(tenantId)
  if (!config.botActivo || config.modoContingencia) {
    resumen.ignorados += 1
    return
  }

  await programarTurno(ctx, {
    tenantId,
    conversacionId: conversacion.id,
    segundosBuffer: config.segundosBuffer,
  })

  resumen.turnosProgramados += 1
}

/** Payload crudo listo para guardar en webhook_events. */
export function comoJson(cuerpoCrudo: Buffer): Json {
  try {
    return JSON.parse(cuerpoCrudo.toString('utf8')) as Json
  } catch {
    return { _no_parseable: cuerpoCrudo.toString('utf8').slice(0, 4000) } as Json
  }
}
