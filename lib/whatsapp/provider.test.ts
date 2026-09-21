import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WhatsAppLimitError, WhatsAppPayloadError } from './limites'
import {
  BspProvider,
  CloudApiProvider,
  limpiarCacheProveedor,
  obtenerProveedor,
  payloadBotones,
  payloadCtaUrl,
  payloadLista,
  payloadTexto,
  WhatsAppApiError,
} from './provider'

const ENV = { ...process.env }

beforeEach(() => {
  limpiarCacheProveedor()
})

afterEach(() => {
  process.env = { ...ENV }
  limpiarCacheProveedor()
})

const destino = '5493875551234'
const texto = (n: number) => 'x'.repeat(n)

describe('límites · botones', () => {
  it('acepta 3 botones', () => {
    expect(() =>
      payloadBotones({
        destino,
        cuerpo: 'hola',
        botones: [
          { id: 'a', titulo: 'Uno' },
          { id: 'b', titulo: 'Dos' },
          { id: 'c', titulo: 'Tres' },
        ],
      }),
    ).not.toThrow()
  })

  it('rechaza 4 botones ANTES de salir a la red', () => {
    try {
      payloadBotones({
        destino,
        cuerpo: 'hola',
        botones: [
          { id: 'a', titulo: 'Uno' },
          { id: 'b', titulo: 'Dos' },
          { id: 'c', titulo: 'Tres' },
          { id: 'd', titulo: 'Cuatro' },
        ],
      })
      expect.unreachable('tendría que haber tirado')
    } catch (err) {
      expect(err).toBeInstanceOf(WhatsAppLimitError)
      const e = err as WhatsAppLimitError
      expect(e.limite).toBe('botones.cantidad')
      expect(e.maximo).toBe(3)
      expect(e.valorRecibido).toBe(4)
    }
  })

  it('acepta un título de exactamente 20 caracteres y rechaza 21', () => {
    const conTitulo = (n: number) =>
      payloadBotones({ destino, cuerpo: 'hola', botones: [{ id: 'a', titulo: texto(n) }] })

    expect(() => conTitulo(20)).not.toThrow()
    try {
      conTitulo(21)
      expect.unreachable('tendría que haber tirado')
    } catch (err) {
      const e = err as WhatsAppLimitError
      expect(e.limite).toBe('botones.titulo')
      expect(e.maximo).toBe(20)
      expect(e.valorRecibido).toBe(21)
      expect(e.detalle).toContain('botón 0')
    }
  })

  it('rechaza ids repetidos', () => {
    expect(() =>
      payloadBotones({
        destino,
        cuerpo: 'hola',
        botones: [
          { id: 'a', titulo: 'Uno' },
          { id: 'a', titulo: 'Dos' },
        ],
      }),
    ).toThrow(WhatsAppPayloadError)
  })
})

describe('límites · lista', () => {
  const fila = (i: number) => ({ id: `f${i}`, titulo: `Fila ${i}` })

  it('acepta 10 filas repartidas en varias secciones', () => {
    expect(() =>
      payloadLista({
        destino,
        cuerpo: 'elegí',
        textoBoton: 'Ver',
        secciones: [
          { titulo: 'A', filas: Array.from({ length: 6 }, (_, i) => fila(i)) },
          { titulo: 'B', filas: Array.from({ length: 4 }, (_, i) => fila(i + 6)) },
        ],
      }),
    ).not.toThrow()
  })

  it('el límite de 10 es sobre el TOTAL, no por sección', () => {
    // 6 + 6 = 12: cada sección sola pasaría, el total no.
    try {
      payloadLista({
        destino,
        cuerpo: 'elegí',
        textoBoton: 'Ver',
        secciones: [
          { titulo: 'A', filas: Array.from({ length: 6 }, (_, i) => fila(i)) },
          { titulo: 'B', filas: Array.from({ length: 6 }, (_, i) => fila(i + 6)) },
        ],
      })
      expect.unreachable('tendría que haber tirado')
    } catch (err) {
      const e = err as WhatsAppLimitError
      expect(e.limite).toBe('lista.filasTotales')
      expect(e.maximo).toBe(10)
      expect(e.valorRecibido).toBe(12)
      expect(e.detalle).toContain('2 secciones')
    }
  })

  it('título de fila: 24 sí, 25 no', () => {
    const conTitulo = (n: number) =>
      payloadLista({
        destino,
        cuerpo: 'elegí',
        textoBoton: 'Ver',
        secciones: [{ titulo: 'A', filas: [{ id: 'f', titulo: texto(n) }] }],
      })

    expect(() => conTitulo(24)).not.toThrow()
    expect(() => conTitulo(25)).toThrow(/lista.tituloFila/)
  })

  it('descripción de fila: 72 sí, 73 no', () => {
    const conDesc = (n: number) =>
      payloadLista({
        destino,
        cuerpo: 'elegí',
        textoBoton: 'Ver',
        secciones: [{ titulo: 'A', filas: [{ id: 'f', titulo: 'ok', descripcion: texto(n) }] }],
      })

    expect(() => conDesc(72)).not.toThrow()
    expect(() => conDesc(73)).toThrow(/lista.descripcionFila/)
  })
})

