-- ============================================================
-- 08 · PAGOS
-- Transacciones y comprobantes por foto.
-- Sólo el almacenamiento: la integración con Mercado Pago no se
-- implementa todavía.
-- ============================================================

create table public.pagos (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  pedido_id          uuid not null,
  proveedor          proveedor_pago not null,
  tipo               tipo_pago not null,
  monto              numeric(12,2) not null check (monto > 0),
  estado             estado_transaccion not null default 'pendiente',
  -- Idempotencia contra MP: el mismo intento no se cobra dos veces.
  external_reference text unique,
  mp_preference_id   text,
  mp_payment_id      text unique,
  init_point         text,
  expira_en          timestamptz,
  cobrado_por        uuid,   -- repartidor que cobró en mano
  raw                jsonb,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  foreign key (pedido_id, tenant_id)   references public.pedidos(id, tenant_id) on delete cascade,
  foreign key (cobrado_por, tenant_id) references public.repartidores(id, tenant_id) on delete set null
);
create index pagos_pedido_idx on public.pagos (pedido_id);
create index pagos_tenant_estado_idx on public.pagos (tenant_id, estado);

-- Comprobantes por foto → SIEMPRE cola manual, nunca auto-aprobación.
-- Los campos ocr_* son para pre-llenar el formulario de revisión, no
-- para decidir. Una transferencia trucha se ve igual de bien en OCR.
create table public.comprobantes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  pedido_id       uuid,
  conversacion_id uuid,
  media_url       text not null,
  ocr_monto       numeric(12,2),
  ocr_fecha       timestamptz,
  ocr_destino     text,
  ocr_raw         jsonb,
  estado          text not null default 'pendiente'
                    check (estado in ('pendiente','aprobado','rechazado')),
  revisado_por    uuid,
  revisado_en     timestamptz,
  motivo_rechazo  text,
  creado_en       timestamptz not null default now(),
  foreign key (pedido_id, tenant_id)       references public.pedidos(id, tenant_id) on delete set null,
  foreign key (conversacion_id, tenant_id) references public.conversaciones(id, tenant_id) on delete set null,
  -- Resuelto sin revisor es un agujero de auditoría.
  constraint comprobantes_revision_completa check (
    estado = 'pendiente'
    or (revisado_por is not null and revisado_en is not null)
  )
);
create index comprobantes_tenant_estado_idx on public.comprobantes (tenant_id, estado);

-- ---------- RLS ----------
alter table public.pagos        enable row level security;
alter table public.comprobantes enable row level security;

create policy tenant_isolation on public.pagos
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));

create policy tenant_isolation on public.comprobantes
  for all to authenticated
  using      (public.es_miembro(tenant_id))
  with check (public.es_miembro(tenant_id));
