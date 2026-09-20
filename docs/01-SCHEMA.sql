-- ============================================================
-- RushFood — Schema multi-tenant (Postgres / Supabase)
-- Tenant #1: Mola (Salta). Correr entero, en orden.
-- Regla: NINGUNA tabla de negocio sin tenant_id.
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------- ENUMS ----------
create type rol_usuario      as enum ('owner','recepcion','cocina','delivery','soporte');
create type canal_pedido     as enum ('whatsapp','web','mostrador','telefono','pedidosya','rappi','ubereats');
create type tipo_entrega     as enum ('delivery','takeaway');
create type estado_pedido    as enum ('borrador','pendiente_pago','confirmado','en_cocina','listo','en_camino','entregado','cancelado','rechazado');
create type estado_pago      as enum ('sin_pago','sena_pagada','pagado','reembolsado','fallido');
create type modo_pago        as enum ('online_total','online_sena','contra_entrega_efectivo','contra_entrega_digital','transferencia');
create type tipo_pago        as enum ('sena','saldo','total','reembolso');
create type estado_transaccion as enum ('pendiente','aprobado','rechazado','cancelado','en_revision','devuelto');
create type proveedor_pago   as enum ('mercadopago','efectivo','transferencia','otro');
create type estado_conv      as enum ('idle','menu','armando_pedido','datos_cliente','direccion','horario','pago','esperando_pago','confirmado','postventa','humano','cerrada','bloqueada');
create type direccion_msg    as enum ('in','out');
create type origen_msg       as enum ('cliente','bot','agente','app_echo','sistema');
create type proveedor_wa     as enum ('cloud_api','bsp_360dialog','bsp_otro');

-- ============================================================
-- 1. TENANCY
-- ============================================================

create table tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,                    -- 'mola'
  nombre        text not null,
  timezone      text not null default 'America/Argentina/Salta',
  moneda        text not null default 'ARS',
  activo        boolean not null default true,
  plan          text not null default 'piloto',
  creado_en     timestamptz not null default now()
);

-- Toda la configuración operativa del negocio, en un solo lugar.
create table tenant_config (
  tenant_id                 uuid primary key references tenants(id) on delete cascade,
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
  acepta_comprobante_foto   boolean not null default false,  -- si true, entra a cola manual
  -- Tiempos
  minutos_extra_delivery    int not null default 15,
  minutos_buffer_cocina     int not null default 0,          -- se suma cuando hay saturación
  pedido_minimo             numeric(12,2) default 0,
  -- Bot
  bot_activo                boolean not null default true,
  modo_contingencia         boolean not null default false,  -- botón de pánico: todo a humano
  horas_reinicio_conv       int not null default 6,          -- pasadas N horas, saludo desde cero
  segundos_buffer_mensajes  int not null default 6,          -- agrupa ráfagas de mensajes
  max_pedidos_simultaneos   int,                             -- si se supera, avisa demora extra
  -- Textos configurables por el dueño
  mensaje_bienvenida        text,
  mensaje_cerrado           text,
  mensaje_fuera_de_zona     text,
  actualizado_en            timestamptz not null default now()
);

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null,                               -- auth.users.id
  rol        rol_usuario not null,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index on memberships (user_id);

-- ============================================================
-- 2. HORARIOS Y COBERTURA
-- ============================================================

create table horarios (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6),  -- 0 = domingo
  abre       time not null,
  cierra     time not null,                                    -- si cierra < abre, cruza medianoche
  ultimo_pedido_min_antes int not null default 0,              -- corta pedidos N min antes de cerrar
  activo     boolean not null default true
);
create index on horarios (tenant_id, dia_semana);

create table dias_especiales (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  fecha      date not null,
  cerrado    boolean not null default true,
  abre       time,
  cierra     time,
  motivo     text,
  unique (tenant_id, fecha)
);

create table zonas_delivery (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  nombre        text not null,                    -- 'Centro', 'Zona Sur'
  precio_envio  numeric(12,2) not null default 0,
  pedido_minimo numeric(12,2) not null default 0,
  minutos_extra int not null default 0,
  poligono      jsonb,                            -- GeoJSON opcional
  barrios       text[],                           -- matcheo por texto: rápido y suficiente al inicio
  activo        boolean not null default true,
  orden         int not null default 0
);
create index on zonas_delivery (tenant_id);

