-- Ejecutar completo en SQL Editor de un proyecto nuevo de Supabase.
-- No conecta la app ni migra los datos locales: eso se hace en el siguiente paso.
begin;

create or replace function public.beer_normalize(value text)
returns text language sql immutable strict set search_path = ''
as $$
  select lower(regexp_replace(btrim(regexp_replace(
    normalize(value, NFD), U&'[\0300-\036f]', '', 'g'
  )), '\s+', ' ', 'g'));
$$;

create table if not exists public.beers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brand text not null check (char_length(brand) <= 80 and char_length(btrim(brand)) > 0),
  name text not null check (char_length(name) <= 100 and char_length(btrim(name)) > 0),
  style text not null default '' check (char_length(style) <= 80),
  date date,
  rating numeric(3,1) not null check (rating between 0 and 10),
  drunk boolean,
  buy_again boolean,
  notes text not null default '' check (char_length(notes) <= 1500),
  -- Guardar la ruta, no una URL temporal: <user_id>/<archivo>.jpg
  photo_path text check (
    split_part(photo_path, '/', 1) = user_id::text
    and char_length(split_part(photo_path, '/', 2)) > 0
  ),
  created_at timestamptz not null default now(),
  brand_key text generated always as (public.beer_normalize(brand)) stored,
  name_key text generated always as (public.beer_normalize(name)) stored,
  unique (user_id, brand_key, name_key)
);

alter table public.beers enable row level security;
revoke all on public.beers from anon, authenticated;
grant select, insert, update, delete on public.beers to authenticated;

drop policy if exists beers_select_own on public.beers;
create policy beers_select_own on public.beers for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists beers_insert_own on public.beers;
create policy beers_insert_own on public.beers for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists beers_update_own on public.beers;
create policy beers_update_own on public.beers for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists beers_delete_own on public.beers;
create policy beers_delete_own on public.beers for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Fotos privadas; la app comprime las imágenes a JPEG antes de subirlas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('beer-photos', 'beer-photos', false, 15728640, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists beer_photos_select_own on storage.objects;
create policy beer_photos_select_own on storage.objects for select to authenticated
  using (bucket_id = 'beer-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists beer_photos_insert_own on storage.objects;
create policy beer_photos_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'beer-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists beer_photos_update_own on storage.objects;
create policy beer_photos_update_own on storage.objects for update to authenticated
  using (bucket_id = 'beer-photos' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'beer-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists beer_photos_delete_own on storage.objects;
create policy beer_photos_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'beer-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

commit;

-- Resultado esperado: rls_enabled = true y photos_public = false.
select
  (select relrowsecurity from pg_class where oid = 'public.beers'::regclass) as rls_enabled,
  (select public from storage.buckets where id = 'beer-photos') as photos_public;
