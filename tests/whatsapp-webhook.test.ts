import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { definirContexto, limpiarContexto, type ContextoWhatsApp } from '@/lib/whatsapp/contexto'
import type { RepoWhatsApp } from '@/lib/whatsapp/repo'
import { GET as webhookGET, POST as webhookPOST } from '@/app/api/whatsapp/webhook/route'
import { POST as procesarPOST } from '@/app/api/whatsapp/procesar/route'
import { GET as cronGET } from '@/app/api/cron/drenar-outbox/route'
import {
  crearBaseDePrueba,
  sembrarTenant,
  type BaseDePrueba,
  type TenantDePrueba,
} from './apoyo/base'
import { RepoPglite } from './apoyo/repo-pglite'
import { ColaFalsa, ProveedorFalso, crearSegundoPlano, repoQueFalla } from './apoyo/dobles'
import { levantarServidor, type ServidorDePrueba } from './apoyo/servidor'
import { firmaMeta, firmaQStash } from './apoyo/firmas'

const APP_SECRET = 'secreto-de-app-de-meta'
const VERIFY_TOKEN = 'token-de-verificacion'
const QSTASH_ACTUAL = 'sig_actual_de_prueba'
const QSTASH_SIGUIENTE = 'sig_siguiente_de_prueba'
const CRON_SECRET = 'secreto-del-cron'

let base: BaseDePrueba
let servidor: ServidorDePrueba
let tenant: TenantDePrueba
let proveedor: ProveedorFalso
let cola: ColaFalsa
let segundoPlano: ReturnType<typeof crearSegundoPlano>
let contexto: ContextoWhatsApp

beforeAll(async () => {
  process.env.META_APP_SECRET = APP_SECRET
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN
  process.env.QSTASH_CURRENT_SIGNING_KEY = QSTASH_ACTUAL
  process.env.QSTASH_NEXT_SIGNING_KEY = QSTASH_SIGUIENTE
  process.env.CRON_SECRET = CRON_SECRET

  base = await crearBaseDePrueba()

  // Los route handlers REALES, servidos por HTTP real.
  servidor = await levantarServidor({
    '/api/whatsapp/webhook': { GET: webhookGET, POST: webhookPOST },
    '/api/whatsapp/procesar': { POST: procesarPOST },
    '/api/cron/drenar-outbox': { GET: cronGET },
  })
}, 240_000)

afterAll(async () => {
  await servidor?.cerrar()
  await base?.cerrar()
})

beforeEach(async () => {
  // Base vacía en cada test. Sin esto los conteos arrastran filas de
  // los tests anteriores, y el drenaje del cron —que por diseño es
  // global— se lleva cola ajena.
  await base.ejecutar('truncate public.tenants, public.webhook_events restart identity cascade')

  tenant = await sembrarTenant(base)
  proveedor = new ProveedorFalso()
  cola = new ColaFalsa()
  segundoPlano = crearSegundoPlano()

  contexto = {
    repo: new RepoPglite(base),
    proveedor,
    cola,
    enSegundoPlano: segundoPlano.enSegundoPlano,
    urlBase: 'https://rushfood.test',
  }
  definirContexto(contexto)
})

afterEach(() => {
  limpiarContexto()
})

/** Reemplaza el repo por uno que falla las primeras `veces` llamadas. */
function hacerFallar(metodo: keyof RepoWhatsApp, veces: number): void {
  definirContexto({ ...contexto, repo: repoQueFalla(contexto.repo, metodo, veces) })
}

// ---------- helpers ----------