-- ============================================================
-- 3. CATÁLOGO
-- ============================================================

create table estaciones (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nombre    text not null,                        -- plancha, freidora, armado, bebidas
  orden     int not null default 0,
  unique (tenant_id, nombre)
);

create table categorias (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nombre    text not null,
  orden     int not null default 0,
  activo    boolean not null default true
);
create index on categorias (tenant_id, orden);

create table productos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  categoria_id   uuid references categorias(id) on delete set null,
  estacion_id    uuid references estaciones(id) on delete set null,
  nombre         text not null,
  descripcion    text,
  ingredientes   text,                            -- para responder "¿qué trae?" y alergias
  precio_base    numeric(12,2) not null,
  minutos_prep   int not null default 10,         -- SIN ESTO el sistema promete tiempos inventados
  imagen_url     text,
  activo         boolean not null default true,
  agotado        boolean not null default false,  -- pausa rápida sin borrar
  orden          int not null default 0,
  alias          text[],                          -- 'la clásica', 'cheese' → matcheo del bot
  creado_en      timestamptz not null default now()
);
create index on productos (tenant_id, activo, agotado);
create index on productos using gin (nombre gin_trgm_ops);

-- Variantes: simple / doble / triple. Precio como delta o absoluto.
create table variantes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  producto_id     uuid not null references productos(id) on delete cascade,
  nombre          text not null,                  -- 'Simple','Doble','Triple'
  precio_delta    numeric(12,2) not null default 0,
  minutos_extra   int not null default 0,
  agotado         boolean not null default false,
  orden           int not null default 0,
  es_default      boolean not null default false
);
create index on variantes (producto_id);

-- Adicionales agrupados: 'Extras', 'Sacar ingredientes', 'Punto de cocción'
create table grupos_opciones (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  nombre        text not null,
  min_selec     int not null default 0,
  max_selec     int not null default 1,
  obligatorio   boolean not null default false,
  orden         int not null default 0
);

create table opciones (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  grupo_id  uuid not null references grupos_opciones(id) on delete cascade,
  nombre    text not null,                        -- 'Extra cheddar', 'Sin cebolla'
  precio    numeric(12,2) not null default 0,
  agotado   boolean not null default false,
  orden     int not null default 0
);

create table producto_grupos (
  producto_id uuid not null references productos(id) on delete cascade,
  grupo_id    uuid not null references grupos_opciones(id) on delete cascade,
  primary key (producto_id, grupo_id)
);

-- Promos simples (2x1, combo, descuento por monto)
create table promociones (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  nombre       text not null,
  tipo         text not null,                     -- 'porcentaje','monto','2x1','envio_gratis'
  valor        numeric(12,2),
  condiciones  jsonb,                             -- {min_total, productos[], dias[], horas[]}
  codigo       text,
  activo       boolean not null default true,
  desde        timestamptz,
  hasta        timestamptz
);

-- ============================================================
-- 4. CLIENTES
-- ============================================================

create table clientes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  telefono        text not null,                  -- E.164: +5493875551234
  nombre          text,
  email           text,
  notas_internas  text,                           -- 'siempre pide sin cebolla', 'moroso'
  bloqueado       boolean not null default false,
  pedidos_count   int not null default 0,
  total_gastado   numeric(14,2) not null default 0,
  primer_pedido   timestamptz,
  ultimo_pedido   timestamptz,
  acepta_promos   boolean not null default false, -- opt-in explícito. Sin esto, no mandes marketing.
  creado_en       timestamptz not null default now(),
  unique (tenant_id, telefono)
);

create table direcciones (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  cliente_id   uuid not null references clientes(id) on delete cascade,
  etiqueta     text,                              -- 'Casa', 'Trabajo'
  calle        text not null,
  numero       text,
  piso_depto   text,
  barrio       text,
  referencia   text,                              -- 'portón negro, timbre roto'
  lat          numeric(10,7),
  lng          numeric(10,7),
  zona_id      uuid references zonas_delivery(id) on delete set null,
  es_default   boolean not null default false,
  verificada   boolean not null default false,
  creado_en    timestamptz not null default now()
);
create index on direcciones (cliente_id);

