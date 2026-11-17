-- ============================================================
-- Directorio de colaboradores y asignación automática de proyectos
-- Requiere antes: migration_2026_11_correcciones.sql
-- Ejecutar en: Supabase Dashboard → SQL Editor (se puede correr más de una vez)
-- ============================================================

-- ── 1. Directorio ───────────────────────────────────────────
-- Lista de todos los colaboradores de BEA. Se carga desde la app (página
-- Directorio, solo coordinadores). Una persona puede estar en el directorio
-- y asignada a proyectos ANTES de tener cuenta: la liga es por correo.
create table if not exists directorio (
  email      text primary key check (email = lower(email)),
  nombre     text not null default '',
  area       text check (area is null or area in ('Consultoría','Commissioning','Modelación','Dirección / PMO')),
  puesto     text not null default '',
  rol_app    text not null default 'colaborador' check (rol_app in ('colaborador','lider','coordinador')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table directorio enable row level security;

drop policy if exists "directorio: autenticados lo ven" on directorio;
create policy "directorio: autenticados lo ven"
  on directorio for select using (auth.uid() is not null);

drop policy if exists "directorio: coordinador lo edita" on directorio;
create policy "directorio: coordinador lo edita"
  on directorio for all using (public.is_coordinador()) with check (public.is_coordinador());

-- ── 2. Perfiles: área y nuevo rol 'colaborador' ─────────────
alter table profiles add column if not exists area text;
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('colaborador','lider','coordinador'));

-- Todos los usuarios con sesión pueden ver nombres del equipo (no solo el suyo)
drop policy if exists "profiles: autenticados ven el equipo" on profiles;
create policy "profiles: autenticados ven el equipo"
  on profiles for select using (auth.uid() is not null);

-- Al crear la cuenta, el perfil toma nombre, área y rol del directorio.
-- Si el correo no está en el directorio, nace como 'colaborador' sin proyectos.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare d directorio%rowtype;
begin
  select * into d from directorio where email = lower(new.email);
  insert into public.profiles (id, email, nombre, role, area)
  values (
    new.id,
    new.email,
    coalesce(nullif(d.nombre, ''), new.raw_user_meta_data->>'nombre', ''),
    coalesce(d.rol_app, 'colaborador'),
    d.area
  );
  return new;
end;
$$;

-- Si un coordinador cambia a alguien en el directorio, su perfil se actualiza.
create or replace function public.sync_profile_from_directorio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update profiles
     set nombre = coalesce(nullif(new.nombre, ''), nombre),
         role   = new.rol_app,
         area   = new.area
   where lower(email) = new.email;
  return new;
end;
$$;

drop trigger if exists directorio_sync_profile on directorio;
create trigger directorio_sync_profile
  after insert or update on directorio
  for each row execute procedure public.sync_profile_from_directorio();

-- ── 3. Asignaciones de proyecto ─────────────────────────────
create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  email      text not null check (email = lower(email)),
  rol        text not null check (rol in ('lider','cx','me','consultor','coordinador')),
  created_at timestamptz not null default now(),
  primary key (project_id, rol, email)
);
create index if not exists project_members_email_idx on project_members(email);
alter table project_members enable row level security;

create or replace function public.my_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt()->>'email', ''))
$$;

-- ¿Puede ver/editar el proyecto? Dueño, coordinador o asignado.
create or replace function public.can_access_project(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = pid
      and (
        p.user_id = auth.uid()
        or public.is_coordinador()
        or exists (select 1 from project_members m
                   where m.project_id = p.id and m.email = public.my_email())
      )
  );
$$;

-- ¿Puede cambiar el equipo? Dueño, coordinador o líder asignado.
create or replace function public.can_manage_project(pid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = pid
      and (
        p.user_id = auth.uid()
        or public.is_coordinador()
        or exists (select 1 from project_members m
                   where m.project_id = p.id and m.rol = 'lider' and m.email = public.my_email())
      )
  );
$$;

drop policy if exists "project_members: ven los del proyecto" on project_members;
create policy "project_members: ven los del proyecto"
  on project_members for select using (public.can_access_project(project_id));

drop policy if exists "project_members: lider o coordinador asigna" on project_members;
create policy "project_members: lider o coordinador asigna"
  on project_members for all
  using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

-- ── 4. Permisos: los asignados ven y trabajan el proyecto ───
drop policy if exists "projects: lider ve sus proyectos" on projects;
create policy "projects: lider ve sus proyectos"
  on projects for select using (public.can_access_project(id));

drop policy if exists "projects: lider edita sus proyectos" on projects;
create policy "projects: lider edita sus proyectos"
  on projects for update using (public.can_manage_project(id));

drop policy if exists "disciplines: acceso via proyecto" on disciplines;
create policy "disciplines: acceso via proyecto"
  on disciplines for all using (public.can_access_project(project_id));

drop policy if exists "concepts: acceso via proyecto" on concepts;
create policy "concepts: acceso via proyecto"
  on concepts for all using (
    exists (select 1 from disciplines d
            where d.id = concepts.discipline_id and public.can_access_project(d.project_id))
  );

drop policy if exists "estimations: acceso via proyecto" on estimations;
create policy "estimations: acceso via proyecto"
  on estimations for all using (public.can_access_project(project_id));

drop policy if exists "estimation_items: acceso via estimacion" on estimation_items;
create policy "estimation_items: acceso via estimacion"
  on estimation_items for all using (
    exists (select 1 from estimations e
            where e.id = estimation_items.estimation_id and public.can_access_project(e.project_id))
  );

drop policy if exists "report_data: acceso via estimacion" on report_data;
create policy "report_data: acceso via estimacion"
  on report_data for all using (
    exists (select 1 from estimations e
            where e.id = report_data.estimation_id and public.can_access_project(e.project_id))
  );

drop policy if exists "report_anexos: acceso via estimacion" on report_anexos;
create policy "report_anexos: acceso via estimacion"
  on report_anexos for all using (
    exists (select 1 from estimations e
            where e.id = report_anexos.estimation_id and public.can_access_project(e.project_id))
  );

drop policy if exists "aditivas: acceso via proyecto" on aditivas;
create policy "aditivas: acceso via proyecto"
  on aditivas for all using (public.can_access_project(project_id));

drop policy if exists "aditiva_alcances: acceso via aditiva" on aditiva_alcances;
create policy "aditiva_alcances: acceso via aditiva"
  on aditiva_alcances for all using (
    exists (select 1 from aditivas a
            where a.id = aditiva_alcances.aditiva_id and public.can_access_project(a.project_id))
  );

-- Solo líderes (Consultoría) y coordinadores crean proyectos nuevos
drop policy if exists "projects: lider crea sus proyectos" on projects;
create policy "projects: lider crea sus proyectos"
  on projects for insert with check (
    user_id = auth.uid()
    and exists (select 1 from profiles where id = auth.uid() and role in ('lider','coordinador'))
  );
