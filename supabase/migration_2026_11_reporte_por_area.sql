-- Reporte mensual por área: cada área (Consultoría, Commissioning, Modelación) llena el suyo dentro de la estimación.
-- Cuando las áreas lo marcan como listo, el líder descarga los 3. Cualquier usuario (menos rol lectura) puede capturarlo.
-- Los reportes anteriores quedan con area = null (reporte general) y sirven de punto de partida.

alter table report_data add column if not exists area      text check (area in ('Consultoría', 'Commissioning', 'Modelación'));
alter table report_data add column if not exists listo     boolean not null default false;
alter table report_data add column if not exists listo_por text    not null default '';
alter table report_data add column if not exists listo_en  timestamptz;

-- Antes: un reporte por estimación. Ahora: uno por estimación y área (el general viejo cuenta como área vacía).
alter table report_data drop constraint if exists report_data_estimation_id_key;
create unique index if not exists report_data_estimacion_area on report_data (estimation_id, coalesce(area, ''));

-- Todos capturan el reporte mensual de cualquier proyecto (no solo los asignados)
drop policy if exists "todos: capturan reportes" on report_data;
create policy "todos: capturan reportes" on report_data for insert
  with check (public.puede_ver_proyectos() and not public.is_lectura());
drop policy if exists "todos: editan reportes" on report_data;
create policy "todos: editan reportes" on report_data for update
  using (public.puede_ver_proyectos() and not public.is_lectura())
  with check (public.puede_ver_proyectos() and not public.is_lectura());