-- ============================================================
-- 5. WHATSAPP
-- ============================================================

create table wa_cuentas (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  proveedor          proveedor_wa not null default 'cloud_api',
  phone_number_id    text not null,
  waba_id            text,
  telefono_display   text not null,
  coexistencia       boolean not null default false,
  token_ref          text not null,               -- nombre de la env var / secret. NUNCA el token acá.
  verify_token       text not null,
  app_secret_ref     text,
  tier_mensajes      text,                        -- TIER_250, TIER_1K...
  calidad            text,                        -- GREEN / YELLOW / RED
  activo             boolean not null default true,
  unique (phone_number_id)
);

create table wa_plantillas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  nombre        text not null,                    -- snake_case, como en Meta
  idioma        text not null default 'es_AR',
  categoria     text not null,                    -- UTILITY / MARKETING / AUTHENTICATION
  estado        text not null default 'borrador', -- borrador/pendiente/aprobada/rechazada
  cuerpo        text not null,
  variables     jsonb,
  meta_id       text,
  unique (tenant_id, nombre, idioma)
);

create table conversaciones (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  cliente_id         uuid references clientes(id) on delete set null,
  wa_id              text not null,               -- número del cliente
  estado             estado_conv not null default 'idle',
  contexto           jsonb not null default '{}', -- carrito en construcción, último menú mostrado, etc.
  bot_pausado_hasta  timestamptz,                 -- takeover humano
  asignada_a         uuid,                        -- user_id del recepcionista
  ultimo_in_at       timestamptz,                 -- define la ventana de 24 h
  ultimo_out_at      timestamptz,
  reinicios          int not null default 0,
  creado_en          timestamptz not null default now(),
  unique (tenant_id, wa_id)
);
create index on conversaciones (tenant_id, estado);
create index on conversaciones (ultimo_in_at desc);

create table mensajes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  conversacion_id  uuid not null references conversaciones(id) on delete cascade,
  wa_message_id    text,                          -- idempotencia: Meta reintenta
  direccion        direccion_msg not null,
  origen           origen_msg not null,
  tipo             text not null,                 -- text,image,audio,location,interactive,template,document
  texto            text,
  payload          jsonb,
  transcripcion    text,                          -- audios transcriptos
  estado_envio     text,                          -- sent/delivered/read/failed
  error            text,
  creado_en        timestamptz not null default now(),
  unique (tenant_id, wa_message_id)
);
create index on mensajes (conversacion_id, creado_en desc);

-- Cola de salida: garantiza envío, reintentos y orden. No mandes directo desde el handler.
create table wa_outbox (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  conversacion_id  uuid references conversaciones(id) on delete cascade,
  destino          text not null,
  payload          jsonb not null,
  estado           text not null default 'pendiente',  -- pendiente/enviado/fallido
  intentos         int not null default 0,
  proximo_intento  timestamptz not null default now(),
  error            text,
  idempotency_key  text unique,
  creado_en        timestamptz not null default now()
);
create index on wa_outbox (estado, proximo_intento);

-- Derivaciones a humano: la "sección de ayuda" del panel
create table tickets (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  conversacion_id  uuid references conversaciones(id) on delete set null,
  pedido_id        uuid,
  motivo           text not null,                 -- reclamo, duda, fuera_de_alcance, pago_dudoso
  prioridad        int not null default 3,
  estado           text not null default 'abierto',
  resumen          text,                          -- lo escribe el bot: el recepcionista no relee 40 mensajes
  asignado_a       uuid,
  resuelto_en      timestamptz,
  creado_en        timestamptz not null default now()
);
create index on tickets (tenant_id, estado, prioridad);

-- ============================================================
-- 6. PEDIDOS
-- ============================================================

