-- Reporte diario de Track (nov 2026): lo ven solo Adriana Trejo, Gerardo Marcos, Ulises Treviño y Héctor González.
-- Se marca por persona en el Directorio (ve_reporte_diario).
alter table directorio add column if not exists ve_reporte_diario boolean not null default false;
update directorio set ve_reporte_diario = (lower(email) in (
  'atrejo@bioconstruccion.com.mx', 'pmanagement@bioconstruccion.com.mx', 'utrevino@bioconstruccion.com.mx', 'hgonzalez@bioconstruccion.com.mx'));

create or replace function public.ve_reporte_diario()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from directorio where email = public.my_email() and activo and ve_reporte_diario);
$$;
revoke execute on function public.ve_reporte_diario() from anon;

-- Quien ve el reporte diario ve las horas de todo el equipo en Track…
create or replace function public.ve_todo_track()
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_coordinador() or public.es_admin_checador() or public.ve_desempeno() or public.ve_reporte_diario();
$$;

-- …y las checadas y ausencias (solo lectura) para comparar contra lo que le tocaba
drop policy if exists "checadas: reporte diario" on checadas;
create policy "checadas: reporte diario" on checadas for select using (public.ve_reporte_diario());
drop policy if exists "ausencias: reporte diario" on ausencias;
create policy "ausencias: reporte diario" on ausencias for select using (public.ve_reporte_diario());
