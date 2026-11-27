-- Conceptos marcados en el borrador de estimación desde Track: quién y cuándo (se ven en la estimación).
alter table estimation_items add column if not exists marcado_desde text;
alter table estimation_items add column if not exists marcado_por   text not null default '';
alter table estimation_items add column if not exists marcado_en    timestamptz;
