-- ============================================================
-- 09 · OPERACIÓN
-- Sección 6 del doc de paneles: pausas, cupones, asignaciones,
-- demanda perdida, historial de precios, avisos y respuestas
-- rápidas. Entra ahora porque después es una migración con datos.
-- ============================================================

-- Frenar el local sin cerrarlo. alcance 'delivery' deja andando el
-- retiro y viceversa; 'todo' corta los dos.
create table public.pausas (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  alcance   alcance_pausa not null,
  hasta     timestamptz not null,
  motivo    text,
  actor     uuid,
  creado_en timestamptz not null default now()
);
-- estaAbierto() pega acá en cada consulta: el índice ordena por
-- vencimiento para cortar temprano.
create index pausas_vigentes_idx on public.pausas (tenant_id, hasta desc);

create table public.cupones (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  codigo        text not null,
  tipo          text not null check (tipo in ('porcentaje','monto','envio_gratis')),
  valor         numeric(12,2),
  usos_max      int check (usos_max is null or usos_max > 0),
  usos_actuales int not null default 0 check (usos_actuales >= 0),
  monto_minimo  numeric(12,2),
  desde         timestamptz,
  hasta         timestamptz,
  activo        boolean not null default true,
  unique (tenant_id, codigo),
  -- El tope es un tope: la base no deja pasarlo aunque la app falle.
  constraint cupones_tope_usos check (usos_max is null or usos_actuales <= usos_max),
  constraint cupones_vigencia  check (hasta is null or desde is null or hasta > desde)
);

create table public.asignaciones (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  pedido_id     uuid not null,
  repartidor_id uuid not null,
  orden_ruta    int,
  asignado_por  uuid,
  asignado_en   timestamptz not null default now(),
  recibido_por  text,     -- quién recibió en la puerta
  foto_entrega  text,
  resultado     text check (resultado is null or resultado in ('entregado','no_contesta','rechazado')),
  foreign key (pedido_id, tenant_id)     references public.pedidos(id, tenant_id) on delete cascade,
  foreign key (repartidor_id, tenant_id) references public.repartidores(id, tenant_id) on delete cascade
);
create index asignaciones_repartidor_idx on public.asignaciones (tenant_id, repartidor_id, asignado_en desc);
create index asignaciones_pedido_idx on public.asignaciones (pedido_id);
-- Un pedido no puede estar asignado dos veces sin resolverse.
create unique index asignaciones_una_abierta_idx
  on public.asignaciones (pedido_id) where resultado is null;

-- Lo que quisieron comprar y no pudieron. Nadie mide esto.
create table public.demanda_perdida (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  tipo            text not null
                    check (tipo in ('agotado','fuera_de_zona','cerrado','sin_delivery')),
  producto_id     uuid,
  texto_cliente   text,
  zona_texto      text,
  conversacion_id uuid,
  creado_en       timestamptz not null default now(),
  foreign key (producto_id, tenant_id)     references public.productos(id, tenant_id) on delete set null,
  foreign key (conversacion_id, tenant_id) references public.conversaciones(id, tenant_id) on delete set null
);
create index demanda_perdida_tenant_tipo_idx on public.demanda_perdida (tenant_id, tipo, creado_en desc);

-- Auditoría de precios. Cuando en marzo pregunte a cuánto vendía la
-- clásica en enero, está acá.
create table public.historial_precios (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  producto_id     uuid,
  variante_id     uuid,
  precio_anterior numeric(12,2) not null,
  precio_nuevo    numeric(12,2) not null,
  motivo          text,   -- 'ajuste masivo', 'manual'
  actor           uuid,
  creado_en       timestamptz not null default now(),
  foreign key (producto_id, tenant_id) references public.productos(id, tenant_id) on delete cascade,
  foreign key (variante_id, tenant_id) references public.variantes(id, tenant_id) on delete cascade,
  -- Una fila que no apunta a nada no sirve para auditar nada.
  constraint historial_precios_objetivo check (
    producto_id is not null or variante_id is not null
  )
);
create index historial_precios_producto_idx on public.historial_precios (tenant_id, producto_id, creado_en desc);

create table public.avisos (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tipo      text not null,
  titulo    text not null,
  detalle   text,
  severidad int not null default 3 check (severidad between 1 and 5),
  leido_en  timestamptz,
  creado_en timestamptz not null default now()
);
create index avisos_sin_leer_idx on public.avisos (tenant_id, creado_en desc) where leido_en is null;

create table public.respuestas_rapidas (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  atajo     text not null,
  texto     text not null,
  orden     int not null default 0,
  unique (tenant_id, atajo)
);

-- ---------- RLS ----------
alter table public.pausas             enable row level security;
alter table public.cupones            enable row level security;
alter table public.asignaciones       enable row level security;
alter table public.demanda_perdida    enable row level security;
alter table public.historial_precios  enable row level security;
alter table public.avisos             enable row level security;
alter table public.respuestas_rapidas enable row level security;

create policy tenant_isolation on public.pausas
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.cupones
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.asignaciones
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.demanda_perdida
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.historial_precios
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.avisos
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.respuestas_rapidas
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));
