-- ============================================================
-- Correcciones 17-nov-2026
-- Ejecutar una vez en: Supabase Dashboard → SQL Editor
-- Se puede correr más de una vez sin romper nada.
-- ============================================================

-- ── 1. Columnas de "Reporte enviado" ───────────────────────
-- La app ya las usa (Estimation.jsx → markReportSent) pero no estaban en schema.sql.
alter table estimations
  add column if not exists report_sent    boolean not null default false,
  add column if not exists report_sent_at timestamptz;

-- ── 2. El registro ya no acepta el rol que mande el usuario ─
-- Antes se tomaba role de raw_user_meta_data, que controla quien se registra:
-- cualquiera podía crearse una cuenta de coordinador. Ahora toda cuenta nueva
-- nace como 'lider' y el rol solo se cambia desde el panel o por un coordinador.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nombre, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    'lider'
  );
  return new;
end;
$$;

-- ── 3. Nadie puede subirse de rol a sí mismo ────────────────
-- La policy "usuario edita su propio perfil" permitía cambiar el campo role.
-- Este trigger bloquea el cambio de rol salvo que lo haga un coordinador
-- o se haga desde el panel/SQL Editor (sin usuario de la app: auth.uid() es null).
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_coordinador() then
    raise exception 'No tienes permiso para cambiar el rol';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on profiles;
create trigger profiles_protect_role
  before update on profiles
  for each row execute procedure public.protect_profile_role();
