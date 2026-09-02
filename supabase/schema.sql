-- ============================================================
-- BEA Estimaciones — Schema de Supabase
-- Ejecutar en el SQL Editor de tu proyecto Supabase
-- ============================================================

-- ── 1. Profiles (uno por usuario de auth) ──────────────────
create table if not exists profiles (
  id        uuid primary key references auth.users on delete cascade,
  email     text not null,
  nombre    text not null default '',
  role      text not null default 'lider' check (role in ('lider', 'coordinador'))
);
alter table profiles enable row level security;

create policy "profiles: usuario ve su propio perfil"
  on profiles for select using (auth.uid() = id);

create policy "profiles: usuario edita su propio perfil"
  on profiles for update using (auth.uid() = id);

-- Auto-crear perfil al registrar usuario
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, nombre, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    coalesce(new.raw_user_meta_data->>'role', 'lider')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 2. Helper: ¿es coordinador? ────────────────────────────
create or replace function public.is_coordinador()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'coordinador'
  );
$$;

-- ── 3. Projects ─────────────────────────────────────────────
create table if not exists projects (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references profiles(id) on delete cascade,
  name                 text not null default 'Nuevo Proyecto',
  client               text not null default '',
  location             text not null default '',
  service_type         text not null default 'LEED BD+C',
  phase                text not null default 'Diseño',
  status               text not null default 'Activo' check (status in ('Activo','Pausado','Cancelado')),
  start_date           date,
  end_date             date,
  currency             text not null default 'MXN' check (currency in ('MXN','USD')),
  client_contact_name  text not null default '',
  client_contact_email text not null default '',
  meses_fase2          integer not null default 8,
  meses_fase3          integer not null default 18,
  team                 jsonb not null default '{"lider":"","cx":"","me":"","consultor":"","coordinador":""}',
  created_at           timestamptz not null default now()
);
alter table projects enable row level security;

create policy "projects: lider ve sus proyectos"
  on projects for select
  using (user_id = auth.uid() or public.is_coordinador());

create policy "projects: lider crea sus proyectos"
  on projects for insert
  with check (user_id = auth.uid());

create policy "projects: lider edita sus proyectos"
  on projects for update
  using (user_id = auth.uid() or public.is_coordinador());

create policy "projects: lider elimina sus proyectos"
  on projects for delete
  using (user_id = auth.uid());

-- ── 4. Disciplines ──────────────────────────────────────────
create table if not exists disciplines (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null default '',
  monto_total numeric(14,2) not null default 0,
  descuento   numeric(5,2)  not null default 0,
  tarifa_hh   numeric(10,2) not null default 0,
  sort_order  integer not null default 0
);
alter table disciplines enable row level security;

create policy "disciplines: acceso via proyecto"
  on disciplines for all
  using (
    exists (
      select 1 from projects p
      where p.id = disciplines.project_id
        and (p.user_id = auth.uid() or public.is_coordinador())
    )
  );

-- ── 5. Concepts ─────────────────────────────────────────────
create table if not exists concepts (
  id            uuid primary key default gen_random_uuid(),
  discipline_id uuid not null references disciplines(id) on delete cascade,
  key           text not null default '',
  description   text not null default '',
  deliverable   text not null default '',
  pct           numeric(10,6) not null default 0,
  month         text not null default '',
  type          text not null default 'Normal' check (type in ('Normal','Finiquito')),
  sort_order    integer not null default 0
);
alter table concepts enable row level security;

create policy "concepts: acceso via proyecto"
  on concepts for all
  using (
    exists (
      select 1 from disciplines d
      join projects p on p.id = d.project_id
      where d.id = concepts.discipline_id
        and (p.user_id = auth.uid() or public.is_coordinador())
    )
  );

-- ── 6. Estimations ──────────────────────────────────────────
create table if not exists estimations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  number      integer not null default 1,
  status      text not null default 'Borrador' check (status in ('Borrador','Enviada')),
  period_from date not null,
  period_to   date not null,
  anticipo    numeric(14,2) not null default 0,
  created_at  timestamptz not null default now()
);
alter table estimations enable row level security;

create policy "estimations: acceso via proyecto"
  on estimations for all
  using (
    exists (
      select 1 from projects p
      where p.id = estimations.project_id
        and (p.user_id = auth.uid() or public.is_coordinador())
    )
  );

