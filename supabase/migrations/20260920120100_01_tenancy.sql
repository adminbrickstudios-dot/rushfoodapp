-- ============================================================
-- 01 · TENANCY
-- Extensiones, enums, tenants, config, memberships, contador de
-- pedidos y las funciones de aislamiento que usan TODAS las
-- políticas RLS del resto de las migraciones.
-- Corre primera: mis_tenants()/es_miembro() son precondición de
-- cada policy posterior.
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------- ENUMS ----------
create type rol_usuario        as enum ('owner','recepcion','cocina','delivery','soporte');
create type canal_pedido       as enum ('whatsapp','web','mostrador','telefono','pedidosya','rappi','ubereats');
create type tipo_entrega       as enum ('delivery','takeaway');
create type estado_pedido      as enum ('borrador','pendiente_pago','confirmado','en_cocina','listo','en_camino','entregado','cancelado','rechazado');
create type estado_pago        as enum ('sin_pago','sena_pagada','pagado','reembolsado','fallido');
create type modo_pago          as enum ('online_total','online_sena','contra_entrega_efectivo','contra_entrega_digital','transferencia');
create type tipo_pago          as enum ('sena','saldo','total','reembolso');
create type estado_transaccion as enum ('pendiente','aprobado','rechazado','cancelado','en_revision','devuelto');
create type proveedor_pago     as enum ('mercadopago','efectivo','transferencia','otro');
create type estado_conv        as enum ('idle','menu','armando_pedido','datos_cliente','direccion','horario','pago','esperando_pago','confirmado','postventa','humano','cerrada','bloqueada');
create type direccion_msg      as enum ('in','out');
create type origen_msg         as enum ('cliente','bot','agente','app_echo','sistema');
create type proveedor_wa       as enum ('cloud_api','bsp_360dialog','bsp_otro');
create type alcance_pausa      as enum ('todo','delivery','takeaway');

-- ---------- TENANTS ----------
create table public.tenants (
  id        uuid primary key default gen_random_uuid(),
  slug      text unique not null,
  nombre    text not null,
  timezone  text not null default 'America/Argentina/Salta',
  moneda    text not null default 'ARS',
  activo    boolean not null default true,
  plan      text not null default 'piloto',
  creado_en timestamptz not null default now()
);

create table public.tenant_config (
  tenant_id                 uuid primary key references public.tenants(id) on delete cascade,
  -- Operación
  acepta_delivery           boolean not null default true,
  acepta_takeaway           boolean not null default true,
  direccion_local           text,
  lat                       numeric(10,7),
  lng                       numeric(10,7),
  -- Pagos
  exige_pago_online         boolean not null default true,
  permite_contra_entrega    boolean not null default false,
  monto_max_contra_entrega  numeric(12,2),
  usa_sena                  boolean not null default false,
  sena_porcentaje           int check (sena_porcentaje between 0 and 100),
  sena_monto_minimo         numeric(12,2),
  minutos_expira_pago       int not null default 15,
  acepta_comprobante_foto   boolean not null default false,
  -- Tiempos
  minutos_extra_delivery    int not null default 15,
  minutos_buffer_cocina     int not null default 0,
  pedido_minimo             numeric(12,2) default 0,
  -- Bot
  bot_activo                boolean not null default true,
  modo_contingencia         boolean not null default false,
  horas_reinicio_conv       int not null default 6,
  segundos_buffer_mensajes  int not null default 6,
  max_pedidos_simultaneos   int,
  -- Textos configurables por el dueño
  mensaje_bienvenida        text,
  mensaje_cerrado           text,
  mensaje_fuera_de_zona     text,
  actualizado_en            timestamptz not null default now()
);

create table public.memberships (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id   uuid not null,
  rol       rol_usuario not null,
  activo    boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

-- Contador correlativo por tenant.
-- Reemplaza al max(numero)+1 del schema original: bajo dos inserts
-- simultáneos del mismo tenant ese patrón genera el mismo número y
-- revienta contra el unique (tenant_id, numero).
create table public.contadores_pedido (
  tenant_id     uuid primary key references public.tenants(id) on delete cascade,
  ultimo_numero int not null default 0
);

-- ---------- FUNCIONES DE AISLAMIENTO ----------
-- search_path = '' obliga a calificar todo con esquema. Sin eso una
-- security definer es escalable vía el search_path del que la llama.
create or replace function public.mis_tenants()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.tenant_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.activo = true;
$fn$;

revoke execute on function public.mis_tenants() from public, anon;
grant  execute on function public.mis_tenants() to authenticated, service_role;

-- Guarda booleana para las policies. EXISTS nunca devuelve null, así
-- que no hay tercer estado: o es miembro o no lo es. Un select
-- directo sin filas devolvería null y la policy quedaría indefinida.
create or replace function public.es_miembro(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.activo = true
  );
$fn$;

revoke execute on function public.es_miembro(uuid) from public, anon;
grant  execute on function public.es_miembro(uuid) to authenticated, service_role;

-- ---------- RLS ----------
alter table public.tenants           enable row level security;
alter table public.tenant_config     enable row level security;
alter table public.memberships       enable row level security;
alter table public.contadores_pedido enable row level security;

-- tenants se aísla por id, no por tenant_id.
create policy tenant_isolation on public.tenants
  for all to authenticated
  using      (public.es_miembro(id))
  with check (public.es_miembro(id));

create policy tenant_isolation on public.tenant_config
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.memberships
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.contadores_pedido
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));
