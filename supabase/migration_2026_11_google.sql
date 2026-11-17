-- Solo el directorio puede tener cuenta (nov 2026)
-- Las cuentas ahora las crea un coordinador desde Directorio (contraseña temporal) o nacen solas
-- al "Entrar con Google". Para que nadie de fuera se cree una cuenta —ni con Google ni con el
-- registro público de Supabase, que está abierto— la base solo acepta el alta si el correo está
-- en el directorio y activo. Si no, rechaza el alta y la app muestra
-- "Tu correo no está dado de alta en el Directorio BEA". Las cuentas que ya existen no cambian.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare d directorio%rowtype;
begin
  select * into d from directorio where email = lower(new.email);
  if not found or not d.activo then
    raise exception 'El correo % no está activo en el directorio BEA', new.email;
  end if;
  insert into public.profiles (id, email, nombre, role, area)
  values (
    new.id,
    new.email,
    coalesce(nullif(d.nombre, ''), new.raw_user_meta_data->>'nombre', new.raw_user_meta_data->>'full_name', ''),
    coalesce(d.rol_app, 'colaborador'),
    d.area
  );
  return new;
end;
$$;
