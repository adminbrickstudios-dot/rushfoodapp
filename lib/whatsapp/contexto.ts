import { ColaQStash, type ColaDiferida } from './cola'
import { obtenerProveedor, type WhatsAppProvider } from './provider'
import { RepoSupabase, type RepoWhatsApp } from './repo'

/**
 * Trabajo que no debe bloquear la respuesta HTTP.
 *
 * En producción es `after()` de next/server: corre después de que la
 * respuesta salió. En los tests se reemplaza por un recolector que el
 * test puede esperar, para que las aserciones sean deterministas sin
 * dejar de modelar "primero responde, después trabaja".
 */
export type EnSegundoPlano = (tarea: () => Promise<void>) => void

export interface ContextoWhatsApp {
  repo: RepoWhatsApp
  proveedor: WhatsAppProvider
  cola: ColaDiferida
  enSegundoPlano: EnSegundoPlano
  /** Base pública de la app, para armar la URL que llama QStash. */
  urlBase: string
}

let sobrescrito: ContextoWhatsApp | null = null

/** Para los tests: inyecta un contexto completo. */
export function definirContexto(ctx: ContextoWhatsApp): void {
  sobrescrito = ctx
}

export function limpiarContexto(): void {
  sobrescrito = null
}

async function enSegundoPlanoProduccion(tarea: () => Promise<void>): Promise<void> {
  // Import dinámico: next/server sólo existe dentro del runtime de
  // Next, y este módulo también se carga desde los tests.
  const { after } = await import('next/server')
  after(async () => {
    try {
      await tarea()
    } catch (err) {
      // Una excepción acá ya no puede afectar la respuesta —que ya
      // salió— pero sí tiene que quedar registrada.
      console.error('[whatsapp] tarea en segundo plano falló', err)
    }
  })
}

export function obtenerContexto(): ContextoWhatsApp {
  if (sobrescrito) return sobrescrito

  const urlBase = process.env.NEXT_PUBLIC_APP_URL
  if (!urlBase) throw new Error('Falta la variable de entorno NEXT_PUBLIC_APP_URL')

  return {
    repo: new RepoSupabase(),
    proveedor: obtenerProveedor(),
    cola: new ColaQStash(),
    enSegundoPlano: (tarea) => {
      void enSegundoPlanoProduccion(tarea)
    },
    urlBase: urlBase.replace(/\/$/, ''),
  }
}
