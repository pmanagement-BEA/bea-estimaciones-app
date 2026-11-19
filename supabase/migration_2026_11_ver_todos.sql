-- Todos los usuarios con sesión pueden VER todos los proyectos (por si una asignación quedó mal).
-- Solo agrega lectura: las políticas de Postgres se suman (OR) y las de escritura no cambian,
-- así que editar sigue siendo solo del equipo asignado, el dueño y los coordinadores.
create or replace function public.puede_ver_proyectos()
returns boolean language sql stable as $$ select auth.uid() is not null $$;

drop policy if exists "todos: ven proyectos" on projects;
create policy "todos: ven proyectos" on projects for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven disciplinas" on disciplines;
create policy "todos: ven disciplinas" on disciplines for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven conceptos" on concepts;
create policy "todos: ven conceptos" on concepts for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven estimaciones" on estimations;
create policy "todos: ven estimaciones" on estimations for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven items" on estimation_items;
create policy "todos: ven items" on estimation_items for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven reportes" on report_data;
create policy "todos: ven reportes" on report_data for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven anexos" on report_anexos;
create policy "todos: ven anexos" on report_anexos for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven aditivas" on aditivas;
create policy "todos: ven aditivas" on aditivas for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven alcances" on aditiva_alcances;
create policy "todos: ven alcances" on aditiva_alcances for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven equipos" on project_members;
create policy "todos: ven equipos" on project_members for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven cierre por area" on estimation_area_status;
create policy "todos: ven cierre por area" on estimation_area_status for select using (public.puede_ver_proyectos());
drop policy if exists "todos: ven formatos cliente" on formatos_cliente;
create policy "todos: ven formatos cliente" on formatos_cliente for select using (public.puede_ver_proyectos());
drop policy if exists "formatos-cliente: todos leen" on storage.objects;
create policy "formatos-cliente: todos leen" on storage.objects for select
  using (bucket_id = 'formatos-cliente' and public.puede_ver_proyectos());

-- Se quita la figura "Coordinador de proyecto" del equipo (nadie estaba asignado; 2 tarjetas viejas la traían como texto)
update projects set team = team - 'coordinador' where team ? 'coordinador';
