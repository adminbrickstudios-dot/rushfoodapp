-- ============================================================
-- 11 · RLS — ENDURECIMIENTO Y VERIFICACIÓN
--
-- Las policies NO se crean acá: cada tabla nace con su RLS activa en
-- su propia migración, que es la única forma de que no exista ni un
-- instante en que la tabla esté abierta.
--
-- Esta migración hace dos cosas:
--   1. Saca los grants por defecto a anon.
--   2. Verifica el invariante y ABORTA si algo quedó afuera.
--
-- Si esta migración falla, no la arregles acá: falta RLS en la
-- migración de la tabla que nombra el error.
-- ============================================================

-- ---------- 1. ANON NO TOCA NADA ----------
-- El browser usa la anon key, pero todo usuario del panel está
-- logueado y pega como 'authenticated'. anon no necesita ni una
-- tabla. La página pública de seguimiento va por el servidor con
-- token_publico, no por PostgREST con anon.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ---------- 2. VERIFICACIÓN DEL INVARIANTE ----------
do $verificacion$
declare
  v_faltan_rls      text;
  v_faltan_policy   text;
  v_sin_tenant      text;
  v_funcs_abiertas  text;
begin
  -- (a) Toda tabla de public con RLS activa, sin excepción.
  select string_agg(c.relname, ', ' order by c.relname)
    into v_faltan_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if v_faltan_rls is not null then
    raise exception 'tablas sin RLS: %', v_faltan_rls;
  end if;

  -- (b) Toda tabla con tenant_id tiene al menos una policy.
  --     webhook_events no tiene tenant_id y queda cerrada sin policy
  --     a propósito, así que no entra en este chequeo.
  select string_agg(c.relname, ', ' order by c.relname)
    into v_faltan_policy
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
    )
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid);

  if v_faltan_policy is not null then
    raise exception 'tablas con tenant_id y sin policy: %', v_faltan_policy;
  end if;

  -- (c) Toda tabla de negocio lleva tenant_id. Las tres excepciones
  --     están nombradas y justificadas; cualquier tabla nueva que
  --     aparezca acá hace fallar la migración.
  select string_agg(c.relname, ', ' order by c.relname)
    into v_sin_tenant
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname not in (
      'tenants',          -- es el tenant
      'contadores_pedido', -- PK es tenant_id
      'webhook_events'    -- llega antes de saber el tenant
    )
    and not exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
    );

  if v_sin_tenant is not null then
    raise exception 'tablas de negocio sin tenant_id: %', v_sin_tenant;
  end if;

  -- (d) Ninguna función propia quedó ejecutable por PUBLIC.
  --     Se excluyen las que pertenecen a una extensión (pgcrypto,
  --     pg_trgm): las instala Postgres con EXECUTE para PUBLIC y no
  --     son nuestras para revocar.
  select string_agg(p.proname, ', ' order by p.proname)
    into v_funcs_abiertas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.deptype = 'e'
    )
    and pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE');

  if v_funcs_abiertas is not null then
    raise exception 'funciones con EXECUTE para PUBLIC: %', v_funcs_abiertas;
  end if;

  raise notice 'RLS verificada: todas las tablas aisladas por tenant.';
end;
$verificacion$;