function eventoTexto(
  phoneNumberId: string,
  waMessageId: string,
  texto: string,
  de = '5493875551234',
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5493875550000', phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: 'Juan' }, wa_id: de }],
              messages: [
                {
                  from: de,
                  id: waMessageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: texto },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

async function postWebhook(cuerpo: unknown, opciones: { firma?: string } = {}) {
  const crudo = JSON.stringify(cuerpo)
  return fetch(`${servidor.url}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': opciones.firma ?? firmaMeta(crudo, APP_SECRET),
    },
    body: crudo,
  })
}

async function postProcesar(conversacionId: string, tenantId: string, clave = QSTASH_ACTUAL) {
  const crudo = JSON.stringify({ conversacionId, tenantId })
  return fetch(`${servidor.url}/api/whatsapp/procesar`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'upstash-signature': firmaQStash(crudo, clave),
    },
    body: crudo,
  })
}

const contar = async (sql: string, params: unknown[] = []): Promise<number> => {
  const filas = await base.consultar<{ n: number }>(sql, params)
  return Number(filas[0]?.n ?? 0)
}

async function conversacionDelTenant(): Promise<string> {
  const [conv] = await base.consultar<{ id: string }>(
    `select id from public.conversaciones where tenant_id = $1`,
    [tenant.tenantId],
  )
  if (!conv) throw new Error('el test esperaba una conversación y no hay ninguna')
  return conv.id
}

// ============================================================

describe('webhook · handshake GET', () => {
  it('devuelve el challenge tal cual cuando el token coincide', async () => {
    const res = await fetch(
      `${servidor.url}/api/whatsapp/webhook?hub.mode=subscribe` +
        `&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`,
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('1158201444')
  })

  it('rechaza con 403 si el token no coincide', async () => {
    const res = await fetch(
      `${servidor.url}/api/whatsapp/webhook?hub.mode=subscribe` +
        `&hub.verify_token=token-equivocado&hub.challenge=123`,
    )

    expect(res.status).toBe(403)
  })
})

describe('webhook · firma', () => {
  it('con firma inválida devuelve 403 y NO escribe ninguna fila', async () => {
    const res = await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.malo', 'hola'), {
      firma: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
    })
    await segundoPlano.esperar()

    expect(res.status).toBe(403)
    expect(await contar(`select count(*)::int as n from public.webhook_events`)).toBe(0)
    expect(await contar(`select count(*)::int as n from public.mensajes`)).toBe(0)
    expect(await contar(`select count(*)::int as n from public.conversaciones`)).toBe(0)
  })

  it('sin la cabecera de firma también devuelve 403', async () => {
    const crudo = JSON.stringify(eventoTexto(tenant.phoneNumberId, 'wamid.sinfirma', 'hola'))
    const res = await fetch(`${servidor.url}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: crudo,
    })
    await segundoPlano.esperar()

    expect(res.status).toBe(403)
    expect(await contar(`select count(*)::int as n from public.mensajes`)).toBe(0)
  })

  it('una firma válida para OTRO cuerpo no sirve', async () => {
    const otroCuerpo = JSON.stringify({ hola: 'chau' })
    const res = await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.x', 'hola'), {
      firma: firmaMeta(otroCuerpo, APP_SECRET),
    })

    expect(res.status).toBe(403)
    expect(await contar(`select count(*)::int as n from public.mensajes`)).toBe(0)
  })

  it('con firma válida acepta y persiste', async () => {
    const res = await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.ok', 'hola'))
    await segundoPlano.esperar()

    expect(res.status).toBe(200)
    expect(
      await contar(
        `select count(*)::int as n from public.mensajes where wa_message_id = 'wamid.ok'`,
      ),
    ).toBe(1)
  })
})

