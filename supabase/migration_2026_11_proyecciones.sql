-- Proyecciones de cobro (nov 2026).
-- Cada persona del proyecto proyecta qué va a estimar en los meses que vienen, por área y,
-- si se puede, por concepto. Lo proyectado para un mes se precarga en la estimación de ese mes.
-- mes = mes de EJECUCIÓN (el periodo de la estimación); se factura al mes siguiente.

create table if not exists proyecciones (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  mes         text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  area        text not null check (area in ('Consultoría','Commissioning','Modelación')),
  concept_id  uuid references concepts(id) on delete set null,
  descripcion text not null default '',
  monto       numeric(14,2) not null default 0 check (monto >= 0),
  tbd         boolean not null default false,          -- "por definir": se sabe qué, no cuánto
  origen      text not null default 'app' check (origen in ('app','excel')),
  creado_por  text not null default public.my_email(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists proyecciones_proyecto on proyecciones(project_id, mes);
create index if not exists proyecciones_mes on proyecciones(mes);
-- Un concepto se proyecta una sola vez por mes
create unique index if not exists proyecciones_concepto_mes on proyecciones(concept_id, mes) where concept_id is not null;

alter table proyecciones enable row level security;

-- Ver: cualquiera con sesión (como los proyectos)
drop policy if exists "proyecciones: ver" on proyecciones;
create policy "proyecciones: ver" on proyecciones for select using (public.puede_ver_proyectos());

-- Capturar y cambiar: quien está en el proyecto (cualquier rol), su creador o un coordinador
drop policy if exists "proyecciones: equipo del proyecto" on proyecciones;
create policy "proyecciones: equipo del proyecto" on proyecciones for all
  using (public.can_access_project(project_id))
  with check (public.can_access_project(project_id));
