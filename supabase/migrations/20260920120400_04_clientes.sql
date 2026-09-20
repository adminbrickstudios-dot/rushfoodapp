-- ============================================================
-- 04 · CLIENTES
-- Clientes y sus direcciones. Los contadores (pedidos_count,
-- total_gastado) son denormalización deliberada: el panel los lee
-- en cada listado y no vale un count() por fila.
-- ============================================================

create table public.clientes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  telefono       text not null,   -- E.164: +5493875551234
  nombre         text,
  email          text,
  notas_internas text,            -- 'siempre pide sin cebolla', 'moroso'
  bloqueado      boolean not null default false,
  pedidos_count  int not null default 0 check (pedidos_count >= 0),
  total_gastado  numeric(14,2) not null default 0 check (total_gastado >= 0),
  primer_pedido  timestamptz,
  ultimo_pedido  timestamptz,
  -- Opt-in explícito. Sin esto no se manda marketing, ni una vez.
  acepta_promos  boolean not null default false,
  creado_en      timestamptz not null default now(),
  unique (tenant_id, telefono),
  unique (id, tenant_id)
);
create index clientes_tenant_ultimo_pedido_idx on public.clientes (tenant_id, ultimo_pedido desc nulls last);

create table public.direcciones (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  cliente_id uuid not null,
  etiqueta   text,            -- 'Casa', 'Trabajo'
  calle      text not null,
  numero     text,
  piso_depto text,
  barrio     text,
  referencia text,            -- 'portón negro, timbre roto'
  lat        numeric(10,7),
  lng        numeric(10,7),
  zona_id    uuid,
  es_default boolean not null default false,
  verificada boolean not null default false,
  creado_en  timestamptz not null default now(),
  foreign key (cliente_id, tenant_id) references public.clientes(id, tenant_id) on delete cascade,
  foreign key (zona_id, tenant_id)    references public.zonas_delivery(id, tenant_id) on delete set null
);
create index direcciones_cliente_idx on public.direcciones (cliente_id);
-- Una sola dirección default por cliente.
create unique index direcciones_una_default_idx
  on public.direcciones (cliente_id) where es_default;

-- ---------- RLS ----------
alter table public.clientes    enable row level security;
alter table public.direcciones enable row level security;

create policy tenant_isolation on public.clientes
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.direcciones
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));
