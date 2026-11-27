-- Histórico de Toggl por actividad (nov 2026): horas de cada persona por actividad (task de Toggl) y mes.
-- Complementa track_historico (que solo trae proyecto y persona). El proyecto sale de track_actividades.proyecto_id.
create table if not exists track_historico_act (
  mes          text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  actividad_id bigint not null references track_actividades(id) on delete cascade,
  email        text not null default '',
  nombre       text not null default '',
  segundos     bigint not null default 0,
  primary key (mes, actividad_id, email)
);
create index if not exists track_historico_act_act on track_historico_act(actividad_id);

alter table track_historico_act enable row level security;
drop policy if exists "track_historico_act: lo suyo o todo" on track_historico_act;
create policy "track_historico_act: lo suyo o todo" on track_historico_act for select
  using (auth.uid() is not null and (email = public.my_email() or public.ve_todo_track()));
drop policy if exists "track_historico_act: coordinador edita" on track_historico_act;
create policy "track_historico_act: coordinador edita" on track_historico_act for all
  using (public.is_coordinador()) with check (public.is_coordinador());
