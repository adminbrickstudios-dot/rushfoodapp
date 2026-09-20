/**
 * Genera lib/types/db.ts leyendo el catálogo de un Postgres que ya
 * corrió todas las migraciones (PGlite / WASM, sin Docker).
 *
 *   node scripts/generar-tipos.mjs
 *
 * Se genera en vez de escribirse a mano para que los tipos no puedan
 * divergir del schema: si cambia una migración, se vuelve a correr.
 */
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const RAIZ = join(import.meta.dirname, '..')
const DIR = join(RAIZ, 'supabase', 'migrations')
const SALIDA = join(RAIZ, 'lib', 'types', 'db.ts')

const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm } })
// pgcrypto en `extensions`, igual que Supabase. Ver el comentario en
// scripts/verificar-migraciones.mjs.
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema if not exists auth;
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;
  create or replace function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`)

for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(await readFile(join(DIR, f), 'utf8'))
}

const q = async (sql) => (await db.query(sql)).rows

const ESCALARES = {
  uuid: 'string', text: 'string', varchar: 'string', bpchar: 'string',
  int2: 'number', int4: 'number', int8: 'number', numeric: 'number',
  float4: 'number', float8: 'number',
  bool: 'boolean',
  timestamptz: 'string', timestamp: 'string', date: 'string', time: 'string', timetz: 'string',
  json: 'Json', jsonb: 'Json',
}

const enums = await q(`
  select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname order by t.typname
