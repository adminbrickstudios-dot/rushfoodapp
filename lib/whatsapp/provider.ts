import {
  validarBotones,
  validarCtaUrl,
  validarCuerpo,
  validarFooter,
  validarLista,
  WhatsAppPayloadError,
  type BotonCtaUrl,
  type BotonRespuesta,
  type SeccionLista,
} from './limites'

// ---------- parámetros de envío ----------

export interface EnvioTexto {
  destino: string // E.164 sin '+', como lo quiere Meta
  texto: string
  previsualizarUrl?: boolean
}

export interface EnvioBotones {
  destino: string
  cuerpo: string
  botones: BotonRespuesta[]
  encabezado?: string
  pie?: string
}

export interface EnvioLista {
  destino: string
  cuerpo: string
  textoBoton: string
  secciones: SeccionLista[]
  encabezado?: string
  pie?: string
}

export interface EnvioPlantilla {
  destino: string
  nombre: string
  idioma: string
  componentes?: unknown[]
}

export interface EnvioCtaUrl {
  destino: string
  cuerpo: string
  botones: BotonCtaUrl[]
  encabezado?: string
  pie?: string
}

export interface ResultadoEnvio {
  waMessageId: string
}

export interface MediaDescargada {
  mediaId: string
  mimeType: string
  bytes: Uint8Array
  sha256?: string
}

export interface WhatsAppProvider {
  readonly nombre: string
  sendText(p: EnvioTexto): Promise<ResultadoEnvio>
  sendButtons(p: EnvioBotones): Promise<ResultadoEnvio>
  sendList(p: EnvioLista): Promise<ResultadoEnvio>
  sendTemplate(p: EnvioPlantilla): Promise<ResultadoEnvio>
  sendCtaUrl(p: EnvioCtaUrl): Promise<ResultadoEnvio>
  markAsRead(waMessageId: string): Promise<void>
  downloadMedia(mediaId: string): Promise<MediaDescargada>
}

/** Falla de la API de WhatsApp (no un límite local). */
export class WhatsAppApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly cuerpo: string,
    public readonly operacion: string,
  ) {
    super(`WhatsApp ${operacion} respondió ${status}: ${cuerpo.slice(0, 500)}`)
    this.name = 'WhatsAppApiError'
  }

  /** 5xx y 429 se reintentan; 4xx de payload no tiene sentido reintentarlos. */
  get reintentable(): boolean {
    return this.status >= 500 || this.status === 429
  }
}

// ---------- construcción de payloads ----------
// Cloud API y los BSP hablan el MISMO JSON de mensajes: lo que cambia
// es la URL y el header de autenticación. Por eso el payload se arma
// una sola vez y las dos implementaciones lo comparten.

function base(destino: string) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: destino }
}

export function payloadTexto(p: EnvioTexto): unknown {
  validarCuerpo(p.texto)
  return {
    ...base(p.destino),
    type: 'text',
    text: { body: p.texto, preview_url: p.previsualizarUrl ?? false },
  }
}

export function payloadBotones(p: EnvioBotones): unknown {
  validarCuerpo(p.cuerpo)
  validarFooter(p.pie)
  validarBotones(p.botones)

  return {
    ...base(p.destino),
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(p.encabezado ? { header: { type: 'text', text: p.encabezado } } : {}),
      body: { text: p.cuerpo },
      ...(p.pie ? { footer: { text: p.pie } } : {}),
      action: {
        buttons: p.botones.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.titulo },
        })),
      },
    },
  }
}

export function payloadLista(p: EnvioLista): unknown {
  validarCuerpo(p.cuerpo)
  validarFooter(p.pie)
  validarLista(p.secciones)

  return {
    ...base(p.destino),
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(p.encabezado ? { header: { type: 'text', text: p.encabezado } } : {}),
      body: { text: p.cuerpo },
      ...(p.pie ? { footer: { text: p.pie } } : {}),
      action: {
        button: p.textoBoton,
        sections: p.secciones.map((s) => ({
          title: s.titulo,
          rows: s.filas.map((f) => ({
            id: f.id,
            title: f.titulo,
            ...(f.descripcion ? { description: f.descripcion } : {}),
          })),
        })),
      },
    },
  }
}

