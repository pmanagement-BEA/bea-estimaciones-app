-- Ligado de actividades de Toggl/Track a conceptos del contrato (nov 2026).
-- El ligado automático se calcula en la app (por código de la actividad, palabras clave y reparto por mes);
-- aquí solo se guardan las CORRECCIONES manuales del líder o un coordinador, que mandan sobre lo automático.
--   concepto_id      → todas las horas de la actividad van a ese concepto
--   disciplina_id    → van a esa fase/disciplina y se reparten por mes entre sus conceptos cobrados
--   ignorar = true   → no se atribuyen a ningún concepto
create table if not exists track_actividad_concepto (
  actividad_id   bigint primary key references track_actividades(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  concepto_id    uuid references concepts(id) on delete set null,
  disciplina_id  uuid references disciplines(id) on delete set null,
  ignorar        boolean not null default false,
  actualizado_por text not null default public.my_email(),
  actualizado_at  timestamptz not null default now()
);
create index if not exists track_actividad_concepto_proj on track_actividad_concepto(project_id);

alter table track_actividad_concepto enable row level security;
drop policy if exists "actividad_concepto: ver" on track_actividad_concepto;
create policy "actividad_concepto: ver" on track_actividad_concepto for select using (auth.uid() is not null);
drop policy if exists "actividad_concepto: líder o coordinador" on track_actividad_concepto;
create policy "actividad_concepto: líder o coordinador" on track_actividad_concepto for all
  using (public.is_coordinador() or public.can_manage_project(project_id))
  with check (public.is_coordinador() or public.can_manage_project(project_id));
