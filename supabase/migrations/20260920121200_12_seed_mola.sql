-- ============================================================
-- 12 · SEED — TENANT "mola"
--
-- Datos de relleno realistas. El menú de verdad lo carga el dueño
-- desde el panel; esto existe para que los paneles, el bot y los
-- tests tengan contra qué correr.
--
-- Todo el bloque verifica filas afectadas: si un insert no escribe
-- lo que dice que escribe, la migración aborta y no deja un tenant
-- a medio armar.
-- ============================================================

do $seed$
declare
  v_tenant        uuid;
  v_est_plancha   uuid;
  v_est_freidora  uuid;
  v_est_armado    uuid;
  v_est_bebidas   uuid;
  v_cat_burgers   uuid;
  v_cat_papas     uuid;
  v_cat_bebidas   uuid;
  v_grp_extras    uuid;
  v_grp_sacar     uuid;
  v_n             int;
begin
  -- ---------- TENANT ----------
  insert into public.tenants (slug, nombre, timezone)
  values ('mola', 'Mola Burgers', 'America/Argentina/Salta')
  returning id into v_tenant;

  if v_tenant is null then
    raise exception 'seed: no se creo el tenant mola';
  end if;

  insert into public.tenant_config (
    tenant_id, acepta_delivery, acepta_takeaway,
    usa_sena, sena_porcentaje, exige_pago_online,
    minutos_extra_delivery, minutos_buffer_cocina, pedido_minimo,
    mensaje_bienvenida, mensaje_cerrado, mensaje_fuera_de_zona
  ) values (
    v_tenant, true, true,
    true, 50, true,
    15, 0, 8000,
    'Hola! Soy el asistente de Mola 🍔 Te tomo el pedido por acá o, si preferís, te paso el link del menú web.',
    'Ahora estamos cerrados. Abrimos de martes a domingo de 20:00 a 01:00. Si querés, dejame tu pedido y lo tomamos apenas abrimos.',
    'Por ahora no llegamos a esa zona 😞 Podés pasar a retirar por el local y te lo dejamos listo.'
  );

  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'seed: tenant_config escribio % filas, esperaba 1', v_n;
  end if;

  -- ---------- ESTACIONES ----------
  insert into public.estaciones (tenant_id, nombre, orden)
  select v_tenant, e.nombre, e.orden
  from (values ('plancha',1),('freidora',2),('armado',3),('bebidas',4)) as e(nombre, orden);

  get diagnostics v_n = row_count;
  if v_n <> 4 then
    raise exception 'seed: estaciones escribio % filas, esperaba 4', v_n;
  end if;

  select id into strict v_est_plancha  from public.estaciones where tenant_id = v_tenant and nombre = 'plancha';
  select id into strict v_est_freidora from public.estaciones where tenant_id = v_tenant and nombre = 'freidora';
  select id into strict v_est_armado   from public.estaciones where tenant_id = v_tenant and nombre = 'armado';
  select id into strict v_est_bebidas  from public.estaciones where tenant_id = v_tenant and nombre = 'bebidas';

  -- ---------- CATEGORÍAS ----------
  insert into public.categorias (tenant_id, nombre, orden)
  values (v_tenant, 'Hamburguesas', 1),
         (v_tenant, 'Papas', 2),
         (v_tenant, 'Bebidas', 3);

  get diagnostics v_n = row_count;
  if v_n <> 3 then
    raise exception 'seed: categorias escribio % filas, esperaba 3', v_n;
  end if;

  select id into strict v_cat_burgers from public.categorias where tenant_id = v_tenant and nombre = 'Hamburguesas';
  select id into strict v_cat_papas   from public.categorias where tenant_id = v_tenant and nombre = 'Papas';
  select id into strict v_cat_bebidas from public.categorias where tenant_id = v_tenant and nombre = 'Bebidas';

  -- ---------- 10 HAMBURGUESAS ----------
  insert into public.productos (
    tenant_id, categoria_id, estacion_id, nombre, descripcion, ingredientes,
    precio_base, costo_insumos, minutos_prep, orden, alias
  )
  select v_tenant, v_cat_burgers, v_est_plancha,
         b.nombre, b.descripcion, b.ingredientes,
         b.precio, b.costo, b.prep, b.orden, b.alias
  from (values
    ('Mola Clásica',      'La de siempre, la que nunca falla.',        'pan de papa, medallón 120g, lechuga, tomate, salsa de la casa',        9800::numeric, 3100::numeric, 10, 1, array['clasica','la clasica','simple']),
    ('Cheeseburger',      'Cheddar fundido sobre la plancha.',         'pan de papa, medallón 120g, doble cheddar, pickles, mostaza y ketchup', 10500::numeric, 3400::numeric, 10, 2, array['cheese','cheeseburger','la de cheddar']),
    ('Bacon Cheddar',     'Panceta crocante y cheddar.',               'pan de papa, medallón 120g, cheddar, panceta, salsa barbacoa',          12200::numeric, 4200::numeric, 12, 3, array['bacon','panceta','la de bacon']),
    ('Barbacoa',          'Cebolla caramelizada y barbacoa ahumada.',  'pan brioche, medallón 120g, cheddar, cebolla caramelizada, barbacoa',   12000::numeric, 4000::numeric, 12, 4, array['bbq','barbacoa']),
    ('Criolla',           'Huevo frito y jamón, bien argentina.',      'pan de papa, medallón 120g, huevo frito, jamón, queso, lechuga',        12500::numeric, 4300::numeric, 13, 5, array['criolla','completa']),
    ('Blue Cheese',       'Queso azul y nuez.',                        'pan brioche, medallón 120g, queso azul, rúcula, nuez',                  13000::numeric, 4800::numeric, 12, 6, array['azul','roquefort','blue']),
    ('Picante Salteña',   'Con locoto, para los de acá.',              'pan de papa, medallón 120g, cheddar, locoto, cebolla morada, chipotle', 12200::numeric, 4100::numeric, 12, 7, array['picante','locoto','la picante']),
    ('Champiñón',         'Champiñones salteados y provolone.',        'pan brioche, medallón 120g, champiñones, provolone, alioli',            12800::numeric, 4500::numeric, 13, 8, array['champi','hongos','champiñon']),
    ('Veggie',            'Medallón de garbanzo y remolacha.',         'pan integral, medallón de garbanzo, lechuga, tomate, alioli vegano',    11500::numeric, 3600::numeric, 11, 9, array['veggie','vegetariana','sin carne']),
    ('Mola Full',         'Todo junto. No preguntes.',                 'pan de papa, medallón 120g, cheddar, panceta, huevo, cebolla, barbacoa',14500::numeric, 5200::numeric, 14, 10, array['full','la full','completa mola'])
  ) as b(nombre, descripcion, ingredientes, precio, costo, prep, orden, alias);

  get diagnostics v_n = row_count;
  if v_n <> 10 then
    raise exception 'seed: hamburguesas escribio % filas, esperaba 10', v_n;
  end if;

  -- Variantes simple / doble / triple para las 10.
  insert into public.variantes (
    tenant_id, producto_id, nombre, precio_delta, costo_extra, minutos_extra, orden, es_default
  )
  select v_tenant, p.id, x.nombre, x.delta, x.costo, x.min_extra, x.orden, x.es_def
  from public.productos p
  cross join (values
    ('Simple', 0::numeric,    0::numeric,    0, 1, true),
    ('Doble',  3800::numeric, 1400::numeric, 3, 2, false),
    ('Triple', 7200::numeric, 2800::numeric, 5, 3, false)
  ) as x(nombre, delta, costo, min_extra, orden, es_def)
  where p.tenant_id = v_tenant
    and p.categoria_id = v_cat_burgers;

  get diagnostics v_n = row_count;
  if v_n <> 30 then
    raise exception 'seed: variantes escribio % filas, esperaba 30', v_n;
  end if;

  -- ---------- PAPAS ----------
  insert into public.productos (
    tenant_id, categoria_id, estacion_id, nombre, descripcion, ingredientes,
    precio_base, costo_insumos, minutos_prep, orden, alias
  )
  select v_tenant, v_cat_papas, v_est_freidora,
         p.nombre, p.descripcion, p.ingredientes, p.precio, p.costo, p.prep, p.orden, p.alias
  from (values
    ('Papas Fritas',            'Porción grande, con sal gruesa.', 'papa, sal',                          5500::numeric, 1500::numeric, 8, 1, array['papas','fritas']),
    ('Papas Cheddar y Bacon',   'Con cheddar fundido y panceta.',  'papa, cheddar, panceta, verdeo',      8200::numeric, 2900::numeric, 10, 2, array['papas cheddar','cheddar bacon']),
    ('Papas Provenzal',         'Ajo y perejil.',                  'papa, ajo, perejil, aceite de oliva', 6200::numeric, 1800::numeric, 9, 3, array['provenzal','papas provenzal'])
  ) as p(nombre, descripcion, ingredientes, precio, costo, prep, orden, alias);

  get diagnostics v_n = row_count;
  if v_n <> 3 then
    raise exception 'seed: papas escribio % filas, esperaba 3', v_n;
  end if;

  -- ---------- BEBIDAS ----------
  insert into public.productos (
    tenant_id, categoria_id, estacion_id, nombre, descripcion,
    precio_base, costo_insumos, minutos_prep, orden, alias
  )
  select v_tenant, v_cat_bebidas, v_est_bebidas,
         b.nombre, b.descripcion, b.precio, b.costo, b.prep, b.orden, b.alias
  from (values
    ('Coca-Cola 500ml',       'Bien fría.',            3200::numeric, 1400::numeric, 1, 1, array['coca','gaseosa']),
    ('Sprite 500ml',          'Bien fría.',            3200::numeric, 1400::numeric, 1, 2, array['sprite','lima limon']),
    ('Agua sin gas 500ml',    NULL,                    2400::numeric, 900::numeric,  1, 3, array['agua']),
    ('Cerveza Salta Rubia 473ml', 'La de acá.',        4500::numeric, 2200::numeric, 1, 4, array['cerveza','salta','birra']),
    ('Limonada con menta',    'Jarra de medio litro.', 4800::numeric, 1500::numeric, 4, 5, array['limonada'])
  ) as b(nombre, descripcion, precio, costo, prep, orden, alias);

  get diagnostics v_n = row_count;
  if v_n <> 5 then
    raise exception 'seed: bebidas escribio % filas, esperaba 5', v_n;
  end if;

  -- ---------- GRUPOS DE OPCIONES ----------
  insert into public.grupos_opciones (tenant_id, nombre, min_selec, max_selec, obligatorio, orden)
  values (v_tenant, 'Adicionales',         0, 5, false, 1),
         (v_tenant, 'Sacar ingredientes',  0, 6, false, 2);

  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception 'seed: grupos_opciones escribio % filas, esperaba 2', v_n;
  end if;

  select id into strict v_grp_extras from public.grupos_opciones where tenant_id = v_tenant and nombre = 'Adicionales';
  select id into strict v_grp_sacar  from public.grupos_opciones where tenant_id = v_tenant and nombre = 'Sacar ingredientes';

  insert into public.opciones (tenant_id, grupo_id, nombre, precio, orden)
  select v_tenant, v_grp_extras, o.nombre, o.precio, o.orden
  from (values
    ('Extra cheddar',     1400::numeric, 1),
    ('Extra panceta',     1900::numeric, 2),
    ('Huevo frito',       1200::numeric, 3),
    ('Cebolla crispy',    1100::numeric, 4),
    ('Extra medallón',    3800::numeric, 5),
    ('Salsa de la casa',   600::numeric, 6)
  ) as o(nombre, precio, orden);

  get diagnostics v_n = row_count;
  if v_n <> 6 then
    raise exception 'seed: opciones de Adicionales escribio % filas, esperaba 6', v_n;
  end if;

  insert into public.opciones (tenant_id, grupo_id, nombre, precio, orden)
  select v_tenant, v_grp_sacar, o.nombre, 0::numeric, o.orden
  from (values
    ('Sin cebolla',  1),
    ('Sin tomate',   2),
    ('Sin lechuga',  3),
    ('Sin pickles',  4),
    ('Sin salsa',    5),
    ('Sin queso',    6)
  ) as o(nombre, orden);

  get diagnostics v_n = row_count;
  if v_n <> 6 then
    raise exception 'seed: opciones de Sacar ingredientes escribio % filas, esperaba 6', v_n;
  end if;

  -- Los dos grupos aplican a las 10 hamburguesas.
  insert into public.producto_grupos (tenant_id, producto_id, grupo_id, orden)
  select v_tenant, p.id, g.grupo_id, g.orden
  from public.productos p
  cross join (values (v_grp_extras, 1), (v_grp_sacar, 2)) as g(grupo_id, orden)
  where p.tenant_id = v_tenant
    and p.categoria_id = v_cat_burgers;

  get diagnostics v_n = row_count;
  if v_n <> 20 then
    raise exception 'seed: producto_grupos escribio % filas, esperaba 20', v_n;
  end if;

  -- ---------- HORARIOS: martes a domingo, 20:00 a 01:00 ----------
  -- dia_semana 0 = domingo. Lunes (1) cerrado.
  -- cierra (01:00) < abre (20:00) ⇒ el turno cruza medianoche, y el
  -- día que se guarda es el de APERTURA.
  insert into public.horarios (tenant_id, dia_semana, abre, cierra, ultimo_pedido_min_antes)
  select v_tenant, d.dia, time '20:00', time '01:00', 30
  from (values (2),(3),(4),(5),(6),(0)) as d(dia);

  get diagnostics v_n = row_count;
  if v_n <> 6 then
    raise exception 'seed: horarios escribio % filas, esperaba 6', v_n;
  end if;

  -- ---------- 3 ZONAS DE DELIVERY ----------
  insert into public.zonas_delivery (tenant_id, nombre, precio_envio, pedido_minimo, minutos_extra, barrios, orden)
  values
    (v_tenant, 'Centro',     1800, 8000,  0, array['Centro','Área Centro','Balcarce','Güemes'],                       1),
    (v_tenant, 'Zona Norte', 2600, 12000, 10, array['Tres Cerritos','Grand Bourg','Castañares','Ciudad del Milagro'], 2),
    (v_tenant, 'Zona Sur',   3200, 15000, 18, array['Limache','San Remo','El Tribuno','Santa Ana','Solidaridad'],     3);

  get diagnostics v_n = row_count;
  if v_n <> 3 then
    raise exception 'seed: zonas_delivery escribio % filas, esperaba 3', v_n;
  end if;

  raise notice 'seed mola OK: tenant %, 18 productos, 30 variantes, 6 horarios, 3 zonas', v_tenant;
end;
$seed$;
