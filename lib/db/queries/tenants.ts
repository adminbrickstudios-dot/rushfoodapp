import { clienteServicio, type ClienteRushFood } from '@/lib/db/client'
import type { TenantConfig, Tenants } from '@/lib/types/db'
import { leerOpcional } from './_comun'

export interface TenantConConfig extends Tenants {
  config: TenantConfig | null
}

/**
 * Resuelve un tenant por su slug de URL ('mola') y trae su
 * configuración operativa en la misma consulta.
 *
 * Devuelve null si no existe o está inactivo: un slug que no matchea
 * es un 404, no una falla.
 */
export async function getTenantBySlug(
  slug: string,
  db: ClienteRushFood = clienteServicio(),
): Promise<TenantConConfig | null> {
  const res = await db
    .from('tenants')
    .select('*, tenant_config(*)')
    .eq('slug', slug)
    .eq('activo', true)
    .maybeSingle()

  const fila = leerOpcional(res, `getTenantBySlug(${slug})`)
  if (!fila) return null

  // tenant_config es 1-a-1 (su PK es el tenant_id), pero PostgREST
  // igual puede devolverlo como array según cómo infiera la relación.
  const { tenant_config, ...tenant } = fila as Tenants & {
    tenant_config: TenantConfig | TenantConfig[] | null
  }

  return {
    ...tenant,
    config: Array.isArray(tenant_config) ? (tenant_config[0] ?? null) : tenant_config,
  }
}
