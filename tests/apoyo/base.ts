import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIR_MIGRACIONES = join(process.cwd(), 'supabase', 'migrations')

export interface BaseDePrueba {
  consultar<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  ejecutar(sql: string): Promise<void>
  cerrar(): Promise<void>
}

/**
 * Postgres real (PGlite / WASM) con TODAS las migraciones aplicadas,
 * incluido el layout de extensiones de Supabase.
 *
 * Se reintenta porque PGlite necesita un bloque contiguo grande de
 * memoria para su heap de WASM y en una máquina cargada la primera
 * reserva puede fallar; no es un problema del schema.
 */
export async function crearBaseDePrueba(intentos = 12): Promise<BaseDePrueba> {
  let ultimoError: unknown

  for (let i = 0; i < intentos; i++) {
    try {
      return await arrancar()
    } catch (err) {
      ultimoError = err
      const msg = err instanceof Error ? err.message : String(err)
      if (!/allocat|out of memory|Memory/i.test(msg)) throw err
    }
  }

  throw new Error(
    `no se pudo crear la base de prueba en ${intentos} intentos: ${String(ultimoError)}`,
  )
}

async function arrancar(): Promise<BaseDePrueba> {
  const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm } })

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema if not exists auth;
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create or replace function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `)

  const archivos = (await readdir(DIR_MIGRACIONES)).filter((f) => f.endsWith('.sql')).sort()

  for (const archivo of archivos) {
    await db.exec(await readFile(join(DIR_MIGRACIONES, archivo), 'utf8'))
  }

  return {
    async consultar<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await db.query<T>(sql, params)
      return res.rows
    },
    async ejecutar(sql: string): Promise<void> {
      await db.exec(sql)
    },
    async cerrar(): Promise<void> {
      await db.close()
    },
  }
}

export interface TenantDePrueba {
  tenantId: string
  cuentaId: string
  phoneNumberId: string
}

/** Crea un tenant con su cuenta de WhatsApp lista para recibir. */
export async function sembrarTenant(
  base: BaseDePrueba,
  opciones: { slug?: string; phoneNumberId?: string; segundosBuffer?: number } = {},
): Promise<TenantDePrueba> {
  const slug = opciones.slug ?? `test-${Math.random().toString(36).slice(2, 8)}`
  const phoneNumberId = opciones.phoneNumberId ?? `pn-${slug}`

  const [tenant] = await base.consultar<{ id: string }>(
    `insert into public.tenants (slug, nombre) values ($1, $2) returning id`,
    [slug, `Tenant ${slug}`],
  )

  const tenantId = tenant!.id

  await base.consultar(
    `insert into public.tenant_config (tenant_id, segundos_buffer_mensajes)
     values ($1, $2)`,
    [tenantId, opciones.segundosBuffer ?? 6],
  )

  const [cuenta] = await base.consultar<{ id: string }>(
    `insert into public.wa_cuentas
       (tenant_id, phone_number_id, telefono_display, token_ref, verify_token)
     values ($1, $2, '+5493875550000', 'WHATSAPP_TOKEN', 'verify')
     returning id`,
    [tenantId, phoneNumberId],
  )

  return { tenantId, cuentaId: cuenta!.id, phoneNumberId }
}
