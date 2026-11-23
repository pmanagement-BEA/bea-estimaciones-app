-- Congelamiento de proyecciones (nov 2026).
-- Las proyecciones de un mes se congelan el día 15 de ese mes (o el siguiente día hábil si cae en fin de semana
-- o festivo). Desde ese día ya no se pueden agregar, cambiar ni quitar desde la app: quedan como la proyección
-- comprometida del mes, que se compara después contra lo estimado (indicadores).
-- Festivos: los mismos de la app (utils/cierre.js).

create or replace function public.es_festivo(d date) returns boolean language sql immutable as $$
  select to_char(d, 'MM-DD') in ('01-01', '05-01', '09-16', '12-25')
    or (extract(month from d) = 2  and extract(isodow from d) = 1 and extract(day from d) between 1 and 7)   -- 1er lunes de febrero
    or (extract(month from d) = 3  and extract(isodow from d) = 1 and extract(day from d) between 15 and 21) -- 3er lunes de marzo
    or (extract(month from d) = 11 and extract(isodow from d) = 1 and extract(day from d) between 15 and 21) -- 3er lunes de noviembre
$$;

create or replace function public.fecha_congelamiento(mes text) returns date language plpgsql immutable as $$
declare d date := to_date(mes || '-15', 'YYYY-MM-DD');
begin
  while extract(isodow from d) in (6, 7) or public.es_festivo(d) loop d := d + 1; end loop;
  return d;
end $$;

create or replace function public.proyeccion_congelada(mes text) returns boolean language sql stable as $$
  select (now() at time zone 'America/Mexico_City')::date >= public.fecha_congelamiento(mes)
$$;

-- Candado: desde la app (con sesión) no se toca un mes congelado. El SQL del PMO (sin sesión) sí puede corregir.
create or replace function public.proteger_proyeccion_congelada() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op in ('UPDATE', 'DELETE') and public.proyeccion_congelada(old.mes) then
    raise exception 'Las proyecciones de % ya están congeladas (desde el %)', old.mes, to_char(public.fecha_congelamiento(old.mes), 'DD/MM/YYYY');
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.proyeccion_congelada(new.mes) then
    raise exception 'Las proyecciones de % ya están congeladas (desde el %)', new.mes, to_char(public.fecha_congelamiento(new.mes), 'DD/MM/YYYY');
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists proyecciones_congeladas on proyecciones;
create trigger proyecciones_congeladas before insert or update or delete on proyecciones
  for each row execute function public.proteger_proyeccion_congelada();
