import type { PostgrestError } from '@supabase/supabase-js'
import { clienteServicio, type ClienteRushFood } from '@/lib/db/client'
import { ErrorDB } from '@/lib/db/queries/_comun'
import type { Conversaciones, Json, WaOutbox } from '@/lib/types/db'
import type { MensajeNormalizado } from './entrada'

/** Código de violación de unique de Postgres. */
const UNIQUE_VIOLADO = '23505'

const esDuplicado = (e: PostgrestError | null): boolean => e?.code === UNIQUE_VIOLADO

export interface CuentaResuelta {
  tenantId: string
  cuentaId: string
}

export interface MensajePendiente {
  id: string
  tipo: string
  texto: string | null
  payload: Json | null
  creadoEn: string
}

export interface PlanTurno {
  debeReprogramar: boolean
  scheduleAnterior: string | null
  primerMensaje: string
}

export interface ConfigConversacion {
  segundosBuffer: number
  botActivo: boolean
  modoContingencia: boolean
}

export interface ReservaEnvio {
  permitido: boolean
  esperarSegundos: number
}

export interface EncolarSalida {
  tenantId: string
  conversacionId: string | null
  destino: string
  payload: Json
  idempotencyKey: string
}

/**
 * Todo el acceso a datos de la capa de WhatsApp.
 *
 * Existe como interfaz por una razón concreta: los tests corren el
 * webhook completo sobre un Postgres real (PGlite) sin PostgREST. Las
 * dos implementaciones llaman a las MISMAS funciones SQL de la
 * migración 13, así que la lógica con condiciones de carrera —locks,
 * reclamo del outbox, rate limit— se testea de verdad, no una imitación.
 */
export interface RepoWhatsApp {
  /** false si el evento ya estaba registrado (Meta reintentó). */
  registrarEventoWebhook(proveedor: string, externalId: string, payload: Json): Promise<boolean>
  marcarEventoProcesado(proveedor: string, externalId: string, error?: string): Promise<void>

  resolverCuenta(phoneNumberId: string): Promise<CuentaResuelta | null>
  obtenerOCrearConversacion(tenantId: string, waId: string): Promise<Conversaciones>
  conversacionPorId(conversacionId: string): Promise<Conversaciones | null>

  /** duplicado=true si el wa_message_id ya estaba guardado. */
  guardarMensaje(
    tenantId: string,
    conversacionId: string,
    m: MensajeNormalizado,
  ): Promise<{ id: string; duplicado: boolean }>

  registrarEntrada(tenantId: string, conversacionId: string, cuando: Date): Promise<void>

  configConversacion(tenantId: string): Promise<ConfigConversacion>

  planificarTurno(
    conversacionId: string,
    tenantId: string,
    ventanaMaxSegundos: number,
  ): Promise<PlanTurno>
  guardarSchedule(conversacionId: string, tenantId: string, scheduleId: string | null): Promise<void>

  tomarLock(conversacionId: string, tenantId: string, timeoutSegundos: number): Promise<boolean>
  liberarLock(conversacionId: string, tenantId: string): Promise<void>

  mensajesSinProcesar(conversacionId: string, tenantId: string): Promise<MensajePendiente[]>
  cerrarTurno(conversacionId: string, tenantId: string, ids: string[]): Promise<number>

  registrarIntentoFallido(conversacionId: string, tenantId: string): Promise<number>
  rendirseYDerivar(
    conversacionId: string,
    tenantId: string,
    resumen: string,
    minutosPausa: number,
  ): Promise<string>
  pausarBot(conversacionId: string, tenantId: string, minutos: number): Promise<void>

  encolarSalida(e: EncolarSalida): Promise<{ id: string; duplicado: boolean }>
  reclamarOutbox(limite: number): Promise<WaOutbox[]>
  /** Devuelve una fila a la cola sin contarle el intento. */
  posponerOutbox(id: string, tenantId: string, segundos: number): Promise<void>
  marcarOutboxEnviado(id: string, tenantId: string, waMessageId: string): Promise<void>
  marcarOutboxFallido(
    id: string,
    tenantId: string,
    error: string,
    maxIntentos: number,
    esperaSegundos?: number | null,
  ): Promise<string>
  reservarEnvio(tenantId: string, destino: string, segundos: number): Promise<ReservaEnvio>
}

// ---------- implementación sobre Supabase / PostgREST ----------

