-- ============================================================
-- 07 · PEDIDOS
-- Pedidos, items, bitácora y el correlativo por tenant.
-- Incluye tomado_por/tomado_en (claim entre recepcionistas) y
-- propina, de la sección 6 del doc de paneles.
-- ============================================================

create table public.pedidos (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  numero          int not null,   -- correlativo POR TENANT, lo pone el trigger
  cliente_id      uuid,
  conversacion_id uuid,
  canal           canal_pedido not null,
  tipo            tipo_entrega not null,
  estado          estado_pedido not null default 'borrador',
  pago_estado     estado_pago not null default 'sin_pago',
  modo_pago       modo_pago,

  -- Montos. Snapshot: el precio de hoy no cambia el pedido de ayer.
  subtotal        numeric(12,2) not null default 0 check (subtotal >= 0),
  descuento       numeric(12,2) not null default 0 check (descuento >= 0),
  envio           numeric(12,2) not null default 0 check (envio >= 0),
  propina         numeric(12,2) not null default 0 check (propina >= 0),
  total           numeric(12,2) not null default 0 check (total >= 0),
  sena_monto      numeric(12,2) not null default 0 check (sena_monto >= 0),
  pagado_monto    numeric(12,2) not null default 0 check (pagado_monto >= 0),
  saldo_pendiente numeric(12,2) generated always as (total - pagado_monto) stored,

  -- Entrega
  direccion_snapshot jsonb,   -- congelada al confirmar
  zona_id            uuid,
  notas_cliente      text,
  notas_internas     text,

  -- Tiempos
  minutos_estimados  int check (minutos_estimados is null or minutos_estimados >= 0),
  prometido_para     timestamptz,
  confirmado_en      timestamptz,
  en_cocina_en       timestamptz,
  listo_en           timestamptz,
  despachado_en      timestamptz,
  entregado_en       timestamptz,
  cancelado_en       timestamptz,
  motivo_cancelacion text,
  repartidor_id      uuid,

  -- Claim: que dos recepcionistas no trabajen sobre el mismo pedido.
  tomado_por         uuid,
  tomado_en          timestamptz,

  -- Link sin login para cliente y repartidor.
  -- gen_random_bytes viene de pgcrypto, que en Supabase vive en el
  -- esquema `extensions` y NO está en el search_path de la sesión de
  -- migración: sin calificar, tira 42883. encode() en cambio es core
  -- (pg_catalog), así que esa no se toca.
  token_publico      text unique not null default encode(extensions.gen_random_bytes(16),'hex'),
  creado_en          timestamptz not null default now(),

  unique (tenant_id, numero),
  unique (id, tenant_id),
  foreign key (cliente_id, tenant_id)      references public.clientes(id, tenant_id) on delete set null,
  foreign key (conversacion_id, tenant_id) references public.conversaciones(id, tenant_id) on delete set null,
  foreign key (zona_id, tenant_id)         references public.zonas_delivery(id, tenant_id) on delete set null,
  foreign key (repartidor_id, tenant_id)   references public.repartidores(id, tenant_id) on delete set null,
  -- Un claim es par o no es: o están los dos campos o no está ninguno.
  constraint pedidos_claim_completo check (
    (tomado_por is null and tomado_en is null)
    or (tomado_por is not null and tomado_en is not null)
  )
);
create index pedidos_tenant_estado_idx on public.pedidos (tenant_id, estado, creado_en desc);
create index pedidos_tenant_creado_idx on public.pedidos (tenant_id, creado_en desc);
create index pedidos_repartidor_idx on public.pedidos (repartidor_id) where repartidor_id is not null;

-- Ahora que existe pedidos, tickets puede cerrar su FK.
alter table public.tickets
  add constraint tickets_pedido_fk
  foreign key (pedido_id, tenant_id) references public.pedidos(id, tenant_id) on delete set null;

-- ---------- CORRELATIVO POR TENANT ----------
-- El upsert con RETURNING toma el row lock del contador, así que dos
-- inserts simultáneos del mismo tenant se serializan y sacan números
-- distintos. El max(numero)+1 del schema original no hace eso.
create or replace function public.siguiente_numero_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_numero int;
begin
  insert into public.contadores_pedido as c (tenant_id, ultimo_numero)
  values (new.tenant_id, 1)
  on conflict (tenant_id) do update
    set ultimo_numero = c.ultimo_numero + 1
  returning c.ultimo_numero into v_numero;

  -- Cero filas afectadas acá significa pedido sin número: es un
  -- error, no un éxito silencioso.
  if v_numero is null then
    raise exception 'no se pudo asignar numero de pedido al tenant %', new.tenant_id
      using errcode = 'internal_error';
  end if;

  new.numero := v_numero;
  return new;
end;
$fn$;

revoke execute on function public.siguiente_numero_pedido() from public, anon, authenticated;

create trigger trg_numero_pedido
  before insert on public.pedidos
  for each row when (new.numero is null)
  execute function public.siguiente_numero_pedido();

create table public.pedido_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  pedido_id       uuid not null,
  producto_id     uuid,
  variante_id     uuid,
  estacion_id     uuid,
  nombre_snapshot text not null,   -- 'Cheeseburger Doble'
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  cantidad        int not null default 1 check (cantidad > 0),
  opciones        jsonb not null default '[]',   -- [{nombre, precio}]
  notas           text,                          -- 'sin cebolla, bien cocida'
  subtotal        numeric(12,2) not null check (subtotal >= 0),
  estado_cocina   text not null default 'pendiente'
                    check (estado_cocina in ('pendiente','en_preparacion','listo')),
  foreign key (pedido_id, tenant_id)   references public.pedidos(id, tenant_id) on delete cascade,
  foreign key (producto_id, tenant_id) references public.productos(id, tenant_id) on delete set null,
  foreign key (variante_id, tenant_id) references public.variantes(id, tenant_id) on delete set null,
  foreign key (estacion_id, tenant_id) references public.estaciones(id, tenant_id) on delete set null
);
create index pedido_items_pedido_idx on public.pedido_items (pedido_id);
create index pedido_items_estacion_idx on public.pedido_items (tenant_id, estacion_id, estado_cocina);

-- Bitácora. Cuando el dueño diga "este pedido nunca llegó", acá está
-- la verdad. Append-only por convención: nada la actualiza.
create table public.pedido_eventos (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pedido_id uuid not null,
  tipo      text not null,   -- creado, confirmado, pago_aprobado, cocina, listo, despachado, entregado, cancelado, editado
  actor     text not null,   -- 'bot', 'sistema', user_id, 'mercadopago'
  datos     jsonb,
  creado_en timestamptz not null default now(),
  foreign key (pedido_id, tenant_id) references public.pedidos(id, tenant_id) on delete cascade
);
create index pedido_eventos_pedido_idx on public.pedido_eventos (pedido_id, creado_en);

-- ---------- RLS ----------
alter table public.pedidos        enable row level security;
alter table public.pedido_items   enable row level security;
alter table public.pedido_eventos enable row level security;

create policy tenant_isolation on public.pedidos
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.pedido_items
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.pedido_eventos
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));
