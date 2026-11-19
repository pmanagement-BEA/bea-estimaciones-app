-- Periodos reales de las estimaciones importadas (texto "PERIODO DE ESTIMACIÓN" de cada hoja del libro)
create table if not exists periodos_respaldo_2026_11 as select id, period_from, period_to from estimations;
alter table periodos_respaldo_2026_11 enable row level security;

update estimations e set period_from = v.f, period_to = v.t
from (values
  ('0b6a9eb1-8dd6-526b-a8e0-b3aec9e8dd46'::uuid, '2026-05-11'::date, '2026-10-10'::date),
  ('80f39702-f92e-52c5-8c75-761aac7909b7'::uuid, '2026-10-11'::date, '2026-11-10'::date),
  ('ef03f529-ae94-5882-8731-2ff7b42eecbb'::uuid, '2026-10-01'::date, '2026-10-30'::date),
  ('8d329ab1-03bb-5f0f-b13f-dc697e6acbc4'::uuid, '2026-09-04'::date, '2026-09-30'::date),
  ('739a3b28-03f6-5bd9-89f6-1abc64af3696'::uuid, '2026-09-04'::date, '2026-09-30'::date),
  ('be2b5f97-1ea8-547d-857b-4a74178dd57d'::uuid, '2026-09-01'::date, '2026-10-31'::date),
  ('af298711-936e-51a5-a273-877c2b3793af'::uuid, '2026-10-01'::date, '2026-10-30'::date),
  ('fc88dbc2-66a3-530f-bb78-a1d3a98e1af8'::uuid, '2026-10-01'::date, '2026-10-30'::date),
  ('6fbc03ff-bd97-54db-b2cd-d8db2ffb1383'::uuid, '2023-01-01'::date, '2023-02-17'::date),
  ('d17ba3e6-2298-5752-b385-19d25cd2b2b9'::uuid, '2026-03-01'::date, '2026-04-30'::date),
  ('440e4d4a-a981-5c51-b556-d8d6c187fc43'::uuid, '2026-02-05'::date, '2026-03-04'::date),
  ('d79da104-6b46-5c21-bbdf-a225e6057598'::uuid, '2025-04-01'::date, '2025-07-31'::date),
  ('1731bdfc-7e18-501f-8116-03acd1e6a514'::uuid, '2026-03-05'::date, '2026-04-04'::date),
  ('fdd69f94-0555-5332-8289-1464cd0598dc'::uuid, '2026-04-05'::date, '2026-05-04'::date),
  ('634a7dbf-03fd-53d8-9bb6-346ad222419f'::uuid, '2026-05-18'::date, '2026-06-17'::date),
  ('c9e5765e-b8b3-596c-86e7-c8fc8295baef'::uuid, '2026-04-01'::date, '2026-08-31'::date),
  ('9fc9ac7c-c969-566e-9f3a-23bade4a998b'::uuid, '2026-02-16'::date, '2026-03-04'::date),
  ('f5023712-c5bf-5371-948c-836cfd299273'::uuid, '2026-07-01'::date, '2026-07-30'::date)
) v(id, f, t)
where e.id = v.id;

-- Borradores creados como mes de calendario en proyectos que estiman con otro corte (p. ej. del 11 al 10):
-- pasan al periodo en turno según su última estimación enviada
update estimations d set period_from = x.f, period_to = x.t
from estimations b
join lateral (select period_from, period_to from estimations e where e.project_id = b.project_id and e.status = 'Enviada' order by number desc limit 1) u on true
join lateral (
  select (u.period_to + 1 + k * interval '1 month')::date f, (u.period_to + 1 + (k + 1) * interval '1 month' - interval '1 day')::date t
  from generate_series(0, 240) k
  where (u.period_to + 1 + (k + 1) * interval '1 month' - interval '1 day')::date >= current_date
  order by k limit 1
) x on true
where d.id = b.id and b.status = 'Borrador' and extract(day from u.period_from) <> 1
  and b.period_from = date_trunc('month', b.period_from)::date
  and b.period_to = (date_trunc('month', b.period_from) + interval '1 month' - interval '1 day')::date;

select p.name, e.number, e.status, e.period_from, e.period_to from estimations e join projects p on p.id = e.project_id
where e.status = 'Borrador' and extract(day from e.period_from) <> 1 order by p.name;
