-- Versión privada actual. Ejecutar después de 002 y 003; no publica reseñas.
begin;
create schema if not exists birras_private;
revoke all on schema birras_private from public, anon, authenticated;

create table if not exists birras_private.action_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  minute_start timestamptz not null,
  minute_count integer not null,
  day_start timestamptz not null,
  day_count integer not null,
  primary key (user_id, action)
);
revoke all on birras_private.action_limits from public, anon, authenticated;

create or replace function birras_private.consume_action(action_name text, per_minute integer, per_day integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  minute_now timestamptz := date_trunc('minute', statement_timestamp());
  day_now timestamptz := date_trunc('day', statement_timestamp() at time zone 'UTC') at time zone 'UTC';
  limits birras_private.action_limits;
begin
  if actor is null then raise insufficient_privilege using message = 'Se requiere una sesión válida.'; end if;
  insert into birras_private.action_limits values (actor, action_name, minute_now, 1, day_now, 1)
  on conflict (user_id, action) do update set
    minute_count = case when action_limits.minute_start = minute_now then action_limits.minute_count + 1 else 1 end,
    minute_start = minute_now,
    day_count = case when action_limits.day_start = day_now then action_limits.day_count + 1 else 1 end,
    day_start = day_now
  returning * into limits;
  if limits.minute_count > per_minute or limits.day_count > per_day then
    raise exception using errcode = 'P0001', message = 'Demasiadas operaciones. Esperá un momento antes de reintentar.';
  end if;
end;
$$;
revoke all on function birras_private.consume_action(text,integer,integer) from public, anon, authenticated;

create or replace function birras_private.guard_beer_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  -- Administraciones y migraciones sin JWT no usan las cuotas del cliente.
  if auth.role() is distinct from 'authenticated' then return new; end if;
  if actor is null or actor <> new.user_id then raise insufficient_privilege; end if;
  if not exists (select 1 from auth.users where id = actor and email_confirmed_at is not null) then
    raise insufficient_privilege using message = 'Confirmá tu email antes de guardar.';
  end if;
  if tg_op = 'UPDATE' and (new.id <> old.id or new.user_id <> old.user_id or new.created_at <> old.created_at) then
    raise insufficient_privilege using message = 'No se puede cambiar el propietario ni la identidad del registro.';
  end if;
  if new.date > current_date then raise check_violation using message = 'La fecha no puede ser futura.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  if tg_op = 'INSERT' and (select count(*) from public.beers where user_id = actor) >= 10000 then
    raise exception 'Se alcanzó el límite de cervezas de esta cuenta.';
  end if;
  perform birras_private.consume_action('beer-write', 120, 2000);
  return new;
end;
$$;
revoke all on function birras_private.guard_beer_write() from public, anon, authenticated;
drop trigger if exists birras_guard_write on public.beers;
create trigger birras_guard_write before insert or update on public.beers
  for each row execute function birras_private.guard_beer_write();

alter table public.beers enable row level security;
alter table public.beers force row level security;
revoke all on public.beers from public, anon;
grant select, insert, update, delete on public.beers to authenticated;
-- Esta política restrictiva también limita cualquier política permisiva agregada por accidente.
drop policy if exists beers_private_guard on public.beers;
create policy beers_private_guard on public.beers as restrictive for all to public
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.beers drop constraint if exists beers_secure_photo_path;
alter table public.beers add constraint beers_secure_photo_path check (
  photo_path is null or (
    split_part(photo_path, '/', 1) = user_id::text
    and photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  )
) not valid;

create or replace function birras_private.guard_photo_upload()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); total_bytes bigint; own_bytes bigint; own_count bigint;
begin
  if new.bucket_id <> 'beer-photos' or auth.role() is distinct from 'authenticated' then return new; end if;
  if actor is null or split_part(new.name,'/',1) <> actor::text then raise insufficient_privilege; end if;
  if not exists (select 1 from auth.users where id = actor and email_confirmed_at is not null) then raise insufficient_privilege; end if;
  if new.name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then raise check_violation using message = 'Ruta de foto no válida.'; end if;
  -- El cliente usa nombres nuevos, no sobreescribe objetos ya publicados.
  perform pg_advisory_xact_lock(hashtextextended('birras-photo-budget', 0));
  select coalesce(sum(greatest(0,coalesce((metadata->>'size')::bigint,2097152))),0),
         coalesce(sum(greatest(0,coalesce((metadata->>'size')::bigint,2097152))) filter (where split_part(name,'/',1)=actor::text),0),
         count(*) filter (where split_part(name,'/',1)=actor::text)
    into total_bytes, own_bytes, own_count from storage.objects where bucket_id='beer-photos';
  if own_count >= 500 or own_bytes + 2097152 > 104857600 or total_bytes + 2097152 > 838860800 then
    raise exception 'Se alcanzó el límite de almacenamiento. Eliminá fotos que ya no uses o contactá al administrador.';
  end if;
  perform birras_private.consume_action('photo-upload', 20, 200);
  return new;
end;
$$;
revoke all on function birras_private.guard_photo_upload() from public, anon, authenticated;
drop trigger if exists birras_guard_upload on storage.objects;
create trigger birras_guard_upload before insert on storage.objects
  for each row execute function birras_private.guard_photo_upload();

update storage.buckets set public=false, file_size_limit=2097152,
  allowed_mime_types=array['image/jpeg'] where id='beer-photos';
-- No cambiar ni mover fotos mediante UPDATE; la app sube una nueva y borra la anterior.
drop policy if exists beer_photos_update_own on storage.objects;
drop policy if exists beer_photos_private_guard on storage.objects;
create policy beer_photos_private_guard on storage.objects as restrictive for all to public
  using (bucket_id <> 'beer-photos' or (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id <> 'beer-photos' or (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists beer_photos_no_update on storage.objects;
create policy beer_photos_no_update on storage.objects as restrictive for update to public
  using (bucket_id <> 'beer-photos') with check (bucket_id <> 'beer-photos');
commit;

select relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
  from pg_class where oid='public.beers'::regclass;
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='beer-photos';