export class RepoSupabase implements RepoWhatsApp {
  constructor(private readonly db: ClienteRushFood = clienteServicio()) {}

  private fallo(ctx: string, error: PostgrestError | null): never {
    throw new ErrorDB(ctx, error)
  }

  async registrarEventoWebhook(
    proveedor: string,
    externalId: string,
    payload: Json,
  ): Promise<boolean> {
    const { error } = await this.db
      .from('webhook_events')
      .insert({ proveedor, external_id: externalId, payload })

    // El unique (proveedor, external_id) ES el mecanismo de
    // idempotencia: que el insert falle por duplicado no es un error,
    // es la respuesta "esto ya lo vimos".
    if (esDuplicado(error)) return false
    if (error) this.fallo(`registrarEventoWebhook(${externalId})`, error)
    return true
  }

  async marcarEventoProcesado(
    proveedor: string,
    externalId: string,
    errorTexto?: string,
  ): Promise<void> {
    const { error } = await this.db
      .from('webhook_events')
      .update({ procesado_en: new Date().toISOString(), error: errorTexto ?? null })
      .eq('proveedor', proveedor)
      .eq('external_id', externalId)

    if (error) this.fallo(`marcarEventoProcesado(${externalId})`, error)
  }

  async resolverCuenta(phoneNumberId: string): Promise<CuentaResuelta | null> {
    const { data, error } = await this.db
      .from('wa_cuentas')
      .select('id, tenant_id')
      .eq('phone_number_id', phoneNumberId)
      .eq('activo', true)
      .maybeSingle()

    if (error) this.fallo(`resolverCuenta(${phoneNumberId})`, error)
    return data ? { tenantId: data.tenant_id, cuentaId: data.id } : null
  }

  async obtenerOCrearConversacion(tenantId: string, waId: string): Promise<Conversaciones> {
    // upsert sólo toca las columnas que se pasan, así que una
    // conversación existente no pierde su estado ni su contexto.
    const { data, error } = await this.db
      .from('conversaciones')
      .upsert({ tenant_id: tenantId, wa_id: waId }, { onConflict: 'tenant_id,wa_id' })
      .select()
      .single()

    if (error || !data) this.fallo(`obtenerOCrearConversacion(${tenantId}, ${waId})`, error)
    return data
  }

  async conversacionPorId(conversacionId: string): Promise<Conversaciones | null> {
    const { data, error } = await this.db
      .from('conversaciones')
      .select()
      .eq('id', conversacionId)
      .maybeSingle()

    if (error) this.fallo(`conversacionPorId(${conversacionId})`, error)
    return data
  }

  async guardarMensaje(
    tenantId: string,
    conversacionId: string,
    m: MensajeNormalizado,
  ): Promise<{ id: string; duplicado: boolean }> {
    const fila = {
      tenant_id: tenantId,
      conversacion_id: conversacionId,
      wa_message_id: m.waMessageId,
      direccion: m.direccion,
      origen: m.origen,
      tipo: m.tipo,
      texto: m.texto,
      payload: m.crudo as Json,
      creado_en: m.recibidoEn.toISOString(),
      // Un echo de agente no es un turno a procesar: nace procesado.
      procesado: m.esEcho,
    }

    const { data, error } = await this.db.from('mensajes').insert(fila).select('id').single()

    if (esDuplicado(error)) {
      const { data: existente, error: errorBusqueda } = await this.db
        .from('mensajes')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('wa_message_id', m.waMessageId)
        .maybeSingle()

      if (errorBusqueda) this.fallo(`guardarMensaje.duplicado(${m.waMessageId})`, errorBusqueda)
      if (!existente) this.fallo(`guardarMensaje: duplicado sin fila (${m.waMessageId})`, null)
      return { id: existente.id, duplicado: true }
    }

    if (error || !data) this.fallo(`guardarMensaje(${m.waMessageId})`, error)
    return { id: data.id, duplicado: false }
  }

  async registrarEntrada(tenantId: string, conversacionId: string, cuando: Date): Promise<void> {
    const { data, error } = await this.db
      .from('conversaciones')
      .update({ ultimo_in_at: cuando.toISOString() })
      .eq('id', conversacionId)
      .eq('tenant_id', tenantId)
      .select('id')

    if (error) this.fallo(`registrarEntrada(${conversacionId})`, error)
    if (!data || data.length === 0) {
      this.fallo(`registrarEntrada(${conversacionId}): afectó 0 filas`, null)
    }
  }

