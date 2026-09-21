import { Client } from '@upstash/qstash'

export interface ProgramarDiferido {
  url: string
  cuerpo: unknown
  retrasoSegundos: number
}

/**
 * Mensajes diferidos.
 *
 * La spec original pedía "un cron cada 5 segundos" para el buffer
 * anti-ráfaga. No existe: Vercel Cron tiene piso de 1 minuto. Un
 * mensaje diferido de QStash sí da precisión de segundos, y además se
 * puede CANCELAR por id, que es exactamente lo que necesita el
 * "reinicio del timer" de la ráfaga.
 */
export interface ColaDiferida {
  /** Devuelve el id del mensaje, para poder cancelarlo después. */
  programar(p: ProgramarDiferido): Promise<string>
  /** Cancelar es best-effort: si ya se disparó, no es un error. */
  cancelar(id: string): Promise<void>
}

export class ColaQStash implements ColaDiferida {
  private readonly cliente: Client

  constructor(token?: string) {
    const valor = token ?? process.env.QSTASH_TOKEN
    if (!valor) throw new Error('Falta la variable de entorno QSTASH_TOKEN')
    this.cliente = new Client({ token: valor })
  }

  async programar(p: ProgramarDiferido): Promise<string> {
    const res = await this.cliente.publishJSON({
      url: p.url,
      body: p.cuerpo,
      delay: Math.max(0, Math.round(p.retrasoSegundos)),
      // QStash reintenta solo si el endpoint responde fuera de 2xx.
      // Con 3 alcanza: el reintento propio del endpoint de procesar
      // es más inteligente que el de QStash porque conoce el estado.
      retries: 3,
    })

    const id = (res as { messageId?: string }).messageId
    if (!id) throw new Error('QStash no devolvió messageId')
    return id
  }

  async cancelar(id: string): Promise<void> {
    try {
      await this.cliente.messages.delete(id)
    } catch (err) {
      // Carrera esperable: el mensaje ya se entregó o ya se canceló.
      // Tratarlo como error dejaría al cliente sin respuesta por algo
      // que no importa.
      const msg = err instanceof Error ? err.message : String(err)
      if (/not found|404/i.test(msg)) return
      throw err
    }
  }
}
