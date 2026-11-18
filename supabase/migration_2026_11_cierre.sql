-- Cierre de estimación por área (nov 2026)
-- Cada área (Consultoría, Commissioning, Modelación) marca su avance del mes como "listo".
-- Cuando todas las áreas que aplican están listas, el líder genera la estimación para el cliente.
-- Marca: el responsable del área en el proyecto, el líder o un coordinador.

create table if not exists estimation_area_status (
  estimation_id uuid not null references estimations(id) on delete cascade,
  area          text not null check (area in ('Consultoría','Commissioning','Modelación')),
  listo_por     text not null default public.my_email(),
  listo_nombre  text not null default '',
  listo_at      timestamptz not null default now(),
  primary key (estimation_id, area)
);
alter table estimation_area_status enable row level security;

-- ¿Puede marcar esta área en el proyecto de la estimación?
create or replace function public.can_mark_area(eid uuid, a text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from estimations e
     where e.id = eid
       and e.status = 'Borrador'
       and (
         public.is_coordinador()
         or public.can_manage_project(e.project_id)
         or exists (select 1 from project_members m
                     where m.project_id = e.project_id and m.email = public.my_email()
                       and case m.rol when 'consultor' then 'Consultoría'
                                      when 'cx'        then 'Commissioning'
                                      when 'me'        then 'Modelación' end = a)
       )
  );
$$;

drop policy if exists "area_status: ven los del proyecto" on estimation_area_status;
create policy "area_status: ven los del proyecto" on estimation_area_status for select
  using (exists (select 1 from estimations e where e.id = estimation_id and public.can_access_project(e.project_id)));

drop policy if exists "area_status: marca el responsable" on estimation_area_status;
create policy "area_status: marca el responsable" on estimation_area_status for insert
  with check (public.can_mark_area(estimation_id, area) and listo_por = public.my_email());

drop policy if exists "area_status: quita el responsable" on estimation_area_status;
create policy "area_status: quita el responsable" on estimation_area_status for delete
  using (public.can_mark_area(estimation_id, area));
