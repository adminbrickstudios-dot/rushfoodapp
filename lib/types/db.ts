// GENERADO POR scripts/generar-tipos.mjs — NO EDITAR A MANO.
// Se regenera con: npm run db:types
// Fuente de verdad: supabase/migrations/*.sql

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      asignaciones: {
        Row: {
          id: string
          tenant_id: string
          pedido_id: string
          repartidor_id: string
          orden_ruta: number | null
          asignado_por: string | null
          asignado_en: string
          recibido_por: string | null
          foto_entrega: string | null
          resultado: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          pedido_id: string
          repartidor_id: string
          orden_ruta?: number | null
          asignado_por?: string | null
          asignado_en?: string
          recibido_por?: string | null
          foto_entrega?: string | null
          resultado?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          pedido_id?: string
          repartidor_id?: string
          orden_ruta?: number | null
          asignado_por?: string | null
          asignado_en?: string
          recibido_por?: string | null
          foto_entrega?: string | null
          resultado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'asignaciones_pedido_id_tenant_id_fkey'
            columns: ['pedido_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'pedidos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'asignaciones_repartidor_id_tenant_id_fkey'
            columns: ['repartidor_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'repartidores'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'asignaciones_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      audit_log: {
        Row: {
          id: string
          tenant_id: string
          user_id: string | null
          accion: string
          entidad: string | null
          entidad_id: string | null
          antes: Json | null
          despues: Json | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id?: string | null
          accion: string
          entidad?: string | null
          entidad_id?: string | null
          antes?: Json | null
          despues?: Json | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string | null
          accion?: string
          entidad?: string | null
          entidad_id?: string | null
          antes?: Json | null
          despues?: Json | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'audit_log_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      avisos: {
        Row: {
          id: string
          tenant_id: string
          tipo: string
          titulo: string
          detalle: string | null
          severidad: number
          leido_en: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          tipo: string
          titulo: string
          detalle?: string | null
          severidad?: number
          leido_en?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          tipo?: string
          titulo?: string
          detalle?: string | null
          severidad?: number
          leido_en?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'avisos_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      bot_runs: {
        Row: {
          id: string
          tenant_id: string
          conversacion_id: string | null
          modelo: string
          intent: string | null
          estado_antes: Database['public']['Enums']['estado_conv'] | null
          estado_despues: Database['public']['Enums']['estado_conv'] | null
          tools_usadas: Json | null
          tokens_in: number | null
          tokens_out: number | null
          tokens_cache: number | null
          latencia_ms: number | null
          costo_usd: number | null
          error: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          conversacion_id?: string | null
          modelo: string
          intent?: string | null
          estado_antes?: Database['public']['Enums']['estado_conv'] | null
          estado_despues?: Database['public']['Enums']['estado_conv'] | null
          tools_usadas?: Json | null
          tokens_in?: number | null
          tokens_out?: number | null
          tokens_cache?: number | null
          latencia_ms?: number | null
          costo_usd?: number | null
          error?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          conversacion_id?: string | null
          modelo?: string
          intent?: string | null
          estado_antes?: Database['public']['Enums']['estado_conv'] | null
          estado_despues?: Database['public']['Enums']['estado_conv'] | null
          tools_usadas?: Json | null
          tokens_in?: number | null
          tokens_out?: number | null
          tokens_cache?: number | null
          latencia_ms?: number | null
          costo_usd?: number | null
          error?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'bot_runs_conversacion_id_tenant_id_fkey'
            columns: ['conversacion_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'conversaciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'bot_runs_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      categorias: {
        Row: {
          id: string
          tenant_id: string
          nombre: string
          orden: number
          activo: boolean
        }
        Insert: {
          id?: string
          tenant_id: string
          nombre: string
          orden?: number
          activo?: boolean
        }
        Update: {
          id?: string
          tenant_id?: string
          nombre?: string
          orden?: number
          activo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'categorias_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      cierres_caja: {
        Row: {
          id: string
          tenant_id: string
          repartidor_id: string | null
          fecha: string
          efectivo_esperado: number
          efectivo_rendido: number | null
          diferencia: number | null
          cerrado_en: string | null
          notas: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          repartidor_id?: string | null
          fecha: string
          efectivo_esperado?: number
          efectivo_rendido?: number | null
          cerrado_en?: string | null
          notas?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          repartidor_id?: string | null
          fecha?: string
          efectivo_esperado?: number
          efectivo_rendido?: number | null
          cerrado_en?: string | null
          notas?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'cierres_caja_repartidor_id_tenant_id_fkey'
            columns: ['repartidor_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'repartidores'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'cierres_caja_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      clientes: {
        Row: {
          id: string
          tenant_id: string
          telefono: string
          nombre: string | null
          email: string | null
          notas_internas: string | null
          bloqueado: boolean
          pedidos_count: number
          total_gastado: number
          primer_pedido: string | null
          ultimo_pedido: string | null
          acepta_promos: boolean
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          telefono: string
          nombre?: string | null
          email?: string | null
          notas_internas?: string | null
          bloqueado?: boolean
          pedidos_count?: number
          total_gastado?: number
          primer_pedido?: string | null
          ultimo_pedido?: string | null
          acepta_promos?: boolean
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          telefono?: string
          nombre?: string | null
          email?: string | null
          notas_internas?: string | null
          bloqueado?: boolean
          pedidos_count?: number
          total_gastado?: number
          primer_pedido?: string | null
          ultimo_pedido?: string | null
          acepta_promos?: boolean
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'clientes_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      comprobantes: {
        Row: {
          id: string
          tenant_id: string
          pedido_id: string | null
          conversacion_id: string | null
          media_url: string
          ocr_monto: number | null
          ocr_fecha: string | null
          ocr_destino: string | null
          ocr_raw: Json | null
          estado: string
          revisado_por: string | null
          revisado_en: string | null
          motivo_rechazo: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          pedido_id?: string | null
          conversacion_id?: string | null
          media_url: string
          ocr_monto?: number | null
          ocr_fecha?: string | null
          ocr_destino?: string | null
          ocr_raw?: Json | null
          estado?: string
          revisado_por?: string | null
          revisado_en?: string | null
          motivo_rechazo?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          pedido_id?: string | null
          conversacion_id?: string | null
          media_url?: string
          ocr_monto?: number | null
          ocr_fecha?: string | null
          ocr_destino?: string | null
          ocr_raw?: Json | null
          estado?: string
          revisado_por?: string | null
          revisado_en?: string | null
          motivo_rechazo?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'comprobantes_conversacion_id_tenant_id_fkey'
            columns: ['conversacion_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'conversaciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'comprobantes_pedido_id_tenant_id_fkey'
            columns: ['pedido_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'pedidos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'comprobantes_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      contadores_pedido: {
        Row: {
          tenant_id: string
          ultimo_numero: number
        }
        Insert: {
          tenant_id: string
          ultimo_numero?: number
        }
        Update: {
          tenant_id?: string
          ultimo_numero?: number
        }
        Relationships: [
          {
            foreignKeyName: 'contadores_pedido_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: true
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      conversaciones: {
        Row: {
          id: string
          tenant_id: string
          cliente_id: string | null
          wa_id: string
          estado: Database['public']['Enums']['estado_conv']
          contexto: Json
          bot_pausado_hasta: string | null
          asignada_a: string | null
          ultimo_in_at: string | null
          ultimo_out_at: string | null
          reinicios: number
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          cliente_id?: string | null
          wa_id: string
          estado?: Database['public']['Enums']['estado_conv']
          contexto?: Json
          bot_pausado_hasta?: string | null
          asignada_a?: string | null
          ultimo_in_at?: string | null
          ultimo_out_at?: string | null
          reinicios?: number
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          cliente_id?: string | null
          wa_id?: string
          estado?: Database['public']['Enums']['estado_conv']
          contexto?: Json
          bot_pausado_hasta?: string | null
          asignada_a?: string | null
          ultimo_in_at?: string | null
          ultimo_out_at?: string | null
          reinicios?: number
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'conversaciones_cliente_id_tenant_id_fkey'
            columns: ['cliente_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'clientes'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'conversaciones_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      cupones: {
        Row: {
          id: string
          tenant_id: string
          codigo: string
          tipo: string
          valor: number | null
          usos_max: number | null
          usos_actuales: number
          monto_minimo: number | null
          desde: string | null
          hasta: string | null
          activo: boolean
        }
        Insert: {
          id?: string
          tenant_id: string
          codigo: string
          tipo: string
          valor?: number | null
          usos_max?: number | null
          usos_actuales?: number
          monto_minimo?: number | null
          desde?: string | null
          hasta?: string | null
          activo?: boolean
        }
        Update: {
          id?: string
          tenant_id?: string
          codigo?: string
          tipo?: string
          valor?: number | null
          usos_max?: number | null
          usos_actuales?: number
          monto_minimo?: number | null
          desde?: string | null
          hasta?: string | null
          activo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'cupones_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      demanda_perdida: {
        Row: {
          id: string
          tenant_id: string
          tipo: string
          producto_id: string | null
          texto_cliente: string | null
          zona_texto: string | null
          conversacion_id: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          tipo: string
          producto_id?: string | null
          texto_cliente?: string | null
          zona_texto?: string | null
          conversacion_id?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          tipo?: string
          producto_id?: string | null
          texto_cliente?: string | null
          zona_texto?: string | null
          conversacion_id?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'demanda_perdida_conversacion_id_tenant_id_fkey'
            columns: ['conversacion_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'conversaciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'demanda_perdida_producto_id_tenant_id_fkey'
            columns: ['producto_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'demanda_perdida_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      dias_especiales: {
        Row: {
          id: string
          tenant_id: string
          fecha: string
          cerrado: boolean
          abre: string | null
          cierra: string | null
          motivo: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          fecha: string
          cerrado?: boolean
          abre?: string | null
          cierra?: string | null
          motivo?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          fecha?: string
          cerrado?: boolean
          abre?: string | null
          cierra?: string | null
          motivo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'dias_especiales_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      direcciones: {
        Row: {
          id: string
          tenant_id: string
          cliente_id: string
          etiqueta: string | null
          calle: string
          numero: string | null
          piso_depto: string | null
          barrio: string | null
          referencia: string | null
          lat: number | null
          lng: number | null
          zona_id: string | null
          es_default: boolean
          verificada: boolean
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          cliente_id: string
          etiqueta?: string | null
          calle: string
          numero?: string | null
          piso_depto?: string | null
          barrio?: string | null
          referencia?: string | null
          lat?: number | null
          lng?: number | null
          zona_id?: string | null
          es_default?: boolean
          verificada?: boolean
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          cliente_id?: string
          etiqueta?: string | null
          calle?: string
          numero?: string | null
          piso_depto?: string | null
          barrio?: string | null
          referencia?: string | null
          lat?: number | null
          lng?: number | null
          zona_id?: string | null
          es_default?: boolean
          verificada?: boolean
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'direcciones_cliente_id_tenant_id_fkey'
            columns: ['cliente_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'clientes'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'direcciones_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'direcciones_zona_id_tenant_id_fkey'
            columns: ['zona_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'zonas_delivery'
            referencedColumns: ['id', 'tenant_id']
          },
        ]
      }
      estaciones: {
        Row: {
          id: string
          tenant_id: string
          nombre: string
          orden: number
        }
        Insert: {
          id?: string
          tenant_id: string
          nombre: string
          orden?: number
        }
        Update: {
          id?: string
          tenant_id?: string
          nombre?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: 'estaciones_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      grupos_opciones: {
        Row: {
          id: string
          tenant_id: string
          nombre: string
          min_selec: number
          max_selec: number
          obligatorio: boolean
          orden: number
        }
        Insert: {
          id?: string
          tenant_id: string
          nombre: string
          min_selec?: number
          max_selec?: number
          obligatorio?: boolean
          orden?: number
        }
        Update: {
          id?: string
          tenant_id?: string
          nombre?: string
          min_selec?: number
          max_selec?: number
          obligatorio?: boolean
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: 'grupos_opciones_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      historial_precios: {
        Row: {
          id: string
          tenant_id: string
          producto_id: string | null
          variante_id: string | null
          precio_anterior: number
          precio_nuevo: number
          motivo: string | null
          actor: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          producto_id?: string | null
          variante_id?: string | null
          precio_anterior: number
          precio_nuevo: number
          motivo?: string | null
          actor?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          producto_id?: string | null
          variante_id?: string | null
          precio_anterior?: number
          precio_nuevo?: number
          motivo?: string | null
          actor?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'historial_precios_producto_id_tenant_id_fkey'
            columns: ['producto_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'historial_precios_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'historial_precios_variante_id_tenant_id_fkey'
            columns: ['variante_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'variantes'
            referencedColumns: ['id', 'tenant_id']
          },
        ]
      }
      horarios: {
        Row: {
          id: string
          tenant_id: string
          dia_semana: number
          abre: string
          cierra: string
          ultimo_pedido_min_antes: number
          activo: boolean
        }
        Insert: {
          id?: string
          tenant_id: string
          dia_semana: number
          abre: string
          cierra: string
          ultimo_pedido_min_antes?: number
          activo?: boolean
        }
        Update: {
          id?: string
          tenant_id?: string
          dia_semana?: number
          abre?: string
          cierra?: string
          ultimo_pedido_min_antes?: number
          activo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'horarios_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      memberships: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          rol: Database['public']['Enums']['rol_usuario']
          activo: boolean
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          rol: Database['public']['Enums']['rol_usuario']
          activo?: boolean
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string
          rol?: Database['public']['Enums']['rol_usuario']
          activo?: boolean
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'memberships_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      mensajes: {
        Row: {
          id: string
          tenant_id: string
          conversacion_id: string
          wa_message_id: string | null
          direccion: Database['public']['Enums']['direccion_msg']
          origen: Database['public']['Enums']['origen_msg']
          tipo: string
          texto: string | null
          payload: Json | null
          transcripcion: string | null
          estado_envio: string | null
          error: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          conversacion_id: string
          wa_message_id?: string | null
          direccion: Database['public']['Enums']['direccion_msg']
          origen: Database['public']['Enums']['origen_msg']
          tipo: string
          texto?: string | null
          payload?: Json | null
          transcripcion?: string | null
          estado_envio?: string | null
          error?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          conversacion_id?: string
          wa_message_id?: string | null
          direccion?: Database['public']['Enums']['direccion_msg']
          origen?: Database['public']['Enums']['origen_msg']
          tipo?: string
          texto?: string | null
          payload?: Json | null
          transcripcion?: string | null
          estado_envio?: string | null
          error?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mensajes_conversacion_id_tenant_id_fkey'
            columns: ['conversacion_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'conversaciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'mensajes_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      opciones: {
        Row: {
          id: string
          tenant_id: string
          grupo_id: string
          nombre: string
          precio: number
          agotado: boolean
          orden: number
        }
        Insert: {
          id?: string
          tenant_id: string
          grupo_id: string
          nombre: string
          precio?: number
          agotado?: boolean
          orden?: number
        }
        Update: {
          id?: string
          tenant_id?: string
          grupo_id?: string
          nombre?: string
          precio?: number
          agotado?: boolean
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: 'opciones_grupo_id_tenant_id_fkey'
            columns: ['grupo_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'grupos_opciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'opciones_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      pagos: {
        Row: {
          id: string
          tenant_id: string
          pedido_id: string
          proveedor: Database['public']['Enums']['proveedor_pago']
          tipo: Database['public']['Enums']['tipo_pago']
          monto: number
          estado: Database['public']['Enums']['estado_transaccion']
          external_reference: string | null
          mp_preference_id: string | null
          mp_payment_id: string | null
          init_point: string | null
          expira_en: string | null
          cobrado_por: string | null
          raw: Json | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          pedido_id: string
          proveedor: Database['public']['Enums']['proveedor_pago']
          tipo: Database['public']['Enums']['tipo_pago']
          monto: number
          estado?: Database['public']['Enums']['estado_transaccion']
          external_reference?: string | null
          mp_preference_id?: string | null
          mp_payment_id?: string | null
          init_point?: string | null
          expira_en?: string | null
          cobrado_por?: string | null
          raw?: Json | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          pedido_id?: string
          proveedor?: Database['public']['Enums']['proveedor_pago']
          tipo?: Database['public']['Enums']['tipo_pago']
          monto?: number
          estado?: Database['public']['Enums']['estado_transaccion']
          external_reference?: string | null
          mp_preference_id?: string | null
          mp_payment_id?: string | null
          init_point?: string | null
          expira_en?: string | null
          cobrado_por?: string | null
          raw?: Json | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pagos_cobrado_por_tenant_id_fkey'
            columns: ['cobrado_por', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'repartidores'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'pagos_pedido_id_tenant_id_fkey'
            columns: ['pedido_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'pedidos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'pagos_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      pausas: {
        Row: {
          id: string
          tenant_id: string
          alcance: Database['public']['Enums']['alcance_pausa']
          hasta: string
          motivo: string | null
          actor: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          alcance: Database['public']['Enums']['alcance_pausa']
          hasta: string
          motivo?: string | null
          actor?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          alcance?: Database['public']['Enums']['alcance_pausa']
          hasta?: string
          motivo?: string | null
          actor?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pausas_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      pedido_eventos: {
        Row: {
          id: string
          tenant_id: string
          pedido_id: string
          tipo: string
          actor: string
          datos: Json | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          pedido_id: string
          tipo: string
          actor: string
          datos?: Json | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          pedido_id?: string
          tipo?: string
          actor?: string
          datos?: Json | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pedido_eventos_pedido_id_tenant_id_fkey'
            columns: ['pedido_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'pedidos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'pedido_eventos_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      pedido_items: {
        Row: {
          id: string
          tenant_id: string
          pedido_id: string
          producto_id: string | null
          variante_id: string | null
          estacion_id: string | null
          nombre_snapshot: string
          precio_unitario: number
          cantidad: number
          opciones: Json
          notas: string | null
          subtotal: number
          estado_cocina: string
        }
        Insert: {
          id?: string
          tenant_id: string
          pedido_id: string
          producto_id?: string | null
          variante_id?: string | null
          estacion_id?: string | null
          nombre_snapshot: string
          precio_unitario: number
          cantidad?: number
          opciones?: Json
          notas?: string | null
          subtotal: number
          estado_cocina?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          pedido_id?: string
          producto_id?: string | null
          variante_id?: string | null
          estacion_id?: string | null
          nombre_snapshot?: string
          precio_unitario?: number
          cantidad?: number
          opciones?: Json
          notas?: string | null
          subtotal?: number
          estado_cocina?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pedido_items_estacion_id_tenant_id_fkey'
            columns: ['estacion_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'estaciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'pedido_items_pedido_id_tenant_id_fkey'
            columns: ['pedido_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'pedidos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'pedido_items_producto_id_tenant_id_fkey'
            columns: ['producto_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'pedido_items_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pedido_items_variante_id_tenant_id_fkey'
            columns: ['variante_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'variantes'
            referencedColumns: ['id', 'tenant_id']
          },
        ]
      }
      pedidos: {
        Row: {
          id: string
          tenant_id: string
          numero: number
          cliente_id: string | null
          conversacion_id: string | null
          canal: Database['public']['Enums']['canal_pedido']
          tipo: Database['public']['Enums']['tipo_entrega']
          estado: Database['public']['Enums']['estado_pedido']
          pago_estado: Database['public']['Enums']['estado_pago']
          modo_pago: Database['public']['Enums']['modo_pago'] | null
          subtotal: number
          descuento: number
          envio: number
          propina: number
          total: number
          sena_monto: number
          pagado_monto: number
          saldo_pendiente: number | null
          direccion_snapshot: Json | null
          zona_id: string | null
          notas_cliente: string | null
          notas_internas: string | null
          minutos_estimados: number | null
          prometido_para: string | null
          confirmado_en: string | null
          en_cocina_en: string | null
          listo_en: string | null
          despachado_en: string | null
          entregado_en: string | null
          cancelado_en: string | null
          motivo_cancelacion: string | null
          repartidor_id: string | null
          tomado_por: string | null
          tomado_en: string | null
          token_publico: string
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          numero: number
          cliente_id?: string | null
          conversacion_id?: string | null
          canal: Database['public']['Enums']['canal_pedido']
          tipo: Database['public']['Enums']['tipo_entrega']
          estado?: Database['public']['Enums']['estado_pedido']
          pago_estado?: Database['public']['Enums']['estado_pago']
          modo_pago?: Database['public']['Enums']['modo_pago'] | null
          subtotal?: number
          descuento?: number
          envio?: number
          propina?: number
          total?: number
          sena_monto?: number
          pagado_monto?: number
          direccion_snapshot?: Json | null
          zona_id?: string | null
          notas_cliente?: string | null
          notas_internas?: string | null
          minutos_estimados?: number | null
          prometido_para?: string | null
          confirmado_en?: string | null
          en_cocina_en?: string | null
          listo_en?: string | null
          despachado_en?: string | null
          entregado_en?: string | null
          cancelado_en?: string | null
          motivo_cancelacion?: string | null
          repartidor_id?: string | null
          tomado_por?: string | null
          tomado_en?: string | null
          token_publico?: string
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          numero?: number
          cliente_id?: string | null
          conversacion_id?: string | null
          canal?: Database['public']['Enums']['canal_pedido']
          tipo?: Database['public']['Enums']['tipo_entrega']
          estado?: Database['public']['Enums']['estado_pedido']
          pago_estado?: Database['public']['Enums']['estado_pago']
          modo_pago?: Database['public']['Enums']['modo_pago'] | null
          subtotal?: number
          descuento?: number
          envio?: number
          propina?: number
          total?: number
          sena_monto?: number
          pagado_monto?: number
          direccion_snapshot?: Json | null
          zona_id?: string | null
          notas_cliente?: string | null
          notas_internas?: string | null
          minutos_estimados?: number | null
          prometido_para?: string | null
          confirmado_en?: string | null
          en_cocina_en?: string | null
          listo_en?: string | null
          despachado_en?: string | null
          entregado_en?: string | null
          cancelado_en?: string | null
          motivo_cancelacion?: string | null
          repartidor_id?: string | null
          tomado_por?: string | null
          tomado_en?: string | null
          token_publico?: string
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pedidos_cliente_id_tenant_id_fkey'
            columns: ['cliente_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'clientes'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'pedidos_conversacion_id_tenant_id_fkey'
            columns: ['conversacion_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'conversaciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'pedidos_repartidor_id_tenant_id_fkey'
            columns: ['repartidor_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'repartidores'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'pedidos_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pedidos_zona_id_tenant_id_fkey'
            columns: ['zona_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'zonas_delivery'
            referencedColumns: ['id', 'tenant_id']
          },
        ]
      }
      producto_grupos: {
        Row: {
          tenant_id: string
          producto_id: string
          grupo_id: string
          orden: number
        }
        Insert: {
          tenant_id: string
          producto_id: string
          grupo_id: string
          orden?: number
        }
        Update: {
          tenant_id?: string
          producto_id?: string
          grupo_id?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: 'producto_grupos_grupo_id_tenant_id_fkey'
            columns: ['grupo_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'grupos_opciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'producto_grupos_producto_id_tenant_id_fkey'
            columns: ['producto_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'producto_grupos_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      productos: {
        Row: {
          id: string
          tenant_id: string
          categoria_id: string | null
          estacion_id: string | null
          nombre: string
          descripcion: string | null
          ingredientes: string | null
          precio_base: number
          costo_insumos: number | null
          minutos_prep: number
          imagen_url: string | null
          activo: boolean
          agotado: boolean
          orden: number
          alias: string[] | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          categoria_id?: string | null
          estacion_id?: string | null
          nombre: string
          descripcion?: string | null
          ingredientes?: string | null
          precio_base: number
          costo_insumos?: number | null
          minutos_prep?: number
          imagen_url?: string | null
          activo?: boolean
          agotado?: boolean
          orden?: number
          alias?: string[] | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          categoria_id?: string | null
          estacion_id?: string | null
          nombre?: string
          descripcion?: string | null
          ingredientes?: string | null
          precio_base?: number
          costo_insumos?: number | null
          minutos_prep?: number
          imagen_url?: string | null
          activo?: boolean
          agotado?: boolean
          orden?: number
          alias?: string[] | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'productos_categoria_id_tenant_id_fkey'
            columns: ['categoria_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'categorias'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'productos_estacion_id_tenant_id_fkey'
            columns: ['estacion_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'estaciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'productos_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      promociones: {
        Row: {
          id: string
          tenant_id: string
          nombre: string
          tipo: string
          valor: number | null
          condiciones: Json | null
          codigo: string | null
          activo: boolean
          desde: string | null
          hasta: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          nombre: string
          tipo: string
          valor?: number | null
          condiciones?: Json | null
          codigo?: string | null
          activo?: boolean
          desde?: string | null
          hasta?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          nombre?: string
          tipo?: string
          valor?: number | null
          condiciones?: Json | null
          codigo?: string | null
          activo?: boolean
          desde?: string | null
          hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'promociones_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      repartidores: {
        Row: {
          id: string
          tenant_id: string
          user_id: string | null
          nombre: string
          telefono: string | null
          activo: boolean
          en_ruta: boolean
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id?: string | null
          nombre: string
          telefono?: string | null
          activo?: boolean
          en_ruta?: boolean
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string | null
          nombre?: string
          telefono?: string | null
          activo?: boolean
          en_ruta?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'repartidores_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      respuestas_rapidas: {
        Row: {
          id: string
          tenant_id: string
          atajo: string
          texto: string
          orden: number
        }
        Insert: {
          id?: string
          tenant_id: string
          atajo: string
          texto: string
          orden?: number
        }
        Update: {
          id?: string
          tenant_id?: string
          atajo?: string
          texto?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: 'respuestas_rapidas_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      tenant_config: {
        Row: {
          tenant_id: string
          acepta_delivery: boolean
          acepta_takeaway: boolean
          direccion_local: string | null
          lat: number | null
          lng: number | null
          exige_pago_online: boolean
          permite_contra_entrega: boolean
          monto_max_contra_entrega: number | null
          usa_sena: boolean
          sena_porcentaje: number | null
          sena_monto_minimo: number | null
          minutos_expira_pago: number
          acepta_comprobante_foto: boolean
          minutos_extra_delivery: number
          minutos_buffer_cocina: number
          pedido_minimo: number | null
          bot_activo: boolean
          modo_contingencia: boolean
          horas_reinicio_conv: number
          segundos_buffer_mensajes: number
          max_pedidos_simultaneos: number | null
          mensaje_bienvenida: string | null
          mensaje_cerrado: string | null
          mensaje_fuera_de_zona: string | null
          actualizado_en: string
        }
        Insert: {
          tenant_id: string
          acepta_delivery?: boolean
          acepta_takeaway?: boolean
          direccion_local?: string | null
          lat?: number | null
          lng?: number | null
          exige_pago_online?: boolean
          permite_contra_entrega?: boolean
          monto_max_contra_entrega?: number | null
          usa_sena?: boolean
          sena_porcentaje?: number | null
          sena_monto_minimo?: number | null
          minutos_expira_pago?: number
          acepta_comprobante_foto?: boolean
          minutos_extra_delivery?: number
          minutos_buffer_cocina?: number
          pedido_minimo?: number | null
          bot_activo?: boolean
          modo_contingencia?: boolean
          horas_reinicio_conv?: number
          segundos_buffer_mensajes?: number
          max_pedidos_simultaneos?: number | null
          mensaje_bienvenida?: string | null
          mensaje_cerrado?: string | null
          mensaje_fuera_de_zona?: string | null
          actualizado_en?: string
        }
        Update: {
          tenant_id?: string
          acepta_delivery?: boolean
          acepta_takeaway?: boolean
          direccion_local?: string | null
          lat?: number | null
          lng?: number | null
          exige_pago_online?: boolean
          permite_contra_entrega?: boolean
          monto_max_contra_entrega?: number | null
          usa_sena?: boolean
          sena_porcentaje?: number | null
          sena_monto_minimo?: number | null
          minutos_expira_pago?: number
          acepta_comprobante_foto?: boolean
          minutos_extra_delivery?: number
          minutos_buffer_cocina?: number
          pedido_minimo?: number | null
          bot_activo?: boolean
          modo_contingencia?: boolean
          horas_reinicio_conv?: number
          segundos_buffer_mensajes?: number
          max_pedidos_simultaneos?: number | null
          mensaje_bienvenida?: string | null
          mensaje_cerrado?: string | null
          mensaje_fuera_de_zona?: string | null
          actualizado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tenant_config_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: true
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      tenants: {
        Row: {
          id: string
          slug: string
          nombre: string
          timezone: string
          moneda: string
          activo: boolean
          plan: string
          creado_en: string
        }
        Insert: {
          id?: string
          slug: string
          nombre: string
          timezone?: string
          moneda?: string
          activo?: boolean
          plan?: string
          creado_en?: string
        }
        Update: {
          id?: string
          slug?: string
          nombre?: string
          timezone?: string
          moneda?: string
          activo?: boolean
          plan?: string
          creado_en?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          id: string
          tenant_id: string
          conversacion_id: string | null
          pedido_id: string | null
          motivo: string
          prioridad: number
          estado: string
          resumen: string | null
          asignado_a: string | null
          resuelto_en: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          conversacion_id?: string | null
          pedido_id?: string | null
          motivo: string
          prioridad?: number
          estado?: string
          resumen?: string | null
          asignado_a?: string | null
          resuelto_en?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          conversacion_id?: string | null
          pedido_id?: string | null
          motivo?: string
          prioridad?: number
          estado?: string
          resumen?: string | null
          asignado_a?: string | null
          resuelto_en?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tickets_conversacion_id_tenant_id_fkey'
            columns: ['conversacion_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'conversaciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'tickets_pedido_fk'
            columns: ['pedido_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'pedidos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'tickets_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      variantes: {
        Row: {
          id: string
          tenant_id: string
          producto_id: string
          nombre: string
          precio_delta: number
          costo_extra: number
          minutos_extra: number
          agotado: boolean
          orden: number
          es_default: boolean
        }
        Insert: {
          id?: string
          tenant_id: string
          producto_id: string
          nombre: string
          precio_delta?: number
          costo_extra?: number
          minutos_extra?: number
          agotado?: boolean
          orden?: number
          es_default?: boolean
        }
        Update: {
          id?: string
          tenant_id?: string
          producto_id?: string
          nombre?: string
          precio_delta?: number
          costo_extra?: number
          minutos_extra?: number
          agotado?: boolean
          orden?: number
          es_default?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'variantes_producto_id_tenant_id_fkey'
            columns: ['producto_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'productos'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'variantes_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      wa_cuentas: {
        Row: {
          id: string
          tenant_id: string
          proveedor: Database['public']['Enums']['proveedor_wa']
          phone_number_id: string
          waba_id: string | null
          telefono_display: string
          coexistencia: boolean
          token_ref: string
          verify_token: string
          app_secret_ref: string | null
          tier_mensajes: string | null
          calidad: string | null
          activo: boolean
        }
        Insert: {
          id?: string
          tenant_id: string
          proveedor?: Database['public']['Enums']['proveedor_wa']
          phone_number_id: string
          waba_id?: string | null
          telefono_display: string
          coexistencia?: boolean
          token_ref: string
          verify_token: string
          app_secret_ref?: string | null
          tier_mensajes?: string | null
          calidad?: string | null
          activo?: boolean
        }
        Update: {
          id?: string
          tenant_id?: string
          proveedor?: Database['public']['Enums']['proveedor_wa']
          phone_number_id?: string
          waba_id?: string | null
          telefono_display?: string
          coexistencia?: boolean
          token_ref?: string
          verify_token?: string
          app_secret_ref?: string | null
          tier_mensajes?: string | null
          calidad?: string | null
          activo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'wa_cuentas_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      wa_outbox: {
        Row: {
          id: string
          tenant_id: string
          conversacion_id: string | null
          destino: string
          payload: Json
          estado: string
          intentos: number
          proximo_intento: string
          error: string | null
          idempotency_key: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          tenant_id: string
          conversacion_id?: string | null
          destino: string
          payload: Json
          estado?: string
          intentos?: number
          proximo_intento?: string
          error?: string | null
          idempotency_key?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          conversacion_id?: string | null
          destino?: string
          payload?: Json
          estado?: string
          intentos?: number
          proximo_intento?: string
          error?: string | null
          idempotency_key?: string | null
          creado_en?: string
        }
        Relationships: [
          {
            foreignKeyName: 'wa_outbox_conversacion_id_tenant_id_fkey'
            columns: ['conversacion_id', 'tenant_id']
            isOneToOne: false
            referencedRelation: 'conversaciones'
            referencedColumns: ['id', 'tenant_id']
          },
          {
            foreignKeyName: 'wa_outbox_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      wa_plantillas: {
        Row: {
          id: string
          tenant_id: string
          nombre: string
          idioma: string
          categoria: string
          estado: string
          cuerpo: string
          variables: Json | null
          meta_id: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          nombre: string
          idioma?: string
          categoria: string
          estado?: string
          cuerpo: string
          variables?: Json | null
          meta_id?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          nombre?: string
          idioma?: string
          categoria?: string
          estado?: string
          cuerpo?: string
          variables?: Json | null
          meta_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'wa_plantillas_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      webhook_events: {
        Row: {
          id: string
          proveedor: string
          external_id: string
          payload: Json
          procesado_en: string | null
          error: string | null
          creado_en: string
        }
        Insert: {
          id?: string
          proveedor: string
          external_id: string
          payload: Json
          procesado_en?: string | null
          error?: string | null
          creado_en?: string
        }
        Update: {
          id?: string
          proveedor?: string
          external_id?: string
          payload?: Json
          procesado_en?: string | null
          error?: string | null
          creado_en?: string
        }
        Relationships: []
      }
      zonas_delivery: {
        Row: {
          id: string
          tenant_id: string
          nombre: string
          precio_envio: number
          pedido_minimo: number
          minutos_extra: number
          poligono: Json | null
          barrios: string[] | null
          activo: boolean
          orden: number
        }
        Insert: {
          id?: string
          tenant_id: string
          nombre: string
          precio_envio?: number
          pedido_minimo?: number
          minutos_extra?: number
          poligono?: Json | null
          barrios?: string[] | null
          activo?: boolean
          orden?: number
        }
        Update: {
          id?: string
          tenant_id?: string
          nombre?: string
          precio_envio?: number
          pedido_minimo?: number
          minutos_extra?: number
          poligono?: Json | null
          barrios?: string[] | null
          activo?: boolean
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: 'zonas_delivery_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      mis_tenants: { Args: Record<PropertyKey, never>; Returns: string[] }
      es_miembro: { Args: { p_tenant_id: string }; Returns: boolean }
    }
    Enums: {
      alcance_pausa: 'todo' | 'delivery' | 'takeaway'
      canal_pedido: 'whatsapp' | 'web' | 'mostrador' | 'telefono' | 'pedidosya' | 'rappi' | 'ubereats'
      direccion_msg: 'in' | 'out'
      estado_conv: 'idle' | 'menu' | 'armando_pedido' | 'datos_cliente' | 'direccion' | 'horario' | 'pago' | 'esperando_pago' | 'confirmado' | 'postventa' | 'humano' | 'cerrada' | 'bloqueada'
      estado_pago: 'sin_pago' | 'sena_pagada' | 'pagado' | 'reembolsado' | 'fallido'
      estado_pedido: 'borrador' | 'pendiente_pago' | 'confirmado' | 'en_cocina' | 'listo' | 'en_camino' | 'entregado' | 'cancelado' | 'rechazado'
      estado_transaccion: 'pendiente' | 'aprobado' | 'rechazado' | 'cancelado' | 'en_revision' | 'devuelto'
      modo_pago: 'online_total' | 'online_sena' | 'contra_entrega_efectivo' | 'contra_entrega_digital' | 'transferencia'
      origen_msg: 'cliente' | 'bot' | 'agente' | 'app_echo' | 'sistema'
      proveedor_pago: 'mercadopago' | 'efectivo' | 'transferencia' | 'otro'
      proveedor_wa: 'cloud_api' | 'bsp_360dialog' | 'bsp_otro'
      rol_usuario: 'owner' | 'recepcion' | 'cocina' | 'delivery' | 'soporte'
      tipo_entrega: 'delivery' | 'takeaway'
      tipo_pago: 'sena' | 'saldo' | 'total' | 'reembolso'
    }
    CompositeTypes: { [_ in never]: never }
  }
}

// ---------- Atajos ----------
type Public = Database['public']

export type Tabla<N extends keyof Public['Tables']> = Public['Tables'][N]['Row']
export type Insertar<N extends keyof Public['Tables']> = Public['Tables'][N]['Insert']
export type Actualizar<N extends keyof Public['Tables']> = Public['Tables'][N]['Update']
export type Enum<N extends keyof Public['Enums']> = Public['Enums'][N]

export type Asignaciones = Tabla<'asignaciones'>
export type AuditLog = Tabla<'audit_log'>
export type Avisos = Tabla<'avisos'>
export type BotRuns = Tabla<'bot_runs'>
export type Categorias = Tabla<'categorias'>
export type CierresCaja = Tabla<'cierres_caja'>
export type Clientes = Tabla<'clientes'>
export type Comprobantes = Tabla<'comprobantes'>
export type ContadoresPedido = Tabla<'contadores_pedido'>
export type Conversaciones = Tabla<'conversaciones'>
export type Cupones = Tabla<'cupones'>
export type DemandaPerdida = Tabla<'demanda_perdida'>
export type DiasEspeciales = Tabla<'dias_especiales'>
export type Direcciones = Tabla<'direcciones'>
export type Estaciones = Tabla<'estaciones'>
export type GruposOpciones = Tabla<'grupos_opciones'>
export type HistorialPrecios = Tabla<'historial_precios'>
export type Horarios = Tabla<'horarios'>
export type Memberships = Tabla<'memberships'>
export type Mensajes = Tabla<'mensajes'>
export type Opciones = Tabla<'opciones'>
export type Pagos = Tabla<'pagos'>
export type Pausas = Tabla<'pausas'>
export type PedidoEventos = Tabla<'pedido_eventos'>
export type PedidoItems = Tabla<'pedido_items'>
export type Pedidos = Tabla<'pedidos'>
export type ProductoGrupos = Tabla<'producto_grupos'>
export type Productos = Tabla<'productos'>
export type Promociones = Tabla<'promociones'>
export type Repartidores = Tabla<'repartidores'>
export type RespuestasRapidas = Tabla<'respuestas_rapidas'>
export type TenantConfig = Tabla<'tenant_config'>
export type Tenants = Tabla<'tenants'>
export type Tickets = Tabla<'tickets'>
export type Variantes = Tabla<'variantes'>
export type WaCuentas = Tabla<'wa_cuentas'>
export type WaOutbox = Tabla<'wa_outbox'>
export type WaPlantillas = Tabla<'wa_plantillas'>
export type WebhookEvents = Tabla<'webhook_events'>
export type ZonasDelivery = Tabla<'zonas_delivery'>

export type AlcancePausa = Enum<'alcance_pausa'>
export type CanalPedido = Enum<'canal_pedido'>
export type DireccionMsg = Enum<'direccion_msg'>
export type EstadoConv = Enum<'estado_conv'>
export type EstadoPago = Enum<'estado_pago'>
export type EstadoPedido = Enum<'estado_pedido'>
export type EstadoTransaccion = Enum<'estado_transaccion'>
export type ModoPago = Enum<'modo_pago'>
export type OrigenMsg = Enum<'origen_msg'>
export type ProveedorPago = Enum<'proveedor_pago'>
export type ProveedorWa = Enum<'proveedor_wa'>
export type RolUsuario = Enum<'rol_usuario'>
export type TipoEntrega = Enum<'tipo_entrega'>
export type TipoPago = Enum<'tipo_pago'>
