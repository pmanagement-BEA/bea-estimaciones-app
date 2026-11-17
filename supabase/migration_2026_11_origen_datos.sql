-- Migración de estimaciones desde Drive (nov 2026)
-- 1) origen_datos: de dónde salió lo cargado en cada proyecto.
--    'app'              → creado/capturado en la plataforma (default)
--    'libro'            → importado de su Libro BEA (RC-OP-07-11), conciliado mes a mes
--    'formato_cliente'  → importado del soporte en formato del cliente
--    'sin_estimaciones' → NO se encontraron estimaciones en Drive: se dio de alta vacío,
--                         sin conceptos ni saldo. Se captura a mano en la plataforma
--                         cuando el proyecto se active o reactive.
-- 2) nota_migracion: detalle (archivo fuente, qué faltó, quién lo revisó).
-- 3) Estado 'Terminado' (por estimar = 0).

alter table projects add column if not exists origen_datos text not null default 'app';
alter table projects drop constraint if exists projects_origen_datos_check;
alter table projects add constraint projects_origen_datos_check
  check (origen_datos in ('app','libro','formato_cliente','sin_estimaciones'));

alter table projects add column if not exists nota_migracion text not null default '';

alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check
  check (status in ('Activo','Pausado','Terminado','Cancelado'));

-- 4) Más decimales para que lo migrado cuadre al peso con los Excel
--    (anticipos como 5.567 %, descuentos como 17.647 %, avances parciales como 33.333 %).
alter table projects          alter column anticipo_pct  type numeric(9,6);
alter table projects          alter column finiquito_pct type numeric(9,6);
alter table disciplines       alter column descuento     type numeric(9,6);
alter table estimation_items  alter column pct_parcial   type numeric(9,6);