export function payloadPlantilla(p: EnvioPlantilla): unknown {
  return {
    ...base(p.destino),
    type: 'template',
    template: {
      name: p.nombre,
      language: { code: p.idioma },
      ...(p.componentes ? { components: p.componentes } : {}),
    },
  }
}

export function payloadCtaUrl(p: EnvioCtaUrl): unknown {
  validarCuerpo(p.cuerpo)
  validarFooter(p.pie)
  validarCtaUrl(p.botones)

  // El límite de 2 que pide la spec se valida arriba, pero el
  // interactive `cta_url` de Meta transporta UN solo botón por
  // mensaje: `action.parameters` es un objeto, no una lista. Dos
  // botones URL sólo existen dentro de una plantilla aprobada.
  // Se corta acá, antes de la red, en vez de mandar algo que Meta
  // rechaza o —peor— aceptar y perder silenciosamente el segundo.
  if (p.botones.length > 1) {
    throw new WhatsAppPayloadError(
      'cta_url admite un solo botón por mensaje. Para dos botones URL hay que usar ' +
        'sendTemplate con una plantilla que los declare.',
    )
  }

  const boton = p.botones[0]!

  return {
    ...base(p.destino),
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      ...(p.encabezado ? { header: { type: 'text', text: p.encabezado } } : {}),
      body: { text: p.cuerpo },
      ...(p.pie ? { footer: { text: p.pie } } : {}),
      action: {
        name: 'cta_url',
        parameters: { display_text: boton.titulo, url: boton.url },
      },
    },
  }
}

// ---------- base HTTP común ----------

export interface ConfigProveedor {
  urlBase: string
  phoneNumberId: string
  token: string
  fetchImpl?: typeof fetch
}

abstract class ProveedorHttp implements WhatsAppProvider {
  abstract readonly nombre: string

  constructor(protected readonly config: ConfigProveedor) {}

  /** Headers de autenticación: es lo único que difiere entre proveedores. */
  protected abstract headersAuth(): Record<string, string>

  protected get fetch(): typeof fetch {
    return this.config.fetchImpl ?? globalThis.fetch
  }

  protected urlMensajes(): string {
    return `${this.config.urlBase.replace(/\/$/, '')}/${this.config.phoneNumberId}/messages`
  }

  protected urlMedia(mediaId: string): string {
    return `${this.config.urlBase.replace(/\/$/, '')}/${mediaId}`
  }

  private async postear(payload: unknown, operacion: string): Promise<ResultadoEnvio> {
    const res = await this.fetch(this.urlMensajes(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headersAuth() },
      body: JSON.stringify(payload),
    })

    const texto = await res.text()
    if (!res.ok) throw new WhatsAppApiError(res.status, texto, operacion)

    const cuerpo = texto ? (JSON.parse(texto) as { messages?: Array<{ id?: string }> }) : {}
    const id = cuerpo.messages?.[0]?.id