describe('webhook · idempotencia', () => {
  it('el mismo wa_message_id en dos POSTs separados deja UNA sola fila', async () => {
    const evento = eventoTexto(tenant.phoneNumberId, 'wamid.repetido', 'hola')

    const r1 = await postWebhook(evento)
    await segundoPlano.esperar()
    const r2 = await postWebhook(evento)
    await segundoPlano.esperar()

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    // Lo frena el unique de webhook_events, antes de mirar el contenido.
    expect(await r2.json()).toMatchObject({ duplicado: true })

    expect(
      await contar(
        `select count(*)::int as n from public.mensajes where wa_message_id = 'wamid.repetido'`,
      ),
    ).toBe(1)
  })

  it('frena el duplicado aunque el envoltorio del evento cambie', async () => {
    // Mismo mensaje en dos entregas distintas: el hash del body
    // difiere, así que webhook_events deja pasar y tiene que frenarlo
    // la segunda capa, el unique de mensajes.
    const a = eventoTexto(tenant.phoneNumberId, 'wamid.doscapas', 'hola')
    const b = JSON.parse(JSON.stringify(a)) as typeof a
    b.entry[0]!.id = 'waba-distinto'

    await postWebhook(a)
    await segundoPlano.esperar()
    await postWebhook(b)
    await segundoPlano.esperar()

    expect(await contar(`select count(*)::int as n from public.webhook_events`)).toBe(2)
    expect(
      await contar(
        `select count(*)::int as n from public.mensajes where wa_message_id = 'wamid.doscapas'`,
      ),
    ).toBe(1)
  })
})

describe('webhook · buffer anti-ráfaga', () => {
  it('un mensaje programa un disparo de QStash', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.b1', 'hola'))
    await segundoPlano.esperar()

    expect(cola.programados).toHaveLength(1)
    expect(cola.programados[0]!.retrasoSegundos).toBe(6)
    expect(cola.programados[0]!.url).toBe('https://rushfood.test/api/whatsapp/procesar')
  })

  it('una ráfaga reinicia el timer: cancela el anterior y deja uno solo vivo', async () => {
    for (const id of ['wamid.r1', 'wamid.r2', 'wamid.r3']) {
      await postWebhook(eventoTexto(tenant.phoneNumberId, id, 'a'))
      await segundoPlano.esperar()
    }

    expect(cola.programados).toHaveLength(3)
    expect(cola.cancelados).toHaveLength(2)
    expect(cola.vivos).toHaveLength(1)

    const [conv] = await base.consultar<{ qstash_schedule_id: string }>(
      `select qstash_schedule_id from public.conversaciones where tenant_id = $1`,
      [tenant.tenantId],
    )
    expect(conv!.qstash_schedule_id).toBe(cola.vivos[0]!.id)
  })

  it('pasados 20 segundos del primer mensaje ya NO reinicia el timer', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.v1', 'a'))
    await segundoPlano.esperar()
    expect(cola.programados).toHaveLength(1)

    // Se envejece la tanda en la base, que es de donde sale la decisión.
    await base.consultar(
      `update public.conversaciones
          set primer_mensaje_sin_procesar_en = now() - interval '25 seconds'
        where tenant_id = $1`,
      [tenant.tenantId],
    )

    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.v2', 'b'))
    await segundoPlano.esperar()

    expect(cola.programados).toHaveLength(1)
    expect(cola.cancelados).toHaveLength(0)
  })

  it('si la ventana venció pero no hay disparo vivo, igual programa uno', async () => {
    // El caso que evita el silencio: sin schedule, dejarlo así
    // significaría que ese cliente nunca recibe respuesta.
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.h1', 'a'))
    await segundoPlano.esperar()

    await base.consultar(
      `update public.conversaciones
          set primer_mensaje_sin_procesar_en = now() - interval '25 seconds',
              qstash_schedule_id = null
        where tenant_id = $1`,
      [tenant.tenantId],
    )

    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.h2', 'b'))
    await segundoPlano.esperar()

    expect(cola.programados).toHaveLength(2)
  })
})

