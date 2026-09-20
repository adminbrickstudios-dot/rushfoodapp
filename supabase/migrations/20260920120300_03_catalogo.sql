-- ============================================================
-- 03 · CATÁLOGO
-- Estaciones, categorías, productos, variantes, grupos de opciones
-- y promociones. Incluye costo_insumos / costo_extra (sección 6 del
-- doc de paneles) desde el arranque, para no migrar con datos adentro.
-- ============================================================

create table public.estaciones (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nombre    text not null,   -- plancha, freidora, armado, bebidas
  orden     int not null default 0,
  unique (tenant_id, nombre),
  unique (id, tenant_id)
);

create table public.categorias (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nombre    text not null,
  orden     int not null default 0,
  activo    boolean not null default true,
  unique (id, tenant_id)
);
create index categorias_tenant_orden_idx on public.categorias (tenant_id, orden);

create table public.productos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  categoria_id  uuid,
  estacion_id   uuid,
  nombre        text not null,
  descripcion   text,
  ingredientes  text,                             -- para responder "¿qué trae?" y alergias
  precio_base   numeric(12,2) not null check (precio_base >= 0),
  costo_insumos numeric(12,2) check (costo_insumos >= 0),
  minutos_prep  int not null default 10 check (minutos_prep >= 0),
  imagen_url    text,
  activo        boolean not null default true,
  agotado       boolean not null default false,   -- pausa rápida sin borrar
  orden         int not null default 0,
  alias         text[],                           -- 'la clásica', 'cheese' → matcheo del bot
  creado_en     timestamptz not null default now(),
  unique (id, tenant_id),
  -- FK compuestas: un producto nunca puede colgar de una categoría o
  -- estación de otro tenant. Sin el tenant_id en la FK, un uuid
  -- filtrado desde el panel alcanzaría para cruzar el aislamiento.
  foreign key (categoria_id, tenant_id) references public.categorias(id, tenant_id) on delete set null,
  foreign key (estacion_id, tenant_id)  references public.estaciones(id, tenant_id) on delete set null
);
create index productos_tenant_disponible_idx on public.productos (tenant_id, activo, agotado);
create index productos_nombre_trgm_idx on public.productos using gin (nombre gin_trgm_ops);

-- Variantes: simple / doble / triple. Precio como delta sobre precio_base.
create table public.variantes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  producto_id  uuid not null,
  nombre       text not null,   -- 'Simple','Doble','Triple'
  precio_delta numeric(12,2) not null default 0,
  costo_extra  numeric(12,2) not null default 0 check (costo_extra >= 0),
  minutos_extra int not null default 0 check (minutos_extra >= 0),
  agotado      boolean not null default false,
  orden        int not null default 0,
  es_default   boolean not null default false,
  unique (id, tenant_id),
  foreign key (producto_id, tenant_id) references public.productos(id, tenant_id) on delete cascade
);
create index variantes_producto_idx on public.variantes (producto_id);
-- Una sola variante default por producto.
create unique index variantes_una_default_idx
  on public.variantes (producto_id) where es_default;

-- Adicionales agrupados: 'Extras', 'Sacar ingredientes', 'Punto de cocción'
create table public.grupos_opciones (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  nombre      text not null,
  min_selec   int not null default 0 check (min_selec >= 0),
  max_selec   int not null default 1 check (max_selec >= 0),
  obligatorio boolean not null default false,
  orden       int not null default 0,
  unique (id, tenant_id),
  constraint grupos_opciones_rango check (max_selec >= min_selec)
);

create table public.opciones (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  grupo_id  uuid not null,
  nombre    text not null,   -- 'Extra cheddar', 'Sin cebolla'
  precio    numeric(12,2) not null default 0,
  agotado   boolean not null default false,
  orden     int not null default 0,
  foreign key (grupo_id, tenant_id) references public.grupos_opciones(id, tenant_id) on delete cascade
);
create index opciones_grupo_idx on public.opciones (grupo_id);

-- Join producto ↔ grupo. Lleva tenant_id como toda tabla de negocio.
create table public.producto_grupos (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  producto_id uuid not null,
  grupo_id    uuid not null,
  orden       int not null default 0,
  primary key (producto_id, grupo_id),
  foreign key (producto_id, tenant_id) references public.productos(id, tenant_id) on delete cascade,
  foreign key (grupo_id, tenant_id)    references public.grupos_opciones(id, tenant_id) on delete cascade
);
create index producto_grupos_tenant_idx on public.producto_grupos (tenant_id);

-- Promos simples. Los cupones con tope de usos van en 09_operacion.
create table public.promociones (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  nombre      text not null,
  tipo        text not null check (tipo in ('porcentaje','monto','2x1','envio_gratis')),
  valor       numeric(12,2),
  condiciones jsonb,   -- {min_total, productos[], dias[], horas[]}
  codigo      text,
  activo      boolean not null default true,
  desde       timestamptz,
  hasta       timestamptz,
  constraint promociones_vigencia check (hasta is null or desde is null or hasta > desde)
);
create index promociones_tenant_activo_idx on public.promociones (tenant_id, activo);

-- ---------- RLS ----------
alter table public.estaciones      enable row level security;
alter table public.categorias      enable row level security;
alter table public.productos       enable row level security;
alter table public.variantes       enable row level security;
alter table public.grupos_opciones enable row level security;
alter table public.opciones        enable row level security;
alter table public.producto_grupos enable row level security;
alter table public.promociones     enable row level security;

create policy tenant_isolation on public.estaciones
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.categorias
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.productos
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.variantes
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.grupos_opciones
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.opciones
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.producto_grupos
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.promociones
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));
