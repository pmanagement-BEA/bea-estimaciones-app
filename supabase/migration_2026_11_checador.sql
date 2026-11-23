-- Checador (nov 2026): cada persona checa entrada y salida, y ve solo lo suyo.
-- Los administradores del checador (marcados en el directorio) ven a todos.
-- Nadie escribe en las tablas directamente:
--   checar()      abre o cierra la franja de hoy con la hora del servidor;
--   editar_dia()  cambia las franjas de un día (la persona las suyas, el administrador las de cualquiera).
--                 Lo editado queda marcado (EDITADO) y se guarda qué había antes, quién lo cambió, cuándo y por qué.
-- Se puede correr más de una vez.

-- ── 1. Quién administra el checador ─────────────────────────
alter table directorio add column if not exists admin_checador boolean not null default false;

create or replace function public.es_admin_checador()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from directorio where email = public.my_email() and admin_checador and activo);
$$;

-- ── 2. Checadas (una fila por franja: entrada → salida) ─────
create table if not exists checadas (
  id         bigint generated always as identity primary key,
  email      text not null check (email = lower(email)),
  fecha      date not null,                          -- día de la entrada (hora de Monterrey)
  entrada    timestamptz not null default now(),
  salida     timestamptz,                            -- null: sigue dentro (o se le olvidó checar salida)
  nota       text not null default '',
  origen     text not null default 'reloj' check (origen in ('reloj', 'manual')),  -- manual: capturada al editar
  editada    boolean not null default false,         -- la creó o la quitó una edición
  borrada    boolean not null default false,         -- quitada por una edición (se conserva para el historial)
  created_at timestamptz not null default now(),
  constraint checadas_salida_despues check (salida is null or salida > entrada)
);
create index if not exists checadas_email_fecha on checadas(email, fecha desc);
create index if not exists checadas_fecha on checadas(fecha);

alter table checadas enable row level security;
drop policy if exists "checadas: cada quien lo suyo, admin todo" on checadas;
create policy "checadas: cada quien lo suyo, admin todo" on checadas for select
  using (auth.uid() is not null and (email = public.my_email() or public.es_admin_checador()));
-- Sin políticas de insert/update/delete: solo las funciones escriben.

-- ── 3. Historial de ediciones ───────────────────────────────
create table if not exists checadas_ediciones (
  id         bigint generated always as identity primary key,
  email      text not null,                          -- de quién es el día
  fecha      date not null,
  motivo     text not null,
  antes      jsonb not null,                         -- [{entrada, salida}] como estaba
  despues    jsonb not null,                         -- [{entrada, salida}] como quedó
  hecho_por  text not null,                          -- quién editó
  hecho_en   timestamptz not null default now()
);
create index if not exists checadas_ediciones_email_fecha on checadas_ediciones(email, fecha);
create index if not exists checadas_ediciones_fecha on checadas_ediciones(fecha);

alter table checadas_ediciones enable row level security;
drop policy if exists "checadas_ediciones: cada quien lo suyo, admin todo" on checadas_ediciones;
create policy "checadas_ediciones: cada quien lo suyo, admin todo" on checadas_ediciones for select
  using (auth.uid() is not null and (email = public.my_email() or public.es_admin_checador()));

-- ── 4. Checar ───────────────────────────────────────────────
-- Si hoy tiene una franja abierta, la cierra (salida = ahora); si no, abre una nueva.
-- Una franja de un día anterior sin salida se queda así ("sin salida") y hoy empieza otra.
create or replace function public.checar(p_nota text default '')
returns checadas language plpgsql security definer set search_path = public as $$
declare
  yo  text := public.my_email();
  hoy date := (now() at time zone 'America/Monterrey')::date;
  r   checadas;
begin
  if auth.uid() is null or coalesce(yo, '') = '' then raise exception 'Inicia sesión para checar'; end if;
  perform pg_advisory_xact_lock(hashtext('checar:' || yo));   -- doble clic: no abre dos franjas
  select * into r from checadas where email = yo and fecha = hoy and salida is null and not borrada order by entrada desc limit 1;
  if found then
    update checadas set salida = greatest(now(), r.entrada + interval '1 second'),
           nota = case when coalesce(trim(p_nota), '') = '' then nota else trim(both from nota || ' ' || trim(p_nota)) end
     where id = r.id returning * into r;
  else
    insert into checadas (email, fecha, nota) values (yo, hoy, coalesce(trim(p_nota), '')) returning * into r;
  end if;
  return r;
end $$;

