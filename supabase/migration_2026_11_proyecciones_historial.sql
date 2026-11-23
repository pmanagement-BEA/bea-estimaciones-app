-- Baúl de proyecciones (nov 2026): historial de cada proyección.
-- Cada alta, cambio o baja de una proyección queda guardada con quién y cuándo, también las de meses futuros.
-- Así se puede ver qué se tenía proyectado para un mes en cualquier fecha (por ejemplo, al congelarse el día 15)
-- y cómo fue cambiando: sirve para los indicadores (proyectado contra estimado).
-- Nadie escribe aquí directamente: lo llena el trigger.

create table if not exists proyecciones_historial (
  id             bigint generated always as identity primary key,
  proyeccion_id  uuid not null,
  project_id     uuid not null,
  accion         text not null check (accion in ('alta', 'cambio', 'baja')),
  mes            text not null,
  area           text not null,
  concept_id     uuid,
  descripcion    text not null default '',
  monto          numeric(14,2) not null default 0,
  tbd            boolean not null default false,
  mes_antes      text,
  monto_antes    numeric(14,2),
  tbd_antes      boolean,
  origen         text not null default 'app',
  hecho_por      text not null default '',
  hecho_en       timestamptz not null default now()
);
create index if not exists proyecciones_historial_mes on proyecciones_historial(mes, hecho_en);
create index if not exists proyecciones_historial_proyecto on proyecciones_historial(project_id, hecho_en);
create index if not exists proyecciones_historial_proyeccion on proyecciones_historial(proyeccion_id, hecho_en);

alter table proyecciones_historial enable row level security;
drop policy if exists "proyecciones_historial: ver" on proyecciones_historial;
create policy "proyecciones_historial: ver" on proyecciones_historial for select using (public.puede_ver_proyectos());

create or replace function public.registrar_proyeccion() returns trigger language plpgsql security definer set search_path = public as $$
declare quien text := coalesce(nullif(public.my_email(), ''), 'PMO (SQL)');
begin
  if tg_op = 'INSERT' then
    insert into proyecciones_historial (proyeccion_id, project_id, accion, mes, area, concept_id, descripcion, monto, tbd, origen, hecho_por)
    values (new.id, new.project_id, 'alta', new.mes, new.area, new.concept_id, new.descripcion, new.monto, new.tbd, new.origen,
            case when new.origen = 'excel' then new.creado_por else quien end);
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.mes, new.area, new.concept_id, new.descripcion, new.monto, new.tbd) is not distinct from
       (old.mes, old.area, old.concept_id, old.descripcion, old.monto, old.tbd) then return new; end if;
    insert into proyecciones_historial (proyeccion_id, project_id, accion, mes, area, concept_id, descripcion, monto, tbd, mes_antes, monto_antes, tbd_antes, origen, hecho_por)
    values (new.id, new.project_id, 'cambio', new.mes, new.area, new.concept_id, new.descripcion, new.monto, new.tbd, old.mes, old.monto, old.tbd, new.origen, quien);
    return new;
  else
    insert into proyecciones_historial (proyeccion_id, project_id, accion, mes, area, concept_id, descripcion, monto, tbd, mes_antes, monto_antes, tbd_antes, origen, hecho_por)
    values (old.id, old.project_id, 'baja', old.mes, old.area, old.concept_id, old.descripcion, 0, false, old.mes, old.monto, old.tbd, old.origen, quien);
    return old;
  end if;
end $$;

drop trigger if exists proyecciones_historial on proyecciones;
create trigger proyecciones_historial after insert or update or delete on proyecciones
  for each row execute function public.registrar_proyeccion();

-- Arranque: lo que ya existe entra al historial como "alta" en la fecha en que se capturó (una sola vez)
insert into proyecciones_historial (proyeccion_id, project_id, accion, mes, area, concept_id, descripcion, monto, tbd, origen, hecho_por, hecho_en)
select p.id, p.project_id, 'alta', p.mes, p.area, p.concept_id, p.descripcion, p.monto, p.tbd, p.origen, p.creado_por, p.created_at
from proyecciones p
where not exists (select 1 from proyecciones_historial h where h.proyeccion_id = p.id);
