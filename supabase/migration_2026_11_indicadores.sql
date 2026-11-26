-- Indicadores RC-OP-43 (nov 2026): horas-hombre por proyecto y área contra el % de avance.
-- Se guardan por CLAVE de proyecto (los dígitos con que empieza el nombre: "581", "564"…), igual que
-- en el Excel RC-OP-43 y en Toggl, porque un portafolio (564) tiene varios proyectos con la misma clave.
--
-- horas_presupuesto: horas de la orden de trabajo por área y el acumulado de arranque (base_hh al cierre de base_mes).
-- horas_mes:         horas trabajadas de cada mes por área (del CSV de Toggl o del RC-OP-43 de arranque).
-- Acumulado de un mes M = base_hh + suma de horas_mes con base_mes < mes <= M.

create table if not exists horas_presupuesto (
  codigo          text not null,
  area            text not null check (area in ('Consultoría','Commissioning','Modelación')),
  presupuesto_hh  numeric(10,2),
  base_hh         numeric(10,2) not null default 0,
  base_mes        text check (base_mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  actualizado_por text not null default public.my_email(),
  actualizado_at  timestamptz not null default now(),
  primary key (codigo, area)
);

create table if not exists horas_mes (
  codigo       text not null,
  mes          text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  area         text not null check (area in ('Consultoría','Commissioning','Modelación')),
  horas        numeric(10,2) not null default 0,
  origen       text not null default 'toggl' check (origen in ('toggl','rc-op-43','manual')),
  importado_por text not null default public.my_email(),
  importado_at  timestamptz not null default now(),
  primary key (codigo, mes, area)
);
create index if not exists horas_mes_mes on horas_mes(mes);

-- ¿Puede administrar algún proyecto con esa clave? (líder, creador o coordinador)
create or replace function public.can_manage_codigo(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_coordinador() or exists (
    select 1 from projects p
    where split_part(regexp_replace(trim(p.name), '[_ ]', '-', 'g'), '-', 1) = c
      and public.can_manage_project(p.id))
$$;
revoke execute on function public.can_manage_codigo(text) from anon;

alter table horas_presupuesto enable row level security;
alter table horas_mes enable row level security;

-- Ver: cualquiera con sesión (igual que los proyectos)
drop policy if exists "horas_presupuesto: ver" on horas_presupuesto;
create policy "horas_presupuesto: ver" on horas_presupuesto for select using (public.puede_ver_proyectos());
drop policy if exists "horas_mes: ver" on horas_mes;
create policy "horas_mes: ver" on horas_mes for select using (public.puede_ver_proyectos());

-- Presupuesto: el líder del proyecto o un coordinador
drop policy if exists "horas_presupuesto: líder o coordinador" on horas_presupuesto;
create policy "horas_presupuesto: líder o coordinador" on horas_presupuesto for all
  using (public.can_manage_codigo(codigo)) with check (public.can_manage_codigo(codigo));

-- Horas del mes: solo coordinador (PMO importa el CSV de Toggl)
drop policy if exists "horas_mes: coordinador" on horas_mes;
create policy "horas_mes: coordinador" on horas_mes for all
  using (public.is_coordinador()) with check (public.is_coordinador());
