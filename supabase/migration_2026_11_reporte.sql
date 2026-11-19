-- Reporte mensual RC-OP-01: encabezado completo, nota de información pendiente y resumen del proyecto
alter table report_data add column if not exists fase_texto          text  not null default '';
alter table report_data add column if not exists estado_proyecto     text  not null default '';
alter table report_data add column if not exists inicio_fase         date;
alter table report_data add column if not exists fin_fase            date;
alter table report_data add column if not exists inicio_contrato     date;
alter table report_data add column if not exists fin_contrato        date;
alter table report_data add column if not exists avance_documental   numeric(5,2);
alter table report_data add column if not exists cliente_responsable text  not null default '';
alter table report_data add column if not exists nota_info_pendiente text  not null default '';
alter table report_data add column if not exists resumen_proyecto    jsonb not null default '[]';