-- ── 5. Editar un día ────────────────────────────────────────
-- p_tramos: [{ "entrada": timestamptz, "salida": timestamptz | null }] como debe quedar el día.
-- Las franjas que no cambian se quedan igual; las que ya no vienen se marcan borradas; las nuevas entran como manuales.
create or replace function public.editar_dia(p_email text, p_fecha date, p_tramos jsonb, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  yo     text := public.my_email();
  quien  text := lower(trim(coalesce(p_email, '')));
  hoy    date := (now() at time zone 'America/Monterrey')::date;
  n      int  := 0;
  total  int;
  t      jsonb;
  e      timestamptz;
  s      timestamptz;
  prev_s timestamptz := null;
  antes  jsonb;
  despues jsonb;
begin
  if auth.uid() is null or coalesce(yo, '') = '' then raise exception 'Inicia sesión para editar'; end if;
  if quien <> yo and not public.es_admin_checador() then raise exception 'Solo puedes editar tus propias checadas'; end if;
  if p_fecha is null or p_fecha > hoy then raise exception 'No se pueden editar días futuros'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la edición'; end if;
  if p_tramos is null or jsonb_typeof(p_tramos) <> 'array' then raise exception 'Franjas inválidas'; end if;
  total := jsonb_array_length(p_tramos);

  for t in select x from jsonb_array_elements(p_tramos) x order by (x->>'entrada')::timestamptz loop
    n := n + 1;
    e := (t->>'entrada')::timestamptz;
    s := nullif(t->>'salida', '')::timestamptz;
    if e is null then raise exception 'Falta la hora de entrada'; end if;
    if (e at time zone 'America/Monterrey')::date <> p_fecha then raise exception 'Cada entrada debe ser del mismo día que se edita'; end if;
    if e > now() then raise exception 'Una entrada quedó en el futuro'; end if;
    if s is not null and s <= e then raise exception 'La salida debe ser después de la entrada'; end if;
    if s is not null and s > now() then raise exception 'Una salida quedó en el futuro'; end if;
    if s is not null and s - e > interval '24 hours' then raise exception 'Una franja no puede durar más de 24 horas'; end if;
    if s is null and (p_fecha <> hoy or n < total) then raise exception 'Solo la última franja de hoy puede quedar sin salida'; end if;
    if prev_s is not null and e < prev_s then raise exception 'Las franjas se enciman'; end if;
    prev_s := s;
  end loop;

  perform pg_advisory_xact_lock(hashtext('checar:' || quien));

  select coalesce(jsonb_agg(jsonb_build_object('entrada', entrada, 'salida', salida) order by entrada), '[]'::jsonb) into antes
    from checadas where email = quien and fecha = p_fecha and not borrada;
  select coalesce(jsonb_agg(jsonb_build_object('entrada', (x->>'entrada')::timestamptz, 'salida', nullif(x->>'salida', '')::timestamptz)
                            order by (x->>'entrada')::timestamptz), '[]'::jsonb) into despues
    from jsonb_array_elements(p_tramos) x;
  if antes = despues then raise exception 'No cambiaste nada'; end if;

  update checadas c set borrada = true, editada = true
   where c.email = quien and c.fecha = p_fecha and not c.borrada
     and not exists (select 1 from jsonb_array_elements(p_tramos) x
                      where (x->>'entrada')::timestamptz = c.entrada
                        and nullif(x->>'salida', '')::timestamptz is not distinct from c.salida);

  insert into checadas (email, fecha, entrada, salida, origen, editada)
  select quien, p_fecha, (x->>'entrada')::timestamptz, nullif(x->>'salida', '')::timestamptz, 'manual', true
    from jsonb_array_elements(p_tramos) x
   where not exists (select 1 from checadas c
                      where c.email = quien and c.fecha = p_fecha and not c.borrada
                        and c.entrada = (x->>'entrada')::timestamptz
                        and c.salida is not distinct from nullif(x->>'salida', '')::timestamptz);

  insert into checadas_ediciones (email, fecha, motivo, antes, despues, hecho_por)
  values (quien, p_fecha, trim(p_motivo), antes, despues, yo);
end $$;

revoke all on function public.checar(text) from public, anon;
grant execute on function public.checar(text) to authenticated;
revoke all on function public.editar_dia(text, date, jsonb, text) from public, anon;
grant execute on function public.editar_dia(text, date, jsonb, text) to authenticated;
revoke all on function public.es_admin_checador() from public, anon;
grant execute on function public.es_admin_checador() to authenticated;
