import type { ColaDiferida, ProgramarDiferido } from '@/lib/whatsapp/cola'
import type { EnSegundoPlano } from '@/lib/whatsapp/contexto'
import type {
  EnvioBotones,
  EnvioCtaUrl,
  EnvioLista,
  EnvioPlantilla,
  EnvioTexto,
  MediaDescargada,
  ResultadoEnvio,
  WhatsAppProvider,
} from '@/lib/whatsapp/provider'
import {
  payloadBotones,
  payloadCtaUrl,
  payloadLista,
  payloadTexto,
} from '@/lib/whatsapp/provider'

export interface EnvioRegistrado {
  clase: string
  destino: string
  payload: unknown
}

/**
 * Proveedor que registra en vez de salir a la red.
 *
 * Construye el payload real antes de registrar, así que las
 * validaciones de límites se ejecutan igual que en producción: un
 * mensaje con 4 botones falla acá también.
 */
export class ProveedorFalso implements WhatsAppProvider {
  readonly nombre = 'falso'
  readonly enviados: EnvioRegistrado[] = []
  readonly leidos: string[] = []

  /** Si se setea, el próximo envío falla con este error. */
  fallarCon: Error | null = null

  private contador = 0

  private registrar(clase: string, destino: string, payload: unknown): ResultadoEnvio {
    if (this.fallarCon) {
      const err = this.fallarCon
      this.fallarCon = null
      throw err
    }
    this.enviados.push({ clase, destino, payload })
    this.contador += 1
    return { waMessageId: `wamid.falso.${this.contador}` }
  }

  async sendText(p: EnvioTexto) {
    return this.registrar('texto', p.destino, payloadTexto(p))
  }
  async sendButtons(p: EnvioBotones) {
    return this.registrar('botones', p.destino, payloadBotones(p))
  }
  async sendList(p: EnvioLista) {
    return this.registrar('lista', p.destino, payloadLista(p))
  }
  async sendTemplate(p: EnvioPlantilla) {
    return this.registrar('plantilla', p.destino, p)
  }
  async sendCtaUrl(p: EnvioCtaUrl) {
    return this.registrar('ctaUrl', p.destino, payloadCtaUrl(p))
  }
  async markAsRead(waMessageId: string): Promise<void> {
    this.leidos.push(waMessageId)
  }
  async downloadMedia(mediaId: string): Promise<MediaDescargada> {
    return { mediaId, mimeType: 'application/octet-stream', bytes: new Uint8Array() }
  }
}

export interface ProgramacionRegistrada extends ProgramarDiferido {
  id: string
}

/** Cola que registra programaciones y cancelaciones sin llamar a QStash. */
export class ColaFalsa implements ColaDiferida {
  readonly programados: ProgramacionRegistrada[] = []
  readonly cancelados: string[] = []
  private contador = 0

  async programar(p: ProgramarDiferido): Promise<string> {
    this.contador += 1
    const id = `qstash-${this.contador}`
    this.programados.push({ ...p, id })
    return id
  }

  async cancelar(id: string): Promise<void> {
    this.cancelados.push(id)
  }

  /** Los que se programaron y todavía no se cancelaron. */
  get vivos(): ProgramacionRegistrada[] {
    return this.programados.filter((p) => !this.cancelados.includes(p.id))
  }
}

/**
 * Envuelve un repo y hace fallar un método las primeras N veces.
 *
 * Sirve para probar el manejo de errores del turno con una falla
 * realista —un hipo de la base a mitad de camino— en vez de forzarla
 * por el proveedor, que está detrás del outbox y por diseño no
 * propaga sus errores al turno.
 */
export function repoQueFalla<T extends object>(
  base: T,
  metodo: keyof T,
  veces: number,
): T {
  let restantes = veces

  return new Proxy(base, {
    get(destino, prop, receptor) {
      const valor = Reflect.get(destino, prop, receptor) as unknown

      if (typeof valor !== 'function') return valor
      const fn = valor as (...args: unknown[]) => unknown

      if (prop !== metodo) return fn.bind(destino)

      return async (...args: unknown[]) => {
        if (restantes > 0) {
          restantes -= 1
          throw new Error(`falla inyectada en ${String(prop)}`)
        }
        return fn.apply(destino, args)
      }
    },
  })
}

/**
 * Recolector de trabajo en segundo plano.
 *
 * Modela lo que hace `after()` en Vercel —la respuesta sale primero y
 * el trabajo corre después— pero le da al test un punto donde
 * esperarlo, para que las aserciones no dependan de timing.
 */
export function crearSegundoPlano(): {
  enSegundoPlano: EnSegundoPlano
  esperar: () => Promise<void>
} {
  const pendientes: Promise<void>[] = []

  return {
    enSegundoPlano: (tarea) => {
      pendientes.push(
        tarea().catch((err) => {
          console.error('[test] tarea en segundo plano falló', err)
        }),
      )
    },
    esperar: async () => {
      // Mientras esperar una tanda agregue más tareas, seguir.
      while (pendientes.length > 0) {
        const tanda = pendientes.splice(0, pendientes.length)
        await Promise.all(tanda)
      }
    },
  }
}