-- ── 7. Estimation items ─────────────────────────────────────
create table if not exists estimation_items (
  id             uuid primary key default gen_random_uuid(),
  estimation_id  uuid not null references estimations(id) on delete cascade,
  concept_id     uuid not null references concepts(id) on delete cascade,
  included       boolean not null default false,
  amount         numeric(14,2) not null default 0,
  amount_parcial numeric(14,2) not null default 0,
  parcial_enabled boolean not null default false,
  pct_parcial    numeric(5,2)  not null default 0,
  delayed        boolean not null default false,
  cause          text not null default '',
  unique(estimation_id, concept_id)
);
alter table estimation_items enable row level security;

create policy "estimation_items: acceso via estimacion"
  on estimation_items for all
  using (
    exists (
      select 1 from estimations e
      join projects p on p.id = e.project_id
      where e.id = estimation_items.estimation_id
        and (p.user_id = auth.uid() or public.is_coordinador())
    )
  );

-- ── 8. Report data (uno por estimación) ─────────────────────
create table if not exists report_data (
  id                    uuid primary key default gen_random_uuid(),
  estimation_id         uuid not null unique references estimations(id) on delete cascade,
  acciones_realizadas   jsonb not null default '[]',
  acciones_pendientes   jsonb not null default '[]',
  informacion_pendiente jsonb not null default '[]',
  riesgos               jsonb not null default '[]',
  entregables           jsonb not null default '[]',
  no_riesgos            boolean not null default false,
  no_anexos             boolean not null default false
);
alter table report_data enable row level security;

create policy "report_data: acceso via estimacion"
  on report_data for all
  using (
    exists (
      select 1 from estimations e
      join projects p on p.id = e.project_id
      where e.id = report_data.estimation_id
        and (p.user_id = auth.uid() or public.is_coordinador())
    )
  );

-- ── 9. Report anexos ────────────────────────────────────────
create table if not exists report_anexos (
  id            uuid primary key default gen_random_uuid(),
  estimation_id uuid not null references estimations(id) on delete cascade,
  texto         text not null default '',
  file_name     text not null default '',
  file_type     text not null default '',
  file_path     text not null default '',
  file_size     integer not null default 0,
  created_at    timestamptz not null default now()
);
alter table report_anexos enable row level security;

create policy "report_anexos: acceso via estimacion"
  on report_anexos for all
  using (
    exists (
      select 1 from estimations e
      join projects p on p.id = e.project_id
      where e.id = report_anexos.estimation_id
        and (p.user_id = auth.uid() or public.is_coordinador())
    )
  );

-- ── 10. Aditivas ────────────────────────────────────────────
create table if not exists aditivas (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  number          integer not null default 1,
  fecha           date,
  ciudad          text not null default 'San Pedro Garza García, N.L.',
  cliente_nombre  text not null default '',
  cliente_atn     text not null default '',
  cliente_email   text not null default '',
  proyecto        text not null default '',
  asunto          text not null default '',
  status          text not null default 'Borrador'
                    check (status in ('Borrador','Enviada','Aceptada','Negada','Negociacion')),
  fecha_aceptada  date,
  fecha_rechazada date,
  status_history  jsonb not null default '[]',
  created_at      timestamptz not null default now()
);
alter table aditivas enable row level security;

create policy "aditivas: acceso via proyecto"
  on aditivas for all
  using (
    exists (
      select 1 from projects p
      where p.id = aditivas.project_id
        and (p.user_id = auth.uid() or public.is_coordinador())
    )
  );

-- ── 11. Aditiva alcances ────────────────────────────────────
create table if not exists aditiva_alcances (
  id          uuid primary key default gen_random_uuid(),
  aditiva_id  uuid not null references aditivas(id) on delete cascade,
  descripcion text not null default '',
  monto       numeric(14,2) not null default 0,
  sort_order  integer not null default 0
);
alter table aditiva_alcances enable row level security;

create policy "aditiva_alcances: acceso via aditiva"
  on aditiva_alcances for all
  using (
    exists (
      select 1 from aditivas a
      join projects p on p.id = a.project_id
      where a.id = aditiva_alcances.aditiva_id
        and (p.user_id = auth.uid() or public.is_coordinador())
    )
  );

-- ── 12. Storage bucket para anexos ──────────────────────────
-- Ejecutar por separado o en el panel de Storage:
-- insert into storage.buckets (id, name, public) values ('report-anexos', 'report-anexos', false);