describe('webhook · echo de agente (Coexistence)', () => {
  it('guarda con origen agente y pausa el bot 30 minutos', async () => {
    const evento = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'smb_message_echoes',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: tenant.phoneNumberId },
                message_echoes: [
                  {
                    from: '5493875550000',
                    to: '5493875551234',
                    id: 'wamid.echo1',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'te lo mando en 20 min' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    await postWebhook(evento)
    await segundoPlano.esperar()

    const [msg] = await base.consultar<{ origen: string; direccion: string; procesado: boolean }>(
      `select origen, direccion, procesado from public.mensajes where wa_message_id = 'wamid.echo1'`,
    )
    expect(msg).toMatchObject({ origen: 'agente', direccion: 'out', procesado: true })

    const [conv] = await base.consultar<{ pausado: boolean; minutos: number }>(
      `select bot_pausado_hasta > now() as pausado,
              extract(epoch from (bot_pausado_hasta - now()))/60 as minutos
         from public.conversaciones where tenant_id = $1`,
      [tenant.tenantId],
    )
    expect(conv!.pausado).toBe(true)
    expect(Number(conv!.minutos)).toBeGreaterThan(29)

    // Un echo no dispara el buffer: el bot se calla, no contesta.
    expect(cola.programados).toHaveLength(0)
  })

  it('con el bot pausado, un mensaje del cliente se guarda pero no despierta al bot', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.pausa1', 'hola'))
    await segundoPlano.esperar()
    cola.programados.length = 0

    await base.consultar(
      `update public.conversaciones set bot_pausado_hasta = now() + interval '30 minutes'
        where tenant_id = $1`,
      [tenant.tenantId],
    )

    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.pausa2', 'seguís ahí?'))
    await segundoPlano.esperar()

    expect(
      await contar(
        `select count(*)::int as n from public.mensajes where wa_message_id = 'wamid.pausa2'`,
      ),
    ).toBe(1)
    expect(cola.programados).toHaveLength(0)
  })
})

describe('webhook · tipos de mensaje', () => {
  it('guarda un tipo desconocido con el payload crudo en vez de descartarlo', async () => {
    const evento = eventoTexto(tenant.phoneNumberId, 'wamid.raro', 'x') as unknown as {
      entry: Array<{ changes: Array<{ value: { messages: Array<Record<string, unknown>> } }> }>
    }
    evento.entry[0]!.changes[0]!.value.messages[0] = {
      from: '5493875551234',
      id: 'wamid.raro',
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'tipo_que_meta_invento_ayer',
      cosa_nueva: { valor: 42 },
    }

    await postWebhook(evento)
    await segundoPlano.esperar()

    const [msg] = await base.consultar<{ tipo: string; payload: Record<string, unknown> }>(
      `select tipo, payload from public.mensajes where wa_message_id = 'wamid.raro'`,
    )
    expect(msg!.tipo).toBe('desconocido')
    expect(msg!.payload).toMatchObject({ type: 'tipo_que_meta_invento_ayer' })
  })

  it('extrae el texto de un interactive list_reply', async () => {
    const evento = eventoTexto(tenant.phoneNumberId, 'wamid.lista', 'x') as unknown as {
      entry: Array<{ changes: Array<{ value: { messages: Array<Record<string, unknown>> } }> }>
    }
    evento.entry[0]!.changes[0]!.value.messages[0] = {
      from: '5493875551234',
      id: 'wamid.lista',
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: { id: 'prod_123', title: 'Cheeseburger', description: 'Doble cheddar' },
      },
    }

    await postWebhook(evento)
    await segundoPlano.esperar()

    const [msg] = await base.consultar<{ tipo: string; texto: string }>(
      `select tipo, texto from public.mensajes where wa_message_id = 'wamid.lista'`,
    )
    expect(msg).toMatchObject({ tipo: 'interactive', texto: 'Cheeseburger' })
    expect(cola.programados).toHaveLength(1)
  })

  it('una imagen se guarda pero todavía no despierta al bot', async () => {
    const evento = eventoTexto(tenant.phoneNumberId, 'wamid.img', 'x') as unknown as {
      entry: Array<{ changes: Array<{ value: { messages: Array<Record<string, unknown>> } }> }>
    }
    evento.entry[0]!.changes[0]!.value.messages[0] = {
      from: '5493875551234',
      id: 'wamid.img',
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'image',
      image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'mirá' },
    }

    await postWebhook(evento)
    await segundoPlano.esperar()

    const [msg] = await base.consultar<{ tipo: string; texto: string }>(
      `select tipo, texto from public.mensajes where wa_message_id = 'wamid.img'`,
    )
    expect(msg).toMatchObject({ tipo: 'image', texto: 'mirá' })
    expect(cola.programados).toHaveLength(0)
  })
})

