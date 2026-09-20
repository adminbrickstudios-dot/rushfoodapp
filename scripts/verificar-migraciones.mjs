/**
 * Corre las migraciones contra un Postgres real (PGlite / WASM), en
 * orden, y verifica el resultado. No necesita Docker ni tocar la base
 * de producción.
 *
 *   node scripts/verificar-migraciones.mjs
 *
 * Lo que NO cubre: los roles reales de Supabase (anon / authenticated
 * / service_role son stubs acá) y por lo tanto el comportamiento vivo
 * de las policies bajo un JWT. Eso hay que probarlo en Supabase.
 */
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const DIR = join(import.meta.dirname, '..', 'supabase', 'migrations')

const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm } })

// Andamiaje que Supabase ya trae y PGlite no.
//
// pgcrypto se instala en `extensions`, que es donde Supabase lo tiene:
// así el `create extension if not exists pgcrypto` de la 01 queda en
// no-op igual que allá, y cualquier llamada sin calificar a
// gen_random_bytes() revienta acá en vez de reventar en el push.
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema if not exists auth;
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;
  create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`)

const archivos = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort()
if (archivos.length === 0) throw new Error('no hay migraciones en supabase/migrations')

for (const archivo of archivos) {
  const sql = await readFile(join(DIR, archivo), 'utf8')
  try {
    await db.exec(sql)
    console.log(`  ok   ${archivo}`)
  } catch (err) {
    console.error(`  FALLA ${archivo}\n        ${err.message}`)
    process.exit(1)
  }
}

console.log('\n--- estado final ---')

const q = async (sql) => (await db.query(sql)).rows

const tablas = await q(`
  select c.relname as tabla, c.relrowsecurity as rls,
         (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
         exists (select 1 from pg_attribute a
                 where a.attrelid = c.oid and a.attname = 'tenant_id'
                   and a.attnum > 0 and not a.attisdropped) as tiene_tenant_id
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname
`)

const sinRls = tablas.filter((t) => !t.rls)
const sinPolicy = tablas.filter((t) => t.tiene_tenant_id && Number(t.policies) === 0)
const sinTenant = tablas.filter(
  (t) => !t.tiene_tenant_id && !['tenants', 'contadores_pedido', 'webhook_events'].includes(t.tabla),
)

console.log(`tablas: ${tablas.length}`)
console.log(`  sin RLS:                    ${sinRls.length ? sinRls.map((t) => t.tabla).join(', ') : 'ninguna'}`)
console.log(`  con tenant_id y sin policy: ${sinPolicy.length ? sinPolicy.map((t) => t.tabla).join(', ') : 'ninguna'}`)
console.log(`  de negocio sin tenant_id:   ${sinTenant.length ? sinTenant.map((t) => t.tabla).join(', ') : 'ninguna'}`)

const funcs = await q(`
  select p.proname,
         pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') as publico
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  order by p.proname
`)
console.log(`funciones propias: ${funcs.map((f) => `${f.proname}${f.publico ? ' [PUBLIC!]' : ''}`).join(', ')}`)

// --- el seed escribió lo que dijo que escribió ---
const conteos = await q(`
  select
    (select count(*) from public.tenants  where slug = 'mola')                              as tenants,
    (select count(*) from public.estaciones)                                                 as estaciones,
    (select count(*) from public.productos)                                                  as productos,
    (select count(*) from public.variantes)                                                  as variantes,
    (select count(*) from public.opciones)                                                   as opciones,
    (select count(*) from public.producto_grupos)                                            as producto_grupos,
    (select count(*) from public.horarios)                                                   as horarios,
    (select count(*) from public.zonas_delivery)                                             as zonas
`)
console.log('seed:', JSON.stringify(conteos[0]))

// --- el correlativo por tenant no colisiona ---
const [{ id: tenantId }] = await q(`select id from public.tenants where slug = 'mola'`)
await db.exec(`
  insert into public.pedidos (tenant_id, canal, tipo) values
    ('${tenantId}', 'whatsapp', 'delivery'),
    ('${tenantId}', 'web', 'takeaway'),
    ('${tenantId}', 'mostrador', 'takeaway');
`)
const numeros = await q(`select numero from public.pedidos order by numero`)
console.log('correlativo:', numeros.map((r) => r.numero).join(', '))

// --- el default de token_publico realmente generó tokens ---
const tokens = await q(`
  select count(*) as total,
         count(distinct token_publico) as distintos,
         min(length(token_publico)) as largo
  from public.pedidos
`)
console.log('token_publico:', JSON.stringify(tokens[0]))

// --- y la versión SIN calificar falla con este layout, que es lo que
//     pasó en Supabase: si alguien la vuelve a escribir así, se cae acá ---
let sinCalificar = 'RESOLVIO (el harness no detectaría la regresión)'
try {
  await q(`select encode(gen_random_bytes(16), 'hex')`)
} catch (err) {
  sinCalificar = `rechazado — ${err.message.split('\n')[0]}`
}
console.log('gen_random_bytes sin calificar:', sinCalificar)

// --- el aislamiento cruzado está cerrado por FK compuesta ---
await db.exec(`insert into public.tenants (slug, nombre) values ('otro', 'Otro Local')`)
const [{ id: otroId }] = await q(`select id from public.tenants where slug = 'otro'`)
const [{ id: prodMola }] = await q(`select id from public.productos limit 1`)
let cruce = 'PERMITIDO (mal)'
try {
  await db.exec(`
    insert into public.variantes (tenant_id, producto_id, nombre)
    values ('${otroId}', '${prodMola}', 'robada')
  `)
} catch {
  cruce = 'rechazado'
}
console.log(`variante de un tenant sobre producto de otro: ${cruce}`)

await db.close()
console.log('\nOK')
