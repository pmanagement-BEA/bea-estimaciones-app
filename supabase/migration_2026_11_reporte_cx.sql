-- Reporte mensual de Cx (nov 2026): uno por proyecto y mes, como el Google Sheet "REPORTES MENSUALES".
-- Secciones: matriz de equipos (% avance por sistema), issues log de diseño y de construcción
-- (ingresos / abierto / en proceso / cerrado por sistema), reuniones y acuerdos, y los conceptos
-- que se pueden cobrar en el mes (van en el correo al líder).
create table if not exists reportes_cx (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  mes                text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  fecha_corte        date,
  matriz             jsonb not null default '{}',   -- { hvac: 35, electrico: null (NA), … }
  nota_matriz        text not null default '',
  issues_diseno      jsonb not null default '{}',   -- { hvac: { ingresos, abierto, proceso, cerrado } | null (NA) }
  nota_diseno        text not null default '',
  issues_construccion jsonb not null default '{}',
  nota_construccion  text not null default '',
  comentarios        text not null default '',
  conceptos_cobrar   uuid[] not null default '{}',
  estado             text not null default 'borrador' check (estado in ('borrador', 'enviado')),
  actualizado_por    text not null default public.my_email(),
  actualizado_at     timestamptz not null default now(),
  unique (project_id, mes)
);

-- ¿Puede editar el reporte? Coordinador, quien administra el proyecto o su responsable de Cx
create or replace function public.puede_reporte_cx(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_coordinador() or public.can_manage_project(pid)
      or exists (select 1 from project_members m where m.project_id = pid and m.rol = 'cx' and lower(m.email) = public.my_email())
$$;
revoke execute on function public.puede_reporte_cx(uuid) from anon;

alter table reportes_cx enable row level security;
drop policy if exists "reportes_cx: ver" on reportes_cx;
create policy "reportes_cx: ver" on reportes_cx for select using (auth.uid() is not null);
drop policy if exists "reportes_cx: editar" on reportes_cx;
create policy "reportes_cx: editar" on reportes_cx for all
  using (public.puede_reporte_cx(project_id)) with check (public.puede_reporte_cx(project_id));
