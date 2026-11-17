-- Acceso sin correos (nov 2026)
-- Los enlaces de invitación/recuperación de Supabase no sirven en BEA: el filtro de seguridad
-- del correo los abre antes que la persona y se gastan (otp_expired). En su lugar:
--   1) Un coordinador asigna una contraseña temporal desde Directorio.
--   2) Al entrar con ella, la app obliga a crear una contraseña propia.
-- La contraseña nunca se guarda en claro: se guarda solo su hash (bcrypt), igual que Supabase Auth.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.asignar_contrasena_temporal(p_email text, p_password text)
returns text
language plpgsql security definer
set search_path = public, extensions, auth
as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
  d directorio%rowtype;
begin
  if not public.is_coordinador() then
    raise exception 'Solo un coordinador puede asignar contraseñas';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'La contraseña temporal debe tener al menos 8 caracteres';
  end if;
  select * into d from directorio where email = v_email;
  if not found then raise exception 'El correo % no está en el directorio', v_email; end if;
  if not d.activo then raise exception '% está marcado como inactivo en el directorio', v_email; end if;

  select id into v_id from auth.users where lower(email) = v_email;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
      crypt(p_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nombre', d.nombre, 'debe_cambiar_contrasena', true),
      now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now());
    return 'creada';
  end if;

  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"debe_cambiar_contrasena": true}'::jsonb,
         updated_at = now()
   where id = v_id;
  return 'actualizada';
end;
$$;

revoke all on function public.asignar_contrasena_temporal(text, text) from public, anon;
grant execute on function public.asignar_contrasena_temporal(text, text) to authenticated;

-- Estado de la cuenta de cada persona del directorio (solo lo ven coordinadores)
create or replace function public.cuentas_directorio()
returns table (email text, tiene_cuenta boolean, debe_cambiar boolean, ultimo_acceso timestamptz)
language sql security definer stable
set search_path = public, auth
as $$
  select d.email,
         u.id is not null,
         coalesce((u.raw_user_meta_data->>'debe_cambiar_contrasena')::boolean, false),
         u.last_sign_in_at
    from directorio d
    left join auth.users u on lower(u.email) = d.email
   where public.is_coordinador();
$$;

revoke all on function public.cuentas_directorio() from public, anon;
grant execute on function public.cuentas_directorio() to authenticated;