create table pedidos (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  numero             int not null,                -- correlativo POR TENANT
  cliente_id         uuid references clientes(id) on delete set null,
  conversacion_id    uuid references conversaciones(id) on delete set null,
  canal              canal_pedido not null,
  tipo               tipo_entrega not null,
  estado             estado_pedido not null default 'borrador',
  pago_estado        estado_pago not null default 'sin_pago',
  modo_pago          modo_pago,
  -- Montos (snapshot: el precio de hoy no cambia el pedido de ayer)
  subtotal           numeric(12,2) not null default 0,
  descuento          numeric(12,2) not null default 0,
  envio              numeric(12,2) not null default 0,
  total              numeric(12,2) not null default 0,
  sena_monto         numeric(12,2) not null default 0,
  pagado_monto       numeric(12,2) not null default 0,
  saldo_pendiente    numeric(12,2) generated always as (total - pagado_monto) stored,
  -- Entrega
  direccion_snapshot jsonb,                       -- congelada al confirmar
  zona_id            uuid references zonas_delivery(id) on delete set null,
  notas_cliente      text,
  notas_internas     text,
  -- Tiempos
  minutos_estimados  int,
  prometido_para     timestamptz,
  confirmado_en      timestamptz,
  en_cocina_en       timestamptz,
  listo_en           timestamptz,
  despachado_en      timestamptz,
  entregado_en       timestamptz,
  cancelado_en       timestamptz,
  motivo_cancelacion text,
  repartidor_id      uuid,
  token_publico      text unique default encode(gen_random_bytes(16),'hex'), -- link para cliente y repartidor
  creado_en          timestamptz not null default now(),
  unique (tenant_id, numero)
);
create index on pedidos (tenant_id, estado, creado_en desc);
create index on pedidos (tenant_id, creado_en desc);

-- Correlativo por tenant sin colisiones
create or replace function siguiente_numero_pedido() returns trigger as $$
begin
  select coalesce(max(numero),0)+1 into new.numero
  from pedidos where tenant_id = new.tenant_id;
  return new;
end $$ language plpgsql;

create trigger trg_numero_pedido before insert on pedidos
for each row when (new.numero is null) execute function siguiente_numero_pedido();

create table pedido_items (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  pedido_id        uuid not null references pedidos(id) on delete cascade,
  producto_id      uuid references productos(id) on delete set null,
  variante_id      uuid references variantes(id) on delete set null,
  estacion_id      uuid references estaciones(id) on delete set null,
  nombre_snapshot  text not null,                 -- 'Cheeseburger Doble'
  precio_unitario  numeric(12,2) not null,
  cantidad         int not null default 1 check (cantidad > 0),
  opciones         jsonb not null default '[]',   -- [{nombre, precio}]
  notas            text,                          -- 'sin cebolla, bien cocida'
  subtotal         numeric(12,2) not null,
  estado_cocina    text not null default 'pendiente' -- pendiente/en_preparacion/listo
);
create index on pedido_items (pedido_id);

-- Bitácora. Cuando el dueño diga "este pedido nunca llegó", acá está la verdad.
create table pedido_eventos (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  pedido_id  uuid not null references pedidos(id) on delete cascade,
  tipo       text not null,                       -- creado, confirmado, pago_aprobado, cocina, listo, despachado, entregado, cancelado, editado
  actor      text not null,                       -- 'bot', 'sistema', user_id, 'mercadopago'
  datos      jsonb,
  creado_en  timestamptz not null default now()
);
create index on pedido_eventos (pedido_id, creado_en);

-- ============================================================
-- 7. PAGOS
-- ============================================================

create table pagos (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  pedido_id           uuid not null references pedidos(id) on delete cascade,
  proveedor           proveedor_pago not null,
  tipo                tipo_pago not null,
  monto               numeric(12,2) not null,
  estado              estado_transaccion not null default 'pendiente',
  external_reference  text unique,                -- idempotencia contra MP
  mp_preference_id    text,
  mp_payment_id       text unique,
  init_point          text,
  expira_en           timestamptz,
  cobrado_por         uuid,                       -- repartidor que cobró en mano
  raw                 jsonb,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);
create index on pagos (pedido_id);
create index on pagos (tenant_id, estado);