  async configConversacion(tenantId: string): Promise<ConfigConversacion> {
    const { data, error } = await this.db
      .from('tenant_config')
      .select('segundos_buffer_mensajes, bot_activo, modo_contingencia')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (error) this.fallo(`configConversacion(${tenantId})`, error)

    // Defaults que replican los de la tabla: un tenant sin config
    // todavía no puede quedarse sin atender.
    return {
      segundosBuffer: data?.segundos_buffer_mensajes ?? 6,
      botActivo: data?.bot_activo ?? true,
      modoContingencia: data?.modo_contingencia ?? false,
    }
  }

  async planificarTurno(
    conversacionId: string,
    tenantId: string,
    ventanaMaxSegundos: number,
  ): Promise<PlanTurno> {
    const { data, error } = await this.db.rpc('planificar_turno', {
      p_conversacion_id: conversacionId,
      p_tenant_id: tenantId,
      p_ventana_max_segundos: ventanaMaxSegundos,
    })

    if (error) this.fallo(`planificarTurno(${conversacionId})`, error)

    const fila = (data as Array<Record<string, unknown>> | null)?.[0]
    if (!fila) this.fallo(`planificarTurno(${conversacionId}): sin resultado`, null)

    return {
      debeReprogramar: Boolean(fila.debe_reprogramar),
      scheduleAnterior: (fila.schedule_anterior as string | null) ?? null,
      primerMensaje: String(fila.primer_mensaje),
    }
  }

  async guardarSchedule(
    conversacionId: string,
    tenantId: string,
    scheduleId: string | null,
  ): Promise<void> {
    const { data, error } = await this.db.rpc('guardar_schedule_conversacion', {
      p_conversacion_id: conversacionId,
      p_tenant_id: tenantId,
      p_schedule_id: scheduleId as string,
    })

    if (error) this.fallo(`guardarSchedule(${conversacionId})`, error)
    if (data !== true) this.fallo(`guardarSchedule(${conversacionId}): afectó 0 filas`, null)
  }

  async tomarLock(
    conversacionId: string,
    tenantId: string,
    timeoutSegundos: number,
  ): Promise<boolean> {
    const { data, error } = await this.db.rpc('tomar_lock_conversacion', {
      p_conversacion_id: conversacionId,
      p_tenant_id: tenantId,
      p_timeout_segundos: timeoutSegundos,
    })

    if (error) this.fallo(`tomarLock(${conversacionId})`, error)
    return data === true
  }

  async liberarLock(conversacionId: string, tenantId: string): Promise<void> {
    const { error } = await this.db.rpc('liberar_lock_conversacion', {
      p_conversacion_id: conversacionId,
      p_tenant_id: tenantId,
    })

    if (error) this.fallo(`liberarLock(${conversacionId})`, error)
  }

  async mensajesSinProcesar(
    conversacionId: string,
    tenantId: string,
  ): Promise<MensajePendiente[]> {
    const { data, error } = await this.db
      .from('mensajes')
      .select('id, tipo, texto, payload, creado_en')
      .eq('conversacion_id', conversacionId)
      .eq('tenant_id', tenantId)
      .eq('procesado', false)
      .eq('direccion', 'in')
      .order('creado_en', { ascending: true })

    if (error) this.fallo(`mensajesSinProcesar(${conversacionId})`, error)

    return (data ?? []).map((m) => ({
      id: m.id,
      tipo: m.tipo,
      texto: m.texto,
      payload: m.payload,
      creadoEn: m.creado_en,
    }))
  }

  async cerrarTurno(conversacionId: string, tenantId: string, ids: string[]): Promise<number> {
    const { data, error } = await this.db.rpc('cerrar_turno', {
      p_conversacion_id: conversacionId,
      p_tenant_id: tenantId,
      p_mensaje_ids: ids,
    })

    if (error) this.fallo(`cerrarTurno(${conversacionId})`, error)
    return Number(data ?? 0)
  }

  async registrarIntentoFallido(conversacionId: string, tenantId: string): Promise<number> {
    const { data, error } = await this.db.rpc('registrar_intento_fallido', {
      p_conversacion_id: conversacionId,
      p_tenant_id: tenantId,
    })

    if (error) this.fallo(`registrarIntentoFallido(${conversacionId})`, error)
    return Number(data ?? 0)
  }

