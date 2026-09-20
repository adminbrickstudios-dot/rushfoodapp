-- ============================================================
-- 02 · HORARIOS Y COBERTURA
-- Horarios semanales, excepciones por fecha y zonas de delivery.
-- Todo lo que consume estaAbierto() y calcularTiempoEstimado().
-- ============================================================

create table public.horarios (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  dia_semana              int not null check (dia_semana between 0 and 6),  -- 0 = domingo
  abre                    time not null,
  cierra                  time not null,   -- si cierra <= abre, el turno cruza medianoche
  ultimo_pedido_min_antes int not null default 0 check (ultimo_pedido_min_antes >= 0),
  activo                  boolean not null default true
);
create index horarios_tenant_dia_idx on public.horarios (tenant_id, dia_semana);

-- Excepciones por fecha: feriados, cierres, horarios especiales.
-- Pisan por completo al horario semanal de esa fecha.
create table public.dias_especiales (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fecha     date not null,
  cerrado   boolean not null default true,
  abre      time,
  cierra    time,
  motivo    text,
  unique (tenant_id, fecha),
  -- Si no está cerrado tiene que traer el horario completo, si no la
  -- fila no dice nada útil y estaAbierto() tendría que adivinar.
  constraint dias_especiales_horario_completo check (
    cerrado = true or (abre is not null and cierra is not null)
  )
);

create table public.zonas_delivery (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  nombre        text not null,
  precio_envio  numeric(12,2) not null default 0,
  pedido_minimo numeric(12,2) not null default 0,
  minutos_extra int not null default 0,
  poligono      jsonb,      -- GeoJSON opcional
  barrios       text[],     -- matcheo por texto: rápido y suficiente al inicio
  activo        boolean not null default true,
  orden         int not null default 0,
  unique (id, tenant_id)   -- habilita FK compuestas desde direcciones y pedidos
);
create index zonas_delivery_tenant_idx on public.zonas_delivery (tenant_id);

-- ---------- RLS ----------
alter table public.horarios        enable row level security;
alter table public.dias_especiales enable row level security;
alter table public.zonas_delivery  enable row level security;

create policy tenant_isolation on public.horarios
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.dias_especiales
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.zonas_delivery
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));
