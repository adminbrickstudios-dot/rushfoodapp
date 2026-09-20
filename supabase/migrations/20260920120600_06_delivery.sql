-- ============================================================
-- 06 · DELIVERY
-- Repartidores y cierre de caja.
-- Va antes de pedidos porque pedidos.repartidor_id la referencia, y
-- antes de operación porque asignaciones cuelga de acá.
-- ============================================================

create table public.repartidores (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id   uuid,
  nombre    text not null,
  telefono  text,
  activo    boolean not null default true,
  en_ruta   boolean not null default false,
  unique (id, tenant_id)
);
create index repartidores_tenant_activo_idx on public.repartidores (tenant_id, activo);

create table public.cierres_caja (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  repartidor_id     uuid,
  fecha             date not null,
  efectivo_esperado numeric(12,2) not null default 0,
  efectivo_rendido  numeric(12,2),
  -- Calculada, no cargada a mano: si la escribe una persona, el día
  -- que no cierre la caja la diferencia va a decir cero igual.
  diferencia        numeric(12,2) generated always as (
                      coalesce(efectivo_rendido, 0) - efectivo_esperado
                    ) stored,
  cerrado_en        timestamptz,
  notas             text,
  unique (tenant_id, repartidor_id, fecha),
  foreign key (repartidor_id, tenant_id) references public.repartidores(id, tenant_id) on delete set null
);

-- ---------- RLS ----------
alter table public.repartidores enable row level security;
alter table public.cierres_caja enable row level security;

create policy tenant_isolation on public.repartidores
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.cierres_caja
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));