  async rendirseYDerivar(
    conversacionId: string,
    tenantId: string,
    resumen: string,
    minutosPausa: number,
  ): Promise<string> {
    const { data, error } = await this.db.rpc('rendirse_y_derivar', {
      p_conversacion_id: conversacionId,
      p_tenant_id: tenantId,
      p_resumen: resumen,
      p_minutos_pausa: minutosPausa,
    })

    if (error) this.fallo(`rendirseYDerivar(${conversacionId})`, error)
    return String(data)
  }

  async pausarBot(conversacionId: string, tenantId: string, minutos: number): Promise<void> {
    const { data, error } = await this.db.rpc('pausar_bot', {
      p_conversacion_id: conversacionId,
      p_tenant_id: tenantId,
      p_minutos: minutos,
    })

    if (error) this.fallo(`pausarBot(${conversacionId})`, error)
    if (data !== true) this.fallo(`pausarBot(${conversacionId}): afectó 0 filas`, null)
  }

  async encolarSalida(e: EncolarSalida): Promise<{ id: string; duplicado: boolean }> {
    const { data, error } = await this.db
      .from('wa_outbox')
      .insert({
        tenant_id: e.tenantId,
        conversacion_id: e.conversacionId,
        destino: e.destino,
        payload: e.payload,
        idempotency_key: e.idempotencyKey,
      })
      .select('id')
      .single()

    if (esDuplicado(error)) {
      const { data: existente, error: errorBusqueda } = await this.db
        .from('wa_outbox')
        .select('id')
        .eq('idempotency_key', e.idempotencyKey)
        .maybeSingle()

      if (errorBusqueda) this.fallo(`encolarSalida.duplicado(${e.idempotencyKey})`, errorBusqueda)
      if (!existente) this.fallo(`encolarSalida: duplicado sin fila`, null)
      return { id: existente.id, duplicado: true }
    }

    if (error || !data) this.fallo(`encolarSalida(${e.idempotencyKey})`, error)
    return { id: data.id, duplicado: false }
  }

  async reclamarOutbox(limite: number): Promise<WaOutbox[]> {
    const { data, error } = await this.db.rpc('reclamar_outbox', { p_limite: limite })

    if (error) this.fallo('reclamarOutbox', error)
    return (data ?? []) as WaOutbox[]
  }

  async posponerOutbox(id: string, tenantId: string, segundos: number): Promise<void> {
    const { data, error } = await this.db.rpc('posponer_outbox', {
      p_id: id,
      p_tenant_id: tenantId,
      p_segundos: segundos,
    })

    if (error) this.fallo(`posponerOutbox(${id})`, error)
    if (data !== true) this.fallo(`posponerOutbox(${id}): afectó 0 filas`, null)
  }

  async marcarOutboxEnviado(id: string, tenantId: string, waMessageId: string): Promise<void> {
    const { data, error } = await this.db.rpc('marcar_outbox_enviado', {
      p_id: id,
      p_tenant_id: tenantId,
      p_wa_message_id: waMessageId,
    })

    if (error) this.fallo(`marcarOutboxEnviado(${id})`, error)
    if (data !== true) this.fallo(`marcarOutboxEnviado(${id}): afectó 0 filas`, null)
  }

  async marcarOutboxFallido(
    id: string,
    tenantId: string,
    errorTexto: string,
    maxIntentos: number,
    esperaSegundos?: number | null,
  ): Promise<string> {
    const { data, error } = await this.db.rpc('marcar_outbox_fallido', {
      p_id: id,
      p_tenant_id: tenantId,
      p_error: errorTexto,
      p_max_intentos: maxIntentos,
      p_segundos_espera: esperaSegundos as number,
    })

    if (error) this.fallo(`marcarOutboxFallido(${id})`, error)
    return String(data)
  }

  async reservarEnvio(tenantId: string, destino: string, segundos: number): Promise<ReservaEnvio> {
    const { data, error } = await this.db.rpc('reservar_envio_destino', {
      p_tenant_id: tenantId,
      p_destino: destino,
      p_segundos: segundos,
    })

    if (error) this.fallo(`reservarEnvio(${destino})`, error)

    const fila = (data as Array<Record<string, unknown>> | null)?.[0]
    if (!fila) this.fallo(`reservarEnvio(${destino}): sin resultado`, null)

    return {
      permitido: Boolean(fila.permitido),
      esperarSegundos: Number(fila.esperar_segundos ?? 0),
    }
  }
}
