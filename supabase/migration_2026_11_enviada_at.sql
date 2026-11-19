-- Fecha en que se marcó como Enviada cada estimación: el periodo de la siguiente empieza ese día
-- y el periodo de la estimación termina el día en que se envía.
alter table estimations add column if not exists enviada_at timestamptz;
