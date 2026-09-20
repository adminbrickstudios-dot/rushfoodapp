-- ============================================================
-- 10 · INFRAESTRUCTURA
-- Idempotencia de webhooks, costo del LLM y auditoría.
-- ============================================================

-- Meta y MP reintentan el mismo evento varias veces. El unique
-- (proveedor, external_id) es lo que hace que el reintento sea un
-- no-op y no un segundo pedido.
--
-- Sin tenant_id a propósito: el evento llega ANTES de saber a qué
-- tenant pertenece — resolverlo es justamente parte de procesarlo.
-- Por eso lleva RLS activa y ninguna policy: queda cerrada para
-- authenticated y anon, y sólo la tocan los webhooks con
-- service_role, que saltea RLS.
create table public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  proveedor    text not null check (proveedor in ('meta','mercadopago')),
  external_id  text not null,
  payload      jsonb not null,
  procesado_en timestamptz,
  error        text,
  creado_en    timestamptz not null default now(),
  unique (proveedor, external_id)
);
create index webhook_events_sin_procesar_idx on public.webhook_events (creado_en)
  where procesado_en is null;

-- Costo y debug del LLM. Si esto no se mide, el mes que el bot se
-- vuelve caro nadie sabe por qué.
create table public.bot_runs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversacion_id uuid,
  modelo          text not null,
  intent          text,
  estado_antes    estado_conv,
  estado_despues  estado_conv,
  tools_usadas    jsonb,
  tokens_in       int,
  tokens_out      int,
  tokens_cache    int,
  latencia_ms     int,
  costo_usd       numeric(10,6),
  error           text,
  creado_en       timestamptz not null default now(),
  foreign key (conversacion_id, tenant_id) references public.conversaciones(id, tenant_id) on delete cascade
);
create index bot_runs_tenant_creado_idx on public.bot_runs (tenant_id, creado_en desc);

-- Quién hizo qué. El día que falte plata, la respuesta está acá.
-- tenant_id es NOT NULL (en el schema original era nullable): una
-- fila de auditoría sin tenant no la ve nadie bajo RLS y no audita
-- nada. Las acciones de plataforma van a otro lado.
create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid,
  accion     text not null,
  entidad    text,
  entidad_id uuid,
  antes      jsonb,
  despues    jsonb,
  creado_en  timestamptz not null default now()
);
create index audit_log_tenant_creado_idx on public.audit_log (tenant_id, creado_en desc);
create index audit_log_entidad_idx on public.audit_log (tenant_id, entidad, entidad_id);

-- ---------- RLS ----------
alter table public.webhook_events enable row level security;
alter table public.bot_runs       enable row level security;
alter table public.audit_log      enable row level security;

-- webhook_events: sin policy, a propósito (ver comentario arriba).

create policy tenant_isolation on public.bot_runs
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

-- La auditoría se lee, no se edita: sin policy de insert/update/delete
-- para authenticated. La escribe el servidor con service_role.
create policy tenant_isolation_select on public.audit_log
  for select to authenticated
  using (public.es_miembro(tenant_id));