    if (!id) {
      throw new WhatsAppApiError(res.status, `respuesta sin message id: ${texto}`, operacion)
    }
    return { waMessageId: id }
  }

  // Todos `async` a propósito: la validación de límites corre antes
  // que cualquier await, así que sin `async` el error saldría de forma
  // SINCRÓNICA y un caller que hiciera `send(...).catch(...)` se
  // rompería en vez de entrar al catch. Con async, un límite excedido
  // es una promesa rechazada, igual que un fallo de red.
  async sendText(p: EnvioTexto) {
    return this.postear(payloadTexto(p), 'sendText')
  }
  async sendButtons(p: EnvioBotones) {
    return this.postear(payloadBotones(p), 'sendButtons')
  }
  async sendList(p: EnvioLista) {
    return this.postear(payloadLista(p), 'sendList')
  }
  async sendTemplate(p: EnvioPlantilla) {
    return this.postear(payloadPlantilla(p), 'sendTemplate')
  }
  async sendCtaUrl(p: EnvioCtaUrl) {
    return this.postear(payloadCtaUrl(p), 'sendCtaUrl')
  }

  async markAsRead(waMessageId: string): Promise<void> {
    const res = await this.fetch(this.urlMensajes(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headersAuth() },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: waMessageId,
      }),
    })

    if (!res.ok) {
      throw new WhatsAppApiError(res.status, await res.text(), 'markAsRead')
    }
  }

  async downloadMedia(mediaId: string): Promise<MediaDescargada> {
    // Dos pasos: primero la metadata con la URL firmada, después los
    // bytes. La URL de descarga también pide el token.
    const meta = await this.fetch(this.urlMedia(mediaId), { headers: this.headersAuth() })
    if (!meta.ok) throw new WhatsAppApiError(meta.status, await meta.text(), 'downloadMedia.meta')

    const info = (await meta.json()) as { url?: string; mime_type?: string; sha256?: string }
    if (!info.url) {
      throw new WhatsAppApiError(meta.status, `media ${mediaId} sin url`, 'downloadMedia.meta')
    }

    const bin = await this.fetch(info.url, { headers: this.headersAuth() })
    if (!bin.ok) throw new WhatsAppApiError(bin.status, await bin.text(), 'downloadMedia.bytes')

    return {
      mediaId,
      mimeType: info.mime_type ?? 'application/octet-stream',
      bytes: new Uint8Array(await bin.arrayBuffer()),
      sha256: info.sha256,
    }
  }
}

/** WhatsApp Cloud API, directo contra graph.facebook.com. */
export class CloudApiProvider extends ProveedorHttp {
  readonly nombre = 'cloud_api'

  protected headersAuth(): Record<string, string> {
    return { authorization: `Bearer ${this.config.token}` }
  }
}

/** BSP estilo 360dialog: mismo JSON, otra base y otra cabecera. */
export class BspProvider extends ProveedorHttp {
  readonly nombre = 'bsp'

  protected headersAuth(): Record<string, string> {
    return { 'D360-API-KEY': this.config.token }
  }

  // Los BSP exponen /messages sin el phone_number_id en el path: el
  // número queda determinado por la API key.
  protected urlMensajes(): string {
    return `${this.config.urlBase.replace(/\/$/, '')}/messages`
  }
}

// ---------- selección en runtime ----------

const URL_CLOUD_API_POR_DEFECTO = 'https://graph.facebook.com/v21.0'

function requerido(nombre: string): string {
  const valor = process.env[nombre]
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`)
  return valor
}

let cache: { clave: string; proveedor: WhatsAppProvider } | null = null

/**
 * Elige el proveedor leyendo process.env EN CADA LLAMADA.
 *
 * Es a propósito que no se resuelva al importar el módulo: cambiar
 * WHATSAPP_PROVIDER en Vercel tiene que alcanzar para cambiar de
 * proveedor, sin volver a deployar. La caché se invalida sola porque
 * está indexada por los valores de entorno.
 */
export function obtenerProveedor(fetchImpl?: typeof fetch): WhatsAppProvider {
  const tipo = process.env.WHATSAPP_PROVIDER ?? 'cloud_api'
  const token = requerido('WHATSAPP_TOKEN')
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? ''
  const urlBase =
    process.env.WHATSAPP_API_URL ?? (tipo === 'cloud_api' ? URL_CLOUD_API_POR_DEFECTO : '')

  if (!urlBase) {
    throw new Error(`WHATSAPP_API_URL es obligatoria para el proveedor '${tipo}'`)
  }
  if (tipo === 'cloud_api' && !phoneNumberId) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID es obligatoria para cloud_api')
  }

  const clave = `${tipo}|${urlBase}|${phoneNumberId}|${token}|${fetchImpl ? 'custom' : 'global'}`
  if (cache?.clave === clave) return cache.proveedor

  const config: ConfigProveedor = { urlBase, phoneNumberId, token, fetchImpl }

  const proveedor: WhatsAppProvider =
    tipo === 'cloud_api' ? new CloudApiProvider(config) : new BspProvider(config)

  cache = { clave, proveedor }
  return proveedor
}

/** Para los tests: descarta la instancia cacheada. */
export function limpiarCacheProveedor(): void {
  cache = null
}
