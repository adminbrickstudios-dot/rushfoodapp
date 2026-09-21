import { Receiver } from '@upstash/qstash'
import { obtenerContexto } from '@/lib/whatsapp/contexto'
import { procesarTurno } from '@/lib/whatsapp/turno'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Verifica que la request venga realmente de QStash.
 *
 * Esta URL es pública: sin esto, cualquiera puede pegarle simulando
 * que venció el buffer de una conversación ajena y hacer que el bot
 * conteste cuando no corresponde.
 *
 * El Receiver del SDK prueba contra la clave actual y, si falla,
 * contra la siguiente — Upstash las rota, y durante la rotación las
 * firmas válidas pueden venir con cualquiera de las dos.
 */
async function firmaQStashValida(req: Request, cuerpoCrudo: string): Promise<boolean> {
  const firma = req.headers.get('upstash-signature')
  if (!firma) return false

  const actual = process.env.QSTASH_CURRENT_SIGNING_KEY
  const siguiente = process.env.QSTASH_NEXT_SIGNING_KEY

  if (!actual || !siguiente) {
    console.error('[procesar] faltan QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY')
    return false
  }

  const receiver = new Receiver({ currentSigningKey: actual, nextSigningKey: siguiente })

  try {
    return await receiver.verify({ signature: firma, body: cuerpoCrudo })
  } catch (err) {
    // SignatureError incluido: firma inválida, vencida o mal formada.
    console.warn('[procesar] firma de QStash rechazada', {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

interface CuerpoProcesar {
  conversacionId?: unknown
  tenantId?: unknown
}

export async function POST(req: Request): Promise<Response> {
  const crudo = await req.text()

  if (!(await firmaQStashValida(req, crudo))) {
    return new Response('unauthorized', { status: 401 })
  }

  let cuerpo: CuerpoProcesar
  try {
    cuerpo = JSON.parse(crudo) as CuerpoProcesar
  } catch {
    return Response.json({ ok: false, error: 'cuerpo no es JSON' }, { status: 400 })
  }

  const conversacionId = typeof cuerpo.conversacionId === 'string' ? cuerpo.conversacionId : null
  const tenantId = typeof cuerpo.tenantId === 'string' ? cuerpo.tenantId : null

  if (!conversacionId || !tenantId) {
    return Response.json(
      { ok: false, error: 'faltan conversacionId o tenantId' },
      { status: 400 },
    )
  }

  const ctx = obtenerContexto()

  // procesarTurno no lanza: resuelve internamente reintento o
  // derivación a humano. El try de acá es por si falla el contexto.
  try {
    const resultado = await procesarTurno(ctx, { conversacionId, tenantId })
    return Response.json({ ok: true, ...resultado })
  } catch (err) {
    console.error('[procesar] error no contemplado', {
      conversacionId,
      tenantId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    })
    // 500 a propósito: QStash reintenta solo, y a diferencia de Meta
    // no hay riesgo de que deshabilite nada.
    return Response.json({ ok: false }, { status: 500 })
  }
}
