import { obtenerContexto } from '@/lib/whatsapp/contexto'
import {
  comoJson,
  idEvento,
  procesarEventoEntrante,
  resolverHandshake,
  verificarFirmaMeta,
} from '@/lib/whatsapp/webhook'

export const runtime = 'nodejs'
// El webhook lee el body crudo para validar la firma: no hay nada que
// cachear y cachearlo rompería la verificación.
export const dynamic = 'force-dynamic'

const PROVEEDOR = 'meta'

/**
 * GET — handshake de verificación de Meta.
 *
 * Meta pega con hub.mode, hub.verify_token y hub.challenge. Si el
 * token coincide hay que devolver el challenge TAL CUAL, como texto
 * plano: si se devuelve JSON o con comillas, Meta rechaza el webhook.
 */
export async function GET(req: Request): Promise<Response> {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN

  if (!verifyToken) {
    console.error('[webhook] falta WHATSAPP_VERIFY_TOKEN')
    return new Response('configuración incompleta', { status: 500 })
  }

  const { ok, challenge } = resolverHandshake(new URL(req.url), verifyToken)

  if (!ok) {
    return new Response('forbidden', { status: 403 })
  }

  return new Response(challenge ?? '', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * POST — mensajes entrantes.
 *
 * Invariante que manda sobre todo lo demás: salvo firma inválida,
 * este endpoint SIEMPRE responde 200 y siempre rápido. Un webhook que
 * devuelve 500 hace que Meta reintente en cascada y, si falla seguido,
 * puede terminar deshabilitándolo — y ahí la hamburguesería deja de
 * recibir pedidos por completo.
 *
 * Por eso el trabajo pesado va después de responder, y cualquier
 * excepción se registra pero no cambia el status.
 */
export async function POST(req: Request): Promise<Response> {
  const appSecret = process.env.META_APP_SECRET

  if (!appSecret) {
    console.error('[webhook] falta META_APP_SECRET')
    return new Response('configuración incompleta', { status: 500 })
  }

  // Bytes exactos: el HMAC se calcula sobre esto, antes de parsear.
  const crudo = Buffer.from(await req.arrayBuffer())
  const firma = req.headers.get('x-hub-signature-256')

  if (!verificarFirmaMeta(crudo, firma, appSecret)) {
    // Único camino que no devuelve 200. No se toca el body ni se
    // escribe una sola fila: si la firma no valida, el contenido no
    // es confiable y no merece llegar a la base.
    console.warn('[webhook] firma inválida', { tieneCabecera: firma !== null })
    return new Response('forbidden', { status: 403 })
  }

  // A partir de acá, pase lo que pase, la respuesta es 200.
  try {
    const ctx = obtenerContexto()
    const externalId = idEvento(crudo)

    // Idempotencia: Meta reintenta agresivo. El unique
    // (proveedor, external_id) convierte el reintento en un no-op.
    const esNuevo = await ctx.repo.registrarEventoWebhook(
      PROVEEDOR,
      externalId,
      comoJson(crudo),
    )

    if (!esNuevo) {
      return Response.json({ ok: true, duplicado: true })
    }

    const payload: unknown = JSON.parse(crudo.toString('utf8'))

    // Todo lo lento —escrituras, markAsRead, QStash— corre DESPUÉS de
    // que Meta recibió su 200. `after` garantiza que igual se ejecute.
    ctx.enSegundoPlano(async () => {
      try {
        const resumen = await procesarEventoEntrante(ctx, payload)
        await ctx.repo.marcarEventoProcesado(PROVEEDOR, externalId)
        console.info('[webhook] evento procesado', { externalId, ...resumen })
      } catch (err) {
        const detalle = err instanceof Error ? `${err.name}: ${err.message}` : String(err)

        console.error('[webhook] falló el procesamiento en segundo plano', {
          externalId,
          error: detalle,
          // El payload crudo va al log para poder diagnosticarlo
          // después: sin esto, un tipo de mensaje inesperado es
          // imposible de reproducir.
          payload: crudo.toString('utf8').slice(0, 4000),
        })

        try {
          await ctx.repo.marcarEventoProcesado(PROVEEDOR, externalId, detalle)
        } catch {
          // La base no responde. Ya está logueado; no hay más.
        }
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    // Falló algo antes de poder agendar el trabajo (la base, la
    // configuración). Meta igual recibe 200: reintentar no lo va a
    // arreglar y arriesga que deshabiliten el webhook.
    console.error('[webhook] error antes de encolar el procesamiento', {
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      payload: crudo.toString('utf8').slice(0, 4000),
    })
    return Response.json({ ok: true, error: true })
  }
}
