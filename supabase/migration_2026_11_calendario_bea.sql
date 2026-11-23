-- Calendario de BEA (nov 2026): días propios de la empresa, como los tenía configurados Woffu.
-- festivo: no se trabaja (no cuenta como horas esperadas en el checador), además de los de ley que ya calcula la app.
-- evento:  se trabaja normal, solo se marca (p. ej. SUMMER).
-- Lo ven todos; lo editan los administradores del checador. Se puede correr más de una vez.

create table if not exists calendario_bea (
  fecha      date primary key,
  nombre     text not null,
  tipo       text not null check (tipo in ('festivo', 'evento')),
  creado_por text not null default '',
  created_at timestamptz not null default now()
);

alter table calendario_bea enable row level security;
drop policy if exists "calendario_bea: todos lo ven" on calendario_bea;
create policy "calendario_bea: todos lo ven" on calendario_bea for select using (auth.uid() is not null);
drop policy if exists "calendario_bea: admin del checador lo edita" on calendario_bea;
create policy "calendario_bea: admin del checador lo edita" on calendario_bea for all
  using (public.es_admin_checador()) with check (public.es_admin_checador());

-- Días de BEA importados de Woffu (calendario "BEA", horario Escalón A-NL)
insert into calendario_bea (fecha, nombre, tipo, creado_por) values
  ('2026-07-30', 'SUMMER', 'evento', 'Woffu'),
  ('2026-09-16', 'Día de la Independencia', 'festivo', 'Woffu'),
  ('2026-11-16', 'Aniversario de la Revolución', 'festivo', 'Woffu'),
  ('2026-12-24', 'Asueto Noche Buena', 'festivo', 'Woffu'),
  ('2026-12-25', 'Navidad', 'festivo', 'Woffu'),
  ('2026-12-31', 'Año Nuevo', 'festivo', 'Woffu'),
  ('2027-07-23', 'SUMMER 1', 'evento', 'Woffu'),
  ('2027-07-30', 'SUMMER 2', 'evento', 'Woffu')
on conflict (fecha) do nothing;
