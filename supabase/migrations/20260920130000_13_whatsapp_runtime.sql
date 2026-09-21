-- ============================================================
-- 13 · RUNTIME DE WHATSAPP
--
-- Columnas de estado para el buffer anti-ráfaga y el control de
-- concurrencia, más las funciones que hacen atómico lo que no puede
-- resolverse con dos queries seguidas.
--
-- Criterio de diseño: todo lo que tenga una condición de carrera vive
-- acá adentro como función SQL, no en TypeScript. Un UPDATE
-- condicional con GET DIAGNOSTICS es atómico; un SELECT seguido de un
-- UPDATE desde Node no lo es, y con dos instancias serverless
-- corriendo a la vez eso se rompe.
-- ============================================================

-- ---------- CONVERSACIONES: buffer y concurrencia ----------
alter table public.conversaciones
  -- Id del mensaje diferido de QStash que va a disparar el turno.
  -- Se cancela y se vuelve a crear en cada mensaje de la ráfaga.
  add column qstash_schedule_id text,
  -- Cuándo llegó el primer mensaje de la tanda todavía sin procesar.
  -- Es lo que permite cortar el reinicio infinito del timer.
  add column primer_mensaje_sin_procesar_en timestamptz,
  -- Lock de procesamiento. Null = libre.
  add column procesando_desde timestamptz,
  add column intentos_fallidos int not null default 0 check (intentos_fallidos >= 0);

create index conversaciones_procesando_idx on public.conversaciones (procesando_desde)
  where procesando_desde is not null;

-- ---------- MENSAJES: qué falta procesar ----------
alter table public.mensajes
  add column procesado boolean not null default false;

-- Los mensajes entrantes ya procesados no se vuelven a mirar nunca:
-- el índice parcial mantiene chico el que sí se consulta en cada turno.
create index mensajes_sin_procesar_idx
  on public.mensajes (conversacion_id, creado_en)
  where procesado = false;

-- ---------- OUTBOX: estado de despacho ----------
-- 'enviando' es el estado intermedio entre que el cron reclama la fila
-- y que la API de WhatsApp contesta. Sin él, dos corridas del cron
-- solapadas mandan el mismo mensaje dos veces.
alter table public.wa_outbox
  drop constraint wa_outbox_estado_check;

alter table public.wa_outbox
  add constraint wa_outbox_estado_check
  check (estado in ('pendiente','enviando','enviado','fallido'));

alter table public.wa_outbox
  add column reclamado_en timestamptz,
  add column enviado_en   timestamptz,
  add column wa_message_id text;

create index wa_outbox_reclamados_idx on public.wa_outbox (reclamado_en)
  where estado = 'enviando';

-- ---------- LÍMITE DE 1 MENSAJE CADA 6 SEGUNDOS POR DESTINATARIO ----------
create table public.wa_envios_recientes (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  destino         text not null,
  ultimo_envio_en timestamptz not null default now(),
  primary key (tenant_id, destino)
);

alter table public.wa_envios_recientes enable row level security;

create policy tenant_isolation on public.wa_envios_recientes
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

-- ============================================================
-- FUNCIONES
-- ============================================================

