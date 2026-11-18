-- Formatos de estimación propios del cliente (nov 2026)
-- Cada proyecto puede tener uno o varios (STIVA manda uno por fase). Se guarda la última estimación
-- que se le mandó al cliente en su formato; la app la usa de plantilla para generar la siguiente y,
-- al marcar la estimación como Enviada, guarda la nueva como plantilla del mes siguiente.

create table if not exists formatos_cliente (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  nombre          text not null default '',
  tipo            text not null check (tipo in ('tec','stiva')),
  archivo         text not null,              -- ruta en el bucket formatos-cliente
  archivo_nombre  text not null default '',
  numero          integer,                    -- número de estimación del cliente en ese archivo
  actualizado_por text not null default public.my_email(),
  actualizado_at  timestamptz not null default now()
);
create index if not exists formatos_cliente_proyecto on formatos_cliente(project_id);
alter table formatos_cliente enable row level security;

drop policy if exists "formatos_cliente: ven los del proyecto" on formatos_cliente;
create policy "formatos_cliente: ven los del proyecto" on formatos_cliente for select
  using (public.can_access_project(project_id));
drop policy if exists "formatos_cliente: líder o coordinador" on formatos_cliente;
create policy "formatos_cliente: líder o coordinador" on formatos_cliente for all
  using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

-- Archivos: bucket privado, carpeta = id del proyecto
insert into storage.buckets (id, name, public)
values ('formatos-cliente', 'formatos-cliente', false)
on conflict (id) do nothing;

drop policy if exists "formatos-cliente: leer" on storage.objects;
create policy "formatos-cliente: leer" on storage.objects for select
  using (case when bucket_id = 'formatos-cliente' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_access_project(((storage.foldername(name))[1])::uuid) else false end);
drop policy if exists "formatos-cliente: subir" on storage.objects;
create policy "formatos-cliente: subir" on storage.objects for insert
  with check (case when bucket_id = 'formatos-cliente' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_manage_project(((storage.foldername(name))[1])::uuid) else false end);
drop policy if exists "formatos-cliente: borrar" on storage.objects;
create policy "formatos-cliente: borrar" on storage.objects for delete
  using (case when bucket_id = 'formatos-cliente' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.can_manage_project(((storage.foldername(name))[1])::uuid) else false end);
