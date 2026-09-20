import { createBrowserClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/db'

export type ClienteRushFood = SupabaseClient<Database>

function requerido(nombre: string, valor: string | undefined): string {
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}`)
  }
  return valor
}

/**
 * Cliente del browser. Usa la anon key, así que TODA consulta pasa
 * por RLS: sólo ve las filas de los tenants donde el usuario logueado
 * tiene un membership activo.
 *
 * Es el único que puede tocar un componente cliente.
 */
export function clienteNavegador(): ClienteRushFood {
  return createBrowserClient<Database>(
    requerido('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requerido('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  )
}

let admin: ClienteRushFood | null = null

/**
 * Cliente de service-role. SALTEA RLS POR COMPLETO: ve y escribe
 * cualquier fila de cualquier tenant. Es para webhooks, crons y el
 * bot, que corren sin usuario logueado.
 *
 * Todo lo que pase por acá tiene que filtrar por tenant_id a mano.
 * No hay red de contención abajo.
 *
 * El chequeo de `window` es un fusible, no la única defensa: si este
 * módulo llega al bundle del browser, la key ya viajó. La defensa
 * real es que SUPABASE_SERVICE_ROLE_KEY no lleva prefijo
 * NEXT_PUBLIC_, así que Next no la inyecta del lado cliente y la
 * llamada muere en `requerido` incluso sin el fusible.
 */
export function clienteServicio(): ClienteRushFood {
  if (typeof window !== 'undefined') {
    throw new Error(
      'clienteServicio() se invocó en el browser. La service-role key saltea RLS ' +
        'y no puede salir del servidor. Usá clienteNavegador() en componentes cliente.',
    )
  }

  if (admin) return admin

  admin = createClient<Database>(
    requerido('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requerido('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-rushfood-origen': 'servicio' } },
    },
  )

  return admin
}
