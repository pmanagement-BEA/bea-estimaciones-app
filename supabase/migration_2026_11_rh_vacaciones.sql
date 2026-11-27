-- Control de vacaciones (RH) en el Checador, nov 2026.
-- 1. Fecha de ingreso de cada persona (la capturan los administradores del checador).
-- 2. Días de vacaciones por ley según antigüedad (LFT 2023, "vacaciones dignas") y botón para asignarlos.
-- 3. Al solicitar vacaciones, lo que pase del saldo queda automáticamente como días sin goce de sueldo.
-- Se puede correr más de una vez.

create table if not exists rh_ingresos (
  email          text primary key check (email = lower(email)),
  fecha_ingreso  date not null,
  actualizado_por text not null default '',
  actualizado_en timestamptz not null default now()
);
alter table rh_ingresos enable row level security;
drop policy if exists "rh_ingresos: cada quien lo suyo, admin todo" on rh_ingresos;
create policy "rh_ingresos: cada quien lo suyo, admin todo" on rh_ingresos for select
  using (auth.uid() is not null and (email = public.my_email() or public.es_admin_checador()));
drop policy if exists "rh_ingresos: admin lo edita" on rh_ingresos;
create policy "rh_ingresos: admin lo edita" on rh_ingresos for all
  using (public.es_admin_checador()) with check (public.es_admin_checador());

alter table ausencias add column if not exists dias_sin_goce numeric(6,2) not null default 0;

-- Días de vacaciones por año cumplido (LFT art. 76, reforma 2023)
create or replace function public.dias_vacaciones_ley(anios int)
returns int language sql immutable as $$
  select case
    when anios < 1 then 0
    when anios <= 5 then 10 + 2 * anios          -- 12, 14, 16, 18, 20
    else 22 + 2 * ((anios - 6) / 5)               -- 6–10: 22, 11–15: 24, 16–20: 26…
  end;
$$;

-- Saldo de una persona en un motivo: asignados vigentes − (aprobados + pendientes), sin contar lo que fue sin goce
create or replace function public.saldo_ausencia(p_email text, p_motivo bigint)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(dias) from ausencia_asignaciones
                    where email = p_email and motivo_id = p_motivo
                      and (fin is null or fin >= (now() at time zone 'America/Monterrey')::date)), 0)
       - coalesce((select sum(dias - dias_sin_goce) from ausencias
                    where email = p_email and motivo_id = p_motivo and estado in ('aprobada', 'pendiente')), 0);
$$;
revoke all on function public.saldo_ausencia(text, bigint) from public, anon;

create or replace function public.solicitar_ausencia(p_motivo bigint, p_inicio date, p_fin date, p_observaciones text default '', p_email text default null)
returns ausencias language plpgsql security definer set search_path = public as $$
declare
  yo    text := public.my_email();
  quien text := lower(trim(coalesce(nullif(p_email, ''), public.my_email())));
  admin boolean := public.es_admin_checador();
  n     int;
  r     ausencias;
  conSaldo boolean;
  disp  numeric;
  sinGoce numeric := 0;
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
  -- Vacaciones (motivos con saldo): lo que no alcance del saldo queda como días sin goce de sueldo
  select con_saldo into conSaldo from ausencia_motivos where id = p_motivo;
  -- Solo si la persona ya tiene días cargados (mientras no se carguen los saldos oficiales, no se marca nada sin goce)
  if conSaldo and exists (select 1 from ausencia_asignaciones where email = quien and motivo_id = p_motivo) then
    disp := public.saldo_ausencia(quien, p_motivo);
    sinGoce := greatest(0, n - greatest(disp, 0));
  end if;
  insert into ausencias (email, motivo_id, inicio, fin, dias, dias_sin_goce, observaciones, estado, solicitado_por, resuelto_por, resuelto_en)
  values (quien, p_motivo, p_inicio, p_fin, n, sinGoce, left(coalesce(trim(p_observaciones), ''), 300),
          case when quien <> yo then 'aprobada' else 'pendiente' end, yo,
          case when quien <> yo then yo end, case when quien <> yo then now() end)
  returning * into r;
  return r;
end $$;

-- Asignar los días por ley del año de antigüedad en curso (a una persona o a todas las que tienen fecha de ingreso).
-- Una asignación por persona y año ("Por ley: año N"); se pueden disfrutar desde el aniversario y hasta 18 meses después.
create or replace function public.asignar_vacaciones_ley(p_email text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  yo text := public.my_email();
  hoy date := (now() at time zone 'America/Monterrey')::date;
  vac bigint;
  r record;
  anios int;
  aniv date;
  v_nota text;
  n int := 0;
begin
  if not public.es_admin_checador() then raise exception 'Solo los administradores asignan días'; end if;
  select id into vac from ausencia_motivos where nombre = 'Vacaciones';
  if vac is null then raise exception 'No existe el motivo Vacaciones'; end if;
  for r in select i.email, i.fecha_ingreso from rh_ingresos i
            join directorio d on lower(d.email) = i.email and d.activo
           where p_email is null or i.email = lower(p_email) loop
    anios := extract(year from age(hoy, r.fecha_ingreso))::int;
    continue when anios < 1;
    aniv := (r.fecha_ingreso + make_interval(years => anios))::date;
    v_nota := 'Por ley: año ' || anios;
    continue when exists (select 1 from ausencia_asignaciones where email = r.email and motivo_id = vac and nota = v_nota);
    insert into ausencia_asignaciones (email, motivo_id, dias, inicio, fin, nota, creado_por)
    values (r.email, vac, public.dias_vacaciones_ley(anios), aniv, (aniv + interval '18 months')::date, v_nota, yo);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.asignar_vacaciones_ley(text) from public, anon;
grant execute on function public.asignar_vacaciones_ley(text) to authenticated;
