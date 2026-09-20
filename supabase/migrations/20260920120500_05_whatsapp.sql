-- ============================================================
-- 05 · WHATSAPP
-- Sólo el almacenamiento. La integración (webhooks, envío, bot) no
-- se implementa todavía; estas tablas existen para que cuando se
-- implemente no haya que migrar con datos adentro.
-- ============================================================

create table public.wa_cuentas (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  proveedor        proveedor_wa not null default 'cloud_api',
  phone_number_id  text not null,
  waba_id          text,
  telefono_display text not null,
  coexistencia     boolean not null default false,
  -- Nombre de la env var / secret. NUNCA el token en la base.
  token_ref        text not null,
  verify_token     text not null,
  app_secret_ref   text,
  tier_mensajes    text,   -- TIER_250, TIER_1K...
  calidad          text check (calidad is null or calidad in ('GREEN','YELLOW','RED')),
  activo           boolean not null default true,
  unique (phone_number_id)
);
create index wa_cuentas_tenant_idx on public.wa_cuentas (tenant_id);

create table public.wa_plantillas (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nombre    text not null,   -- snake_case, como en Meta
  idioma    text not null default 'es_AR',
  categoria text not null check (categoria in ('UTILITY','MARKETING','AUTHENTICATION')),
  estado    text not null default 'borrador'
              check (estado in ('borrador','pendiente','aprobada','rechazada')),
  cuerpo    text not null,
  variables jsonb,
  meta_id   text,
  unique (tenant_id, nombre, idioma)
);

create table public.conversaciones (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  cliente_id        uuid,
  wa_id             text not null,   -- número del cliente
  estado            estado_conv not null default 'idle',
  contexto          jsonb not null default '{}',   -- carrito en construcción, último menú mostrado
  bot_pausado_hasta timestamptz,                   -- takeover humano
  asignada_a        uuid,                          -- user_id del recepcionista
  ultimo_in_at      timestamptz,                   -- define la ventana de 24 h
  ultimo_out_at     timestamptz,
  reinicios         int not null default 0,
  creado_en         timestamptz not null default now(),
  unique (tenant_id, wa_id),
  unique (id, tenant_id),
  foreign key (cliente_id, tenant_id) references public.clientes(id, tenant_id) on delete set null
);
create index conversaciones_tenant_estado_idx on public.conversaciones (tenant_id, estado);
create index conversaciones_ultimo_in_idx on public.conversaciones (tenant_id, ultimo_in_at desc);

create table public.mensajes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversacion_id uuid not null,
  wa_message_id   text,   -- idempotencia: Meta reintenta el mismo mensaje
  direccion       direccion_msg not null,
  origen          origen_msg not null,
  tipo            text not null,   -- text,image,audio,location,interactive,template,document
  texto           text,
  payload         jsonb,
  transcripcion   text,            -- audios transcriptos
  estado_envio    text check (estado_envio is null or estado_envio in ('sent','delivered','read','failed')),
  error           text,
  creado_en       timestamptz not null default now(),
  unique (tenant_id, wa_message_id),
  foreign key (conversacion_id, tenant_id) references public.conversaciones(id, tenant_id) on delete cascade
);
create index mensajes_conversacion_idx on public.mensajes (conversacion_id, creado_en desc);

-- Cola de salida: garantiza envío, reintentos y orden.
-- No se manda directo desde el handler del webhook.
create table public.wa_outbox (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversacion_id uuid,
  destino         text not null,
  payload         jsonb not null,
  estado          text not null default 'pendiente'
                    check (estado in ('pendiente','enviado','fallido')),
  intentos        int not null default 0 check (intentos >= 0),
  proximo_intento timestamptz not null default now(),
  error           text,
  idempotency_key text unique,
  creado_en       timestamptz not null default now(),
  foreign key (conversacion_id, tenant_id) references public.conversaciones(id, tenant_id) on delete cascade
);
create index wa_outbox_pendientes_idx on public.wa_outbox (estado, proximo_intento)
  where estado = 'pendiente';

-- Derivaciones a humano: la "sección de ayuda" del panel.
-- pedido_id queda sin FK hasta 07_pedidos, que la agrega.
create table public.tickets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversacion_id uuid,
  pedido_id       uuid,
  motivo          text not null,   -- reclamo, duda, fuera_de_alcance, pago_dudoso
  prioridad       int not null default 3 check (prioridad between 1 and 5),
  estado          text not null default 'abierto'
                    check (estado in ('abierto','en_curso','resuelto','descartado')),
  resumen         text,            -- lo escribe el bot: el recepcionista no relee 40 mensajes
  asignado_a      uuid,
  resuelto_en     timestamptz,
  creado_en       timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (conversacion_id, tenant_id) references public.conversaciones(id, tenant_id) on delete set null
);
create index tickets_tenant_estado_idx on public.tickets (tenant_id, estado, prioridad);

-- ---------- RLS ----------
alter table public.wa_cuentas     enable row level security;
alter table public.wa_plantillas  enable row level security;
alter table public.conversaciones enable row level security;
alter table public.mensajes       enable row level security;
alter table public.wa_outbox      enable row level security;
alter table public.tickets        enable row level security;

create policy tenant_isolation on public.wa_cuentas
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.wa_plantillas
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.conversaciones
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.mensajes
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.wa_outbox
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.tickets
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));
