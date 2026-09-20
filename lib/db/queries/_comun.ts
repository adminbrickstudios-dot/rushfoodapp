import type { PostgrestError } from '@supabase/supabase-js'

/** Error de base con el contexto de qué se estaba haciendo. */
export class ErrorDB extends Error {
  constructor(
    contexto: string,
    public readonly causa?: PostgrestError | null,
  ) {
    super(causa ? `${contexto}: ${causa.message} (${causa.code})` : contexto)
    this.name = 'ErrorDB'
  }
}

interface Respuesta<T> {
  data: T | null
  error: PostgrestError | null
}

/** Lectura que puede no encontrar nada. Cero filas devuelve null. */
export function leerOpcional<T>(res: Respuesta<T>, contexto: string): T | null {
  if (res.error) throw new ErrorDB(contexto, res.error)
  return res.data
}

/** Lectura que tiene que encontrar algo. Cero filas es error. */
export function leerUna<T>(res: Respuesta<T>, contexto: string): T {
  if (res.error) throw new ErrorDB(contexto, res.error)
  if (res.data === null) throw new ErrorDB(`${contexto}: no devolvió ninguna fila`)
  return res.data
}

/**
 * Escritura verificada.
 *
 * Un insert/update que matchea cero filas devuelve `data: []` sin
 * error: PostgREST lo considera un éxito. Bajo RLS eso pasa todo el
 * tiempo — el tenant equivocado no ve la fila, así que no actualiza
 * nada y nadie se entera. Acá cero filas es error, siempre.
 *
 * Requiere que la query termine en .select(), si no `data` viene null
 * y no hay nada que contar.
 */
export function escrituraVerificada<T>(
  res: Respuesta<T[]>,
  contexto: string,
  esperadas?: number,
): T[] {
  if (res.error) throw new ErrorDB(contexto, res.error)

  const filas = res.data ?? []

  if (filas.length === 0) {
    throw new ErrorDB(
      `${contexto}: afectó 0 filas. O el tenant_id no corresponde, o RLS bloqueó la escritura.`,
    )
  }

  if (esperadas !== undefined && filas.length !== esperadas) {
    throw new ErrorDB(`${contexto}: afectó ${filas.length} filas, esperaba ${esperadas}`)
  }

  return filas
}