describe('procesar · firma de QStash', () => {
  it('sin firma devuelve 401 y no procesa nada', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.p0', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    const res = await fetch(`${servidor.url}/api/whatsapp/procesar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversacionId: convId, tenantId: tenant.tenantId }),
    })

    expect(res.status).toBe(401)
    expect(proveedor.enviados).toHaveLength(0)
    expect(
      await contar(`select count(*)::int as n from public.mensajes where procesado = true`),
    ).toBe(0)
  })

  it('una firma de otro emisor también da 401', async () => {
    const crudo = JSON.stringify({ conversacionId: 'x', tenantId: 'y' })
    const res = await fetch(`${servidor.url}/api/whatsapp/procesar`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'upstash-signature': firmaQStash(crudo, 'clave-de-un-atacante'),
      },
      body: crudo,
    })

    expect(res.status).toBe(401)
  })

  it('una firma válida para otro cuerpo no sirve', async () => {
    const firma = firmaQStash(JSON.stringify({ otra: 'cosa' }), QSTASH_ACTUAL)
    const res = await fetch(`${servidor.url}/api/whatsapp/procesar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'upstash-signature': firma },
      body: JSON.stringify({ conversacionId: 'x', tenantId: 'y' }),
    })

    expect(res.status).toBe(401)
  })

  it('acepta la firma hecha con la clave SIGUIENTE (rotación)', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.rot', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    const res = await postProcesar(convId, tenant.tenantId, QSTASH_SIGUIENTE)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ estado: 'procesado' })
  })
})

describe('procesar · turno completo', () => {
  it('responde el menú de 3 botones y marca los mensajes procesados', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.t1', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    const res = await postProcesar(convId, tenant.tenantId)
    const cuerpo = (await res.json()) as { estado: string; mensajes: number }

    expect(res.status).toBe(200)
    expect(cuerpo).toMatchObject({ estado: 'procesado', mensajes: 1 })

    expect(proveedor.enviados).toHaveLength(1)
    const enviado = proveedor.enviados[0]!.payload as {
      interactive: { action: { buttons: Array<{ reply: { title: string } }> } }
    }
    expect(enviado.interactive.action.buttons).toHaveLength(3)
    expect(enviado.interactive.action.buttons.map((b) => b.reply.title)).toEqual([
      'Ver el menú',
      'Hacer un pedido',
      'Hablar con alguien',
    ])

    expect(
      await contar(`select count(*)::int as n from public.mensajes where procesado = false`),
    ).toBe(0)

    const [limpio] = await base.consultar<{
      primer_mensaje_sin_procesar_en: string | null
      qstash_schedule_id: string | null
      procesando_desde: string | null
    }>(
      `select primer_mensaje_sin_procesar_en, qstash_schedule_id, procesando_desde
         from public.conversaciones where id = $1`,
      [convId],
    )
    expect(limpio!.primer_mensaje_sin_procesar_en).toBeNull()
    expect(limpio!.qstash_schedule_id).toBeNull()
    expect(limpio!.procesando_desde).toBeNull()
  })

  it('trata toda la ráfaga como UN turno y contesta una sola vez', async () => {
    for (const id of ['wamid.u1', 'wamid.u2', 'wamid.u3']) {
      await postWebhook(eventoTexto(tenant.phoneNumberId, id, 'a'))
      await segundoPlano.esperar()
    }
    const convId = await conversacionDelTenant()

    const res = await postProcesar(convId, tenant.tenantId)

    expect(await res.json()).toMatchObject({ estado: 'procesado', mensajes: 3 })
    expect(proveedor.enviados).toHaveLength(1)
  })

  it('un disparo sobre una conversación sin pendientes no manda nada', async () => {
    const [conv] = await base.consultar<{ id: string }>(
      `insert into public.conversaciones (tenant_id, wa_id) values ($1, '549387555999') returning id`,
      [tenant.tenantId],
    )

    const res = await postProcesar(conv!.id, tenant.tenantId)

    expect(await res.json()).toMatchObject({ estado: 'sin_mensajes' })
    expect(proveedor.enviados).toHaveLength(0)
  })
})

describe('procesar · control de concurrencia', () => {
  it('con dos llamadas EN PARALELO sólo una hace el trabajo', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.c1', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    // Promise.all de verdad: las dos requests salen antes de que
    // ninguna termine.
    const [a, b] = await Promise.all([
      postProcesar(convId, tenant.tenantId),
      postProcesar(convId, tenant.tenantId),
    ])

    const estados = [
      ((await a.json()) as { estado: string }).estado,
      ((await b.json()) as { estado: string }).estado,
    ]

    // Una trabajó. La otra encontró el lock tomado, o entró después y
    // ya no había pendientes: las dos son salidas correctas. Lo que no
    // puede pasar es que las dos manden el mensaje.
    expect(estados.filter((e) => e === 'procesado')).toHaveLength(1)
    expect(['ocupado', 'sin_mensajes']).toContain(estados.find((e) => e !== 'procesado'))

    expect(proveedor.enviados).toHaveLength(1)
    expect(await contar(`select count(*)::int as n from public.wa_outbox`)).toBe(1)
    expect(
      await contar(`select count(*)::int as n from public.mensajes where procesado = true`),
    ).toBe(1)
  })

  it('cinco llamadas en paralelo tampoco duplican el envío', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.c5', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    const respuestas = await Promise.all(
      Array.from({ length: 5 }, () => postProcesar(convId, tenant.tenantId)),
    )
    const estados = await Promise.all(
      respuestas.map(async (r) => ((await r.json()) as { estado: string }).estado),
    )

    expect(estados.filter((e) => e === 'procesado')).toHaveLength(1)
    expect(proveedor.enviados).toHaveLength(1)
    expect(await contar(`select count(*)::int as n from public.wa_outbox`)).toBe(1)
  })

  it('el lock se libera aunque el turno falle', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.f1', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    hacerFallar('cerrarTurno', 1)
    await postProcesar(convId, tenant.tenantId)

    const [estado] = await base.consultar<{ procesando_desde: string | null }>(
      `select procesando_desde from public.conversaciones where id = $1`,
      [convId],
    )
    expect(estado!.procesando_desde).toBeNull()
  })
})

describe('procesar · reintentos y derivación a humano', () => {
  it('antes de las 3 fallas reprograma un reintento en vez de rendirse', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.e1', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    const programadosAntes = cola.programados.length
    hacerFallar('cerrarTurno', 1)

    const res = await postProcesar(convId, tenant.tenantId)

    expect(await res.json()).toMatchObject({ estado: 'reintentara', intento: 1 })
    expect(cola.programados.length).toBe(programadosAntes + 1)
    expect(cola.programados.at(-1)!.retrasoSegundos).toBe(5)
    expect(await contar(`select count(*)::int as n from public.tickets`)).toBe(0)
  })

  it('a las 3 fallas seguidas crea un ticket y pausa el bot 15 minutos', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.d1', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    // La falla se inyecta en una operación del TURNO. Por el proveedor
    // no sirve: sus errores los absorbe el outbox y no llegan acá.
    hacerFallar('cerrarTurno', 3)

    for (let i = 1; i <= 3; i++) {
      await postProcesar(convId, tenant.tenantId)
    }

    const tickets = await base.consultar<{ motivo: string; resumen: string; prioridad: number }>(
      `select motivo, resumen, prioridad from public.tickets where conversacion_id = $1`,
      [convId],
    )
    expect(tickets).toHaveLength(1)
    expect(tickets[0]!.motivo).toBe('error_tecnico')
    expect(tickets[0]!.resumen).toContain('cerrarTurno')

    const [conv] = await base.consultar<{ minutos: number; intentos_fallidos: number }>(
      `select extract(epoch from (bot_pausado_hasta - now()))/60 as minutos, intentos_fallidos
         from public.conversaciones where id = $1`,
      [convId],
    )
    expect(Number(conv!.minutos)).toBeGreaterThan(14)
    expect(conv!.intentos_fallidos).toBe(0)
  })

  it('el mensaje queda sin procesar para que el reintento lo tome', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.g1', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    hacerFallar('cerrarTurno', 1)
    await postProcesar(convId, tenant.tenantId)

    expect(
      await contar(`select count(*)::int as n from public.mensajes where procesado = false`),
    ).toBe(1)
  })
})

describe('outbox y cron', () => {
  it('el cron sin CRON_SECRET devuelve 401', async () => {
    const res = await fetch(`${servidor.url}/api/cron/drenar-outbox`)
    expect(res.status).toBe(401)
  })

  it('el cron con un secreto equivocado devuelve 401', async () => {
    const res = await fetch(`${servidor.url}/api/cron/drenar-outbox`, {
      headers: { authorization: 'Bearer otro-secreto-distinto' },
    })
    expect(res.status).toBe(401)
  })

  it('el cron con el secreto correcto drena la cola', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.o1', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    // El envío inmediato falla, así que la fila queda para el cron.
    proveedor.fallarCon = new Error('caída momentánea')
    await postProcesar(convId, tenant.tenantId)

    expect(
      await contar(`select count(*)::int as n from public.wa_outbox where estado = 'pendiente'`),
    ).toBe(1)
    expect(proveedor.enviados).toHaveLength(0)

    // El backoff puso proximo_intento en el futuro y el slot de 6
    // segundos quedó tomado: se adelantan los dos para no dormir.
    await base.consultar(`update public.wa_outbox set proximo_intento = now()`)
    await base.consultar(`delete from public.wa_envios_recientes`)

    const res = await fetch(`${servidor.url}/api/cron/drenar-outbox`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, enviados: 1 })
    expect(proveedor.enviados).toHaveLength(1)
    expect(
      await contar(`select count(*)::int as n from public.wa_outbox where estado = 'enviado'`),
    ).toBe(1)
  })

  it('respeta el límite de 1 mensaje cada 6 segundos por destinatario', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.rl1', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    await postProcesar(convId, tenant.tenantId)
    expect(proveedor.enviados).toHaveLength(1)

    // Segundo envío al mismo número, inmediatamente después.
    await base.consultar(
      `insert into public.wa_outbox (tenant_id, conversacion_id, destino, payload, idempotency_key)
       values ($1, $2, '5493875551234', $3::jsonb, 'clave-rl-2')`,
      [
        tenant.tenantId,
        convId,
        JSON.stringify({ clase: 'texto', params: { destino: '5493875551234', texto: 'otro' } }),
      ],
    )

    const res = await fetch(`${servidor.url}/api/cron/drenar-outbox`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })

    expect(await res.json()).toMatchObject({ pospuestos: 1, enviados: 0 })
    expect(proveedor.enviados).toHaveLength(1)

    // Y no le gastó un intento.
    const [fila] = await base.consultar<{ intentos: number; estado: string }>(
      `select intentos, estado from public.wa_outbox where idempotency_key = 'clave-rl-2'`,
    )
    expect(fila).toMatchObject({ intentos: 0, estado: 'pendiente' })
  })

  it('pasados los 6 segundos el mismo destinatario vuelve a recibir', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.rl3', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()
    await postProcesar(convId, tenant.tenantId)

    await base.consultar(
      `insert into public.wa_outbox (tenant_id, conversacion_id, destino, payload, idempotency_key)
       values ($1, $2, '5493875551234', $3::jsonb, 'clave-rl-4')`,
      [
        tenant.tenantId,
        convId,
        JSON.stringify({ clase: 'texto', params: { destino: '5493875551234', texto: 'otro' } }),
      ],
    )

    // Se envejece la última marca de envío en vez de esperar 6 s.
    await base.consultar(
      `update public.wa_envios_recientes set ultimo_envio_en = now() - interval '7 seconds'`,
    )

    const res = await fetch(`${servidor.url}/api/cron/drenar-outbox`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })

    expect(await res.json()).toMatchObject({ enviados: 1 })
    expect(proveedor.enviados).toHaveLength(2)
  })

  it('la misma idempotency_key no encola dos veces', async () => {
    const insertar = () =>
      base.consultar(
        `insert into public.wa_outbox (tenant_id, destino, payload, idempotency_key)
         values ($1, '549387555111', $2::jsonb, 'clave-unica')`,
        [tenant.tenantId, JSON.stringify({ clase: 'texto', params: {} })],
      )

    await insertar()
    await expect(insertar()).rejects.toThrow()

    expect(
      await contar(
        `select count(*)::int as n from public.wa_outbox where idempotency_key = 'clave-unica'`,
      ),
    ).toBe(1)
  })

  it('un envío que agota los reintentos deriva a un humano', async () => {
    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.perdido', 'hola'))
    await segundoPlano.esperar()
    const convId = await conversacionDelTenant()

    proveedor.fallarCon = new Error('caída')
    await postProcesar(convId, tenant.tenantId)

    // Se lleva la fila al borde del límite de intentos.
    await base.consultar(
      `update public.wa_outbox set intentos = 4, proximo_intento = now() where conversacion_id = $1`,
      [convId],
    )
    await base.consultar(`delete from public.wa_envios_recientes`)

    proveedor.fallarCon = new Error('caída definitiva')
    const res = await fetch(`${servidor.url}/api/cron/drenar-outbox`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })

    expect(await res.json()).toMatchObject({ fallidos: 1 })
    expect(
      await contar(`select count(*)::int as n from public.wa_outbox where estado = 'fallido'`),
    ).toBe(1)

    // Lo importante: alguien se entera.
    const tickets = await base.consultar<{ motivo: string; resumen: string }>(
      `select motivo, resumen from public.tickets where conversacion_id = $1`,
      [convId],
    )
    expect(tickets).toHaveLength(1)
    expect(tickets[0]!.resumen).toContain('No se pudo entregar')
  })
})

describe('multi-tenant', () => {
  it('un mensaje al número de otro tenant no toca las conversaciones del primero', async () => {
    const otro = await sembrarTenant(base)

    await postWebhook(eventoTexto(tenant.phoneNumberId, 'wamid.mt1', 'hola'))
    await segundoPlano.esperar()
    await postWebhook(eventoTexto(otro.phoneNumberId, 'wamid.mt2', 'hola'))
    await segundoPlano.esperar()

    expect(
      await contar(`select count(*)::int as n from public.conversaciones where tenant_id = $1`, [
        tenant.tenantId,
      ]),
    ).toBe(1)
    expect(
      await contar(`select count(*)::int as n from public.mensajes where tenant_id = $1`, [
        otro.tenantId,
      ]),
    ).toBe(1)
  })

  it('un phone_number_id desconocido no crea nada', async () => {
    const res = await postWebhook(eventoTexto('pn-que-no-existe', 'wamid.nn', 'hola'))
    await segundoPlano.esperar()

    expect(res.status).toBe(200)
    expect(await contar(`select count(*)::int as n from public.mensajes`)).toBe(0)

    // El evento queda registrado con el error, para poder diagnosticarlo.
    const [evento] = await base.consultar<{ error: string | null }>(
      `select error from public.webhook_events order by creado_en desc limit 1`,
    )
    expect(evento!.error).toContain('no hay wa_cuenta activa')
  })
})
