-- Ausencias y anuncios (nov 2026), como en Woffu. Requiere antes: migration_2026_11_checador.sql y migration_2026_11_calendario_bea.sql
-- Ausencias: cada persona solicita (vacaciones, permisos, incapacidad…), los administradores del checador aprueban o rechazan.
--   Motivos editables; los que llevan saldo (Vacaciones) se descuentan de los días asignados a cada persona.
-- Anuncios: los administradores publican, todos leen; se guarda quién ya lo vio.
-- Se puede correr más de una vez.

-- ── Días laborables entre dos fechas (sin fines de semana, festivos de ley ni festivos de BEA) ──
create or replace function public.dias_laborables(d1 date, d2 date)
returns int language sql stable set search_path = public as $$
  select count(*)::int from generate_series(d1, d2, interval '1 day') g(d)
   where extract(isodow from g.d) < 6
     and not public.es_festivo(g.d::date)
     and not exists (select 1 from calendario_bea c where c.fecha = g.d::date and c.tipo = 'festivo');
$$;

-- ── Motivos ──────────────────────────────────────────────────
create table if not exists ausencia_motivos (
  id         bigint generated always as identity primary key,
  nombre     text not null unique,
  con_saldo  boolean not null default false,   -- se descuenta de los días asignados (p. ej. Vacaciones)
  color      text not null default '#8B5CF6',
  activo     boolean not null default true,
  orden      int not null default 100,
  created_at timestamptz not null default now()
);
alter table ausencia_motivos enable row level security;
drop policy if exists "ausencia_motivos: todos los ven" on ausencia_motivos;
create policy "ausencia_motivos: todos los ven" on ausencia_motivos for select using (auth.uid() is not null);
drop policy if exists "ausencia_motivos: admin los edita" on ausencia_motivos;
create policy "ausencia_motivos: admin los edita" on ausencia_motivos for all using (public.es_admin_checador()) with check (public.es_admin_checador());

-- Motivos que tenía BEA en Woffu
insert into ausencia_motivos (nombre, con_saldo, color, orden) values
  ('Vacaciones', true, '#16A34A', 1),
  ('1 Día permiso especial', false, '#0EA5E9', 10),
  ('Boda', false, '#EC4899', 20),
  ('Consultas médicas / análisis', false, '#F59E0B', 20),
  ('Defunción', false, '#64748B', 20),
  ('Enfermedad', false, '#EF4444', 20),
  ('Falta justificada', false, '#A855F7', 20),
  ('Incapacidad (médica)', false, '#DC2626', 20),
  ('Maternidad', false, '#DB2777', 20),
  ('Paternidad', false, '#2563EB', 20),
  ('Permiso con goce de sueldo', false, '#0D9488', 20),
  ('Permiso extraordinario - COVID', false, '#78716C', 20),
  ('Permiso sin goce', false, '#9CA3AF', 20),
  ('Summer Break', false, '#EAB308', 30),
  ('Winter Break', false, '#06B6D4', 30)
on conflict (nombre) do nothing;

