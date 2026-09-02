-- Migración: agregar columnas faltantes en aditivas y aditiva_alcances
-- Ejecutar en: Supabase Dashboard → SQL Editor

alter table aditivas
  add column if not exists intro         text not null default '',
  add column if not exists clausulas     text not null default '',
  add column if not exists cierre_texto  text not null default '',
  add column if not exists elaborado_por text not null default '',
  add column if not exists aceptado_por  text not null default '',
  add column if not exists ccps          text not null default '';

alter table aditiva_alcances
  add column if not exists items      text not null default '',
  add column if not exists entregable text not null default '';
