-- Registros de Toggl uno por uno (nov 2026), para ver en el reporte diario qué hizo cada quien mientras el
-- equipo termina de pasarse a Track. Se cargan desde Toggl (id = id del registro en Toggl, así no se duplican).
create table if not exists track_toggl_entradas (
  id           bigint primary key,
  email        text not null default '',
  proyecto_id  bigint,
  actividad_id bigint,
  descripcion  text not null default '',
  inicio       timestamptz not null,
  fin          timestamptz,
  segundos     integer not null default 0
);
create index if not exists track_toggl_entradas_inicio on track_toggl_entradas(inicio);
create index if not exists track_toggl_entradas_email on track_toggl_entradas(email);

alter table track_toggl_entradas enable row level security;
drop policy if exists "toggl_entradas: lo suyo o todo" on track_toggl_entradas;
create policy "toggl_entradas: lo suyo o todo" on track_toggl_entradas for select
  using (auth.uid() is not null and (email = public.my_email() or public.ve_todo_track()));
drop policy if exists "toggl_entradas: coordinador edita" on track_toggl_entradas;
create policy "toggl_entradas: coordinador edita" on track_toggl_entradas for all
  using (public.is_coordinador()) with check (public.is_coordinador());