describe('límites · cuerpo y footer', () => {
  it('cuerpo: 1024 sí, 1025 no', () => {
    expect(() => payloadTexto({ destino, texto: texto(1024) })).not.toThrow()
    try {
      payloadTexto({ destino, texto: texto(1025) })
      expect.unreachable('tendría que haber tirado')
    } catch (err) {
      const e = err as WhatsAppLimitError
      expect(e.limite).toBe('cuerpo')
      expect(e.maximo).toBe(1024)
    }
  })

  it('footer: 60 sí, 61 no', () => {
    const conPie = (n: number) =>
      payloadBotones({
        destino,
        cuerpo: 'hola',
        botones: [{ id: 'a', titulo: 'Uno' }],
        pie: texto(n),
      })

    expect(() => conPie(60)).not.toThrow()
    expect(() => conPie(61)).toThrow(/footer/)
  })

  it('el límite del cuerpo también aplica a botones y lista', () => {
    expect(() =>
      payloadBotones({ destino, cuerpo: texto(1025), botones: [{ id: 'a', titulo: 'Uno' }] }),
    ).toThrow(WhatsAppLimitError)
  })
})

describe('límites · CTA URL', () => {
  it('acepta un botón', () => {
    expect(() =>
      payloadCtaUrl({
        destino,
        cuerpo: 'pagá acá',
        botones: [{ titulo: 'Pagar', url: 'https://mp.com/x' }],
      }),
    ).not.toThrow()
  })

  it('rechaza 3 botones por el límite de cantidad', () => {
    try {
      payloadCtaUrl({
        destino,
        cuerpo: 'x',
        botones: [
          { titulo: 'a', url: 'https://a' },
          { titulo: 'b', url: 'https://b' },
          { titulo: 'c', url: 'https://c' },
        ],
      })
      expect.unreachable('tendría que haber tirado')
    } catch (err) {
      const e = err as WhatsAppLimitError
      expect(e.limite).toBe('ctaUrl.cantidad')
      expect(e.maximo).toBe(2)
      expect(e.valorRecibido).toBe(3)
    }
  })

  it('con 2 botones avisa que cta_url no los soporta, en vez de perder uno', () => {
    expect(() =>
      payloadCtaUrl({
        destino,
        cuerpo: 'x',
        botones: [
          { titulo: 'a', url: 'https://a' },
          { titulo: 'b', url: 'https://b' },
        ],
      }),
    ).toThrow(WhatsAppPayloadError)
  })
})

describe('forma del payload', () => {
  it('los botones salen como reply con id y title', () => {
    const p = payloadBotones({
      destino,
      cuerpo: 'hola',
      botones: [{ id: 'ver_menu', titulo: 'Ver el menú' }],
      pie: 'Mola',
    }) as {
      type: string
      interactive: {
        type: string
        body: { text: string }
        footer: { text: string }
        action: { buttons: Array<{ type: string; reply: { id: string; title: string } }> }
      }
    }

    expect(p.type).toBe('interactive')
    expect(p.interactive.type).toBe('button')
    expect(p.interactive.body.text).toBe('hola')
    expect(p.interactive.footer.text).toBe('Mola')
    expect(p.interactive.action.buttons[0]).toEqual({
      type: 'reply',
      reply: { id: 'ver_menu', title: 'Ver el menú' },
    })
  })
})

