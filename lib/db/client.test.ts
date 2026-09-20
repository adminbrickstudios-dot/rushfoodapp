import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clienteServicio } from './client'

const ENV_ORIGINAL = { ...process.env }

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proyecto.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-de-prueba'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-de-prueba'
})

afterEach(() => {
  process.env = { ...ENV_ORIGINAL }
  delete (globalThis as { window?: unknown }).window
})

describe('clienteServicio — no puede usarse desde el browser', () => {
  it('tira si existe window', () => {
    // Así se ve el módulo si termina en el bundle del cliente.
    ;(globalThis as { window?: unknown }).window = {}

    expect(() => clienteServicio()).toThrowError(/se invocó en el browser/)
  })

  it('en el servidor devuelve un cliente', () => {
    expect(clienteServicio()).toBeTruthy()
  })

  it('reusa la misma instancia en el servidor', () => {
    expect(clienteServicio()).toBe(clienteServicio())
  })
})

describe('clienteServicio — variables de entorno', () => {
  it('tira con un mensaje claro si falta la service-role key', async () => {
    // Módulo fresco: si no, el singleton que armaron los tests de
    // arriba se devuelve cacheado y nunca se lee la env var.
    vi.resetModules()
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const { clienteServicio: fresco } = await import('./client')

    expect(() => fresco()).toThrowError(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
