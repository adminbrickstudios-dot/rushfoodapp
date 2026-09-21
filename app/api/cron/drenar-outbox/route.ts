import { timingSafeEqual } from 'node:crypto'
import { obtenerContexto } from '@/lib/whatsapp/contexto'
import { drenarOutbox } from '@/lib/whatsapp/outbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Cuántas filas se drenan por corrida. */
const LIMITE = 40

function comparaSegura(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`. Se acepta
 * además `?secreto=` para poder dispararlo a mano en una emergencia
 * sin armar el header.
 */
function autorizado(req: Request): boolean {
  const secreto = process.env.CRON_SECRET
  if (!secreto) return false

  const cabecera = req.headers.get('authorization')
  if (cabecera && comparaSegura(cabecera, `Bearer ${secreto}`)) return true

  const query = new URL(req.url).searchParams.get('secreto')
  return query !== null && comparaSegura(query, secreto)
}

async function manejar(req: Request): Promise<Response> {
  if (!autorizado(req)) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const resumen = await drenarOutbox(obtenerContexto(), LIMITE)
    return Response.json({ ok: true, ...resumen })
  } catch (err) {
    console.error('[cron] drenar-outbox falló', {
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    })
    return Response.json({ ok: false }, { status: 500 })
  }
}

// Vercel Cron usa GET; POST queda para dispararlo a mano.
export const GET = manejar
export const POST = manejar