-- ── Asignaciones de días (saldo de cada persona por motivo) ──
create table if not exists ausencia_asignaciones (
  id         bigint generated always as identity primary key,
  email      text not null check (email = lower(email)),
  motivo_id  bigint not null references ausencia_motivos(id),
  dias       numeric(6,2) not null,                 -- puede ser negativo para un ajuste
  inicio     date,                                  -- desde cuándo se pueden disfrutar (opcional)
  fin        date,                                  -- hasta cuándo (opcional)
  nota       text not null default '',
  creado_por text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ausencia_asignaciones_email on ausencia_asignaciones(email);
alter table ausencia_asignaciones enable row level security;
drop policy if exists "ausencia_asignaciones: cada quien lo suyo, admin todo" on ausencia_asignaciones;
create policy "ausencia_asignaciones: cada quien lo suyo, admin todo" on ausencia_asignaciones for select
  using (auth.uid() is not null and (email = public.my_email() or public.es_admin_checador()));
drop policy if exists "ausencia_asignaciones: admin las edita" on ausencia_asignaciones;
create policy "ausencia_asignaciones: admin las edita" on ausencia_asignaciones for all
  using (public.es_admin_checador()) with check (public.es_admin_checador());

-- ── Solicitudes de ausencia ─────────────────────────────────
create table if not exists ausencias (
  id            bigint generated always as identity primary key,
  email         text not null check (email = lower(email)),
  motivo_id     bigint not null references ausencia_motivos(id),
  inicio        date not null,
  fin           date not null,
  dias          numeric(6,2) not null,              -- días laborables del periodo
  observaciones text not null default '',
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
  solicitado_por text not null default '',
  solicitado_en timestamptz not null default now(),
  resuelto_por  text,
  resuelto_en   timestamptz,
  comentario    text not null default '',          -- de quien aprueba o rechaza
  constraint ausencias_fechas check (fin >= inicio)
);
create index if not exists ausencias_email on ausencias(email, inicio);
create index if not exists ausencias_estado on ausencias(estado);
alter table ausencias enable row level security;
drop policy if exists "ausencias: cada quien lo suyo, admin todo" on ausencias;
create policy "ausencias: cada quien lo suyo, admin todo" on ausencias for select
  using (auth.uid() is not null and (email = public.my_email() or public.es_admin_checador()));
-- Sin políticas de escritura: solo las funciones.

-- Solicitar. Sin p_email (o el propio) queda pendiente. Un administrador puede registrarla para otra persona: queda aprobada.
create or replace function public.solicitar_ausencia(p_motivo bigint, p_inicio date, p_fin date, p_observaciones text default '', p_email text default null)
returns ausencias language plpgsql security definer set search_path = public as $$
declare
  yo    text := public.my_email();
  quien text := lower(trim(coalesce(nullif(p_email, ''), public.my_email())));
  admin boolean := public.es_admin_checador();
  n     int;
  r     ausencias;
begin
  if auth.uid() is null or coalesce(yo, '') = '' then raise exception 'Inicia sesión'; end if;
  if quien <> yo and not admin then raise exception 'Solo puedes solicitar ausencias para ti'; end if;
  if not exists (select 1 from ausencia_motivos where id = p_motivo and activo) then raise exception 'Elige un motivo válido'; end if;
  if p_inicio is null or p_fin is null then raise exception 'Pon la fecha de inicio y de fin'; end if;
  if p_fin < p_inicio then raise exception 'La fecha fin debe ser igual o después del inicio'; end if;
  if p_fin - p_inicio > 366 then raise exception 'El periodo es demasiado largo'; end if;
  n := public.dias_laborables(p_inicio, p_fin);
  if n = 0 then raise exception 'En esas fechas no hay días laborables'; end if;
  perform pg_advisory_xact_lock(hashtext('ausencia:' || quien));
  if exists (select 1 from ausencias where email = quien and estado in ('pendiente', 'aprobada') and inicio <= p_fin and fin >= p_inicio) then
    raise exception 'Ya hay una solicitud pendiente o aprobada que se cruza con esas fechas';
  end if;
  insert into ausencias (email, motivo_id, inicio, fin, dias, observaciones, estado, solicitado_por, resuelto_por, resuelto_en)
  values (quien, p_motivo, p_inicio, p_fin, n, left(coalesce(trim(p_observaciones), ''), 300),
          case when quien <> yo then 'aprobada' else 'pendiente' end, yo,
          case when quien <> yo then yo end, case when quien <> yo then now() end)
  returning * into r;
  return r;
end $$;

-- Cancelar: la persona, mientras esté pendiente o (aprobada y todavía no empiece); el administrador, cualquiera.
create or replace function public.cancelar_ausencia(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare yo text := public.my_email(); r ausencias; hoy date := (now() at time zone 'America/Monterrey')::date;
begin
  select * into r from ausencias where id = p_id for update;
  if not found then raise exception 'No existe la solicitud'; end if;
  if r.email <> yo and not public.es_admin_checador() then raise exception 'No puedes cancelar esta solicitud'; end if;
  if r.estado not in ('pendiente', 'aprobada') then raise exception 'La solicitud ya está %', r.estado; end if;
  if r.email = yo and not public.es_admin_checador() and r.estado = 'aprobada' and r.inicio <= hoy then
    raise exception 'Ya empezó: pide a un administrador que la cancele';
  end if;
  update ausencias set estado = 'cancelada', resuelto_por = yo, resuelto_en = now() where id = p_id;
end $$;

-- Aprobar o rechazar (administradores)
create or replace function public.resolver_ausencia(p_id bigint, p_aprobar boolean, p_comentario text default '')
returns void language plpgsql security definer set search_path = public as $$
declare yo text := public.my_email(); r ausencias;
begin
  if not public.es_admin_checador() then raise exception 'Solo los administradores aprueban solicitudes'; end if;
  select * into r from ausencias where id = p_id for update;
  if not found then raise exception 'No existe la solicitud'; end if;
  if r.estado <> 'pendiente' then raise exception 'La solicitud ya está %', r.estado; end if;
  if r.email = yo then raise exception 'Tu propia solicitud la aprueba otro administrador'; end if;
  if not p_aprobar and coalesce(trim(p_comentario), '') = '' then raise exception 'Escribe por qué se rechaza'; end if;
  update ausencias set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         resuelto_por = yo, resuelto_en = now(), comentario = left(coalesce(trim(p_comentario), ''), 300)
   where id = p_id;
end $$;

revoke all on function public.solicitar_ausencia(bigint, date, date, text, text) from public, anon;
grant execute on function public.solicitar_ausencia(bigint, date, date, text, text) to authenticated;
revoke all on function public.cancelar_ausencia(bigint) from public, anon;
grant execute on function public.cancelar_ausencia(bigint) to authenticated;
revoke all on function public.resolver_ausencia(bigint, boolean, text) from public, anon;
grant execute on function public.resolver_ausencia(bigint, boolean, text) to authenticated;

-- ── Anuncios ─────────────────────────────────────────────────
create table if not exists anuncios (
  id           bigint generated always as identity primary key,
  titulo       text not null,
  cuerpo       text not null default '',
  autor_email  text not null default '',
  fijado       boolean not null default false,
  publicado_en timestamptz not null default now(),
  editado_en   timestamptz
);
alter table anuncios enable row level security;
drop policy if exists "anuncios: todos los ven" on anuncios;
create policy "anuncios: todos los ven" on anuncios for select using (auth.uid() is not null);
drop policy if exists "anuncios: admin los publica" on anuncios;
create policy "anuncios: admin los publica" on anuncios for all using (public.es_admin_checador()) with check (public.es_admin_checador());

create table if not exists anuncios_vistos (
  anuncio_id bigint not null references anuncios(id) on delete cascade,
  email      text not null,
  visto_en   timestamptz not null default now(),
  primary key (anuncio_id, email)
);
alter table anuncios_vistos enable row level security;
drop policy if exists "anuncios_vistos: los propios, admin todos" on anuncios_vistos;
create policy "anuncios_vistos: los propios, admin todos" on anuncios_vistos for select
  using (auth.uid() is not null and (email = public.my_email() or public.es_admin_checador()));
drop policy if exists "anuncios_vistos: marcar el propio" on anuncios_vistos;
create policy "anuncios_vistos: marcar el propio" on anuncios_vistos for insert
  with check (auth.uid() is not null and email = public.my_email());

-- El anuncio que ya estaba en Woffu
insert into anuncios (titulo, cuerpo, autor_email, publicado_en)
select 'FUMIGACIÓN PROGRAMADA',
       'Se les informa que el miércoles 23 de septiembre se realizará fumigación en la oficina; ténganlo en consideración.',
       coalesce((select email from directorio where nombre = 'Melina Ortiz' limit 1), ''), '2026-09-22 09:00-06'
where not exists (select 1 from anuncios where titulo = 'FUMIGACIÓN PROGRAMADA');
