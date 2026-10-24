-- Permitir cargar cervezas sin foto y sin fecha, conservando los datos existentes.
begin;
alter table public.beers alter column photo_path drop not null;
alter table public.beers alter column date drop not null;
commit;
