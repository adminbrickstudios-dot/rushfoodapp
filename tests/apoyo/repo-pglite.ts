import type { Conversaciones, Json, WaOutbox } from '@/lib/types/db'
import type { MensajeNormalizado } from '@/lib/whatsapp/entrada'
import type {
  ConfigConversacion,
  CuentaResuelta,
  EncolarSalida,
  MensajePendiente,
  PlanTurno,
  RepoWhatsApp,
  ReservaEnvio,
} from '@/lib/whatsapp/repo'
import type { BaseDePrueba } from './base'

const UNIQUE_VIOLADO = '23505'

function esDuplicado(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  if (code === UNIQUE_VIOLADO) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /duplicate key value violates unique constraint/i.test(msg)
}

/**
 * RepoWhatsApp sobre Postgres directo, para los tests.
 *
 * No imita a PostgREST: llama a las MISMAS funciones SQL de la
 * migración 13 que usa la implementación de producción. Todo lo que
 * tiene condiciones de carrera —el lock, el reclamo del outbox, la
 * reserva del slot de 6 segundos— es el mismo código ejecutándose.
 * Lo único que cambia es el transporte.
 */
export class RepoPglite implements RepoWhatsApp {
  constructor(private readonly base: BaseDePrueba) {}

  private async una<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const filas = await this.base.consultar<T>(sql, params)
    return filas[0] ?? null
  }

  async registrarEventoWebhook(
    proveedor: string,
    externalId: string,
    payload: Json,
  ): Promise<boolean> {
    try {
      await this.base.consultar(
        `insert into public.webhook_events (proveedor, external_id, payload)
         values ($1, $2, $3::jsonb)`,
        [proveedor, externalId, JSON.stringify(payload)],
      )
      return true
    } catch (err) {
      if (esDuplicado(err)) return false
      throw err
    }
  }

  async marcarEventoProcesado(
    proveedor: string,
    externalId: string,
    error?: string,
  ): Promise<void> {
    await this.base.consultar(
      `update public.webhook_events
          set procesado_en = now(), error = $3
        where proveedor = $1 and external_id = $2`,
      [proveedor, externalId, error ?? null],
    )
  }

  async resolverCuenta(phoneNumberId: string): Promise<CuentaResuelta | null> {
    const fila = await this.una<{ id: string; tenant_id: string }>(
      `select id, tenant_id from public.wa_cuentas
        where phone_number_id = $1 and activo = true`,
      [phoneNumberId],
    )
    return fila ? { tenantId: fila.tenant_id, cuentaId: fila.id } : null
  }

  async obtenerOCrearConversacion(tenantId: string, waId: string): Promise<Conversaciones> {
    const fila = await this.una<Conversaciones>(
      `insert into public.conversaciones (tenant_id, wa_id)
       values ($1, $2)
       on conflict (tenant_id, wa_id) do update set wa_id = excluded.wa_id
       returning *`,
      [tenantId, waId],
    )
    if (!fila) throw new Error('obtenerOCrearConversacion no devolvió fila')
    return fila
  }

  async conversacionPorId(conversacionId: string): Promise<Conversaciones | null> {
    return this.una<Conversaciones>(`select * from public.conversaciones where id = $1`, [
      conversacionId,
    ])
  }

  async guardarMensaje(
    tenantId: string,
    conversacionId: string,
    m: MensajeNormalizado,
  ): Promise<{ id: string; duplicado: boolean }> {
    try {
      const fila = await this.una<{ id: string }>(
        `insert into public.mensajes
           (tenant_id, conversacion_id, wa_message_id, direccion, origen, tipo,
            texto, payload, creado_en, procesado)
         values ($1, $2, $3, $4::direccion_msg, $5::origen_msg, $6, $7, $8::jsonb, $9, $10)
         returning id`,
        [
          tenantId,
          conversacionId,
          m.waMessageId,
          m.direccion,
          m.origen,
          m.tipo,
          m.texto,
          JSON.stringify(m.crudo),
          m.recibidoEn.toISOString(),
          m.esEcho,
        ],
      )
      if (!fila) throw new Error('guardarMensaje no devolvió fila')
      return { id: fila.id, duplicado: false }
    } catch (err) {
      if (!esDuplicado(err)) throw err

      const existente = await this.una<{ id: string }>(
        `select id from public.mensajes where tenant_id = $1 and wa_message_id = $2`,
        [tenantId, m.waMessageId],
      )
      if (!existente) throw new Error(`duplicado sin fila: ${m.waMessageId}`)
      return { id: existente.id, duplicado: true }
    }
  }

  async registrarEntrada(
    tenantId: string,
    conversacionId: string,
    cuando: Date,
  ): Promise<void> {
    const filas = await this.base.consultar(
      `update public.conversaciones set ultimo_in_at = $3
        where id = $1 and tenant_id = $2 returning id`,
      [conversacionId, tenantId, cuando.toISOString()],
    )
    if (filas.length === 0) throw new Error('registrarEntrada afectó 0 filas')
  }

  async configConversacion(tenantId: string): Promise<ConfigConversacion> {
    const fila = await this.una<{
      segundos_buffer_mensajes: number
      bot_activo: boolean
      modo_contingencia: boolean
    }>(
      `select segundos_buffer_mensajes, bot_activo, modo_contingencia
         from public.tenant_config where tenant_id = $1`,
      [tenantId],
    )

    return {
      segundosBuffer: fila?.segundos_buffer_mensajes ?? 6,
      botActivo: fila?.bot_activo ?? true,
      modoContingencia: fila?.modo_contingencia ?? false,
    }
  }

  async planificarTurno(
    conversacionId: string,
    tenantId: string,
    ventanaMaxSegundos: number,
  ): Promise<PlanTurno> {
    const fila = await this.una<{
      debe_reprogramar: boolean
      schedule_anterior: string | null
      primer_mensaje: string
    }>(`select * from public.planificar_turno($1, $2, $3)`, [
      conversacionId,
      tenantId,
      ventanaMaxSegundos,
    ])

    if (!fila) throw new Error('planificar_turno sin resultado')

    return {
      debeReprogramar: fila.debe_reprogramar,
      scheduleAnterior: fila.schedule_anterior,
      primerMensaje: String(fila.primer_mensaje),
    }
  }

  async guardarSchedule(
    conversacionId: string,
    tenantId: string,
    scheduleId: string | null,
  ): Promise<void> {
    const fila = await this.una<{ guardar_schedule_conversacion: boolean }>(
      `select public.guardar_schedule_conversacion($1, $2, $3)`,
      [conversacionId, tenantId, scheduleId],
    )
    if (!fila?.guardar_schedule_conversacion) throw new Error('guardarSchedule afectó 0 filas')
  }

  async tomarLock(
    conversacionId: string,
    tenantId: string,
    timeoutSegundos: number,
  ): Promise<boolean> {
    const fila = await this.una<{ tomar_lock_conversacion: boolean }>(
      `select public.tomar_lock_conversacion($1, $2, $3)`,
      [conversacionId, tenantId, timeoutSegundos],
    )
    return fila?.tomar_lock_conversacion === true
  }

  async liberarLock(conversacionId: string, tenantId: string): Promise<void> {
    await this.base.consultar(`select public.liberar_lock_conversacion($1, $2)`, [
      conversacionId,
      tenantId,
    ])
  }

  async mensajesSinProcesar(
    conversacionId: string,
    tenantId: string,
  ): Promise<MensajePendiente[]> {
    const filas = await this.base.consultar<{
      id: string
      tipo: string
      texto: string | null
      payload: Json | null
      creado_en: string
    }>(
      `select id, tipo, texto, payload, creado_en
         from public.mensajes
        where conversacion_id = $1 and tenant_id = $2
          and procesado = false and direccion = 'in'
        order by creado_en asc`,
      [conversacionId, tenantId],
    )

    return filas.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      texto: m.texto,
      payload: m.payload,
      creadoEn: String(m.creado_en),
    }))
  }

  async cerrarTurno(
    conversacionId: string,
    tenantId: string,
    ids: string[],
  ): Promise<number> {
    const fila = await this.una<{ cerrar_turno: number }>(
      `select public.cerrar_turno($1, $2, $3::uuid[])`,
      [conversacionId, tenantId, ids],
    )
    return Number(fila?.cerrar_turno ?? 0)
  }

  async registrarIntentoFallido(conversacionId: string, tenantId: string): Promise<number> {
    const fila = await this.una<{ registrar_intento_fallido: number }>(
      `select public.registrar_intento_fallido($1, $2)`,
      [conversacionId, tenantId],
    )
    return Number(fila?.registrar_intento_fallido ?? 0)
  }

  async rendirseYDerivar(
    conversacionId: string,
    tenantId: string,
    resumen: string,
    minutosPausa: number,
  ): Promise<string> {
    const fila = await this.una<{ rendirse_y_derivar: string }>(
      `select public.rendirse_y_derivar($1, $2, $3, $4)`,
      [conversacionId, tenantId, resumen, minutosPausa],
    )
    return String(fila?.rendirse_y_derivar)
  }

  async pausarBot(conversacionId: string, tenantId: string, minutos: number): Promise<void> {
    const fila = await this.una<{ pausar_bot: boolean }>(`select public.pausar_bot($1, $2, $3)`, [
      conversacionId,
      tenantId,
      minutos,
    ])
    if (!fila?.pausar_bot) throw new Error('pausarBot afectó 0 filas')
  }

  async encolarSalida(e: EncolarSalida): Promise<{ id: string; duplicado: boolean }> {
    try {
      const fila = await this.una<{ id: string }>(
        `insert into public.wa_outbox
           (tenant_id, conversacion_id, destino, payload, idempotency_key)
         values ($1, $2, $3, $4::jsonb, $5) returning id`,
        [e.tenantId, e.conversacionId, e.destino, JSON.stringify(e.payload), e.idempotencyKey],
      )
      if (!fila) throw new Error('encolarSalida no devolvió fila')
      return { id: fila.id, duplicado: false }
    } catch (err) {
      if (!esDuplicado(err)) throw err

      const existente = await this.una<{ id: string }>(
        `select id from public.wa_outbox where idempotency_key = $1`,
        [e.idempotencyKey],
      )
      if (!existente) throw new Error('encolarSalida: duplicado sin fila')
      return { id: existente.id, duplicado: true }
    }
  }

  async reclamarOutbox(limite: number): Promise<WaOutbox[]> {
    return this.base.consultar<WaOutbox>(`select * from public.reclamar_outbox($1)`, [limite])
  }

  async posponerOutbox(id: string, tenantId: string, segundos: number): Promise<void> {
    const fila = await this.una<{ posponer_outbox: boolean }>(
      `select public.posponer_outbox($1, $2, $3)`,
      [id, tenantId, segundos],
    )
    if (!fila?.posponer_outbox) throw new Error('posponerOutbox afectó 0 filas')
  }

  async marcarOutboxEnviado(
    id: string,
    tenantId: string,
    waMessageId: string,
  ): Promise<void> {
    const fila = await this.una<{ marcar_outbox_enviado: boolean }>(
      `select public.marcar_outbox_enviado($1, $2, $3)`,
      [id, tenantId, waMessageId],
    )
    if (!fila?.marcar_outbox_enviado) throw new Error('marcarOutboxEnviado afectó 0 filas')
  }

  async marcarOutboxFallido(
    id: string,
    tenantId: string,
    error: string,
    maxIntentos: number,
    esperaSegundos?: number | null,
  ): Promise<string> {
    const fila = await this.una<{ marcar_outbox_fallido: string }>(
      `select public.marcar_outbox_fallido($1, $2, $3, $4, $5)`,
      [id, tenantId, error, maxIntentos, esperaSegundos ?? null],
    )
    return String(fila?.marcar_outbox_fallido)
  }

  async reservarEnvio(
    tenantId: string,
    destino: string,
    segundos: number,
  ): Promise<ReservaEnvio> {
    const fila = await this.una<{ permitido: boolean; esperar_segundos: number }>(
      `select * from public.reservar_envio_destino($1, $2, $3)`,
      [tenantId, destino, segundos],
    )
    if (!fila) throw new Error('reservar_envio_destino sin resultado')
    return { permitido: fila.permitido, esperarSegundos: Number(fila.esperar_segundos) }
  }
}