describe('selección de proveedor en runtime', () => {
  it('cloud_api devuelve CloudApiProvider', () => {
    process.env.WHATSAPP_PROVIDER = 'cloud_api'
    process.env.WHATSAPP_TOKEN = 't'
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123'
    delete process.env.WHATSAPP_API_URL

    expect(obtenerProveedor()).toBeInstanceOf(CloudApiProvider)
  })

  it('bsp_360dialog devuelve BspProvider', () => {
    process.env.WHATSAPP_PROVIDER = 'bsp_360dialog'
    process.env.WHATSAPP_TOKEN = 't'
    process.env.WHATSAPP_API_URL = 'https://waba.360dialog.io/v1'

    expect(obtenerProveedor()).toBeInstanceOf(BspProvider)
  })

  it('cambiar la variable de entorno cambia el proveedor SIN reimportar el módulo', () => {
    process.env.WHATSAPP_TOKEN = 't'
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123'
    process.env.WHATSAPP_API_URL = 'https://waba.360dialog.io/v1'

    process.env.WHATSAPP_PROVIDER = 'cloud_api'
    expect(obtenerProveedor().nombre).toBe('cloud_api')

    // Esto es lo que tiene que poder hacerse en Vercel sin deployar.
    process.env.WHATSAPP_PROVIDER = 'bsp_360dialog'
    expect(obtenerProveedor().nombre).toBe('bsp')
  })

  it('falla claro si falta el token', () => {
    process.env.WHATSAPP_PROVIDER = 'cloud_api'
    delete process.env.WHATSAPP_TOKEN

    expect(() => obtenerProveedor()).toThrow(/WHATSAPP_TOKEN/)
  })
})

describe('llamada HTTP', () => {
  function proveedorConFetch(respuesta: Response) {
    process.env.WHATSAPP_PROVIDER = 'cloud_api'
    process.env.WHATSAPP_TOKEN = 'token-secreto'
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456'
    delete process.env.WHATSAPP_API_URL

    const llamadas: Array<{ url: string; init: RequestInit }> = []
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), init: init ?? {} })
      return respuesta
    }) as unknown as typeof fetch

    return { proveedor: obtenerProveedor(fake), llamadas }
  }

  it('pega al endpoint de Cloud API con el Bearer y devuelve el message id', async () => {
    const { proveedor, llamadas } = proveedorConFetch(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), { status: 200 }),
    )

    const res = await proveedor.sendText({ destino, texto: 'hola' })

    expect(res.waMessageId).toBe('wamid.123')
    expect(llamadas[0]!.url).toBe('https://graph.facebook.com/v21.0/123456/messages')
    expect((llamadas[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer token-secreto',
    )
  })

  it('un 400 de Meta se convierte en WhatsAppApiError NO reintentable', async () => {
    const { proveedor } = proveedorConFetch(
      new Response(JSON.stringify({ error: { message: 'invalid' } }), { status: 400 }),
    )

    try {
      await proveedor.sendText({ destino, texto: 'hola' })
      expect.unreachable('tendría que haber tirado')
    } catch (err) {
      expect(err).toBeInstanceOf(WhatsAppApiError)
      expect((err as WhatsAppApiError).status).toBe(400)
      expect((err as WhatsAppApiError).reintentable).toBe(false)
    }
  })

  it('un 503 sí es reintentable', async () => {
    const { proveedor } = proveedorConFetch(new Response('upstream caído', { status: 503 }))

    await expect(proveedor.sendText({ destino, texto: 'hola' })).rejects.toSatisfy(
      (err: unknown) => err instanceof WhatsAppApiError && err.reintentable,
    )
  })

  it('un límite excedido NO llega a llamar a fetch', async () => {
    const { proveedor, llamadas } = proveedorConFetch(new Response('{}', { status: 200 }))

    await expect(proveedor.sendText({ destino, texto: texto(2000) })).rejects.toThrow(
      WhatsAppLimitError,
    )
    expect(llamadas).toHaveLength(0)
  })
})
