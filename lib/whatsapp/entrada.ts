/**
 * Normalización de los payloads del webhook de Meta.
 *
 * Regla que atraviesa todo el módulo: nada se descarta. Un tipo de
 * mensaje que no conocemos se guarda igual con tipo 'desconocido' y el
 * payload crudo, porque un mensaje perdido es un pedido perdido y
 * porque Meta agrega tipos sin avisar.
 */

export type TipoMensaje =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'interactive'
  | 'button'
  | 'contacts'
  | 'reaction'
  | 'order'
  | 'system'
  | 'desconocido'

const TIPOS_CONOCIDOS = new Set<TipoMensaje>([
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'interactive',
  'button',
  'contacts',
  'reaction',
  'order',
  'system',
])

/** De dónde salió el mensaje. Alineado con el enum origen_msg. */
export type OrigenMensaje = 'cliente' | 'bot' | 'agente' | 'app_echo' | 'sistema'

export interface MensajeNormalizado {
  waMessageId: string
  /** wa_id del CLIENTE, sea entrante o echo saliente. */
  waIdCliente: string
  direccion: 'in' | 'out'
  origen: OrigenMensaje
  tipo: TipoMensaje
  /** Texto plano para el bot. Null si el mensaje no tiene texto. */
  texto: string | null
  /** Id de la opción elegida en un interactive. */
  respuestaId: string | null
  /** Id de media para image/audio/video/document/sticker. */
  mediaId: string | null
  recibidoEn: Date
  /** Payload crudo del mensaje, tal cual lo mandó Meta. */
  crudo: unknown
  /**
   * Un echo es un mensaje que un empleado mandó desde la app de
   * WhatsApp Business en un número con Coexistence. No dispara el
   * buffer: dispara el takeover humano.
   */
  esEcho: boolean
}

export interface EstadoNormalizado {
  waMessageId: string
  estado: string
  waIdCliente: string | null
}

export interface EventoNormalizado {
  phoneNumberId: string | null
  mensajes: MensajeNormalizado[]
  estados: EstadoNormalizado[]
}

type Obj = Record<string, unknown>

const esObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const comoArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** Meta manda los timestamps como segundos epoch, en string. */
function aFecha(v: unknown): Date {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n)) return new Date()
  return new Date(n * 1000)
}

function tipoDe(v: unknown): TipoMensaje {
  const t = str(v)
  if (t && TIPOS_CONOCIDOS.has(t as TipoMensaje)) return t as TipoMensaje
  return 'desconocido'
}

/** Extrae texto legible según el tipo. Devuelve null si no hay. */
function textoDe(msg: Obj, tipo: TipoMensaje): string | null {
  switch (tipo) {
    case 'text':
      return esObj(msg.text) ? str(msg.text.body) : null

    case 'interactive': {
      if (!esObj(msg.interactive)) return null
      // button_reply y list_reply son payloads distintos: el primero
      // no tiene description, el segundo sí. Los dos traen title.
      const br = esObj(msg.interactive.button_reply) ? msg.interactive.button_reply : null
      const lr = esObj(msg.interactive.list_reply) ? msg.interactive.list_reply : null
      return str(br?.title ?? null) ?? str(lr?.title ?? null)
    }

    // Botón de plantilla (quick reply): llega como type 'button'.
    case 'button':
      return esObj(msg.button) ? str(msg.button.text) : null

    case 'image':
    case 'video':
    case 'document':
      return esObj(msg[tipo]) ? str((msg[tipo] as Obj).caption) : null

    case 'location': {
      if (!esObj(msg.location)) return null
      const l = msg.location
      return str(l.name) ?? str(l.address) ?? `ubicación ${String(l.latitude)},${String(l.longitude)}`
    }

    case 'reaction':
      return esObj(msg.reaction) ? str(msg.reaction.emoji) : null

    default:
      return null
  }
}