`)
const nombresEnum = new Set(enums.map((e) => e.typname))

const tsDe = (typname) => {
  if (ESCALARES[typname]) return ESCALARES[typname]
  if (nombresEnum.has(typname)) return `Database['public']['Enums']['${typname}']`
  if (typname.startsWith('_')) {
    const base = typname.slice(1)
    return `${ESCALARES[base] ?? (nombresEnum.has(base) ? `Database['public']['Enums']['${base}']` : 'unknown')}[]`
  }
  return 'unknown'
}

const tablas = await q(`
  select c.relname as tabla,
         a.attname as col,
         t.typname as tipo,
         a.attnotnull as obligatoria,
         a.attgenerated <> '' as generada,
         pg_get_expr(d.adbin, d.adrelid) is not null as tiene_default
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname, a.attnum
`)

const porTabla = new Map()
for (const r of tablas) {
  if (!porTabla.has(r.tabla)) porTabla.set(r.tabla, [])
  porTabla.get(r.tabla).push(r)
}

// Las FK reales. postgrest-js las exige en cada tabla (GenericTable
// pide `Relationships`) y las usa para tipar los select embebidos:
// sin esto el cliente entero colapsa a `never`.
const fks = await q(`
  select
    c.conname                                as nombre,
    src.relname                              as tabla,
    tgt.relname                              as referenciada,
    (select array_agg(a.attname order by k.ord)
       from unnest(c.conkey) with ordinality as k(attnum, ord)
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columnas,
    (select array_agg(a.attname order by k.ord)
       from unnest(c.confkey) with ordinality as k(attnum, ord)
       join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as columnas_ref,
    -- 1-a-1 si las columnas de origen ya son únicas por sí solas.
    exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid
        and i.indisunique
        and i.indnatts = array_length(c.conkey, 1)
        and (select array_agg(x order by x) from unnest(i.indkey::int[]) x)
          = (select array_agg(x order by x) from unnest(c.conkey::int[]) x)
    ) as uno_a_uno
  from pg_constraint c
  join pg_class src on src.oid = c.conrelid
  join pg_class tgt on tgt.oid = c.confrelid
  join pg_namespace n on n.oid = src.relnamespace
  where c.contype = 'f' and n.nspname = 'public'
  order by src.relname, c.conname
`)

const fksPorTabla = new Map()
for (const fk of fks) {
  if (!fksPorTabla.has(fk.tabla)) fksPorTabla.set(fk.tabla, [])
  fksPorTabla.get(fk.tabla).push(fk)
}

const L = []
L.push('// GENERADO POR scripts/generar-tipos.mjs — NO EDITAR A MANO.')
L.push('// Se regenera con: npm run db:types')
L.push('// Fuente de verdad: supabase/migrations/*.sql')
L.push('')
L.push('export type Json =')
L.push('  | string')
L.push('  | number')
L.push('  | boolean')
L.push('  | null')
L.push('  | { [key: string]: Json | undefined }')
L.push('  | Json[]')
L.push('')
L.push('export interface Database {')
L.push('  public: {')
L.push('    Tables: {')

for (const [tabla, cols] of [...porTabla].sort(([a], [b]) => a.localeCompare(b))) {
  L.push(`      ${tabla}: {`)
  L.push('        Row: {')
  for (const c of cols) {
    L.push(`          ${c.col}: ${tsDe(c.tipo)}${c.obligatoria ? '' : ' | null'}`)
  }
  L.push('        }')
  L.push('        Insert: {')
  for (const c of cols) {
    if (c.generada) continue // las columnas generadas las calcula Postgres
    const opcional = !c.obligatoria || c.tiene_default
    L.push(`          ${c.col}${opcional ? '?' : ''}: ${tsDe(c.tipo)}${c.obligatoria ? '' : ' | null'}`)
  }
  L.push('        }')
  L.push('        Update: {')
  for (const c of cols) {
    if (c.generada) continue
    L.push(`          ${c.col}?: ${tsDe(c.tipo)}${c.obligatoria ? '' : ' | null'}`)
  }
  L.push('        }')

  const rels = fksPorTabla.get(tabla) ?? []
  if (rels.length === 0) {
    L.push('        Relationships: []')
  } else {
    L.push('        Relationships: [')
    for (const fk of rels) {
      L.push('          {')
      L.push(`            foreignKeyName: '${fk.nombre}'`)
      L.push(`            columns: [${fk.columnas.map((c) => `'${c}'`).join(', ')}]`)
      L.push(`            isOneToOne: ${fk.uno_a_uno}`)
      L.push(`            referencedRelation: '${fk.referenciada}'`)
      L.push(`            referencedColumns: [${fk.columnas_ref.map((c) => `'${c}'`).join(', ')}]`)
      L.push('          },')
    }
    L.push('        ]')
  }

  L.push('      }')
}

L.push('    }')
L.push('    Views: { [_ in never]: never }')
L.push('    Functions: {')
L.push('      mis_tenants: { Args: Record<PropertyKey, never>; Returns: string[] }')
L.push('      es_miembro: { Args: { p_tenant_id: string }; Returns: boolean }')
L.push('    }')
L.push('    Enums: {')
for (const e of enums) {
  L.push(`      ${e.typname}: ${e.labels.map((l) => `'${l}'`).join(' | ')}`)
}
L.push('    }')
L.push('    CompositeTypes: { [_ in never]: never }')
L.push('  }')
L.push('}')
L.push('')
L.push('// ---------- Atajos ----------')
L.push("type Public = Database['public']")
L.push('')
L.push("export type Tabla<N extends keyof Public['Tables']> = Public['Tables'][N]['Row']")
L.push("export type Insertar<N extends keyof Public['Tables']> = Public['Tables'][N]['Insert']")
L.push("export type Actualizar<N extends keyof Public['Tables']> = Public['Tables'][N]['Update']")
L.push("export type Enum<N extends keyof Public['Enums']> = Public['Enums'][N]")
L.push('')
for (const [tabla] of [...porTabla].sort(([a], [b]) => a.localeCompare(b))) {
  const pascal = tabla.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())
  L.push(`export type ${pascal} = Tabla<'${tabla}'>`)
}
L.push('')
for (const e of enums) {
  const pascal = e.typname.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())
  L.push(`export type ${pascal} = Enum<'${e.typname}'>`)
}
L.push('')

await mkdir(join(RAIZ, 'lib', 'types'), { recursive: true })
await writeFile(SALIDA, L.join('\n'), 'utf8')
await db.close()

console.log(`lib/types/db.ts: ${porTabla.size} tablas, ${enums.length} enums, ${L.length} lineas`)