-- ---------- LOCK DE CONVERSACIÓN ----------
-- Devuelve true sólo si ESTA llamada tomó el lock.
--
-- Dos llamadas simultáneas: la primera hace el UPDATE y se queda con
-- el row lock; la segunda se bloquea, y cuando la primera commitea
-- vuelve a evaluar el WHERE contra la fila NUEVA — donde
-- procesando_desde ya es reciente — así que afecta 0 filas y devuelve
-- false. Esa reevaluación es lo que hace que esto sea correcto y no
-- una carrera con suerte.
create or replace function public.tomar_lock_conversacion(
  p_conversacion_id uuid,
  p_tenant_id       uuid,
  p_timeout_segundos int default 30
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas int;
begin
  update public.conversaciones c
     set procesando_desde = now()
   where c.id = p_conversacion_id
     and c.tenant_id = p_tenant_id
     and (
       c.procesando_desde is null
       -- Lock vencido: el proceso que lo tomó murió sin liberarlo.
       or c.procesando_desde < now() - make_interval(secs => p_timeout_segundos)
     );

  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$fn$;

revoke execute on function public.tomar_lock_conversacion(uuid, uuid, int) from public, anon, authenticated;
grant  execute on function public.tomar_lock_conversacion(uuid, uuid, int) to service_role;

create or replace function public.liberar_lock_conversacion(
  p_conversacion_id uuid,
  p_tenant_id       uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas int;
begin
  update public.conversaciones c
     set procesando_desde = null
   where c.id = p_conversacion_id
     and c.tenant_id = p_tenant_id;

  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$fn$;

revoke execute on function public.liberar_lock_conversacion(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.liberar_lock_conversacion(uuid, uuid) to service_role;

-- ---------- PLANIFICACIÓN DEL TURNO (buffer anti-ráfaga) ----------
-- Decide si hay que reprogramar el timer y devuelve el schedule viejo
-- para que la app lo cancele en QStash.
--
-- El UPDATE toma el row lock de la conversación, así que dos mensajes
-- que llegan en el mismo milisegundo se serializan: el segundo ve el
-- primer_mensaje_sin_procesar_en que fijó el primero.
create or replace function public.planificar_turno(
  p_conversacion_id uuid,
  p_tenant_id       uuid,
  p_ventana_max_segundos int default 20
)
returns table (
  debe_reprogramar  boolean,
  schedule_anterior text,
  primer_mensaje    timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_primero  timestamptz;
  v_schedule text;
  v_filas    int;
begin
  update public.conversaciones c
     set primer_mensaje_sin_procesar_en = coalesce(c.primer_mensaje_sin_procesar_en, now())
   where c.id = p_conversacion_id
     and c.tenant_id = p_tenant_id
  returning c.primer_mensaje_sin_procesar_en, c.qstash_schedule_id
       into v_primero, v_schedule;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'planificar_turno: la conversacion % no existe en el tenant %',
      p_conversacion_id, p_tenant_id
      using errcode = 'no_data_found';
  end if;

  debe_reprogramar :=
    -- Sin schedule vivo hay que crear uno SIEMPRE, aunque la ventana
    -- ya se haya pasado: si no, el turno no se dispara nunca y el
    -- cliente se queda sin respuesta. Este caso es el que convierte
    -- la regla de los 20 segundos en algo seguro.
    v_schedule is null
    -- Dentro de la ventana: se reinicia el timer.
    or (now() - v_primero) < make_interval(secs => p_ventana_max_segundos);

  schedule_anterior := v_schedule;
  primer_mensaje    := v_primero;
  return next;
end;
$fn$;

revoke execute on function public.planificar_turno(uuid, uuid, int) from public, anon, authenticated;
grant  execute on function public.planificar_turno(uuid, uuid, int) to service_role;

create or replace function public.guardar_schedule_conversacion(
  p_conversacion_id uuid,
  p_tenant_id       uuid,
  p_schedule_id     text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas int;
begin
  update public.conversaciones c
     set qstash_schedule_id = p_schedule_id
   where c.id = p_conversacion_id
     and c.tenant_id = p_tenant_id;

  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$fn$;

revoke execute on function public.guardar_schedule_conversacion(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.guardar_schedule_conversacion(uuid, uuid, text) to service_role;

-- ---------- CIERRE DEL TURNO ----------
-- Marca los mensajes como procesados y limpia el estado de la tanda.
-- Devuelve cuántos mensajes marcó: cero es un error para el que llama.
create or replace function public.cerrar_turno(
  p_conversacion_id uuid,
  p_tenant_id       uuid,
  p_mensaje_ids     uuid[]
)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas int;
begin
  update public.mensajes m
     set procesado = true
   where m.conversacion_id = p_conversacion_id
     and m.tenant_id = p_tenant_id
     and m.id = any(p_mensaje_ids)
     and m.procesado = false;

  get diagnostics v_filas = row_count;

  update public.conversaciones c
     set primer_mensaje_sin_procesar_en = null,
         qstash_schedule_id             = null,
         intentos_fallidos              = 0
   where c.id = p_conversacion_id
     and c.tenant_id = p_tenant_id;

  return v_filas;
end;
$fn$;

revoke execute on function public.cerrar_turno(uuid, uuid, uuid[]) from public, anon, authenticated;
grant  execute on function public.cerrar_turno(uuid, uuid, uuid[]) to service_role;

-- ---------- FALLAS DE PROCESAMIENTO ----------
-- Incrementa el contador y devuelve el valor nuevo, en una sola
-- operación atómica: leer-y-después-escribir perdería incrementos.
create or replace function public.registrar_intento_fallido(
  p_conversacion_id uuid,
  p_tenant_id       uuid
)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_intentos int;
begin
  update public.conversaciones c
     set intentos_fallidos = c.intentos_fallidos + 1,
         qstash_schedule_id = null
   where c.id = p_conversacion_id
     and c.tenant_id = p_tenant_id
  returning c.intentos_fallidos into v_intentos;

  if v_intentos is null then
    raise exception 'registrar_intento_fallido: conversacion % inexistente en tenant %',
      p_conversacion_id, p_tenant_id
      using errcode = 'no_data_found';
  end if;

  return v_intentos;
end;
$fn$;

revoke execute on function public.registrar_intento_fallido(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.registrar_intento_fallido(uuid, uuid) to service_role;

-- Se agotaron los reintentos: pausa el bot, resetea el contador y
-- deja un ticket para que un humano se entere. Todo junto, porque a
-- medias deja la conversación en un estado peor que el error.
create or replace function public.rendirse_y_derivar(
  p_conversacion_id uuid,
  p_tenant_id       uuid,
  p_resumen         text,
  p_minutos_pausa   int default 15
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ticket_id uuid;
  v_filas     int;
begin
  update public.conversaciones c
     set bot_pausado_hasta  = now() + make_interval(mins => p_minutos_pausa),
         intentos_fallidos  = 0,
         qstash_schedule_id = null,
         procesando_desde   = null
   where c.id = p_conversacion_id
     and c.tenant_id = p_tenant_id;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'rendirse_y_derivar: conversacion % inexistente en tenant %',
      p_conversacion_id, p_tenant_id
      using errcode = 'no_data_found';
  end if;

  insert into public.tickets (tenant_id, conversacion_id, motivo, prioridad, estado, resumen)
  values (p_tenant_id, p_conversacion_id, 'error_tecnico', 1, 'abierto', p_resumen)
  returning id into v_ticket_id;

  return v_ticket_id;
end;
$fn$;

revoke execute on function public.rendirse_y_derivar(uuid, uuid, text, int) from public, anon, authenticated;
grant  execute on function public.rendirse_y_derivar(uuid, uuid, text, int) to service_role;

-- ---------- TAKEOVER HUMANO (smb_message_echoes) ----------
create or replace function public.pausar_bot(
  p_conversacion_id uuid,
  p_tenant_id       uuid,
  p_minutos         int default 30
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas int;
begin
  update public.conversaciones c
     set bot_pausado_hasta = greatest(
           coalesce(c.bot_pausado_hasta, now()),
           now() + make_interval(mins => p_minutos)
         )
   where c.id = p_conversacion_id
     and c.tenant_id = p_tenant_id;

  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$fn$;

revoke execute on function public.pausar_bot(uuid, uuid, int) from public, anon, authenticated;
grant  execute on function public.pausar_bot(uuid, uuid, int) to service_role;

-- ---------- OUTBOX: RECLAMO ATÓMICO ----------
-- FOR UPDATE SKIP LOCKED es lo que permite que dos corridas del cron
-- se solapen sin pisarse: cada una se lleva filas distintas.
-- El intento se cuenta al RECLAMAR, no al fallar, para que un proceso
-- que muere a mitad de camino no reintente para siempre.
create or replace function public.reclamar_outbox(
  p_limite          int default 20,
  p_segundos_colgado int default 120
)
returns setof public.wa_outbox
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return query
  update public.wa_outbox o
     set estado       = 'enviando',
         reclamado_en = now(),
         intentos     = o.intentos + 1
   where o.id in (
     select c.id
     from public.wa_outbox c
     where (c.estado = 'pendiente' and c.proximo_intento <= now())
        -- Filas que quedaron colgadas en 'enviando' porque el proceso
        -- murió entre el reclamo y la respuesta de la API.
        or (c.estado = 'enviando' and c.reclamado_en < now() - make_interval(secs => p_segundos_colgado))
     order by c.proximo_intento
     for update skip locked
     limit p_limite
   )
  returning o.*;
end;
$fn$;

revoke execute on function public.reclamar_outbox(int, int) from public, anon, authenticated;
grant  execute on function public.reclamar_outbox(int, int) to service_role;

create or replace function public.marcar_outbox_enviado(
  p_id            uuid,
  p_tenant_id     uuid,
  p_wa_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas int;
begin
  update public.wa_outbox o
     set estado        = 'enviado',
         enviado_en    = now(),
         wa_message_id = p_wa_message_id,
         error         = null
   where o.id = p_id
     and o.tenant_id = p_tenant_id;

  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$fn$;

revoke execute on function public.marcar_outbox_enviado(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.marcar_outbox_enviado(uuid, uuid, text) to service_role;

-- Reprograma con backoff, o marca fallido si se agotaron los intentos.
create or replace function public.marcar_outbox_fallido(
  p_id          uuid,
  p_tenant_id   uuid,
  p_error       text,
  p_max_intentos int default 5,
  p_segundos_espera int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_intentos int;
  v_estado   text;
  v_espera   int;
begin
  select o.intentos into v_intentos
  from public.wa_outbox o
  where o.id = p_id and o.tenant_id = p_tenant_id;

  if v_intentos is null then
    raise exception 'marcar_outbox_fallido: fila % inexistente en tenant %', p_id, p_tenant_id
      using errcode = 'no_data_found';
  end if;

  if v_intentos >= p_max_intentos then
    v_estado := 'fallido';
    v_espera := 0;
  else
    v_estado := 'pendiente';
    -- Backoff exponencial: 2, 4, 8, 16... segundos. Si el que llama
    -- pide una espera puntual (rate limit del destinatario), gana esa.
    v_espera := coalesce(p_segundos_espera, power(2, v_intentos)::int);
  end if;

  update public.wa_outbox o
     set estado          = v_estado,
         error           = p_error,
         proximo_intento = now() + make_interval(secs => v_espera)
   where o.id = p_id
     and o.tenant_id = p_tenant_id;

  return v_estado;
end;
$fn$;

revoke execute on function public.marcar_outbox_fallido(uuid, uuid, text, int, int) from public, anon, authenticated;
grant  execute on function public.marcar_outbox_fallido(uuid, uuid, text, int, int) to service_role;

-- Devuelve una fila a la cola SIN gastarle un intento.
-- Es para el rate limit de 6 segundos: que el destinatario todavía no
-- pueda recibir no es una falla del envío, y contarlo como tal haría
-- que un cliente que escribe seguido agote los reintentos y termine
-- con mensajes marcados 'fallido' que nunca se intentaron de verdad.
create or replace function public.posponer_outbox(
  p_id       uuid,
  p_tenant_id uuid,
  p_segundos int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas int;
begin
  update public.wa_outbox o
     set estado          = 'pendiente',
         proximo_intento = now() + make_interval(secs => p_segundos),
         -- Deshace el incremento que hizo reclamar_outbox.
         intentos        = greatest(0, o.intentos - 1)
   where o.id = p_id
     and o.tenant_id = p_tenant_id;

  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$fn$;

revoke execute on function public.posponer_outbox(uuid, uuid, int) from public, anon, authenticated;
grant  execute on function public.posponer_outbox(uuid, uuid, int) to service_role;

-- ---------- RESERVA DEL SLOT DE 6 SEGUNDOS ----------
-- Atómico: el ON CONFLICT DO UPDATE ... WHERE toma el row lock, así
-- que dos envíos simultáneos al mismo número no pueden reservar los
-- dos. El que pierde recibe cuántos segundos tiene que esperar.
create or replace function public.reservar_envio_destino(
  p_tenant_id uuid,
  p_destino   text,
  p_segundos  int default 6
)
returns table (
  permitido        boolean,
  esperar_segundos int
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas   int;
  v_ultimo  timestamptz;
begin
  insert into public.wa_envios_recientes as e (tenant_id, destino, ultimo_envio_en)
  values (p_tenant_id, p_destino, now())
  on conflict (tenant_id, destino) do update
     set ultimo_envio_en = now()
   where e.ultimo_envio_en <= now() - make_interval(secs => p_segundos);

  get diagnostics v_filas = row_count;

  if v_filas = 1 then
    permitido := true;
    esperar_segundos := 0;
    return next;
    return;
  end if;

  select e.ultimo_envio_en into v_ultimo
  from public.wa_envios_recientes e
  where e.tenant_id = p_tenant_id and e.destino = p_destino;

  permitido := false;
  esperar_segundos := greatest(
    1,
    ceil(extract(epoch from (v_ultimo + make_interval(secs => p_segundos)) - now()))::int
  );
  return next;
end;
$fn$;

revoke execute on function public.reservar_envio_destino(uuid, text, int) from public, anon, authenticated;
grant  execute on function public.reservar_envio_destino(uuid, text, int) to service_role;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
do $verificacion$
declare
  v_faltan_rls     text;
  v_funcs_abiertas text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_faltan_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if v_faltan_rls is not null then
    raise exception 'tablas sin RLS: %', v_faltan_rls;
  end if;

  select string_agg(p.proname, ', ' order by p.proname)
    into v_funcs_abiertas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE');

  if v_funcs_abiertas is not null then
    raise exception 'funciones con EXECUTE para PUBLIC: %', v_funcs_abiertas;
  end if;

  raise notice 'runtime de whatsapp OK';
end;
$verificacion$;
