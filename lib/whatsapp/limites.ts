/**
 * Límites duros de la API de WhatsApp, validados ANTES de tocar la red.
 *
 * La idea es no enterarse de que se violó un límite por un 400 de Meta
 * un viernes a las 22. Todo lo de acá es puro y sincrónico: se ejecuta
 * antes de cualquier fetch.
 *
 * Los caracteres se cuentan en unidades UTF-16 (`.length`), no en code
 * points. Es el criterio conservador: para cualquier string con emojis
 * o acentos, UTF-16 cuenta igual o más que code points, así que nunca
 * se deja pasar algo que Meta después rechace por largo. El costo es
 * que un texto lleno de emojis puede rebotar acá siendo aceptable allá.
 */

export const LIMITES = {
  cuerpo: 1024,
  footer: 60,
  botones: { cantidad: 3, titulo: 20 },
  lista: { filasTotales: 10, tituloFila: 24, descripcionFila: 72 },
  ctaUrl: { cantidad: 2 },
} as const

/** Se excedió un límite duro de la API. Nunca llegó a salir a la red. */
export class WhatsAppLimitError extends Error {
  constructor(
    /** Qué límite: 'botones.cantidad', 'lista.tituloFila', etc. */
    public readonly limite: string,
    /** El máximo que permite la API. */
    public readonly maximo: number,
    /** Lo que se recibió. */
    public readonly valorRecibido: number,
    /** Contexto extra: qué botón, qué fila. */
    public readonly detalle?: string,
  ) {
    super(
      `Límite de WhatsApp excedido en ${limite}: máximo ${maximo}, recibido ${valorRecibido}` +
        (detalle ? ` (${detalle})` : ''),
    )
    this.name = 'WhatsAppLimitError'
  }
}

/**
 * Un payload que la API no puede representar. Distinto de exceder un
 * límite numérico: acá la forma misma del mensaje no existe en Meta.
 */
export class WhatsAppPayloadError extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'WhatsAppPayloadError'
  }
}

const largo = (texto: string): number => texto.length

export function validarCuerpo(texto: string): void {
  if (largo(texto) > LIMITES.cuerpo) {
    throw new WhatsAppLimitError('cuerpo', LIMITES.cuerpo, largo(texto))
  }
}

export function validarFooter(texto: string | undefined | null): void {
  if (texto == null) return
  if (largo(texto) > LIMITES.footer) {
    throw new WhatsAppLimitError('footer', LIMITES.footer, largo(texto))
  }
}

export interface BotonRespuesta {
  id: string
  titulo: string
}

export function validarBotones(botones: readonly BotonRespuesta[]): void {
  if (botones.length > LIMITES.botones.cantidad) {
    throw new WhatsAppLimitError('botones.cantidad', LIMITES.botones.cantidad, botones.length)
  }
  if (botones.length === 0) {
    throw new WhatsAppPayloadError('sendButtons necesita al menos un botón')
  }

  botones.forEach((boton, i) => {
    if (largo(boton.titulo) > LIMITES.botones.titulo) {
      throw new WhatsAppLimitError(
        'botones.titulo',
        LIMITES.botones.titulo,
        largo(boton.titulo),
        `botón ${i} (${boton.id})`,
      )
    }
  })

  const ids = botones.map((b) => b.id)
  if (new Set(ids).size !== ids.length) {
    throw new WhatsAppPayloadError(`sendButtons con ids repetidos: ${ids.join(', ')}`)
  }
}

export interface FilaLista {
  id: string
  titulo: string
  descripcion?: string
}

export interface SeccionLista {
  titulo: string
  filas: FilaLista[]
}

export function validarLista(secciones: readonly SeccionLista[]): void {
  // El límite de 10 es sobre el TOTAL de filas de todas las secciones
  // juntas, no 10 por sección. Es el error clásico con este endpoint.
  const filas = secciones.flatMap((s) => s.filas)

  if (filas.length > LIMITES.lista.filasTotales) {
    throw new WhatsAppLimitError(
      'lista.filasTotales',
      LIMITES.lista.filasTotales,
      filas.length,
      `${secciones.length} secciones`,
    )
  }
  if (filas.length === 0) {
    throw new WhatsAppPayloadError('sendList necesita al menos una fila')
  }

  for (const fila of filas) {
    if (largo(fila.titulo) > LIMITES.lista.tituloFila) {
      throw new WhatsAppLimitError(
        'lista.tituloFila',
        LIMITES.lista.tituloFila,
        largo(fila.titulo),
        `fila ${fila.id}`,
      )
    }
    if (fila.descripcion != null && largo(fila.descripcion) > LIMITES.lista.descripcionFila) {
      throw new WhatsAppLimitError(
        'lista.descripcionFila',
        LIMITES.lista.descripcionFila,
        largo(fila.descripcion),
        `fila ${fila.id}`,
      )
    }
  }

  const ids = filas.map((f) => f.id)
  if (new Set(ids).size !== ids.length) {
    throw new WhatsAppPayloadError('sendList con ids de fila repetidos')
  }
}

export interface BotonCtaUrl {
  titulo: string
  url: string
}

export function validarCtaUrl(botones: readonly BotonCtaUrl[]): void {
  if (botones.length > LIMITES.ctaUrl.cantidad) {
    throw new WhatsAppLimitError('ctaUrl.cantidad', LIMITES.ctaUrl.cantidad, botones.length)
  }
  if (botones.length === 0) {
    throw new WhatsAppPayloadError('sendCtaUrl necesita al menos un botón')
  }
}