function respuestaIdDe(msg: Obj, tipo: TipoMensaje): string | null {
  if (tipo === 'interactive' && esObj(msg.interactive)) {
    const br = esObj(msg.interactive.button_reply) ? msg.interactive.button_reply : null
    const lr = esObj(msg.interactive.list_reply) ? msg.interactive.list_reply : null
    return str(br?.id ?? null) ?? str(lr?.id ?? null)
  }
  if (tipo === 'button' && esObj(msg.button)) {
    return str(msg.button.payload)
  }
  return null
}

function mediaIdDe(msg: Obj, tipo: TipoMensaje): string | null {
  if (!['image', 'audio', 'video', 'document', 'sticker'].includes(tipo)) return null
  return esObj(msg[tipo]) ? str((msg[tipo] as Obj).id) : null
}

function normalizarMensaje(crudo: unknown, esEcho: boolean): MensajeNormalizado | null {
  if (!esObj(crudo)) return null

  const waMessageId = str(crudo.id)
  if (!waMessageId) return null // sin id no hay idempotencia posible

  const tipo = tipoDe(crudo.type)

  // En un mensaje entrante el cliente es `from`. En un echo el negocio
  // es `from` y el cliente es `to`.
  const waIdCliente = esEcho ? str(crudo.to) : str(crudo.from)
  if (!waIdCliente) return null

  return {
    waMessageId,
    waIdCliente,
    direccion: esEcho ? 'out' : 'in',
    origen: esEcho ? 'agente' : 'cliente',
    tipo,
    texto: textoDe(crudo, tipo),
    respuestaId: respuestaIdDe(crudo, tipo),
    mediaId: mediaIdDe(crudo, tipo),
    recibidoEn: aFecha(crudo.timestamp),
    crudo,
    esEcho,
  }
}

/**
 * Aplana el webhook de Meta a una lista de mensajes y estados.
 *
 * Un POST puede traer varias entries, cada una con varios changes, y
 * cada change con varios mensajes. Meta los agrupa por conveniencia
 * suya, no nuestra.
 */
export function normalizarEvento(payload: unknown): EventoNormalizado {
  const mensajes: MensajeNormalizado[] = []
  const estados: EstadoNormalizado[] = []
  let phoneNumberId: string | null = null

  if (!esObj(payload)) return { phoneNumberId, mensajes, estados }

  for (const entry of comoArray(payload.entry)) {
    if (!esObj(entry)) continue

    for (const change of comoArray(entry.changes)) {
      if (!esObj(change)) continue

      const value = esObj(change.value) ? change.value : null
      if (!value) continue

      if (esObj(value.metadata)) {
        phoneNumberId = str(value.metadata.phone_number_id) ?? phoneNumberId
      }

      for (const m of comoArray(value.messages)) {
        const norm = normalizarMensaje(m, false)
        if (norm) mensajes.push(norm)
      }

      // Coexistence: los mensajes que un empleado mandó desde su
      // celular llegan por el field smb_message_echoes, en la clave
      // message_echoes. No son mensajes entrantes.
      for (const m of comoArray(value.message_echoes)) {
        const norm = normalizarMensaje(m, true)
        if (norm) mensajes.push(norm)
      }

      for (const s of comoArray(value.statuses)) {
        if (!esObj(s)) continue
        const id = str(s.id)
        if (!id) continue
        estados.push({
          waMessageId: id,
          estado: str(s.status) ?? 'desconocido',
          waIdCliente: str(s.recipient_id),
        })
      }
    }
  }

  return { phoneNumberId, mensajes, estados }
}

/**
 * ¿Este mensaje tiene que disparar el buffer anti-ráfaga?
 *
 * Sólo texto e interactivos de un cliente. Los echoes de agente no:
 * esos pausan el bot. Media y demás se guardan pero no despiertan al
 * bot todavía (eso llega con la capa de LLM).
 */
export function disparaBuffer(m: MensajeNormalizado): boolean {
  if (m.esEcho) return false
  return m.tipo === 'text' || m.tipo === 'interactive' || m.tipo === 'button'
}
