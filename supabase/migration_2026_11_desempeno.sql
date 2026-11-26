-- Reporte de desempeño (nov 2026): lo ven los coordinadores (rol_app = 'coordinador' o is_coordinador())
-- y quien tenga directorio.ve_desempeno = true (PMO / CEO que no son coordinadores).
-- Ellos también ven las horas de todo el equipo en Track.
alter table directorio add column if not exists ve_desempeno boolean not null default false;

create or replace function public.ve_desempeno()
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_coordinador()
      or exists (select 1 from directorio
                 where email = public.my_email() and activo
                   and (rol_app = 'coordinador' or ve_desempeno));
$$;

create or replace function public.ve_todo_track()
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_coordinador() or public.es_admin_checador() or public.ve_desempeno();
$$;