-- Comprobantes por foto → SIEMPRE cola manual, nunca auto-aprobación
create table comprobantes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  pedido_id      uuid references pedidos(id) on delete set null,
  conversacion_id uuid references conversaciones(id) on delete set null,
  media_url      text not null,
  ocr_monto      numeric(12,2),                   -- extraído por el LLM, solo para pre-llenar
  ocr_fecha      timestamptz,
  ocr_destino    text,
  ocr_raw        jsonb,
  estado         text not null default 'pendiente', -- pendiente/aprobado/rechazado
  revisado_por   uuid,
  revisado_en    timestamptz,
  motivo_rechazo text,
  creado_en      timestamptz not null default now()
);
create index on comprobantes (tenant_id, estado);

-- ============================================================
-- 8. DELIVERY
-- ============================================================

create table repartidores (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id   uuid,
  nombre    text not null,
  telefono  text,
  activo    boolean not null default true
);

create table cierres_caja (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  repartidor_id   uuid references repartidores(id) on delete set null,
  fecha           date not null,
  efectivo_esperado numeric(12,2) not null default 0,
  efectivo_rendido  numeric(12,2),
  diferencia      numeric(12,2),
  cerrado_en      timestamptz,
  notas           text,
  unique (tenant_id, repartidor_id, fecha)
);

-- ============================================================
-- 9. INFRAESTRUCTURA
-- ============================================================

-- Idempotencia de webhooks entrantes (Meta y MP reintentan varias veces)
create table webhook_events (
  id           uuid primary key default gen_random_uuid(),
  proveedor    text not null,                     -- 'meta','mercadopago'
  external_id  text not null,
  payload      jsonb not null,
  procesado_en timestamptz,
  error        text,
  creado_en    timestamptz not null default now(),
  unique (proveedor, external_id)
);

-- Costo y debug del LLM
create table bot_runs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  conversacion_id  uuid references conversaciones(id) on delete cascade,
  modelo           text not null,
  intent           text,
  estado_antes     estado_conv,
  estado_despues   estado_conv,
  tools_usadas     jsonb,
  tokens_in        int,
  tokens_out       int,
  tokens_cache     int,
  latencia_ms      int,
  costo_usd        numeric(10,6),
  error            text,
  creado_en        timestamptz not null default now()
);
create index on bot_runs (tenant_id, creado_en desc);

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references tenants(id) on delete cascade,
  user_id    uuid,
  accion     text not null,
  entidad    text,
  entidad_id uuid,
  antes      jsonb,
  despues    jsonb,
  creado_en  timestamptz not null default now()
);

-- ============================================================
-- 10. RLS
-- ============================================================

create or replace function mis_tenants() returns setof uuid as $$
  select tenant_id from memberships
  where user_id = auth.uid() and activo = true;
$$ language sql stable security definer;

do $$
declare t text;
begin
  foreach t in array array[
    'tenant_config','memberships','horarios','dias_especiales','zonas_delivery',
    'estaciones','categorias','productos','variantes','grupos_opciones','opciones',
    'promociones','clientes','direcciones','wa_cuentas','wa_plantillas',
    'conversaciones','mensajes','wa_outbox','tickets','pedidos','pedido_items',
    'pedido_eventos','pagos','comprobantes','repartidores','cierres_caja','bot_runs','audit_log'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format($f$
      create policy tenant_isolation on %I
      for all to authenticated
      using (tenant_id in (select mis_tenants()))
      with check (tenant_id in (select mis_tenants()));
    $f$, t);
  end loop;
end $$;

alter table tenants enable row level security;
create policy tenant_self on tenants for select to authenticated
  using (id in (select mis_tenants()));

-- El bot, los webhooks y los crons corren con service_role, que saltea RLS.
-- NUNCA exponer la service_role key al browser.

-- ============================================================
-- 11. SEED MOLA
-- ============================================================

insert into tenants (slug, nombre) values ('mola','Mola Burgers');

insert into tenant_config (tenant_id, usa_sena, sena_porcentaje, exige_pago_online, mensaje_bienvenida)
select id, true, 50, true,
 'Hola! Soy el asistente de Mola 🍔 Te tomo el pedido por acá o, si preferís, te paso el link del menú web.'
from tenants where slug='mola';

insert into estaciones (tenant_id, nombre, orden)
select t.id, e.nombre, e.orden
from tenants t, (values ('plancha',1),('freidora',2),('armado',3),('bebidas',4)) as e(nombre,orden)
where t.slug='mola';

-- El menú real lo carga Juancruz desde el panel, no a mano acá.