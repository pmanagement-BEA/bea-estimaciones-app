-- Estado 'Inactivo' (nov 2026): proyectos que están en el control maestro pero sin estimaciones ni actividad.
-- No es Pausado (que sí tuvo avance) ni Terminado: se reactiva cuando arranque. Se puede correr más de una vez.
alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check
  check (status in ('Activo','Pausado','Inactivo','Terminado','Cancelado'));
